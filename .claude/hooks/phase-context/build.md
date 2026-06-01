# BUILD Phase Context (post-compaction)

This file is injected by `inject-phase-context.ps1` when the orchestrator session is resumed after auto-compaction. Its job is to restore enough context for `/continue` to pick up cleanly — not to re-document the flow.

**Canonical sources:**
- Phase orchestration → [`commands/continue.md`](../../commands/continue.md) § Phase: BUILD
- Per-story loop diagram → [`commands/continue.md`](../../commands/continue.md) (Step B1–B7)
- Halt categories + autonomy tiers → [`shared/agent-autonomy.md`](../../shared/agent-autonomy.md)

## Key file paths

- Brief: `generated-docs/specs/project-brief.md` (receives inline factual updates during BUILD)
- Story metadata: `workflow-state.json` under `epics[currentEpic].stories[currentStory]`
- Tests: `web/src/__tests__/integration/` (Vitest) + `web/e2e/epic-<N>-story-<M>-<slug>.spec.ts` (Playwright)
- Journal: `generated-docs/context/journal.md` (Tier-2 / Tier-3 entries from developer agent)
- Epic completion summary: emitted in chat; full detail in the journal

Sub-state in `workflow-state.json`:
- `currentEpic`, `currentStory`
- `currentStory.status` — `in-progress | halted | complete`
- `currentStory.cycleNumber` — 1 on first try; 2/3 on fix cycles
- `currentStory.lastHalt` — `null` or `{ reason, options, agent }`

## Determining current stage after compaction

| `currentStory.status` | Test files exist? | Code changes uncommitted? | Current stage |
|---|---|---|---|
| `complete` | — | — | Story committed — advance to next story (or epic completion) |
| `in-progress` | No | — | Re-run `test-generator` |
| `in-progress` | Yes | No commits since story start | Re-run `developer` |
| `in-progress` | Yes | Files modified | Mid-implementation — ask user `revert + restart` or `manual finish` per R6 |
| `halted` | — | — | Re-surface `lastHalt` via `AskUserQuestion` |

Recovery: `node .claude/scripts/transition-phase.js --repair` re-reads state from artifacts.
