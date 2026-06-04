# Epic 4 — Responsive, Accessible & Compliant Experience

> Cross-cutting quality hardening once the screens exist — empty-state polish, WCAG 2.2 AA accessibility, the responsive table-to-card collapse below 768px, error/retry UX, and the POPIA audit-trail surfacing on transaction detail.

**Requirements:** R15, NFR1, NFR2, NFR3, NFR4, NFR8
**Depends on:** Epics 2, 3
**epicIntroducesSharedSurface:** false
**Manual-test status:** pending

## Stories (build order)

### 1. Brand theming pass — apply the financial-services palette across all screens *(infrastructure-only)*
- **Route:** null · **Target:** `web/src/app/globals.css` · **modify_existing** · Roles: Importer, Approver
- **Requirements:** NFR1, R15
- Replace the default neutral palette with the brief §11 brand tokens (primary #1E40AF, secondary #334155, accent #D97706, status trios) + wire Inter. Token-only; resolves the Epic-1 [theming-todo].
- **ACs:** AC-1 brand palette replaces neutral (vitest) · AC-2 Inter wired (vitest) · AC-3 status tokens match + StatusBadge keeps colour+icon+label (vitest) · AC-4 AA contrast of key pairs (manual)

### 2. Accessibility pass — keyboard navigation, focus, labels, AT-exposed help
- **Route:** `/transactions` · **modify_existing** · Roles: Importer, Approver
- **Requirements:** NFR1, NFR4
- WCAG 2.2 AA across the existing routes; focus-visible, tab order, accessible names, label associations; replace the Export `title`-only tooltip with an AT-exposed mechanism (resolves Epic-3 Story-4 [review]).
- **ACs:** AC-1 keyboard-operable + visible focus (playwright) · AC-2 Export-disabled reason AT-exposed (playwright) · AC-3 accessible names + labels (vitest) · AC-4 axe no AA violations (vitest) · AC-5 cross-browser (manual)

### 3. Responsive table-to-card collapse below 768px
- **Route:** `/transactions` (+ `/files`) · **modify_existing** · Roles: Importer, Approver
- **Requirements:** NFR3
- Below 768px the File Logs + Transactions tables collapse to a vertical card list (no horizontal scroll); full table at/above 768px; sort/filter/pagination preserved.
- **ACs:** AC-1 Transactions card collapse <768px (playwright) · AC-2 full table >=768px (playwright) · AC-3 File Logs same collapse (playwright) · AC-4 sort/filter/paginate in card layout (vitest)

### 4. Consistent error and retry UX across async actions
- **Route:** `/files/[id]` · **modify_existing** · Roles: Importer, Approver
- **Requirements:** NFR8
- Add a delete-failure error+retry surface (role="alert") on file cancel (resolves Epic-2 Story-5 [review]); sweep async paths for consistent visible error+retry. No new endpoints.
- **ACs:** AC-1 failed cancel shows error+retry, not silent close (playwright) · AC-2 consistent error+retry across async surfaces (vitest)

### 5. POPIA audit-trail surfacing on transaction detail
- **Route:** `/transactions` · **modify_existing** · Roles: Approver, Importer
- **Requirements:** R15
- Surface LastChangedUser/LastChangedDate on Approved/Rejected transaction detail; key the rejection trail on isRejected so who/when shows even with an empty note (resolves Epic-3 Story-3 [review]).
- **ACs:** AC-1 who/when on approved+rejected detail (playwright) · AC-2 rejected trail keyed on status, note sub-line conditional (vitest) · AC-3 note shown read-only when present (vitest)

## Non-goals
- No dark theme — light-theme only.
- No customer-facing PII redaction — operator personas see account numbers/amounts in full.
- No separate audit-log screen — last-changed columns + the detail trail are the audit surface.
- No right-to-erasure / self-service data-deletion (handled outside the frontend).
- No frontend work toward the 99.5% uptime / RTO / RPO targets (infrastructure obligations).

## Spec gaps / notes
- **NFR2 (performance budgets):** the API p99 ≤1s and upload ≤30s targets are infrastructure-bound, not fully frontend-controllable — surfaced honestly rather than overclaimed (no dedicated perf-check AC was added at the user's gate; can be added later).
- **Story 5:** no single-transaction GET endpoint — detail is read from the already-loaded transactions list (Epic-3 client-side approach).
- **Deferred journal items covered:** theming-todo → Story 1; cancel-failure → Story 4; BR8 trail-keying → Story 5; Export AT-tooltip → Story 2.
- The `epic-1-story-4-account-lockout` real-timer vitest flake under parallel load is a test-stabilization candidate (not given its own story per the user's gate decision).
