# Build Timing Policy

Record how long the project takes to build — from the first action to COMPLETE —
broken down by **phase** (macro) and **sub-phase** (granular), with
**manual-intervention time excluded**. The result is a report at
`generated-docs/timing/timing-report.md`.

> **Active build time = total wall-clock − manual-intervention time.**
> Manual-intervention time is any span where Claude has stopped and is waiting on the
> user: gate approvals, manual verification steps, answering clarifying questions, and
> the gaps around `/clear` or between sessions.

## How it works (deterministic — the default path)

This is captured automatically; it does not rely on Claude remembering.

1. **Capture — `.claude/hooks/record-timing.ps1`.**
   Wired in `.claude/settings.json` to fire on `UserPromptSubmit` (→ `prompt`),
   `Stop` (→ `response`), `SubagentStart`, `SubagentStop`, `SessionStart`, and
   `SessionEnd`. On each event it appends one compact JSON line to the ledger,
   stamped with a real UTC ISO timestamp and the workflow phase/epic/story that was
   active at that moment. The hook is fail-safe — any error exits 0 and never blocks
   the workflow.

2. **Ledger — `generated-docs/timing/timing-ledger.jsonl`.**
   Append-only, one event per line. It lives on disk, so `/clear` and context
   resets never lose data. Never rewrite or delete it mid-project. Entry shape:

   ```json
   {"ts":"2026-06-01T11:30:00.000Z","event":"prompt","phase":"BUILD","epic":1,"story":2,"phaseStatus":"in_progress","agent":null,"session":"abc12345"}
   ```

3. **Report — `.claude/scripts/generate-timing-report.js`.**
   Reads the ledger and writes `generated-docs/timing/timing-report.md`:
   - total wall-clock, total manual-intervention time (excluded), and active build time;
   - active time per phase (INTAKE / PLAN / BUILD / COMPLETE);
   - active time per sub-phase, derived from agent spans (e.g. `developer` →
     development, `test-generator` → test-generation, `code-reviewer` → review,
     `playwright-runner` → e2e, `feature-planner` → planning);
   - BUILD active time per story;
   - a cross-check against `workflow-state.json` → `state.history[]` phase boundaries.

   Run it whenever the user asks for build timing:

   ```
   node .claude/scripts/generate-timing-report.js
   ```

   At **COMPLETE**, the orchestrator runs it automatically and commits the artifacts
   (ledger + report) — see Path 1 of the COMPLETE phase in
   [commands/continue.md](../commands/continue.md). The congratulations one-liner
   reports the headline active build time and points to the report.

## Active vs manual — the classification rule

The report walks consecutive ledger events. An interval is **active** unless it
*follows* a point where Claude handed control back to the user. Intervals that start
with `response`, `session_end`, `session_start`, or `permission_request` are
**manual / idle** and are subtracted; intervals starting with `prompt`,
`subagent_start`, `subagent_stop`, or `permission_resolved` are active. This cleanly
excludes think time, gate waits, `/clear` gaps, and overnight breaks without any
manual bookkeeping.

**Permission-approval waits are excluded too.** A permission prompt happens mid-turn
(Claude is otherwise working), so it would be counted as active unless handled
specially. The `record-timing.ps1` hook logs `permission_request` when the prompt is
shown; the next `PreToolUse` (the approval) is recorded as `permission_resolved`,
which bounds the wait. That `permission_request` → `permission_resolved` span is
subtracted and also broken out as its own line in the report summary. To keep the
ledger lean, `PreToolUse` is only recorded when it directly resolves a pending
permission prompt — not for every tool call.

## Build vs debug time per story

The report splits each story's BUILD time into **build** (the initial build + first
verify round) and **debug** (fix-cycle work after that — the Step B6 developer
re-invocations and their re-runs of `playwright-runner` / `code-reviewer`, plus
Step B7.1 manual-test fixes). Two mechanisms, preferring the precise one:

1. **Cycle tag (precise — "from now on").** The orchestrator writes `currentCycle`
   to `workflow-state.json` at each build/fix-cycle start (`1` at Step B3, `2`/`3`
   at Step B6; reset to `1` when BUILD moves to the next story). `record-timing.ps1`
   stamps `cycle` on every ledger event. The report attributes each BUILD interval
   with `cycle >= 2` to **debug**, `cycle 1` to **build** — an exact, interval-based
   split consistent with the active-time totals.
2. **Span-based estimate (fallback — retroactive).** For stories recorded before the
   cycle tag existed (no `cycle` on their events), the report estimates debug time
   from agent spans: the 1st span of a given agent role in a story is the initial
   build/verify; 2nd+ spans of that role are fix-cycle re-runs. These rows are marked
   `~est (spans)` and may not sum exactly to the interval-based Active total (span
   sums vs gap-based intervals — the same caveat as the sub-phase table).

This appears in the report's **"BUILD time per story — build vs debug"** table, with
a per-story fix-cycle count read from each story's `e2eFixCycleCount` in
`workflow-state.json`.

## Manual fallback (only if the hook is unavailable)

If timing hooks are disabled or a non-hooked environment is in use, Claude maintains
the same ledger by hand: at each phase/sub-phase boundary, stamp a real clock time
(`Get-Date -Format o` or `node -e "console.log(new Date().toISOString())"` — never
estimate) and append a matching JSON line to `timing-ledger.jsonl`. When pausing for
the user, append `{"event":"response",...}`; when resuming, append
`{"event":"prompt",...}`. The same report generator then works unchanged.

## Rules

- The ledger is append-only and committed with the rest of the project. Never restart
  or rewrite it; after a `/clear`, continue appending.
- Never fabricate or estimate a timestamp — only ever record a real clock reading.
- Report actual numbers. If the ledger is sparse (e.g. hook was added mid-project),
  say so in the summary rather than implying full coverage.
