# AI-Driven Development Workflows

Quick reference for common workflows in this template.

The workflow has four phases — **INTAKE / PLAN / BUILD / COMPLETE** — with 1–2 user gates and an agent-driven BUILD loop.

---

## Workflow 1: Starting a New Project

**Scenario:** You just created a new project from this GitHub template.

```bash
# 1. Create from template
Click "Use this template" on GitHub → Name your project → Create

# 2. Clone and open
git clone https://github.com/your-username/your-new-project.git
cd your-new-project
code .  # Opens in VSCode

# 3. Initialize
# In Claude Code chat, type:
/start
# This handles npm install, verifies setup, and immediately starts INTAKE.
```

### Expected Timeline

- **Setup:** 2–5 minutes
- **First feature:** depends on complexity (simple feature ~30 min with AI assistance)

---

## Workflow 2: Adding Features to Existing Project

**Scenario:** Your project is already set up and you want to add a new feature.

```bash
# 1. Open your existing project
cd your-existing-project
code .

# 2. (Optional) Start dev server
npm --prefix web run dev

# 3. Start new feature
# In Claude Code chat, type:
/start
# Claude detects the existing project and guides you through adding the feature.
```

### What Claude Does

1. **Detects project state** — confirms initialized, checks for in-progress features
2. **Runs INTAKE** — scans documentation/, asks 3 checklist questions (auth, backend, roles), invokes intake-agent, presents Gate 1 for `project-brief.md` approval
3. **Chains directly into `/continue`** for PLAN and BUILD
4. **Drives PLAN** — proposes epics, then per-epic stories; user approves (or single combined gate for single-epic features)
5. **Drives BUILD** — per story: test-generator → developer → playwright-runner ∥ code-reviewer → commit
6. **Emits Epic Completion Summary** at each epic boundary; loops back to PLAN for the next epic if any
7. **Commits and pushes** after each story

---

## Workflow 3: Resuming Interrupted Work

**Scenario:** Session closed mid-workflow, or auto-compaction fired.

```bash
# In Claude Code chat, type:
/continue
```

`/continue` reads `generated-docs/context/workflow-state.json`, determines the current phase, and re-enters at the appropriate step. Resumption uses the same paths as initial execution.

### What `/continue` shows

```
Resuming: phase=BUILD, epic=2, story=3
```

If state is missing or unclear, `/continue` runs `transition-phase.js --repair` to reconstruct from artifacts. Confidence levels:

- `high` — proceed
- `medium` — show `detected` / `assumed`, ask user to confirm
- `low` — require user verification

---

## Workflow 4: Validate Before Commit

`/quality-check` runs all 5 quality gates (security, code quality, testing, performance) outside the BUILD loop. Useful for ad-hoc validation.

```bash
# In Claude Code chat, type:
/quality-check
```

Inside BUILD, `code-reviewer` runs the same gates automatically — no manual invocation needed.

---

## Workflow 5: Open the Dashboard

```bash
# In Claude Code chat, type:
/dashboard
```

Generates `generated-docs/dashboard.html` and opens it in the browser. Auto-refreshes every 10s; reflects current phase, epic/story progress, commits, and decisions.

---

## Phase Model — At a Glance

Four phases, 1–2 user gates:

| Phase | Driven by | Gate(s) | Single artifact / signal |
|---|---|---|---|
| **INTAKE** | `/start` | **Gate 1** — approve `project-brief.md` | `generated-docs/specs/project-brief.md` |
| **PLAN** | `/continue` | **Gate 2a** — approve epic list, **Gate 2b** — approve stories per epic (multi-epic) / **Combined Gate 2** (single-epic) | `_feature-overview.md` + per-epic overviews |
| **BUILD** | `/continue` | None — autonomous per-story loop, halts only on always-halt categories | Per-story commits |
| **COMPLETE** | `/continue` | None | Final summary |

**Single-epic short-circuit:** when `feature-planner` returns `epicCount === 1`, Gates 2a and 2b collapse into one combined approval.

**BUILD per-story loop:** `test-generator (Vitest ∥ Playwright)` → `developer` → `playwright-runner ∥ code-reviewer` → commit (∥ next story's test-generator). Fix cycle on failure, max 3.

The full orchestration — every step, every prompt template, every commit incantation — lives in [commands/start.md](commands/start.md) and [commands/continue.md](commands/continue.md). The agents that run inside each phase are inventoried in [agents/README.md](agents/README.md).

---

## Halt Conditions

Agents halt only for the "Always halt" categories defined in [agent-autonomy.md](shared/agent-autonomy.md) (security, contract, project-level decisions). When a halt fires, the orchestrator surfaces it verbatim to the user via `AskUserQuestion` and waits for the decision. BUILD resumes with the user's answer.

For standard decisions (file naming, test patterns, common React patterns, Shadcn selection, ARIA labels, UI defaults), agents proceed autonomously and record decisions in commit bodies.

---

## Context Management

The workflow chains continuously from INTAKE through BUILD. State authority lives in `workflow-state.json`; `/continue` re-enters at any phase.

**Auto-compaction is handled automatically.** The `inject-phase-context.ps1` hook restores workflow state via `additionalContext` when compaction fires. The user does not need to take action.

---

## Command Reference

| Command | When to use | What it does |
|---|---|---|
| `/start` | Begin a new feature | Runs INTAKE through Gate 1, then chains into `/continue` |
| `/continue` | Resume interrupted workflow OR continue after `/start`'s INTAKE | Drives PLAN and BUILD based on state |
| `/status` | Check progress | Shows phase, epic, story, and recent commits |
| `/quality-check` | Ad-hoc validation | Runs all 5 quality gates outside BUILD |
| `/dashboard` | Open visual dashboard | Generates HTML, opens in browser |

---

## Pro Tips

- **New project:** `/start` handles everything. It installs dependencies (in the background) and captures git prefs as part of Step 0 before INTAKE.
- **Existing project:** `/start` detects state and proceeds.
- **Mid-flow interruption:** `/continue` resumes from `workflow-state.json`. If state is missing, repair runs automatically.
- **Phases chain continuously.** If you manually clear the session, `/continue` resumes cleanly from `workflow-state.json`.
- **Dashboard auto-refreshes:** leave it open in a browser tab for live progress.

---

## Troubleshooting

### "I ran `/start` but nothing happened"

- Check that Claude Code extension is active
- Look for the command prompt response
- Try `npm --prefix web install` manually

### "I want to start over with a feature"

- Delete contents of `generated-docs/context/`
- Type `/start` to begin fresh

### "Claude doesn't remember my in-progress feature"

- Context files may have been deleted
- Just describe what you were building — `/continue` will reconstruct via `transition-phase.js --repair`

### "Quality gates are failing"

- Type `/quality-check` to see specific failures
- Claude provides fix suggestions
- Re-run after fixes applied

### "BUILD halted on something I didn't expect"

- The agent autonomy policy halts on always-halt categories (permissions, API contracts, dependencies, etc.)
- The halt message includes options — pick one or describe a different path
- BUILD resumes after your decision

---

## Decision Tree

```
Are you starting a NEW project from template?
├─ YES → Type /start (handles setup + INTAKE automatically)
└─ NO → Continue below

Do you have a feature in progress?
├─ YES → Type /continue (resumes from workflow-state.json)
└─ NO → Type /start to begin a new one

Is your feature complete?
├─ YES → It's already committed and pushed
└─ NO → Continue with /continue
```

---

**Questions?** Type `/help` or just ask Claude directly.
