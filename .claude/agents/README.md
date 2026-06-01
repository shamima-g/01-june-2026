# Claude Code Agents

Specialised Claude Code agents that support the 4-phase workflow (**INTAKE / PLAN / BUILD / COMPLETE**) for building features in this template.

For the phase model, gates, autonomy policy, and orchestration rules see [WORKFLOWS.md](../WORKFLOWS.md), [agent-autonomy.md](../shared/agent-autonomy.md), and [orchestrator-rules.md](../shared/orchestrator-rules.md). This file is just the agent inventory.

## Live Agents

| Phase | Agent | Description |
|-------|-------|-------------|
| **INTAKE** | intake-agent | Scan `documentation/`, run the project-basics checklist, produce `project-brief.md` and the intake manifest |
| **INTAKE** | api-connectivity-agent | At end of INTAKE, parse the OpenAPI spec's `securitySchemes`, capture missing auth details, and run a curl smoke test before PLAN begins |
| **PLAN** | feature-planner | Propose the epic list (`epics` mode), then per-epic stories (`stories` mode); returns structured proposals for orchestrator approval |
| **BUILD** (on-demand) | design-api-agent | Generate `generated-docs/specs/api-spec.yaml` from the brief when an API is needed and no user-provided spec exists |
| **BUILD** (on-demand) | design-style-agent | Generate CSS design tokens and a style reference guide from branding requirements in the brief |
| **BUILD** (on-demand) | type-generator-agent | Generate TypeScript types and typed endpoint functions from the canonical OpenAPI spec |
| **BUILD** (on-demand) | mock-setup-agent | Generate MSW mock handlers from the OpenAPI spec and wire up browser mock infrastructure |
| **BUILD** (per story) | test-generator | Write failing Vitest + React Testing Library tests AND a Playwright spec before implementation |
| **BUILD** (per story) | developer | Implement the story so failing tests pass; reads `project-brief.md` as source of truth |
| **BUILD** (per story, parallel) | playwright-runner | Run the story's Playwright spec once and return a structured JSON result |
| **BUILD** (per story, parallel) | code-reviewer | Read changed files, run quality gates, apply autonomy policy, return findings |

`playwright-runner` and `code-reviewer` run in parallel after `developer`. The BUILD loop is otherwise serial per story.

---

## Available Agents

### INTAKE

#### 1. Intake Agent

**File:** [intake-agent.md](intake-agent.md)

**Purpose:** First agent of the workflow. Scans `documentation/` for any existing material, runs a small project-basics checklist (auth, backend, roles), and produces `project-brief.md` — the single Gate 1 artifact — together with the intake manifest.

**When to use:**
- Always runs first when starting a new feature via `/start`
- Automatically invoked by the orchestrator

**Key outputs:**
- `generated-docs/specs/project-brief.md` (Gate 1 artifact)
- `generated-docs/context/intake-manifest.json`

---

#### 2. API Connectivity Agent

**File:** [api-connectivity-agent.md](api-connectivity-agent.md)

**Purpose:** Runs at the end of INTAKE when the brief specifies a real backend. Parses `securitySchemes` from the OpenAPI spec, captures any missing auth details from the user, and runs a curl smoke test before PLAN begins. Catches credential / connectivity problems before BUILD wastes time on them.

**When to use:**
- After `intake-agent` finishes, only when the brief points to a real backend
- Automatically invoked by the orchestrator

---

### PLAN

#### 3. Feature Planner

**File:** [feature-planner.md](feature-planner.md)

**Purpose:** Drives PLAN. Runs in two modes — `epics` proposes the full epic list for Gate 2a; `stories` proposes stories for a single epic for Gate 2b. When `epicCount === 1`, Gates 2a and 2b collapse into one combined approval. Returns structured proposals only; the orchestrator persists artifacts.

**Key outputs (after orchestrator persistence):**
- `generated-docs/stories/_feature-overview.md` — epic list
- `generated-docs/stories/epic-<N>-<slug>/_epic-overview.md` — story list per epic (story metadata lives in `workflow-state.json`; there are no per-story Markdown files)

---

### BUILD — on-demand artifact generators

These four agents run at the start of BUILD only when their artifact is needed and not already user-provided. The intake manifest records which ones to run.

#### 4. Design API Agent

**File:** [design-api-agent.md](design-api-agent.md)

**Purpose:** Designs a complete OpenAPI specification from `project-brief.md` for API-first development. Skipped when a user-provided spec already exists in `documentation/`.

**Key outputs:**
- `generated-docs/specs/api-spec.yaml`

---

#### 5. Design Style Agent

**File:** [design-style-agent.md](design-style-agent.md)

**Purpose:** Formalises styling and branding requirements into CSS design tokens (`:root` / `.dark` in oklch, replacing Shadcn defaults in `globals.css`) plus a style reference guide for things CSS can't express (typography, spacing, motion, accessibility).

**Key outputs:**
- `generated-docs/specs/design-tokens.css`
- `generated-docs/specs/design-tokens.md`

---

#### 6. Type Generator Agent

**File:** [type-generator-agent.md](type-generator-agent.md)

**Purpose:** Generates TypeScript interfaces and typed API endpoint functions from the canonical OpenAPI spec. Eliminates redundant type inference inside BUILD and keeps types consistent across stories and tests. Also re-runs during `/api-mock-refresh` when schema changes are detected.

**Key outputs:**
- `web/src/types/api-generated.ts`
- `web/src/lib/api/endpoints.ts`

---

#### 7. Mock Setup Agent

**File:** [mock-setup-agent.md](mock-setup-agent.md)

**Purpose:** Generates MSW mock handlers from the OpenAPI spec and wires up the browser mock infrastructure, so the BUILD loop can run against deterministic mocked responses when no live backend is available.

---

### BUILD — per-story loop

For each story the orchestrator runs: **test-generator → developer → (playwright-runner ∥ code-reviewer) → commit**. A Playwright or review failure triggers a scoped fix cycle (developer → re-run the failing check), with a max of 3 cycles before escalation.

#### 8. Test Generator

**File:** [test-generator.md](test-generator.md)

**Purpose:** Generates failing Vitest + React Testing Library tests AND a Playwright end-to-end spec **before** implementation. The tests encode the acceptance criteria as executable code; the Playwright spec runs via `playwright-runner` before the user's manual verification.

**Key outputs:**
- `web/src/__tests__/...` (Vitest)
- `web/e2e/epic-<N>-story-<M>-<slug>.spec.ts` (Playwright)

---

#### 9. Developer

**File:** [developer.md](developer.md)

**Purpose:** Implements exactly one story at a time. Reads `project-brief.md` as the source of truth, consumes `prototype-src/` when present, applies the agent autonomy policy, and halts only on always-halt conditions. Makes the failing tests pass using App Router, Shadcn UI, and the project's API client.

---

#### 10. Playwright Runner

**File:** [playwright-runner.md](playwright-runner.md)

**Purpose:** Owns the Playwright verification step inside BUILD. Resolves the story's spec target, runs Playwright once, and returns a structured JSON result. Runs in parallel with `code-reviewer` after `developer`.

A failure auto-triggers a fix cycle — `developer` patches, then `playwright-runner` re-runs only the failing scope until green or 3-cycle escalation.

---

#### 11. Code Reviewer

**File:** [code-reviewer.md](code-reviewer.md)

**Purpose:** BUILD-loop reviewer. Reads changed files, runs the five quality gates, applies the agent autonomy policy, and returns findings to the orchestrator. Runs in parallel with `playwright-runner` after `developer`.

**What it checks:**
- TypeScript & React quality
- Next.js 16 patterns
- Security (XSS, secrets, BFF auth boundaries)
- Project patterns (API client, types, Shadcn UI)
- Testing coverage
- Accessibility

---

## Workflow at a Glance

1. **INTAKE** — `intake-agent` → (if backend) `api-connectivity-agent` → **Gate 1: approve `project-brief.md`**
2. **PLAN** — `feature-planner (epics)` → **Gate 2a: approve epic list** → `feature-planner (stories)` per epic → **Gate 2b: approve stories** (single-epic features collapse Gate 2a + 2b into one combined gate)
3. **BUILD** — on-demand artifact agents run once at the start (whatever the manifest flags), then per story: `test-generator` → `developer` → (`playwright-runner` ∥ `code-reviewer`) → commit
4. **COMPLETE** — final summary, no agent

Halt conditions live in [agent-autonomy.md](../shared/agent-autonomy.md). Agents proceed autonomously for standard decisions and only halt on the "always halt" categories (security, contract, project-level decisions).

### Quick Quality Check

Outside the BUILD loop, run all 5 gates at any time:

```
/quality-check
```

---

## Context Directory

`generated-docs/context/` is used for agent-to-agent and orchestrator communication. Files here are temporary and gitignored.

| File | Created By | Used By |
|------|------------|---------|
| `intake-manifest.json` | intake-agent | PLAN orchestrator, BUILD on-demand agents |
| `workflow-state.json` | transition scripts | all agents |
| `review-findings.json` | code-reviewer | code-reviewer (next BUILD iteration) |
| `quality-gate-status.json` | code-reviewer | (final output) |

---

## Workflow State Management

### Transition Scripts

| Script | Purpose |
|--------|---------|
| `transition-phase.js` | Manages phase transitions, validates artifacts, detects state from disk, and repairs `workflow-state.json` when it's missing or stale |
| `lib/workflow-helpers.js` | Shared helpers used by `transition-phase.js` and other workflow scripts |

### Script Execution Verification (CRITICAL)

**Agents MUST verify script execution succeeded before proceeding.** When running transition scripts, always check the JSON output:

```bash
# Run the transition
node .claude/scripts/transition-phase.js --current --to BUILD

# Expected success output:
# { "status": "ok", "message": "Transitioned from PLAN to BUILD", ... }

# Error output (DO NOT PROCEED):
# { "status": "error", "message": "Invalid transition...", ... }
```

**Verification rules:**
1. `"status": "ok"` — success, proceed
2. `"status": "error"` — **stop** and report the error to the user
3. `"status": "warning"` — proceed with caution, inform the user

### Validation Flags

```bash
# Check prerequisites before transitioning
node .claude/scripts/transition-phase.js --current --to BUILD --validate

# Verify the FROM phase created expected outputs
node .claude/scripts/transition-phase.js --current --to BUILD --verify-output
```

### Repair Function

If workflow state is lost or corrupted:

```bash
node .claude/scripts/transition-phase.js --repair
```

The repair function returns a **confidence level**:
- **High** — artifacts clearly indicate state, proceed
- **Medium** — some assumptions made, verify with user
- **Low** — many assumptions, require user confirmation before proceeding

---

## Creating Custom Agents

Model new agents on an existing one (e.g. [developer.md](developer.md) for a per-story actor, [intake-agent.md](intake-agent.md) for a single-call orchestrator-driven agent). The minimum each agent needs:

1. YAML frontmatter with `name`, `description`, `model`, and `tools`
2. Clear purpose and "when to use"
3. Step-by-step workflow
4. DO / DON'T guidelines
5. Example return shape (agents return structured text to the orchestrator — they do not talk to the user directly)

---

## Related Documentation

- [Agent Workflow Guide](../../.template-docs/users/Help/Agent-Workflow-Guide.md) — user-facing workflow walkthrough
- [Project README](../../README.md) — project overview and setup
- [CLAUDE.md](../../CLAUDE.md) — Claude Code configuration for this project
- [§12 Tests Verify User-Observable Behavior](../../CLAUDE.md#12-tests-verify-user-observable-behavior) — testing principle and policy pointer
