# Shared Orchestrator Rules

These rules apply to both `/start` and `/continue` orchestrators. Both commands MUST follow everything in this file.

The workflow runs in four phases: **INTAKE → PLAN → BUILD → COMPLETE**.

## Voice (mandatory)

Apply [tone-guide.md](../agents/tone-guide.md) for all user-facing text — knowledgeable colleague, "I" and "we" (never third-person agent references), lead with what's solid, frame gaps as next steps.

**Plain language (mandatory):** users are often non-developers. Strip technical jargon from acceptance criteria checklists, manual verification prompts, quality gate summaries, and status updates. Say "the app builds correctly" not "TypeScript compilation succeeded with zero diagnostics"; say "You should see a loading spinner" not "Verify the isLoading state renders the Skeleton component."

## User Questions (mandatory)

`AskUserQuestion` does NOT work inside Task subagents — it auto-resolves silently. Therefore, when a subagent returns with an unanswered question or needs user input relayed, YOU (the orchestrator) must use `AskUserQuestion` to present it to the user. Never relay questions as plain text output. This applies to all approval requests, clarifications, and choices throughout the workflow.

**Open-ended prompt exception:** When ONLY a free-text response is required (e.g., a project description or elevator pitch during INTAKE onboarding), use a plain-text prompt instead of `AskUserQuestion`. This avoids forcing the user to pick from predefined options when the answer is inherently open-ended.

## User Approval Policy (CRITICAL)

**NEVER auto-approve on behalf of the user.** When an agent returns with work that needs approval:

1. **Output the proposed content as regular conversation text** — the user must see it.
2. **Then** call `AskUserQuestion` for explicit approval.
3. **Only proceed** after receiving the user's actual response.

A subagent's return is visible to you but **invisible to the user** — if the content lives only in the agent's return, you have NOT displayed it yet.

**Self-check before every `AskUserQuestion` call:** *"Does my most recent assistant text include the full content the user is being asked to approve — verbatim?"* If no, output the payload first, then call AUQ.

This applies at the two approval gates in the workflow:

- Gate 1 — `project-brief.md` approval (end of INTAKE)
- Gate 2 — epic list + per-epic stories approval (PLAN). Single-epic features collapse this into one combined gate.

**Fallback if the agent return is empty or unclear:** read the file the agent wrote (e.g., the project brief) and construct the summary yourself before calling AUQ.

**Anti-pattern:** calling AUQ with "Does this look right?" without first outputting what "this" refers to.

## Context Management Policy

The workflow chains continuously through INTAKE → PLAN → BUILD → COMPLETE. State authority lives in `generated-docs/context/workflow-state.json`; `/continue` re-enters at whatever phase state shows.

**Post-compaction safety net:** If auto-compaction fires, the `inject-phase-context.ps1` hook automatically restores workflow state via `additionalContext`. The hook reads `workflow-state.json` and the matching `.claude/hooks/phase-context/<phase>.md` (`intake.md`, `plan.md`, or `build.md`). This covers both orchestrator and subagent sessions.

## Dashboard Update Policy

The HTML dashboard (`generated-docs/dashboard.html`) is regenerated at workflow milestones. The browser auto-refreshes every 10 seconds via `<meta http-equiv="refresh">`, so users see updates automatically if the dashboard is open. These updates are **non-blocking** — a failure must never halt the workflow.

### When to update

| Trigger | Fire-and-forget |
|---|---|
| End of INTAKE (project-brief.md committed) | yes |
| End of PLAN epic-list approval | yes |
| End of PLAN per-epic stories approval | yes |
| After each test-generator return | yes |
| After each developer return | yes |
| After each playwright-runner / code-reviewer parallel return | yes |
| After each story commit | yes |
| At Epic Completion Summary emission | yes |
| At feature completion | yes |

### How to fire

Run the generator script directly — no subagent needed:

```bash
node .claude/scripts/generate-dashboard-html.js --collect
```

This is a single synchronous command (~100ms) that reads workflow state and writes the HTML file. If it fails, log a warning but do not throw. The workflow continues regardless.

**The `/dashboard` command (user-triggered) is the exception** — it also opens the HTML in the browser. See `.claude/commands/dashboard.md`.

## Git Push Authorization (mandatory)

Agents are pre-authorized to run `git push origin HEAD` at designated milestones — the user already approved the underlying work via `AskUserQuestion`. `HEAD` pushes whatever branch the user is currently on (works equally well for `main`, a feature branch, or a spike). When an agent's instructions say push, execute directly; don't re-confirm. On push failure, report the error and stop — don't retry.

Designated push points: after Gate 1 INTAKE commit, after each PLAN gate's commit, after each story commit during BUILD.

## Generated Document Names

Every AI-generated document under `generated-docs/` and every E2E spec under `web/e2e/` has exactly one correct filename shape. The machine-readable source of truth is [.claude/shared/generated-doc-conventions.json](./generated-doc-conventions.json); the human-readable mirror is [.claude/shared/naming-conventions.md](./naming-conventions.md).

The PreToolUse hook `.claude/hooks/enforce-generated-doc-names.js` runs on every `Write`/`Edit`/`MultiEdit` and blocks new files whose names don't match. Existing files on disk are grandfathered. Run `node .claude/scripts/validate-generated-doc-names.js` to audit the whole tree before a commit.

**The two-number rule** (memorize this): when the parent directory already identifies the epic (e.g., `generated-docs/stories/epic-N-[slug]/`), the filename carries **only the story number** — `story-3-role-aware-nav.md`, not `story-1-3-role-aware-nav.md`. When the parent directory is flat (e.g., `generated-docs/reviews/`, `web/e2e/`), the filename carries **both numbers** — `epic-1-story-3-role-aware-nav.spec.ts`. Adding a new document type requires adding an entry to the JSON schema; no code changes needed.

## Scoped Call Pattern

Interactive agents are invoked using scoped calls — focused Task invocations separated by orchestrator-driven `AskUserQuestion` prompts. Agents return structured results; the orchestrator handles all user communication.

**Key rules for every scoped call:**

- Tell the agent which call it is, when applicable (e.g., "This is the produce call — write the brief")
- Tell the agent what NOT to do (e.g., "Do NOT commit. Do NOT use AskUserQuestion.")
- After the agent returns, the orchestrator owns the next step (display results, ask user, launch next call)
- Use **camelCase** for all structured-return field names and scoped-call prompt fields — matches the manifest schema

**Per-phase call patterns:**

| Agent | Phase | Calls | User interaction |
|-------|-------|-------|-------------------------------|
| `intake-agent` | INTAKE | produce + revise (conditional) | 3-question checklist + Gate 1 approval |
| `api-connectivity-agent` | INTAKE | spec analysis + smoke test (conditional) | None |
| `feature-planner` | PLAN | mode `epics` + mode `stories` (per epic) | Gate 2 — combined for single-epic, split for multi-epic |
| `test-generator` | BUILD | Vitest + Playwright (parallel) | None |
| `developer` | BUILD | implement | Halts only on always-halt categories per [agent-autonomy.md](./agent-autonomy.md) |
| `playwright-runner` | BUILD | E2E verification (parallel with code-reviewer) | Halts via parent on `halt` status |
| `code-reviewer` | BUILD | review + quality gates (parallel with playwright-runner) | Halts on always-halt findings |

See the phase-specific orchestrator files for the full call prompts: [`/start`](../commands/start.md) (INTAKE) and [`/continue`](../commands/continue.md) (PLAN and BUILD).

## Halt Handling

When any BUILD agent returns a `HALT` block (per [agent-autonomy.md](./agent-autonomy.md)):

1. Surface the halt block **verbatim** to the user
2. Use `AskUserQuestion` with the options the agent suggested (plus the implicit "Other" affordance for free-text)
3. Capture the user's decision
4. Resume the appropriate BUILD step with the decision passed as additional context

**Halt persistence:** mark the current story's `status: "halted"` in `workflow-state.json` so `/continue` after a session break re-surfaces the halt rather than blindly re-running BUILD.

## Brief Is The Source of Truth

`project-brief.md` overrides template code per [CLAUDE.md §7](../../CLAUDE.md). This rule is baked into the `developer` and `test-generator` agent files; the orchestrator does **not** need to re-inject it on every call. Structural contradictions halt per [agent-autonomy.md](./agent-autonomy.md) Tier 4.

## Commit Policy

Create commits at every logical point:

- After INTAKE (`project-brief.md` + manifest produced and approved)
- After PLAN epic-list approval (`_feature-overview.md` + workflow state)
- After PLAN per-epic stories approval (per-epic overview + workflow state)
- After each story commit during BUILD (tests + implementation + Playwright spec)
- At feature completion (final commit if any state changes remain)

### Commit Message Format (Conventional Commits)

All commit messages MUST follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

**Description** must be lowercase, imperative mood ("add", not "added" or "adds"), and not end with a period.

**Allowed types:**

| Type | When to use |
|------|-------------|
| `feat` | New user-facing functionality (story implementation) |
| `fix` | Bug fix |
| `docs` | Documentation-only changes (INTAKE and PLAN artifacts) |
| `refactor` | Code restructuring with no behaviour change |
| `test` | Adding or updating tests only |
| `chore` | Housekeeping — copying artifacts, config changes, dependency updates |

**Scope conventions by workflow phase:**

| Phase | Scope | Example |
|-------|-------|---------|
| INTAKE | `intake` | `docs(intake): approve project brief` |
| PLAN | `plan` | `docs(plan): epic list approved` / `docs(plan): stories for epic 1 — auth` |
| BUILD (story commit) | `epic-N` | `feat(epic-1): story 2 — add user profile page` |

**Story commits (BUILD phase)** use `feat`, `fix`, or `refactor` depending on the story's nature, with the epic as scope:

```
feat(epic-1): story 2 — add user profile page

- Implemented: profile card, avatar upload, edit form
- Tests: all passing
- Quality gates: all passing
- Manual verification: passed | auto-skipped (component only) | skipped

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Breaking changes** are indicated by appending `!` after the scope or by adding a `BREAKING CHANGE:` footer:

```
feat(epic-2)!: story 3 — replace legacy auth with OAuth2
```

## Script Execution Verification

All transition scripts output JSON. Always verify the result before proceeding:

1. `"status": "ok"` = Success, proceed to next step
2. `"status": "error"` = **STOP**, report the error to the user
3. `"status": "warning"` = Proceed with caution, inform user

**Troubleshooting:**

- Check current state: `node .claude/scripts/transition-phase.js --show`
- Repair if needed: `node .claude/scripts/transition-phase.js --repair`

## TodoWrite Progress Display

After initializing or validating workflow state, display the TodoWrite progress list:

```bash
node .claude/scripts/generate-todo-list.js
```

Parse the JSON output and call `TodoWrite` with the resulting array. This gives the user an immediate visual of the workflow phases.

**After each agent completes and returns to you**, re-run this script and update TodoWrite to reflect the new state. This keeps the progress display current throughout the workflow.
