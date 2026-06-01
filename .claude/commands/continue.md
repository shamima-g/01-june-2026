---
description: Continue the workflow — drives PLAN gates and the BUILD loop. Resumes from any phase based on workflow-state.json.
---

Continue the feature workflow. `/start` runs INTAKE through Gate 1 and chains here; `/continue` can also be invoked directly to resume after a session break.

**Read and follow all rules in [orchestrator-rules.md](../shared/orchestrator-rules.md).**

## Execution Model

`/continue` is parent-driven. Read workflow-state.json, determine the current phase, execute its instructions directly. Launch work agents via `Agent` with the named subagent_type. Present approvals via `AskUserQuestion`.

The flow runs continuously from PLAN through BUILD to COMPLETE. State is authoritative; the orchestrator re-enters at whatever phase the state shows.

If `workflow-state.json` uses pre-4-phase phase names (`DESIGN`/`SCOPE`/`STORIES`/`REALIGN`/`WRITE-TESTS`/`IMPLEMENT`/`QA`), it's a legacy project — run `/migrate-legacy` before proceeding.

## Phase Flow

```
INTAKE (resume only) → PLAN → BUILD → (next epic) → COMPLETE
                       ⛳ 1–2 gates    no gates
```

| Phase | What runs | Gates |
|---|---|---|
| INTAKE | (resume support only — /start owns the happy path) | Gate 1 if interrupted |
| PLAN | `feature-planner` (epics + per-epic stories) | Gate 2 (single combined for 1-epic features; epic-list + per-epic stories for multi-epic) |
| BUILD | per story: `test-generator` → `developer` → (`playwright-runner` ∥ `code-reviewer`) → commit | None (autonomous within an epic) |
| COMPLETE | Final summary + congrats | — |

---

## Step 1: Read State

```bash
node .claude/scripts/collect-dashboard-data.js --format=json --with-todos
```

Parse the output. Call `TodoWrite` with `data.todos` to restore the progress display (lost if the session context was cleared).

### If `status: "no_state"`:

Attempt repair:

```bash
node .claude/scripts/transition-phase.js --repair
```

After repair, check confidence:

- `"high"` — proceed
- `"medium"` — show `detected` / `assumed` arrays, confirm with user
- `"low"` — require user verification before proceeding

If repair fails: ask user "No workflow state or artifacts found. Run `/start` to begin fresh?"

### If `status: "ok"`:

```
Resuming: phase=[phase], epic=[N], story=[M]
```

Find the matching section below and execute its instructions.

---

## Phase: INTAKE (Resume Only)

If state shows `INTAKE` but `/start` was interrupted before Gate 1 approval, resume:

1. Check `generated-docs/specs/project-brief.md`:
   - **Missing** → re-invoke `intake-agent` mode `produce` with the same context recoverable from `intake-manifest.json` and (if present) the routing path. If unrecoverable, ask the user briefly: "Looks like INTAKE didn't finish. Want to re-run it from the top?"
   - **Exists but uncommitted** → present Gate 1 via the [Gate Approval Pattern](../shared/gate-approval-pattern.md) with options Approve / Adjust / Edit-directly / Start-over. See `/start` Step 8 for the format.
2. On approval → commit and transition per `/start` Step 9, then continue to PLAN.

---

## Phase: PLAN

PLAN has two sub-phases driven by `feature-planner`:

1. **Epic list** — `feature-planner` mode `epics` produces a flat list
2. **Per-epic stories** — `feature-planner` mode `stories` produces stories for each epic

**Single-epic short-circuit** collapses these into one combined gate.

### Step P1: Epic List Generation

Check `workflow-state.json` for `epics` array:

- **Missing or empty** → invoke `feature-planner` mode `epics`
- **Populated and approved** → skip to Step P3 (per-epic stories)

Launch:

```
Agent: feature-planner
mode: epics
input: project-brief.md
```

Wait for return. The agent returns an `EPICS PROPOSAL` block with `epicCount`, the `epics` array, and `unmappedRequirements`.

### Step P2: Single-Epic Short-Circuit Detection

If `epicCount === 1`:

1. Skip the standalone epic-list gate
2. Immediately invoke `feature-planner` mode `stories` for the single epic
3. Present a **combined gate** showing the epic + its stories together

This collapses two gates into one for small features (the LibertyBold scenario).

Otherwise (multi-epic): proceed to the epic-list gate below.

### Step P2 (multi-epic): Epic List Gate

Display the epic proposal as conversation text first:

```
I see this work breaking down into [epicCount] epics:

1. **[Epic Name]** — [summary] (covers [requirementIds])
2. **[Epic Name]** — [summary] (covers [requirementIds])
   - Depends on: Epic 1

[If unmappedRequirements is non-empty:]
**Worth a look:** [IDs] aren't assigned to any epic — that might mean the brief has scope I missed, or they belong somewhere we should discuss.
```

Then `AskUserQuestion`:

- **Question:** "Does this epic breakdown make sense?"
- **Options:**
  - "Approve all" — proceed to per-epic stories
  - "Adjust the list" — free-text deltas
  - "Start over" — discard and re-propose

**Revision flow:** invoke `feature-planner` mode `epics` with `revisionFeedback`. Loop until approved.

**On approval:**

1. Persist epic list to `workflow-state.json` (`epics` array with `index`, `name`, `slug`, `summary`, `requirementIds`, `dependsOn`, `nonGoals`, `status: "pending"`, `manualTestStatus: "pending"`)
2. Write epic list to `generated-docs/stories/_feature-overview.md` for visibility
3. Commit:

```bash
git add generated-docs/stories/_feature-overview.md generated-docs/context/workflow-state.json .claude/logs/
git commit -m "docs(plan): epic list approved"
git push origin HEAD
```

4. Update phase totals:

```bash
node .claude/scripts/transition-phase.js --set-totals epics N
```

5. Proceed to Step P3.

### Step P3: Per-Epic Stories Gate

For the first epic where `status === "pending"`:

Invoke `feature-planner` mode `stories`:

```
Agent: feature-planner
mode: stories
epicName: <name>
epicSummary: <summary>
epicRequirementIds: <ids>
```

Wait for return. The agent returns a `STORIES PROPOSAL` with story details per story (`plainSummary`, `manualTestChecklist`, `isInfrastructureOnly`, `acceptanceCriteria` as `{ id, text, coverage }` objects, `specGaps`), plus epic-level `epicIntroducesSharedSurface`, `infrastructureReuseNotes`, and `prototypeSrcRoutes`. The epic's `nonGoals` come from `workflow-state.json` (set by `feature-planner` mode `epics`).

The planner self-validates the coverage tag set per its success criteria (every AC has a tag from the closed set; `playwright` tags only on routable stories). Trust the return — no inline re-validation needed here.

Display the proposal as conversation text first using the **slim format** — plain language, user-perspective, no implementation jargon (the planner applied its [Translation Rule](../agents/feature-planner.md#translation-rule) to produce these strings; render them verbatim):

```
## Epic — [name]

Here's what this epic builds:

[For each story in order:]

[If isInfrastructureOnly is true:]
**[N]. [Story Title]** *(under-the-hood — verified by step [N+1])*
[plainSummary]

[Otherwise:]
**[N]. [Story Title]**
[plainSummary]

Manual tests when this epic is done:
- ☐ [manualTestChecklist item 1]
- ☐ [manualTestChecklist item 2]
- ...

[After the last story, if epic.nonGoals is non-empty:]
**What this epic is NOT building** *(in case you expected any of these):*
- [nonGoals item 1]
- [nonGoals item 2]
- ...

[If any story has specGaps non-empty, render a separate block AFTER the story summaries:]
**Spec gaps worth a look** *(operations these stories need but the API spec doesn't document):*
- [story 2] [specGaps[0]]
- [story 3] [specGaps[0]]
- ...
*You can fix the spec inline, change the story to use documented endpoints, or proceed and resolve each gap during BUILD.*

[If prototypeSrcRoutes is non-empty (optional context, brief):]
*Prototype reference: I'll use your existing wireframes for the screens above.*
```

The technical detail (full `acceptanceCriteria` with coverage tags, `requirementIds`, `targetFile`, `slug`, `summary`, `infrastructureReuseNotes`, `prototypeSrcRoutes`, `epicIntroducesSharedSurface`) is persisted to `workflow-state.json` and `_epic-overview.md` for the agents, but **not shown to the user at this gate**. The slim format above is what the user evaluates.

Then `AskUserQuestion`:

- **Question:** "Ready to build [epic name]?"
- **Options:**
  - "Approve epic" — kick off BUILD
  - "Adjust the stories" — free-text deltas
  - "Skip this epic" — mark deferred, move to next

**Revision flow:** invoke `feature-planner` mode `stories` with `revisionFeedback`. Loop until approved or skipped.

**On approval:**

1. Persist stories to `workflow-state.json` under the epic's `stories` array — include **all** returned fields (`title`, `slug`, `summary`, `plainSummary`, `requirementIds`, `roles`, `route`, `targetFile`, `pageAction`, `isInfrastructureOnly`, `acceptanceCriteria` (array of `{ id, text, coverage }`), `manualTestChecklist`, `specGaps`). Persist epic-level `epicIntroducesSharedSurface`, `infrastructureReuseNotes`, and `prototypeSrcRoutes` on the epic itself (the developer reads the latter two in Step B3). Initialize epic-level `manualTestStatus: "pending"` if not already set.
2. Write per-epic stories file to `generated-docs/stories/epic-<N>-<slug>/_epic-overview.md` for visibility (story metadata only; not full file-per-story)
3. Update phase totals + transition:

```bash
node .claude/scripts/transition-phase.js --epic N --set-totals stories M
node .claude/scripts/transition-phase.js --epic N --story 1 --to BUILD --verify-output
```

4. Commit:

```bash
git add generated-docs/stories/epic-N-*/ generated-docs/context/workflow-state.json .claude/logs/
git commit -m "docs(plan): stories for epic [N] — [name]"
git push origin HEAD
```

5. Proceed to BUILD phase.

---

## Phase: BUILD

Per story in the current epic, run the BUILD loop. Each story is a sequential mini-pipeline.

### Step B1: Read Current Story

From `workflow-state.json`: `currentEpic`, `currentStory`. Read the story's metadata from the in-state `stories` array. The story includes title, summary, requirementIds, roles, route, targetFile, pageAction, and `acceptanceCriteria` (array of `{ id, text, coverage }`). Read the epic's `epicIntroducesSharedSurface` flag from the epic record; read `playwrightMockingDefault` from `intake-manifest.json` → `context.testInfrastructure.playwrightMockingDefault` (defaults to `page-route-with-spec` if absent).

### Step B2: test-generator

Launch in parallel via a single Task batch — Vitest tests and Playwright spec are independent files:

```
Agent batch:
  - subagent_type: test-generator
    mode: vitest
    story: <metadata>
    epicIntroducesSharedSurface: <bool>
    playwrightMockingDefault: <enum>
  - subagent_type: test-generator
    mode: playwright
    story: <metadata>
    epicIntroducesSharedSurface: <bool>
    playwrightMockingDefault: <enum>
```

Await both. The agent returns paths to the generated test files. The vitest call may also return `baselinePath` when it created or extended the per-epic baseline file — capture it and add to the file list passed downstream.

**Halt check:** If the story is routable (`route !== null`) AND `test-generator` did NOT produce a Playwright spec at `web/e2e/<story-slug>.spec.ts`, this is an always-halt condition per [agent-autonomy.md](../shared/agent-autonomy.md). Stop BUILD and surface to user:

```
HALT — story <slug> is routable but no Playwright spec was generated. Rule 10 enforcement requires every routable story to have an E2E spec.
What should we do?
1. Re-run test-generator (might be a transient issue)
2. Mark this story non-routable (skip the spec)
3. Stop and investigate
```

### Step B3: developer

```
Agent: developer
story: <metadata>
infrastructureReuseNotes: <epic-level array>
prototypeSrcRoutes: <epic-level map>
testPaths: [<vitest paths>, <playwright path>]
cycleNumber: 1
```

The agent reads `project-brief.md`, reads `prototype-src/<route>/` when available, reads `generated-docs/context/api-shape-report.md` when it exists, implements code, runs `npm --prefix web test -- --run`, returns `DEVELOPER COMPLETE` or `HALT` or `DEVELOPER UNABLE TO RESOLVE`.

**On `HALT`:** surface the halt block verbatim to the user with `AskUserQuestion`. Resume BUILD with the user's chosen option as additional context in a re-invocation.

**Endpoint-invention HALT special handling.** When `halt.category === "undocumented-endpoint"` (per [agent-autonomy.md](../shared/agent-autonomy.md) Tier 4), surface the four-option menu rather than the agent's default options:

```
HALT — story <slug> needs an API operation that isn't in the spec.

The agent wants to call:
  <method> <path> <queryParams|headers|body>

The spec documents:
  <related-but-not-matching-operations>

How should we proceed?
```

`AskUserQuestion` options:

1. **Add to spec, proceed** — user pastes the missing operation definition (path, method, params, response shape) as free-text via "Other". Agent updates `documentation/<spec>.yaml`, re-invokes developer with the updated spec.
2. **Use a documented alternative** — agent describes a workaround using existing endpoints (e.g., list + client-side filter). User confirms. Agent proceeds with the workaround approach.
3. **Defer story — backend team needs to add** — story marked `status: "blocked"` with `blockedReason: <spec-gap>` in `workflow-state.json`. BUILD moves to the next story.
4. **Acknowledge undocumented extension, proceed with audit trail** — release valve. The agent proceeds AND auto-journals a Tier 3 `[review]` entry with the specific endpoint + variant. The journal is the audit trail; the epic-completion summary surfaces the entry at the next epic boundary so the user reviews it explicitly.

After the user picks, re-invoke `developer` with `priorFailures.endpointInvention: { resolution: <option-1|2|3|4>, details: <follow-up text> }`.

**On `DEVELOPER UNABLE TO RESOLVE`:** treat as fix-cycle failure (Step B6).

### Step B4: Parallel — playwright-runner ∥ code-reviewer

Fire both in a single Task batch. Include the per-epic baseline file (if Story 1 wrote one this cycle) in `changedFiles`:

```
Agent batch:
  - subagent_type: playwright-runner
    storySlug: <slug>
  - subagent_type: code-reviewer
    story: <metadata>
    changedFiles: [<paths from developer's return>, <baselinePath if present>]
```

Await both returns.

**Outcomes:**

| `playwright-runner` | `code-reviewer.overallVerdict` | Next step |
|---|---|---|
| pass | `ready-to-commit` | B5 — commit |
| pass | `fix-cycle-needed` | B6 — fix cycle |
| pass | `halt` | Surface halt block to user |
| fail | (any) | B6 — fix cycle |

### Step B5: Commit

**Before staging:** append the developer's `tier2JournalEntries` and `tier3JournalEntries` to `generated-docs/context/journal.md` under the current epic's section (create the section header if this is the first story in the epic). Tier 1 decisions stay in the commit body only — they don't go in the journal.

```bash
git add web/src/ web/e2e/ generated-docs/specs/project-brief.md generated-docs/context/journal.md generated-docs/context/workflow-state.json .claude/logs/
git commit -m "$(cat <<'EOF'
feat(epic-<N>-story-<M>): <story title>

[Developer's commit body — Tier 1 decisions, brief updates, key choices]

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin HEAD
```

Transition:

```bash
node .claude/scripts/transition-phase.js --epic N --story M --to COMPLETE --verify-output
```

Update `workflow-state.json`: mark the story `status: "complete"`.

**Output to user (one line):**

```
Story <M>/<totalInEpic> done — moving to story <M+1>.
```

Then loop back to Step B1 with the next story.

### Step B6: Fix Cycle

Re-invoke `developer` with:

```
Agent: developer
story: <metadata>
infrastructureReuseNotes: <epic-level array>
prototypeSrcRoutes: <epic-level map>
testPaths: [<vitest paths>, <playwright path>]
cycleNumber: <2 or 3>
priorFailures: {
  playwright: <playwright-runner output if failed>,
  codeReview: <findings from code-reviewer if fix-cycle-needed>
}
```

After developer returns, re-fire the parallel playwright-runner + code-reviewer per Step B4.

**Cycle cap:** if cycleNumber > 3, halt:

```
HALT — story <slug> hit the 3-cycle fix limit. Manual intervention needed.
Last failures:
- Playwright: [first-line]
- Code review: [Critical or High findings]
What should we do?
1. Walk me through the issue
2. Defer this story (mark non-routable, skip Playwright)
3. Stop the workflow
```

### Step B7: Epic Complete

When the last story in the epic finishes B5:

**Read journal entries for this epic:**

```bash
node .claude/scripts/collect-dashboard-data.js --format=json --with-todos
```

(The same dashboard-data script already powers `/status`; it returns per-epic state.) Then read the journal directly to extract Tier-3 entries for the current epic:

```bash
node -e "const fs=require('fs');const j=fs.readFileSync('generated-docs/context/journal.md','utf-8');const epicHeader=/^## Epic \\d+/m;const blocks=j.split(epicHeader);const last=blocks[blocks.length-1];const lines=last.split('\\n');const flagged=lines.filter(l=>/^- \\[(review|affects-downstream)\\]/.test(l));console.log(JSON.stringify(flagged,null,2));"
```

`flagged` is the array of `[review]` / `[affects-downstream]` one-liners written by the developer agent during this epic. If empty, omit the "Things worth a glance" section from the summary.

**Emit the Epic Completion Summary as conversation text:**

```
Epic <name> complete.

Commits (<N>):
  - <sha> <story 1 title>
  - <sha> <story 2 title>
  ...

Autonomous decisions made during this epic (<M>):
  - <story>: <decision> — <rationale>
  ...

[If flagged is non-empty:]
Things worth a glance (from journal):
  - <each flagged entry, verbatim>
  ...
```

Full detail lives in `generated-docs/context/journal.md` (path moves under multi-feature). The chat summary stays terse — only `[review]`-tagged and `[affects-downstream]` entries surface; the user can open the journal for the rest.

#### Step B7.1: Manual-Test Gate

After emitting the Epic Completion Summary, run the manual-test gate.

**Legacy detection (backward compatibility):** if **every non-infrastructure story** in this epic lacks `manualTestChecklist` (the epic was planned before this gate existed), skip the gate. Set epic `manualTestStatus: "legacy"` and emit a one-line notice:

```
Epic [name] was planned before the manual-test gate was added. No checklist available — proceeding as before.
```

Then continue to the "more epics remain?" check below.

**Otherwise**, render the manual-test gate in two parts: first emit the checklist as conversation text (see "Output text (before the AUQ)" below), then ask via `AskUserQuestion`. Never embed the checklist inside the AUQ — it can't be formatted there and becomes unreadable.

**Rendering rules:**

- **Group by story.** Each story's items appear under a bold story title heading so the user knows what they're testing.
- **Skip infrastructure-only stories** (`isInfrastructureOnly: true` or empty `manualTestChecklist`). They have no user-testable behaviour.
- **Do not re-render non-goals.** They're a planning concern, not a test step.
- **Length budget.** Single AUQ even for long lists. If a future epic exceeds ~30 items, log a one-line warning (planning signal the epic should have been split) but still render.
- **Boxes are presentation-only.** We don't persist per-item tick state.

**Output text (before the AUQ):**

```
Walk through these manual tests for [Epic name]:

**[Story 2 title]**
- ☐ [test item 1]
- ☐ [test item 2]
...

**[Story 3 title]**
- ☐ [test item 1]
...
```

Then `AskUserQuestion`:

- **Question:** "Did everything check out?"
- **Options:**
  - "All good" — mark epic `manualTestStatus: "passed"`; proceed
  - "Found an issue" — see [Fix-cycle integration](#fix-cycle-integration) below
  - "Skip for now" — mark epic `manualTestStatus: "skipped"`; proceed (surfaces on dashboard with badge)

**On `manualTestStatus` change**, write to `workflow-state.json` and fire dashboard regeneration.

##### Fix-cycle integration

When the user picks "Found an issue":

1. `AskUserQuestion` (free-text via "Other"): *"What's the issue? Paste or describe the test step that failed and what you saw instead."*
2. Pattern-match the user's text against the epic's per-story `manualTestChecklist` items to pick the most-likely affected story. Heuristic: keyword overlap with story title + checklist items.
   - **Clear match** → proceed with that story.
   - **Ambiguous match** (no clear winner, or affects multiple) → follow-up AUQ; for epics with ≤3 non-infrastructure stories, list them as options; for >3, present the top-3 by keyword score plus an *"Other / multiple stories"* free-text option.
3. Mark epic `manualTestStatus: "issues"` in state.
4. Re-enter BUILD's existing fix cycle (Step B6) for the chosen story with the user's report packaged as `priorFailures.manualTest: { description: <free-text>, storySlug: <slug> }`.
5. After `developer` returns successfully and the parallel `playwright-runner ∥ code-reviewer` re-run passes, **re-display the Step B7.1 manual-test gate for the same epic** (the user re-walks the checklist).

**Cycle cap:** 3 manual-test fix cycles per epic. Implementation chooses whether to share Step B6's existing `cycleNumber` counter or use a separate `manualTestCycleNumber` — the constraint is the 3-attempt budget. On cap, halt with:

```
HALT — epic [name] has hit 3 manual-test fix cycles. Manual intervention needed.
What should we do?
1. Defer the remaining failures and move on (mark manualTestStatus: skipped)
2. Stop the workflow
```

#### Step B7.2: Move On

After the manual-test gate resolves (passed / skipped / legacy), check if more epics remain:

- **Yes** → loop back to Phase PLAN Step P3 for the next pending epic. The user can interject before the next gate fires.
- **No** → proceed to COMPLETE.

---

## Phase: COMPLETE

There are two entry paths here:

1. **Just finished the last epic** — Step B7.2 transitioned to COMPLETE and `featureComplete` isn't yet `true`. Mark it, emit the congratulations one-liner, and stop:

   ```bash
   node .claude/scripts/transition-phase.js --feature-complete --verify-output
   ```

   ```
   [Feature name] is fully implemented and committed. [Total commits] commits across [N] epics.
   ```

   Stop here. `/continue` re-entered later picks up Path 2 below.

2. **`/continue` invoked after `featureComplete: true`** — the user is back to extend the feature with more epics. Don't re-emit congratulations. Treat the act of running `/continue` as implicit consent to add more.

   Display the prompt as plain conversational text (NOT `AskUserQuestion`) — the user replies with free text:

   > "This feature is marked complete. What's next? Describe the new requirements or epics in as much detail as you have."

   Capture the user's next message as `extensionRequirements`. Then:

   1. **Append to the brief.** Add a new section at the bottom of `generated-docs/specs/project-brief.md`:

      ```markdown

      ---

      ## Extension — <YYYY-MM-DD>

      <extensionRequirements verbatim>
      ```

      Use Edit/Write to append; do not rewrite the existing brief.

   2. **Reopen the feature for new epics:**

      ```bash
      node .claude/scripts/transition-phase.js --reopen-for-epics
      ```

      Verify `status: "ok"` and `reopened: true`. If error, STOP and surface.

   3. **Commit the extension** (so it's recoverable across sessions):

      ```bash
      git add generated-docs/specs/project-brief.md generated-docs/context/workflow-state.json .claude/logs/
      git commit -m "docs(brief): extension — additional epics requested"
      git push origin HEAD
      ```

   4. **Invoke `feature-planner` mode `epics`** with the brief (now including the new Extension section), the existing `state.epics` array, and the user's `extensionRequirements` text. The planner reads these and proposes what to add. Then render the Step P2 epic-list gate as usual; on approval, persist and continue into Step P3.

---

## Halt Handling

When any agent returns a `HALT` block (per [agent-autonomy.md](../shared/agent-autonomy.md)):

1. Surface the halt block verbatim to the user
2. Use `AskUserQuestion` with the options the agent suggested (plus an "Other" affordance for free-text)
3. Capture the user's decision
4. Resume the appropriate phase step with the decision passed as additional context

**Halt persistence:** mark the current story's `status: "halted"` in `workflow-state.json` so `/continue` after a session break re-surfaces the halt rather than blindly re-running BUILD.

---

## Dashboard Updates

Fire dashboard regeneration at workflow milestones per the [Dashboard Update Policy](../shared/orchestrator-rules.md#dashboard-update-policy):

- After Gate 1 approval (project-brief.md committed)
- After epic-list approval (Gate 2a)
- After each per-epic stories approval (Gate 2b)
- After each story commit
- At epic completion
- After the manual-test gate resolves (any of passed / issues / skipped / legacy)
- At feature completion

```bash
node .claude/scripts/generate-dashboard-html.js --collect
```

Fire-and-forget. On script failure, log a one-line warning and continue.

---

## Notes

- **State authority** — `workflow-state.json` is the source of truth. `/continue` re-enters at whatever phase state shows. Resumption after a session break uses the same paths as initial execution.
- **Halts surface immediately** — no race conditions because BUILD is synchronous from the orchestrator's perspective
- **Tool budget** — keep parent tool calls per response at ~3 outside of natural turn boundaries (`AskUserQuestion` answers reset the budget). Delegate heavy bash sequences to subagents (`playwright-runner` already does this for E2E)
- **Brief is authoritative** — developer and test-generator agent files already encode "brief overrides template code." No per-call reminder needed from the orchestrator.
