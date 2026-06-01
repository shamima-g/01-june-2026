# How the Workflow Works

When you type `/start`, Claude Code guides you through building your feature in three stages — **Intake, Plan, Build**. AI agents handle most of the work; you step in at a couple of approval points and then verify the finished feature in your browser.

---

## Quick Start

1. Type `/start` in Claude Code — it will ask what you want to build, or read from anything you've placed in `documentation/`
2. Follow the prompts — Claude Code tells you what it's doing and pauses for your approval at each stage

**Commands:**

| Command | What it does |
|---------|-------------|
| `/start` | Begin building a new feature |
| `/continue` | Pick up where you left off after an interruption |
| `/status` | See where you are in the current workflow |
| `/dashboard` | Open a visual overview of your project's progress |
| `/quality-check` | Run all quality checks manually |

---

## The Three Stages

### Stage 1: Intake
Claude Code reads anything you've placed in `documentation/` and asks a short checklist of questions (authentication, backend, user roles). It then writes a **project brief** summarising what it understood. **You review and approve the brief before anything else happens.**

If your brief mentions a real backend, Claude Code also runs a quick connection test against it before moving on — so credential or URL problems surface before any code is written.

### Stage 2: Plan
Claude Code breaks the feature into **epics** (major areas of work) and presents them in priority order. **You approve the epic list**, and then for each epic Claude Code defines the individual **stories** — the specific pieces of functionality. **You approve each epic's stories before work starts.**

Small features with only one epic collapse this into a single combined approval.

### Stage 3: Build
For each approved story, Claude Code automatically:

1. Writes failing tests that describe exactly what the story should do
2. Writes the code to make those tests pass
3. Runs end-to-end browser tests and the five quality gates in parallel
4. Commits the change

If anything goes wrong, Claude Code retries the fix automatically (up to three attempts) before pausing to ask for your input.

Once a story passes its automated checks, Claude Code asks you to open your browser and verify it works as expected. Once you confirm, the story is done.

---

## The Flow at a Glance

```
You describe what you want
          ↓
Claude Code reads your docs and produces a project brief    ← you approve (Stage 1: Intake)
          ↓
Claude Code plans the work as epics and stories             ← you approve (Stage 2: Plan)
          ↓
For each story:
  Claude Code writes tests, then code, then runs checks     (automatic, Stage 3: Build)
          ↓
You verify the feature in your browser                      ← you confirm
          ↓
Story committed; next story begins
```

---

## Quality Gates

Before each story is committed, five gates run automatically:

| Gate | What it looks for |
|------|------------------|
| 1. Functional | Does the feature work the way you described? |
| 2. Security | Are there any security vulnerabilities or accidentally exposed secrets? |
| 3. Code quality | Is the code well-formed and free of errors? |
| 4. Tests | Do all the tests pass? |
| 5. Performance | Does the page load quickly and respond smoothly? |

Gates 2, 3, and 4 are fully automated. Gates 1 and 5 include a step where you check the running app yourself.

---

## You're Always in Control

You don't have to follow every step rigidly. If you want to skip something, go back, or change direction, just say so in plain English:

- *"Skip ahead to planning, my brief is good"*
- *"I want to update my requirements before we continue"*
- *"Redo the stories for Epic 2 — I want to change the scope"*
- *"Regenerate the tests for this story"*

Claude Code will follow your lead.

---

## Troubleshooting

**The workflow was interrupted and I don't know where I left off**
Type `/status` to see the current stage, or `/continue` to pick up from where you left off. Claude Code saves its progress as it goes.

**I want to change my requirements after the workflow has started**
Just tell Claude Code what you want to change. You can update your feature description in `documentation/` and ask Claude Code to re-read it, or describe the change in the chat and ask it to adjust the plan.

**A quality check failed**
Claude Code will tell you what failed and why. Ask it to fix the issue — it will explain what went wrong in plain language and resolve it before continuing.

**Claude Code seems stuck or is asking for something I don't understand**
Ask it to explain in simpler terms, or describe where you think you are: *"I've approved the stories for Epic 1 — what should happen next?"* Claude Code will orient itself and continue.

**I approved something and want to go back and change it**
You can always ask to revisit a previous stage: *"I want to go back and change the stories for Epic 2."* Claude Code will work with you to adjust the plan.
