# INTAKE Phase Context (post-compaction)

This file is injected by `inject-phase-context.ps1` when the orchestrator session is resumed after auto-compaction. Its job is to restore enough context for `/start` or `/continue` to pick up cleanly — not to re-document the flow.

**Canonical sources:**
- Phase orchestration → [`commands/start.md`](../../commands/start.md)
- Single-artifact INTAKE design → [`agents/intake-agent.md`](../../agents/intake-agent.md)
- Backend connectivity → [`agents/api-connectivity-agent.md`](../../agents/api-connectivity-agent.md)
- Gate approval pattern → [`shared/gate-approval-pattern.md`](../../shared/gate-approval-pattern.md)

## Key file paths

- Brief: `generated-docs/specs/project-brief.md`
- Manifest: `generated-docs/context/intake-manifest.json`
- Smoke-test artifact: `generated-docs/context/api-smoke-test.sh`

## Determining current stage after compaction

| `project-brief.md` exists? | Committed to git? | Current stage |
|---|---|---|
| No | — | Pre-Gate 1 — re-run `intake-agent` produce mode |
| Yes | No | Gate 1 pending — re-display brief summary, present approval AUQ |
| Yes | Yes | INTAKE complete — transition to PLAN, hand off to `/continue` |

Recovery: `node .claude/scripts/transition-phase.js --repair` re-reads state from artifacts on disk.
