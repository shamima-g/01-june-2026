# Template Development Guide

For maintainers of the template repository itself. Release process, version strategy, and PR labels live in [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Philosophy

The workflow exists for end-users, not maintainers. Optimise for:

- **Minimal friction** — interrupt the user only at deliberate gates
- **Speed** — agents run in parallel where they can; the BUILD loop owns its own retries
- **Reliability** — quality gates are binary; no rationalised failures
- **Resilience** — `/continue` resumes from any phase via `workflow-state.json`
- **Pleasantness** — the user should enjoy interacting with the workflow

When evaluating a change, ask: does this make the user's experience better, or does it add a step to defend the workflow against itself?

---

## Local repo hygiene (template developers only)

The workflow guard, session logging, and `generated-docs/` exist for end-users. As a template developer you don't commit your own logs or generated artefacts.

Add these to your local `.git/info/exclude` (a per-clone ignore file that is never committed):

```
.claude/logs/
.specstory/history/
generated-docs/
```

The workflow guard hook fires on every `UserPromptSubmit` and redirects non-workflow prompts to `/start`. It is intended for end-users running real features. When you are making documentation, infrastructure, or agent changes, ignore the guard's redirect prompt — it isn't for you.

---

## Where things live

```
├── .claude/
│   ├── agents/        # Agent definitions (see .claude/agents/README.md)
│   ├── commands/      # Slash commands (/start, /continue, /status, ...)
│   ├── hooks/         # PreToolUse / UserPromptSubmit / SessionStart hooks
│   ├── policies/      # Cross-cutting policies (auth, testing, file ops, ...)
│   ├── scripts/       # transition-phase.js, scan-doc.js, quality-gates.js, ...
│   └── WORKFLOWS.md   # The 4-phase workflow reference
├── web/               # Next.js frontend (excluded from template sync)
├── documentation/     # User-provided specs read during INTAKE (read-only)
├── generated-docs/    # Workflow outputs (briefs, specs, state, dashboards)
├── .github/           # CI workflows + scripts
└── .template-docs/    # This guide and the user-facing help centre
```

---

## Modifying the workflow

Quality gates catch broken code; they don't catch a broken hook, a regressed agent prompt, or a slash command that no longer runs cold. When you change anything under `.claude/`, smoke-test the surface that changed.

| Surface             | What it does                         | Smoke test                                                              |
| ------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| `.claude/agents/`   | Agent prompts and tool grants        | `/start` on a minimal feature; watch the agent's step land correctly    |
| `.claude/commands/` | Slash command bodies                 | Invoke the command from a cold session (no prior context)               |
| `.claude/hooks/`    | React to harness events              | Trigger the real event the hook fires on — `/start` alone won't do it   |
| `.claude/policies/` | Referenced inline from agent prompts | Grep for referencing files; re-run those agents                         |
| `.claude/scripts/`  | Called by hooks and commands         | Run directly first (`node .claude/scripts/foo.js`), then via its caller |

For orchestrator-path changes (`workflow-state.json`, `/continue` resumption, phase transitions) also pause mid-BUILD and resume — confirm the right step re-fires.

### Keep bash permission prompts low

User permission prompts are the loudest friction in the workflow. Every new bash command an agent runs is a potential prompt. Before adding one:

1. Check [`.claude/hooks/bash-permission-checker.js`](../../.claude/hooks/bash-permission-checker.js) for the existing allowlist
2. If it's a recurring command, extend the allowlist so agents don't trip on it
3. Prefer Read / Edit / Write / Glob / Grep over shelling out — those don't require bash permission

---

## Design decisions

### 1. BFF as the encouraged auth path

**Decision:** When the brief specifies authentication, the BFF pattern is the encouraged path. The template documents the endpoint contract and Next.js integration shape but does not ship the BFF runtime itself.

**Rationale:**

- Tokens stay in HttpOnly cookies server-side — XSS can't exfiltrate them
- The client bundle ships no auth library
- CSRF is handled by `SameSite=Strict` cookies
- The backend enforces auth uniformly across all API consumers

Full security best-practices and integration shape live in [bff-auth-pattern.md](../../.claude/policies/bff-auth-pattern.md).

### 2. Vitest + Playwright split

**Decision:** Vitest + React Testing Library for unit/integration tests (jsdom), Playwright for end-to-end browser specs. One Playwright spec per routable story is mandatory — see [CLAUDE.md §10](../../CLAUDE.md).

**Rationale:**

- Vitest: fast, ESM-native, integrates with the Vite ecosystem
- Playwright: catches runtime issues that mocked tests can't (real navigation, real browser auth flows, redirects, middleware)

The full Vitest-vs-Playwright-vs-manual split lives in [testing-policy.md](../../.claude/policies/testing-policy.md).

### 3. Per-story commits

**Decision:** BUILD commits after each story passes its quality gates and the user's manual verification, not at the end of an epic.

**Rationale:**

- Small, atomic commits make review and rollback straightforward
- A failed story doesn't block already-completed stories from landing
- The dashboard and `/status` reflect real per-story progress

### 4. Post-epic user manual testing

**Decision:** After every epic the workflow halts at a manual test gate before moving on.

**Rationale:** Mock-based tests can't tell you the page feels right, that the network actually wires through, or that copy reads sensibly to a human. One user interaction per epic catches the class of bugs that only surface in a real browser against a real backend — cheap to pay, expensive to skip.

---

## Template sync boundary

The template ships to derived repos via [`.github/workflows/sync-template.yml`](../../.github/workflows/sync-template.yml). The `/web` folder is **excluded** from sync; everything else under the repo root flows to user projects on the next sync run.

Practical implication: changes to `.claude/`, `.github/`, `CLAUDE.md`, root configs, and `.template-docs/` will land in every derived project. Treat them with that blast radius in mind.

Full release and sync process: [CONTRIBUTING.md](CONTRIBUTING.md).
