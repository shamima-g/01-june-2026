# Agent Autonomy Policy

## Purpose

Halts are the single largest contributor to wall-clock cost in the workflow (~10 halt events × 30–90 min per significant feature in the empirical data). Most of those halts asked the user to decide things that are settled by industry best practice or that BUILD can resolve and report back.

This policy defines a **four-tier decision framework** so BUILD agents only stop the user for genuinely unsafe ground. Lower tiers are recorded — autonomous decisions appear in commit bodies; journal-as-you-go decisions land in the project journal; surface-at-epic-boundary items get one line in the epic-completion summary.

The trade-off is explicit: **trade approval-time friction for review-time friction**. The user reviews at natural pauses (epic boundary, feature completion) rather than being interrupted mid-implementation.

This policy is referenced by [`developer.md`](../agents/developer.md), [`code-reviewer.md`](../agents/code-reviewer.md), and the BUILD loop in [`continue.md`](../commands/continue.md).

---

## Decision Framework

Four tiers, ordered by user-interruption cost. When in doubt, prefer the **next-more-conservative tier** (e.g., journal-only over autonomous, surface-at-boundary over journal-only, halt over surface).

| Tier | Default behaviour | Recorded? | When user sees it |
|---|---|---|---|
| **Tier 1 — Autonomous** | Decide, proceed | One-line note in commit body | At commit (git log) |
| **Tier 2 — Journal as you go** | Decide, journal, proceed | Journal entry + commit body | At epic completion (in journal) |
| **Tier 3 — Surface at epic boundary** | Decide, journal with `[review]` tag, proceed | Journal entry + epic-summary callout | At epic-completion summary in chat |
| **Tier 4 — Halt** | Stop BUILD, ask the user | N/A (user decides) | Immediately, via `AskUserQuestion` |

---

## Tier 1 — Autonomous

Industry-standard, low-blast-radius, easily reverted. Decide and proceed. One-line note in the commit body; no journal entry.

| Category | Examples |
|---|---|
| **Naming & structure** | File names, folder organisation, directory grouping. Use the project conventions visible in the existing codebase. |
| **Test patterns** | Assertion style (`toBe` vs `toEqual` vs `toHaveTextContent`), fixture conventions, `describe`/`it` nesting, test data shape |
| **Common React patterns** | `useState` for local form state, `useEffect` cleanup, error boundaries on async-rendering components, loading skeletons, focus management on mount, `useId` for label/input pairing |
| **Tailwind class organisation** | Class ordering, breakpoint stacking, responsive utility composition |
| **Shadcn component selection** | When multiple fit (`Dialog` vs `Sheet`, `Select` vs `Combobox`), pick the one closest to the use case |
| **Standard accessibility decisions** | ARIA labels for icon-only buttons, `aria-live` regions for async feedback, focus traps in modals, `prefers-reduced-motion` respect |
| **UI defaults** | Default sort order on data grids (most-recent-first or alphabetical), default page size (10/20/25), empty state copy, default loading copy |
| **Standard error handling** | Try/catch around async boundaries, in-app error rendering shapes, "Retry" buttons on transient errors, generic "Something went wrong" copy for unknown failures |
| **Minor refactor** | Renaming a local variable for clarity, extracting a 3-line helper inside the same file, inlining a one-shot constant |
| **Test data values** | Email addresses (`alice@example.com`), names, numbers in fixture data — match anything observable in `project-brief.md` §6 Data Model |

**Recording:** mention in the commit body. Example:

```
feat(epic-1-story-2): add user list page

Decisions:
- Used Shadcn Table over DataTable for simpler sort + pagination needs
- Default sort: last_login desc
- Page size: 20
```

---

## Tier 2 — Journal as you go

Decisions that aren't risky but the user would want to know about post hoc. The developer journals these to `generated-docs/context/journal.md` (path moves under multi-feature) and proceeds. Surfaced briefly in the epic-completion summary.

| Category | Examples |
|---|---|
| **Borderline composition / strategy** | Shared component vs inlining (rule of three), one big component vs several small, validation on submit vs blur, skeleton vs spinner vs nothing for loading, empty/error state design |
| **Factual additions to the brief** | New endpoint discovered during integration, new field needed on an entity, additional enum value, new state value — see [Brief Drift Handling](#brief-drift-handling) below |
| **Naming / shape clarifications** | Brief says `username`, API uses `userName`; brief says number, API has decimal — same intent. Reconcile and journal. |
| **Workflow refinements** | Brief lists 5 steps, prototype shows 4 + an implicit step — record the actual sequence. |

**Journal entry shape** (plain English, user-readable — write it like you'd describe it to a teammate, not like a system log):

```
Brief got a small update: the customer record gained a "preferred_contact" field, discovered while wiring up the list view.
```

```
For the sales table, went with separate components for Header / Rows / Footer (line items needed independent loading state).
```

No `Decisions:` / `Brief updates:` headers in journal entries — those belong in commit bodies. The journal is conversational.

---

## Tier 3 — Surface at epic boundary

Semantic refinements where the agent has high confidence but the user might want to know **before the next epic plans against the change**, or observations that will affect later stories. The developer applies the refinement, journals with a tag, BUILD continues. Epic-completion summary surfaces it as a one-line callout.

| Category | Examples | Tag |
|---|---|---|
| **Requirement wording was ambiguous** | "Show recent activity" — recent = last 7 days? Last 30? Agent picks most reasonable interpretation. | `[review]` |
| **Business rule needed refinement to be implementable** | BR3 says "no duplicates" — agent specifies the uniqueness scope (per-user vs global). | `[review]` |
| **AC needs adjustment to match prototype reality** | AC said "user sees X" — prototype shows X-and-Y in the same affordance. Agent implements the prototype shape. | `[review]` |
| **Affects-downstream observation** | "Stories 5 and 6 will both consume this filter state — consider lifting." | `[affects-downstream]` |

**Tag and surface format:**

```
[review] AC-7 ("Show recent activity") was interpreted as "last 30 days" — wasn't specified in the brief.
```

```
[affects-downstream] The date-range picker built here will be re-used by epic 2's filter panel; consider lifting state up before story 4 of epic 2 lands.
```

Epic-completion summary then becomes:

> "Epic 1 done. 1 thing worth a glance and 1 heads-up for epic 2 — want to look before we plan?"

---

## Tier 4 — Halt

Reserved for genuinely unsafe ground. Stop BUILD and ask the user.

| Category | Examples | Why halt |
|---|---|---|
| **Permissions** | Adding/removing a permission in the roles matrix; changing who can do what | Security-sensitive — silent permission grants are an audit risk |
| **API contracts — modification** | Changing request body shape; adding required fields; renaming endpoints; changing status code semantics | Affects every consumer |
| **API contracts — undocumented usage** | Calling an endpoint, query param, header, or request body shape not documented in the OpenAPI spec (e.g., `?LogId=` when spec only documents `?IsActive=`; adding `LastChangedUser` header when spec doesn't list it; POSTing a body shape that doesn't match the documented request schema) | Contract additions are real architectural decisions that must be made explicitly, not improvised; benchmark shows improvisation is the dominant source of contract drift. Use category `undocumented-endpoint` in the halt return so the orchestrator surfaces the four-option menu in [continue.md](../commands/continue.md) §B3. |
| **New external dependencies** | New npm package; new MCP server; new third-party service | Supply-chain risk, license, bundle size |
| **State management / data fetching library** | Switching from TanStack Query to SWR; adding Redux/Zustand | Cross-cutting; affects every component |
| **Authentication flow** | Changing auth method, adding/removing auth endpoints, modifying session handling | Security-critical; tied to `project-brief.md` §3 |
| **Cross-cutting architecture** | Router structure (App Router vs Pages); layout shell shape; middleware behaviour | Affects every story going forward |
| **Project-brief structural contradiction** | A stated requirement is **contradicted** (not refined, clarified, or extended) by what implementation reveals | The brief is the user's signed-off intent |
| **CLAUDE.md / policy contradiction** | Story requires bypassing a documented policy (no eslint-disable, must use Shadcn, etc.) | Policies exist for reasons |
| **Playwright spec missing for a routable story** | Story has `route !== null` but `web/e2e/epic-<N>-story-<M>-<slug>.spec.ts` doesn't exist after `test-generator` runs | Quality-signal failure |

**Note on "project-brief structural contradiction":** this used to cover all brief drift, which produced too many halts. It now covers only **structural contradictions** — cases where what the code needs cannot coexist with what the brief states. Naming clarifications, shape refinements, missing enum values, workflow ordering, ambiguous wording → Tier 2 or Tier 3 (autonomous + journal).

**Halt format:**

```
HALT: <one-line description>

Context:
- Story: <epic-N-story-M slug>
- What I was doing: <action>
- Why I stopped: <specific concern>

The user needs to decide:
1. <option A — clearest path forward>
2. <option B — alternative>
3. <option C — escape hatch, e.g., update the brief>

Recommendation: <option N> because <one-line rationale>
```

The orchestrator surfaces this verbatim and resumes BUILD with the user's answer.

---

## Brief Drift Handling

Implementation regularly surfaces things that aren't in the brief. The drift type determines the tier:

| Drift type | Tier | Behaviour |
|---|---|---|
| **Factual addition** — new endpoint, new field, additional enum value, missing state value | Tier 2 | Update `project-brief.md` inline. Journal the change (plain English). Continue. |
| **Naming / shape clarification** — case difference, type refinement, same intent | Tier 2 | Reconcile silently (use what works), journal the reconciliation. Continue. |
| **Wording / scope refinement** — requirement was ambiguous, agent picks an interpretation | Tier 3 | Apply the interpretation. Journal with `[review]` tag. Surface at epic boundary. |
| **Affects-downstream observation** — discovery that will impact later stories | Tier 3 | Journal with `[affects-downstream]` tag. Surface at epic boundary. |
| **Structural contradiction** — what the code needs is incompatible with what the brief states | Tier 4 | Halt. User updates brief or confirms the change. |

The distinction is: **does proceeding break user intent?**

- No, just extends or refines it → Tier 2
- No, but the interpretation might be wrong → Tier 3
- Yes — proceeding ships something the user didn't agree to → Tier 4

---

## What's Not Covered Here

Some decisions are made earlier in the workflow and aren't subject to runtime tiering:

- **Roles template selection** — decided at INTAKE; recorded in `project-brief.md` §2
- **Auth method** — decided at INTAKE; recorded in `project-brief.md` §3
- **Data source** — decided at INTAKE; recorded in `project-brief.md` §4
- **Compliance domains** — decided at INTAKE; recorded in `project-brief.md` §5
- **Brand colors / typography** — decided at INTAKE; recorded in `project-brief.md` §11 (raw hex)

BUILD agents read these and follow them. Disagreement with one of these is Tier 4 ("project-brief structural contradiction").

---

## Updating This Policy

This policy is the starting point. As real usage surfaces patterns:

- **Tier 1 → Tier 2:** if reviewers consistently revert autonomous decisions in a category, promote it to journal-as-you-go.
- **Tier 2 → Tier 3:** if a journal-only category produces problems that aren't caught until later epics, promote to surface-at-boundary.
- **Tier 3 → Tier 4:** if an at-boundary item turns out to need pre-implementation decisions, promote to halt.
- **And the reverse:** if a halt category produces only routine answers, demote it. If a surface category never produces user action, demote it.

Changes are reviewed during the MVP measurement phase.
