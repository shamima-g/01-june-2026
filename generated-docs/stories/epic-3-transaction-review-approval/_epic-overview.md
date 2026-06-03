# Epic 3 — Transaction Review, Approval & Export (Approver)

> The Approver's surface — the sortable, paginated, filterable Transactions table; approve and reject (with mandatory rejection note) gated to Imported transactions; the per-file summary with drill-down; the audit trail on rejected transactions; and CSV export of the current filtered set.

**Requirements:** R4, R5, R7, R8, R9, R10, BR1, BR2, BR3, BR6, BR8, BR9, BR10
**Depends on:** Epic 1
**epicIntroducesSharedSurface:** false
**Manual-test status:** pending

## Stories (build order)

### 1. Transactions table — sortable, paginated, read-only surface
- **Route:** `/transactions` · **Target:** `web/src/app/transactions/page.tsx` · **modify_existing** · Roles: Approver, Importer
- **Requirements:** R4, BR9, BR10
- Read-only table with the eight brief columns + StatusBadge, single-column sort, 5/10/20/50 pagination (default 20), zero-data/error states. Establishes the fail-closed RBAC scaffold; no row-actions yet.
- **ACs:** AC-1 columns+badge (playwright) · AC-2 sort asc/desc (playwright) · AC-3 pagination (playwright) · AC-4 empty/error states (vitest) · AC-5 no action controls baseline (vitest)

### 2. Filter and search the Transactions table
- **Route:** `/transactions` · **modify_existing** · Roles: Approver, Importer
- **Requirements:** R5, BR6
- Client-side filter by Status / File / date range / amount range + search on Reference & Account Number; removable chips + Clear-all; no-results state. The filtered set feeds Export (Story 4).
- **ACs:** AC-1 status filter (playwright) · AC-2 file/date/amount filters (vitest) · AC-3 search (playwright) · AC-4 chips + Clear-all (playwright) · AC-5 no-results state (vitest)

### 3. Review actions — approve or reject an Imported transaction *(merged Approve + Reject)*
- **Route:** `/transactions` · **modify_existing** · Roles: Approver
- **Requirements:** R7, R8, BR1, BR2, BR3, BR8, BR9
- Approve/Reject row-actions on Imported rows only. Cancel-focused confirm dialogs naming the Reference; mandatory rejection note (≤500 chars, validated); row flips + success toast; rejected note + who/when shown read-only; assertive inline error on hard failure; fail-closed Approver-only.
- **ACs:** AC-1 actions only on Imported (playwright) · AC-2 confirm dialog + mandatory note gating (playwright) · AC-3 note validation blur/submit/max-500 (vitest) · AC-4 approve→Approved / reject→Rejected + toast (playwright) · AC-5 rejection note + who/when read-only (playwright) · AC-6 fail-closed RBAC + hard-failure inline error (vitest)

### 4. Export the current filtered transactions as CSV
- **Route:** `/transactions` · **modify_existing** · Roles: Approver
- **Requirements:** R9, BR6, BR9
- Client-side CSV of exactly the filtered set; disabled with tooltip when zero match; fail-closed Approver-only.
- **ACs:** AC-1 CSV equals filtered set (playwright) · AC-2 export tracks filter changes (vitest) · AC-3 disabled when empty (playwright) · AC-4 absent for Importer/unknown (vitest)

### 5. Per-file summary with status counts and drill-down
- **Route:** `/transactions` · **modify_existing** · Roles: Approver, Importer
- **Requirements:** R10
- Total / Imported / Approved / Rejected counts per file (client-side aggregation); clicking a count drills into the pre-filtered table.
- **ACs:** AC-1 counts shown (playwright) · AC-2 counts match data (vitest) · AC-3 drill-down pre-filtered (playwright)

## Non-goals
- No bulk approve/reject — one transaction at a time through its own confirmation.
- No editing a transaction's details — approve-or-reject only.
- No reversing/re-opening an Approved or Rejected transaction — terminal states are final.
- No scheduled or emailed exports — on-demand CSV of what's on screen.
- No analytics dashboards beyond the per-file status summary.

## Spec gaps (cross-cutting)
All list operations are client-side: `GET /v1/transactions` documents no sort/page/filter/search params, and there is no export or per-file-summary endpoint — sorting, filtering, pagination, export, and the summary counts are all derived in the browser over the fetched set (consistent with Epic 2; brief §9 confirms client-side export). TransactionType display format (§13.D, 'C'/'D' vs 'Debit') to be confirmed against the live response during BUILD.
