# Build Timing — Recommendation

Goal: record the time taken to build this project from beginning to end, broken down
per phase (macro) and sub-phase (granular), **excluding manual-intervention time**
(time spent waiting on the user). Output a final report. The setup must survive
`/clear` and multiple sessions so timing is never lost or forgotten.

## How the existing workflow helps

Two facts about this repo shape the design:

1. **Phase transitions are already timestamped.** `.claude/scripts/transition-phase.js`
   pushes an ISO-timestamped entry into `state.history[]` on every
   INTAKE → PLAN → BUILD → COMPLETE move and every story completion. Macro phase
   boundaries are essentially free.
2. **Every event is already hooked.** `.claude/settings.json` runs
   `capture-context.ps1` on `prompt`, `response` (Stop), `subagent_start` /
   `subagent_stop`, `pre/post_tool_use`, etc. The gap between a `response` and the
   *next* `prompt` is exactly the "manual intervention" time to exclude — Claude is
   idle, waiting for the user.

## Where to store the prompt (so it survives `/clear`)

A prompt that lives only in chat is wiped by `/clear` and by auto-compaction. The only
places guaranteed to be re-injected into **every** context window are:

| Option | Survives `/clear`? | Reliability | Effort |
|---|---|---|---|
| **CLAUDE.md** (a new Critical Rule + a `.claude/policies/timing-policy.md`) | Yes — auto-loaded every session/context | Good — but relies on Claude obeying | Paste once |
| **Hook + report script** (extends `capture-context.ps1` / `state.history`) | Yes — deterministic, no memory needed | Best — cannot be "forgotten" | Build once |

**Recommendation:** do both. Put the *instruction* in `CLAUDE.md` (the "don't forget
across `/clear`" guarantee, since CLAUDE.md is re-loaded into every context). Back it
with an **append-only on-disk ledger** at `generated-docs/timing/` (already a
Write-allowed path) so a `/clear` mid-project loses nothing. The hook version is
strictly more reliable because it reads timestamps the harness already emits.

## The prompt

Paste this as **Critical Rule 13** in `CLAUDE.md` (and/or as
`.claude/policies/timing-policy.md`, linked from the Policies list). It is written to
be unambiguous and `/clear`-safe.

```markdown
### 13. Record Build Timing (Active Time Only)

Throughout the entire project — every phase, every `/clear`, every session — maintain
a development timing ledger. This rule is mandatory and persists across context resets.

**Ledger location (append-only, survives `/clear`):**
`generated-docs/timing/timing-ledger.jsonl` — one JSON object per line, never rewritten.

**On every boundary, append one entry stamped with a REAL clock time** (run
`Get-Date -Format o` or `node -e "console.log(new Date().toISOString())"` — never
estimate or guess a time):

    {"ts":"<ISO-8601>","event":"<event>","phase":"INTAKE|PLAN|BUILD|COMPLETE","unit":"<e.g. epic-1-story-2 or null>","label":"<sub-phase>","note":"<optional>"}

**Events to record:**
- `phase_start` / `phase_end` — macro: the 4 phases.
- `task_start` / `task_end` — granular sub-phases:
    - PLAN: `epic-planning`, `story-planning`
    - BUILD (per story): `test-generation`, `development`, `review`, `e2e`, `fixes`, `commit`
- `pause` / `resume` — see manual-intervention rule below.

**Exclude manual-intervention time (CRITICAL):**
Whenever you stop and hand control to the user — gate approvals, manual verification
steps, answering a clarifying question, or any wait for user input — append a `pause`
entry (`note` = the reason). When you resume working, append a `resume` entry. Time
between `pause`→`resume` is the user's time and MUST be subtracted from active time.
Treat the span from your last action before a `/clear` to your first action after it
as a `pause`/`resume` pair too.

**Surviving `/clear`:** the ledger is on disk, so never restart it. After a reset,
read the last entries, append a `resume`, and continue. Do not re-create or duplicate.

**The report:** at COMPLETE (or whenever the user asks), generate
`generated-docs/timing/timing-report.md` from the ledger:
- Total wall-clock (first `ts` → last `ts`).
- Total manual-intervention time (Σ of pause→resume spans) — reported separately.
- **Active build time = wall-clock − manual-intervention time.**
- A table: each phase and sub-phase with its active duration and occurrence count.
- Per-story breakdown for BUILD.
Cross-check macro phase durations against `workflow-state.json` → `state.history[]`
timestamps and flag any discrepancy.
```

## Why this design meets every requirement

- **Beginning → end:** `phase_start` at INTAKE's first action, `phase_end` at COMPLETE.
- **Granular + macro:** macro = the 4 phases; granular = the named sub-phase labels per story.
- **Ignores manual time:** the explicit `pause` / `resume` protocol subtracts every
  user / gate / verification wait — the formula is
  `active build time = wall-clock − manual-intervention time`.
- **Survives `/clear`:** append-only JSONL on disk + the rule living in CLAUDE.md
  (re-injected into every context).
- **Report:** `generated-docs/timing/timing-report.md`, cross-checked against the
  existing `state.history`.

## Next steps (optional)

- (a) Apply Rule 13 to `CLAUDE.md`.
- (b) Build the deterministic hook + report-generator so timing is captured
  automatically even if Claude forgets — strictly more reliable, since it reads the
  timestamps the harness already emits.
