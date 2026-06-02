# Feature Overview — Transaction Import & Approval System

A frontend for a transaction-management backend: **Importers** upload transaction files; **Approvers** review, approve, reject, and export the resulting transactions. Session-cookie auth against a dual-backend setup (auth `:10010`, transactions `:10005/transactions-api`), proxied same-origin via Next.js route handlers.

## Epics

### Epic 1 — Authentication & Application Foundation
`epic-1-auth-and-foundation` · depends on: none

Sign-in with role-based landing, the dual-backend same-origin proxy and API client wiring, session lifecycle (idle/absolute timeout, lockout), and the shared status-badge and empty-state building blocks the screens reuse.

**Covers:** R1, R16, R17, R18, NFR5, NFR6, NFR7

### Epic 2 — File Import & Lifecycle (Importer)
`epic-2-file-import-lifecycle` · depends on: Epic 1

Upload a transaction file, see all active file logs with their status, drill into a file, retry validation on a failed file, review validation errors, and cancel a file (guarded when any transaction is already approved).

**Covers:** R2, R3, R6, R11, R12, R13, R14, BR4, BR5, BR7, BR11, BR12

### Epic 3 — Transaction Review, Approval & Export (Approver)
`epic-3-transaction-review-approval` · depends on: Epic 1

The sortable, paginated, filterable Transactions table; approve and reject (with mandatory rejection note) gated to Imported transactions; the per-file summary with drill-down; the audit trail on rejected transactions; and CSV export of the current filtered set.

**Covers:** R4, R5, R7, R8, R9, R10, BR1, BR2, BR3, BR6, BR8, BR9, BR10

### Epic 4 — Responsive, Accessible & Compliant Experience
`epic-4-responsive-accessible-compliant` · depends on: Epics 2, 3

Cross-cutting quality hardening once the screens exist — empty-state polish (no-data vs no-filter-results), WCAG 2.2 AA accessibility, the responsive table-to-card collapse below 768px, error/retry UX, and the POPIA audit-trail surfacing on transaction detail.

**Covers:** R15, NFR1, NFR2, NFR3, NFR4, NFR8

---

_All requirements (R1–R18, BR1–BR12, NFR1–NFR8) are mapped; nothing unassigned._
