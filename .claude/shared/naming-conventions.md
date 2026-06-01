# Generated document naming conventions

This file is the human-readable mirror of [generated-doc-conventions.json](./generated-doc-conventions.json). The JSON is the machine-readable source of truth — it's consumed by the PreToolUse enforcement hook and the repo-wide validator. When you change one, update both.

## Why these rules exist

Every generated document type in this template has exactly one correct filename shape. Drift silently breaks downstream tooling:

- The dashboard's "Test Coverage" card uses `/story-(\d+)/` to extract the story number. If stories are named `story-<epic>-<story>-<slug>.md` the regex captures the epic number instead, and stories 2+ disappear from the dashboard.
- The E2E pre-check globs `epic-<N>-story-<M>-*.spec.ts` — both numbers are required.

## Enforcement

- **Creation-time (hard):** `.claude/hooks/enforce-generated-doc-names.js` runs as a PreToolUse hook on `Write`, `Edit`, and `MultiEdit`. It blocks any new file in `generated-docs/` or `web/e2e/` whose name doesn't match this schema. Existing files on disk are grandfathered — the hook only blocks NEW creations (so agents can still edit historical files with legacy names).
- **On-demand audit:** `node .claude/scripts/validate-generated-doc-names.js` walks the repo and reports any file that doesn't match, regardless of whether it existed before the hook was added.

## The rules

| Document | Directory glob | Filename pattern | Good | Bad |
|---|---|---|---|---|
| Epic overview | `generated-docs/stories/epic-*/` | `^_epic-overview\.md$` | `_epic-overview.md` | `epic-overview.md` |
| Feature overview | `generated-docs/stories/` | `^_feature-overview\.md$` | `_feature-overview.md` | `feature-overview.md` |
| E2E spec | `web/e2e/` | `^epic-\d+-story-\d+-[a-z0-9-]+\.spec\.ts$` | `epic-1-story-3-role-aware-nav.spec.ts` | `story-3-role-aware-nav.spec.ts` |

> Story metadata lives in `workflow-state.json` under `epics[N].stories[M]`; only `_epic-overview.md` is written for visibility — no per-story Markdown files are produced.

## The two-number rule

Two different conventions are in play, distinguished by whether the parent directory already identifies the epic:

- **When the parent directory is `epic-N-[slug]/`** → the filename contains the **story number only** (e.g., `story-3-*.md`). Epic number is already unambiguous from context.
- **When the parent directory is flat** (e.g., `reviews/`, `web/e2e/`) → the filename contains **both numbers** (e.g., `epic-1-story-3-*.md`). Flat directories have no context, so the filename carries it.

If you catch yourself writing `story-<epic>-<story>-<slug>.md` inside an `epic-N-[slug]/` directory, stop — that's the drift pattern the hook exists to prevent.

## Adding a new document type

1. Add an entry to [generated-doc-conventions.json](./generated-doc-conventions.json) with `id`, `writtenBy`, `dirGlob`, `filenamePattern`, `example`, `counterexample`, `rationale`.
2. Add a row to the table above.
3. Run `node .claude/scripts/validate-generated-doc-names.js --verbose` to confirm existing files of that type still match.

The hook and validator both re-read the JSON every invocation — no code changes required when you add a new convention.
