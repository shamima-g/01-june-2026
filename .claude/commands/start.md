---
description: Start the workflow — drives INTAKE end-to-end through Gate 1, then hands off to /continue for PLAN and BUILD.
---

Start a new feature workflow. This command runs INTAKE only; PLAN and BUILD are handled by `/continue`, which is invoked automatically after Gate 1 approval.

**Read and follow all rules in [orchestrator-rules.md](../shared/orchestrator-rules.md).**

## Flow

```
/start → [setup check] → [welcome + onboarding routing]
       → [scan-doc.js ∥ api-connectivity-agent spec analysis]   (parallel)
       → [3-question checklist: auth, backend, roles]
       → [api-connectivity-agent smoke test]   (skipped when dataSource ∈ {mock-only, new-api})
       → [intake-agent produce mode → project-brief.md]
       → ── Gate 1: project-brief.md approval ── (rejection → intake-agent revise mode → re-display)
       → [commit + transition to PLAN]
       → [invoke /continue inline]
```

The handoff to `/continue` is automatic.

---

## Step 0: Setup Check

Probe state with two Bash calls — **issue both in the same assistant response** so they run in parallel:

```bash
test -d web/node_modules && echo "installed" || echo "missing"
test -f .claude/preferences.json && echo "configured" || echo "missing"
```

**Both present →** "Project setup is complete." Set `backgroundInstallTaskId = null`, `verificationPending = false`. Go to Step 1.

**Otherwise, run the missing pieces concurrently** — issue the install Bash call and the `AskUserQuestion` in the **same assistant response** so the install overlaps the user's git-prefs answer:

- **`needsInstall` →** `npm --prefix web install` with `run_in_background: true`. Capture the task ID as `backgroundInstallTaskId`; set `verificationPending = true` (Step 8.5 blocks on it before commit).
- **`needsPreferences` →** ask via `AskUserQuestion`: "How should Claude handle git commits and pushes?" Options: *Auto-approve both (recommended) / commits only / pushes only / Always ask*. Map → `node .claude/scripts/init-preferences.js --autoApproveCommit <true|false> --autoApprovePush <true|false>`. Don't use Write to create files in `.claude/` (prompts); the node script is auto-approved.

Post a one-liner ("Setup primed — dependencies installing in the background.") and continue to Step 1.

---

## Step 1: Initialize Workflow State

`/start` is the **first-time-only** entry point. Anything else — resuming an interrupted workflow, or extending a completed feature with more epics — belongs in `/continue`.

```bash
node .claude/scripts/transition-phase.js --init INTAKE
```

Parse the response:

- `status: "ok"` → new state created; proceed to Step 2.
- `status: "exists"` → state is already present. Do NOT archive it and do NOT overwrite. Output the redirect verbatim and stop:

  > "There's already a workflow in this project. Run `/continue` — it will resume the active phase, or if the previous feature is complete, it'll prompt you for the new epic(s) to add. If you genuinely want to start over from scratch, delete `generated-docs/context/workflow-state.json` manually first (Step 7 will regenerate `project-brief.md`)."

## Step 2: Open Dashboard (Fire-and-Forget)

```bash
node .claude/scripts/generate-dashboard-html.js --collect
start "" "generated-docs/dashboard.html"
```

On script failure, output `"Dashboard generation failed — you can run /dashboard manually later."` and continue.

## Step 3: Welcome + Onboarding Routing

Pre-scan `documentation/` so the welcome message reflects what's there:

```bash
node .claude/scripts/scan-doc.js documentation/ --keywords auth,role,BFF,compliance,mock,api
```

Parse the JSON output. Welcome line based on scan result (check prototype condition first):

- **`documentation/genesis.md` or `documentation/prototype-src/` present:** "I see prototype artifacts in `documentation/` ([detected files]). We'll use those as the starting point."
- **Other substantive files:** "I see you have [N files] in `documentation/` including [2–3 key items]. We'll work with whatever's there."
- **Empty or `.gitkeep`-only:** "I don't see anything in `documentation/` yet — that's fine, we have several ways to get started."

Then ask the routing question via `AskUserQuestion`:

- **Question:** "How would you like to get started?"
- **Options:**
  - **"I have a prototype repo to import"** *(Recommended unless docs are clearly non-prototype)* — "Import artifacts from a prototyping tool repo (docs, design tokens, React source)."
  - **"I have existing docs to share"** — "Copy project materials (specs, requirements, wireframes, API docs) into `documentation/`."
  - **"Let's build requirements together"** — "I'll ask questions and we'll define the requirements from scratch."

Pre-tick rules (per Test Run 24 finding U1):

| Scan result | Recommended option |
|---|---|
| `documentation/` empty or `.gitkeep`-only | "I have a prototype repo to import" |
| `documentation/genesis.md` / `prototype-src/` / `project.pen` present | "I have a prototype repo to import" |
| Substantive non-prototype files (BRD, OpenAPI spec) | "I have existing docs to share" |

Guided Q&A is never recommended — it's the fallback when the user lacks materials.

### Option A: Share existing materials (`onboardingPath = "docs"`)

**Skip-rule (avoid redundant "ready?" prompt):**

If the Step 3 `scanResult` already shows substantive non-prototype files in `documentation/` (the same condition that pre-recommended this option — BRD, OpenAPI spec, requirements doc, etc.), the user has implicitly confirmed by picking this option. Do NOT ask the follow-up question. Instead, post a single one-liner acknowledgement and proceed directly to Step 4:

> "Working with the files already in `documentation/`. If you want guided Q&A instead, say so before I read the brief back to you."

Proceed to Step 4 with `projectDescription = null`.

**Otherwise** (the user picked Option A but `documentation/` was empty or `.gitkeep`-only — they intend to drop files in now):

> "Drop whatever you have into `documentation/` — feature specs, requirements docs, API schemas, wireframes, design files, meeting notes. Anything goes. I'll work with whatever's there."

Then via `AskUserQuestion`:
- **Question:** "Let me know when your files are in place."
- **Options:** "Ready, I've added my files" / "Actually, let's do guided Q&A instead"

If "Ready": proceed to Step 4 with `projectDescription = null`.
If "Q&A": switch to Option C.

### Option B: Prototype Import (`onboardingPath = "prototype"`)

Ask as plain text (not `AskUserQuestion`):

> "What's the path to your prototype repo? You can use an absolute path (`C:\Git\my-prototype`) or a relative path (`../my-prototype`)."

Run:

```bash
node .claude/scripts/import-prototype.js --from "<user-provided-path>"
```

If `status: "ok"`: display a summary of what was imported — requirements file, design tokens, API specs, prototype screen count, mock data, stories index. Then proceed to Step 4 with `projectDescription = null`.

If `status: "error"`: display the error. Via `AskUserQuestion`:
- "Let me fix the path and try again" → re-ask
- "I'll copy files manually instead" → switch to Option A
- "Let's do guided Q&A instead" → switch to Option C

### Option C: Guided Q&A (`onboardingPath = "qa"`)

Ask as plain text:

> "What are you building? Give me the elevator pitch — who's it for, what does it do, and what's the core problem it solves. As much or as little detail as you like."

Capture the response as `projectDescription`. Proceed to Step 4.

---

## Step 4: Pre-Intake Parallel — Spec Analysis

The deep documentation scan ran in Step 3 (`scan-doc.js`); its JSON output already populates the welcome message and pre-ticks the checklist. The only agent that needs to run here is `api-connectivity-agent` Call A — fire it now so its result is ready by the time the checklist completes.

- **`api-connectivity-agent`** Call A — spec analysis, returns smoke-test plan or empty plan when no spec exists.

Hold the Step 3 scan JSON in working memory; you'll pass it to `intake-agent` produce mode in Step 7 as `scanResult`. The agent does not run in scan-preview mode — produce mode receives the orchestrator's scan and synthesises everything in one call.

---

## Step 5: Checklist — 3 Questions

Ask three questions via batched `AskUserQuestion` calls. Inferred answers from Step 4's scan pre-tick options where applicable.

### Q1 — Roles Template

- **Question:** "Which roles template fits your app?"
- **Options** (per [roles-snippets.md](../shared/roles-snippets.md)):
  - "SaaS Standard" — Owner / Admin / Member / Viewer
  - "Internal Tool" — Admin / User
  - "Marketplace" — Buyer / Seller / Moderator
  - "Editorial" — Editor / Author / Contributor / Reader

The auto-`"Other"` affordance handles `custom`. Pre-tick the inferred template if the scan returned one.

Silent accept on the four explicit templates: post a one-line acknowledgement ("Captured: [roles list]. You can refine in the brief at Gate 1.") and continue. No drilldown.

### Q2 — Authentication Method

Always asked explicitly per [authentication-intake.md](../policies/authentication-intake.md) — **never inferred**.

- **Question:** "How will users authenticate?"
- **Options:**
  - "Backend For Frontend (BFF)" — "Backend handles OIDC login/logout, sets cookies. Frontend calls backend for user info."
  - "Frontend-only (next-auth)" — "Next.js handles auth directly using next-auth. **Note:** API calls won't carry session context — protects frontend routes only."
  - "Custom" — "I have a different authentication/authorization approach."

**Conditional follow-ups (fire after Q2 returns):**
- **BFF:** plain-text prompts for login URL, userinfo URL, logout URL. Display backend-requirements + CI-implication note per [authentication-intake.md](../policies/authentication-intake.md) Rule 4.
- **Frontend-only:** display the trade-off warning per [authentication-intake.md](../policies/authentication-intake.md) Rule 5.
- **Custom:** plain-text prompt — "Describe your auth/authorization approach."

### Q3 — Backend Readiness

- **Question:** "Is your backend API up and running?"
- **Options:**
  - "Yes, it's running" — `dataSource: existing-api`
  - "No, still in development" — `dataSource: api-in-development`, mock layer required
  - "N/A — no backend API" — `dataSource: mock-only`

Combined with the scan's `hasApiSpec`, derive `dataSource` per the table in the existing decision matrix (collapsed):

| Spec exists | Backend status | dataSource |
|---|---|---|
| Yes | Running | `existing-api` |
| Yes | In dev | `api-in-development` |
| Yes | N/A | `mock-only` |
| No | Running | `new-api` |
| No | In dev | `api-in-development` |
| No | N/A | `mock-only` |

---

## Step 6: Smoke Test (skipped when dataSource is `mock-only` or `new-api`)

When the user picked BFF or an API spec exists with the backend running, run `api-connectivity-agent` Call B using the plan from Step 4. Procedure per [api-connectivity-agent.md](../agents/api-connectivity-agent.md): up to 3 attempts (Call B + 2 × Call C), curl-fallback, Shape 1/2/3 persistence.

The agent writes `context.backendConnectivity` to the manifest and returns.

Skip with a one-liner ("Backend connectivity check skipped (dataSource=[value]).") when not applicable.

### Step 6.5: Auth + Endpoint Probe (optional sub-step)

Only run when **all** of: `dataSource: existing-api`, `authMethod ∈ {bff, custom}` (and `custom` is session/cookie-based — confirm with user when ambiguous), and the Step 6 smoke test reached the backend (Shape 2 or Shape 3 success). Otherwise skip.

Append the probe AUQ to the connectivity question set per [authentication-intake.md §Auth + Endpoint Probe](../policies/authentication-intake.md). When the user picks **Yes, probe**:

1. Confirm `TEST_USERNAME` and `TEST_PASSWORD` are set in `web/.env.local` (presence-check via `node -e "console.log(!!process.env.TEST_USERNAME)"`). If missing, prompt the user to set them, then re-check.

2. **Kick off the probe in background** — single Bash call with `run_in_background: true`:

   ```bash
   node .claude/scripts/run-auth-probe.js --config <path-to-generated-config.json>
   ```

   The script writes incremental progress to `generated-docs/context/api-probe-state.json` (status, endpoints completed, current endpoint). Hard wallclock cap: 2 minutes.

3. **Continue with Step 7 (intake-agent produce mode) while the probe runs.** Do NOT block on the probe.

4. **Sync point before Gate 1.** Before invoking `intake-agent` to finalise the brief (Step 7 produce-mode return), check `api-probe-state.json`:
   - If `status: complete` — read `api-shape-report.md`, pass observed drift to `intake-agent` so the brief's §6 Data Model + §13 Notes can incorporate it.
   - If `status: in_progress` — wait with a visible "Probe still running... (N/M endpoints)" message. Re-check every ~5 seconds. Honour the 2-minute cap (kill if exceeded).
   - If `status: incomplete` (cap hit) or `status: failed` — surface the partial report and the failure reason; let the user choose whether to retry or proceed without the probe.

5. **Crash recovery** (handled by `/continue`): on resume after a session break, check `api-probe-state.json`. If `status: in_progress` but no live process, treat as failed-incomplete and offer the user a re-run.

When the user picks **Skip — verify manually** or **Paste a session cookie instead**, follow the path described in [authentication-intake.md §Auth + Endpoint Probe](../policies/authentication-intake.md) and skip the background kick-off above.

---

## Step 7: Invoke intake-agent (Produce Mode)

Launch `intake-agent` with a single prompt containing all context:

```
mode: produce
onboardingPath: <docs | prototype | qa>
projectDescription: <text or null>
checklist:
  authMethod: <bff | frontend-only | custom>
  bffEndpoints: <object or null>
  customAuthNotes: <text or null>
  dataSource: <existing-api | new-api | api-in-development | mock-only>
  rolesTemplate: <saas-standard | internal-tool | marketplace | editorial | custom>
  customRoles: <array or null>
backendConnectivity: <Shape 1/2/3 or null>
```

The agent reads `documentation/`, generates `generated-docs/specs/project-brief.md`, updates `generated-docs/context/intake-manifest.json`, and returns a `BRIEF SUMMARY`. Hold the summary for Gate 1.

---

## Step 8: Gate 1 — project-brief.md Approval

Follow the shared [Gate Approval Pattern](../shared/gate-approval-pattern.md). Specifics:

**Summary template** (output as regular text *before* the `AskUserQuestion`, populated from Step 7's `BRIEF SUMMARY`):

```
Here's the project brief I've assembled from your inputs:

**Goal:** [snapshot.goal]

**Critical decisions captured:**
- Roles: [snapshot.rolesTemplate]
- Auth: [snapshot.authMethod]
- Data source: [snapshot.dataSource]
- Compliance: [snapshot.complianceDomains or "None"]

**Counts:**
- Functional requirements: [counts.requirements]
- Business rules: [counts.businessRules]
- NFRs: [counts.nfrs]
- Compliance requirements: [counts.complianceRequirements]

[If keyItemsForUserAttention is non-empty:
**Worth a careful look:**
- [item 1]
- [item 2]
]

[If thinSections is non-empty:
**Sections that translated thinly from your sources (you may want to expand):**
- [section]
]

The full document is at `generated-docs/specs/project-brief.md`. Review it before approving.
```

**AUQ options:**
- "Approve all" — use this brief as the basis for PLAN and BUILD
- "I have small changes" — describe deltas
- "Let me edit the file directly" — open the file, edit, then re-confirm
- "Start over" — interpretation is off; clarify path/approach and re-run intake

**Revise call:** invoke `intake-agent` with `mode: revise` and `revisionFeedback: <feedback>`. The agent re-emits the brief and returns an updated `BRIEF SUMMARY`. Re-display the summary template. Loop until approved.

**"Start over" branch:** first ask plain text — "What should we change about the path or approach? (e.g., 'switch to guided Q&A', 'roles template is wrong', 'my docs were incomplete')." Then invoke `intake-agent` revise mode with the overrides as `revisionFeedback`.

---

## Step 8.5: Background-Work Gate

Only run if `verificationPending == true` (set at Step 0). Otherwise skip.

1. **Wait for `npm install`.** If `backgroundInstallTaskId` is still active, wait for it. Non-zero exit → STOP, surface error, do not commit.
2. **Run verification in parallel.** Issue all three commands as **separate Bash tool calls in a single response**, each with `run_in_background: true`. Do NOT chain them with `&&` and do NOT call them sequentially across responses — that's the difference between a ~15 s gate and a ~45 s one.
   ```bash
   npm --prefix web exec -- tsc -p web/tsconfig.json --noEmit
   npm --prefix web run lint
   npm --prefix web run build
   ```
   Wait for all three to finish. Any non-zero exit → STOP and surface the failure. All pass → set `verificationPending = false` and continue.

---

## Step 9: On Approval — Commit + Transition

Commit the intake bundle:

```bash
git add documentation/ \
  generated-docs/specs/project-brief.md \
  generated-docs/context/intake-manifest.json \
  generated-docs/context/api-smoke-test.sh \
  .claude/logs/

git commit -m "docs(intake): project brief"
git push origin HEAD
```

`api-smoke-test.sh` may not exist if connectivity was skipped; `git add` ignores missing paths.

Transition phase:

```bash
node .claude/scripts/transition-phase.js --to PLAN --verify-output
```

Verify `"status": "ok"`. If error, STOP and report.

---

## Step 10: Hand Off to /continue

Tell the user (conversationally, one line):

> "Brief approved and committed. Moving into planning..."

Then invoke `/continue` via the Skill tool. The handoff is seamless — no user prompt.

`/continue` reads `workflow-state.json`, sees phase `PLAN`, and drives the PLAN gate(s). See [continue.md](./continue.md) for the rest of the flow.

---

## Notes

- **No phase-context hooks** for retired phases — the `inject-phase-context` machinery only knows INTAKE, PLAN, BUILD, COMPLETE in the new flow
- **Continuous flow** — `/start` chains into `/continue` directly, and `/continue` chains between PLAN epics and BUILD.
- **State authority** — `workflow-state.json` is the source of truth for phase and progress. `/continue` re-enters at whatever phase state says.
