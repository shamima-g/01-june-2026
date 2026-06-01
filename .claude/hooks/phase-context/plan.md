# PLAN Phase Context (post-compaction)

This file is injected by `inject-phase-context.ps1` when the orchestrator session is resumed after auto-compaction. Its job is to restore enough context for `/continue` to pick up cleanly — not to re-document the flow.

**Canonical sources:**
- Phase orchestration → [`commands/continue.md`](../../commands/continue.md) § Phase: PLAN
- Two-mode contract → [`agents/feature-planner.md`](../../agents/feature-planner.md)
- Gate approval pattern → [`shared/gate-approval-pattern.md`](../../shared/gate-approval-pattern.md)

## Key file paths

- Brief: `generated-docs/specs/project-brief.md`
- Feature overview: `generated-docs/stories/_feature-overview.md` (epic list)
- Per-epic overview: `generated-docs/stories/epic-<N>-<slug>/_epic-overview.md` (story list)
- State: `generated-docs/context/workflow-state.json`

Sub-state in `workflow-state.json`:
- `epics` — keyed by epic number; populated after epic-list approval
- `epics[N].stories` — keyed by story number; populated after per-epic approval
- `currentEpic` — epic whose stories are in BUILD or just approved

## Determining current stage after compaction

| `_feature-overview.md` exists? | `currentEpic` has stories? | Current stage |
|---|---|---|
| No | — | Pre-epic-list — re-run `feature-planner` mode `epics` |
| Yes (epics committed) | No | Pre-stories — re-run `feature-planner` mode `stories` for `currentEpic` |
| Yes | Yes (stories committed) | PLAN complete for this epic — transition to BUILD |

Recovery: `node .claude/scripts/transition-phase.js --repair` re-reads state from artifacts.

**Single-epic short-circuit:** when `feature-planner` returns `epicCount === 1`, Gates 2a and 2b collapse into one combined approval.
