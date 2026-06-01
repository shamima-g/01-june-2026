---
description: Migrate a pre-4-phase workflow-state.json to the current INTAKE/PLAN/BUILD/COMPLETE model
---

You are migrating a project that was started under the pre-4-phase workflow (commits before 6d6da27, 2026-05-21) to the current 4-phase model. The transform is deterministic and lives in `.claude/scripts/migrate-legacy-state.js`; your job is to run it, report what changed, and flag anything that needs a human eye. It is fully reversible (a backup is saved and `--restore` reverts everything), so apply directly — don't gate behind an approval step.

## Step 1: Apply

```bash
node .claude/scripts/migrate-legacy-state.js --apply
```

This dry-runs internally and only writes when legacy state is detected; it backs up the original `workflow-state.json` to `workflow-state.legacy-backup.json` first. Statuses:

- **`no_legacy`** — no `workflow-state.json` or `feature-requirements.md`. Tell the user there's nothing to migrate; suggest `/start` for a new feature.
- **`no_migration_needed`** — already on the 4-phase model. Nothing to do.
- **`applied`** — migration ran. Continue to Step 2.

## Step 2: Report what changed (concisely)

1. **What changed** — translate each `changes[]` entry to one line:
   - `state-rewrite` → "`workflow-state.json` rewritten to the 4-phase model"
   - `spec-copy` → "`feature-requirements.md` copied to `project-brief.md` with a migration header"
2. **Spot-check warnings** — from `warnings[]`, surface only the *missing-evidence* ones ("no test files found", "no acceptance criteria found"). These mean a story was marked COMPLETE in legacy state but the migrator couldn't confirm it on disk — list those stories and suggest the user verify them. Don't relay the safe synthesized-field or dropped-block warnings.
3. **Always show the revert path:**
   > "Backup saved to `workflow-state.legacy-backup.json`. To undo: `node .claude/scripts/migrate-legacy-state.js --restore`."

Do NOT print the raw migrated state JSON — the backup and the `changes`/`warnings` summary are the audit trail.

## Step 3: Continue

Suggest `/status` to confirm the new state renders correctly, then `/continue` to resume work. If invoked automatically from `/continue`, just proceed.

## Restore path

To revert (e.g., after seeing `/status` misbehave):

```bash
node .claude/scripts/migrate-legacy-state.js --restore
```

Swaps `workflow-state.legacy-backup.json` back into place and removes the migration-header `project-brief.md` (only if the brief still carries the migration header — a user-edited brief is left intact, with a warning).

## DO

- Apply directly — the migration is reversible, so a pre-approval gate isn't needed.
- Always print the revert command after applying.
- Surface missing-evidence warnings (a "completed" story with no tests/AC on disk) so the user can spot-check.

## DON'T

- Don't dump the raw migrated state JSON into the conversation — the backup and the script output are the audit trail.
- Don't re-apply when the script reports `no_migration_needed`. It's a no-op.
- Don't edit `workflow-state.json` by hand. If the migrator can't handle something, surface it and ask the user — don't paper over it.

## Related commands

- `/status` — confirm post-migration state renders correctly
- `/continue` — resume the workflow from the migrated state
- `/start` — for projects with no legacy state, the normal entry point
