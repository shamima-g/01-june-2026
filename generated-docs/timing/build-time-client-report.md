# Build Time Report

- **Application:** Financial-services transaction file-import & approval web application
- **Reporting period:** 2 June 2026 – 4 June 2026 (data through end of 4 June)
- **Scope delivered:** 5 epics, 21 stories
- **AI model used:** Claude Opus 4.8 (`claude-opus-4-8`)
- **Reasoning effort:** High
- **Subscription seat:** Premium

---

## 1. Headline

| Metric | Value |
|---|---|
| **Active build time** | **13h 30m** |
| Stories delivered | 21 |
| Epics delivered | 5 |

*Active build time* is hands-on engineering time only. Time spent waiting on
reviews, approvals, clarifications, and idle/overnight gaps between sessions is
measured separately and **excluded** from these figures.

---

## 2. Build time by phase

| Phase | Active time | Share |
|---|---|---|
| Intake (requirements & setup) | 15m | 2% |
| Planning (epics & stories) | 38m | 5% |
| Build & finalisation | 12h 38m | 93% |
| **Total** | **13h 30m** | 100% |

The Build & finalisation total of 12h 38m comprises **7h 28m of feature
development**, **4h 39m of debugging / rework** (broken out separately in §5),
and roughly **31m of final quality gates and finalisation**.

---

## 3. Build time by epic (feature development, excluding debugging)

| Epic | Theme | Build time |
|---|---|---|
| 1 | Authentication & application foundation | 1h 5m |
| 2 | File import & lifecycle (Importer) | 2h 31m |
| 3 | Transaction review, approval & export (Approver) | 1h 42m |
| 4 | Responsive, accessible & compliant experience | 1h 51m |
| 5 | Backend role-name resolution fix | 20m |
| | **Total** | **7h 28m** |

---

## 4. Build time by story (feature development, excluding debugging)

| Story | Title | Build time |
|---|---|---|
| 1.1 | Same-origin proxy and dual-backend API client wiring | 6m |
| 1.2 | Sign-in with role-based landing | 12m |
| 1.3 | Sign-out and session-timeout lifecycle | 21m |
| 1.4 | Account lockout after repeated failed sign-ins | 11m |
| 1.5 | Shared status badge and empty-state building blocks | 15m |
| 2.1 | File Logs dashboard with status, sorting, and pagination | 22m |
| 2.2 | File detail with its transactions and processing banners | 20m |
| 2.3 | Upload a transaction file | 1h 3m |
| 2.4 | Retry validation and review validation errors | 20m |
| 2.5 | Cancel a file with the approved-transaction guard | 25m |
| 3.1 | Transactions table — sortable, paginated, read-only | 10m |
| 3.2 | Filter and search the Transactions table | 20m |
| 3.3 | Review actions — approve or reject a transaction | 29m |
| 3.4 | Export the current filtered transactions as CSV | 27m |
| 3.5 | Per-file summary with status counts and drill-down | 16m |
| 4.1 | Brand theming pass across all screens | 14m |
| 4.2 | Accessibility pass — keyboard, focus, labels, AT help | 41m |
| 4.3 | Responsive table-to-card collapse below 768px | 17m |
| 4.4 | Consistent error and retry UX across async actions | 20m |
| 4.5 | POPIA audit-trail surfacing on transaction detail | 18m |
| 5.1 | Recognise the live backend's role display-names | 20m |
| | **Total** | **7h 28m** |

---

## 5. Debugging effort

Debugging / rework time is the fix-cycle work that followed the initial build
of a story (re-work after testing and review). Only stories that required
debugging are listed; nine stories needed little to none and are not shown.

| Story | Title | Debugging time |
|---|---|---|
| 4.3 | Responsive table-to-card collapse below 768px | 37m |
| 3.2 | Filter and search the Transactions table | 36m |
| 3.3 | Review actions — approve or reject a transaction | 30m |
| 3.1 | Transactions table — sortable, paginated, read-only | 27m |
| 3.5 | Per-file summary with status counts and drill-down | 23m |
| 2.1 | File Logs dashboard with status, sorting, and pagination | 23m |
| 1.2 | Sign-in with role-based landing | 21m |
| 1.4 | Account lockout after repeated failed sign-ins | 20m |
| 4.5 | POPIA audit-trail surfacing on transaction detail | 16m |
| 1.1 | Same-origin proxy and dual-backend API client wiring | 14m |
| 2.3 | Upload a transaction file | 8m |
| 2.2 | File detail with its transactions and processing banners | 6m |
| 1.5 | Shared status badge and empty-state building blocks | 5m |
| 2.4 | Retry validation and review validation errors | 3m |
| 4.2 | Accessibility pass — keyboard, focus, labels, AT help | 3m |
| 2.5 | Cancel a file with the approved-transaction guard | 2m |
| | **Total** | **≈ 4h 39m** |

The most debugging-intensive areas were the **Transaction review/approval and
filtering screens (Epic 3)** and the **responsive layout work (Story 4.3)**.

---

## Notes on methodology

- Figures come from automated, timestamped activity logging captured throughout
  the build.
- *Active build time* excludes all waiting and idle time — reviews, approvals,
  clarifications, and gaps between working sessions.
- The split between feature build and debugging is derived from the rework
  performed after each story's initial build; figures are rounded to the
  nearest minute, so individual rows may not sum exactly to the stated totals.
- Data covers 2 June – 4 June 2026 inclusive (up to and including yesterday).
