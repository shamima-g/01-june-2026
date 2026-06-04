'use client';

/**
 * Transactions table (Epic 3, Story 1 — R4, BR9, BR10; Epic 3, Story 2 — R5,
 * R15, BR6; Epic 3, Story 3 — R7, R8, BR1, BR2, BR3, BR8, BR9; Epic 3, Story 4
 * — R9, BR6, BR9; Epic 3, Story 5 — R10; Epic 4, Story 2 — NFR1, NFR4; Epic 4,
 * Story 3 — NFR3; Epic 4, Story 5 — R15, BR8).
 *
 * Replaces the Epic 1 under-construction placeholder at /transactions with the
 * real read-only Transactions surface (CLAUDE.md §7 — replace, don't nest). On
 * mount it fetches the full transaction set (`GET /api/transactions/v1/transactions`,
 * the client unwraps the singular `{ Transactions: [...] }` envelope to a bare
 * array) and renders a sortable (single-column), paginated (5/10/20/50, default
 * 20) table with the brief's eight columns: Reference, Transaction Date, Account
 * Number, Description, Amount, Currency, Transaction Type, Status.
 *
 *   - Status is shown via the shared StatusBadge, which pairs colour with an icon
 *     AND text label (R16 / NFR1).
 *   - The zero-data empty state uses the shared EmptyState (no-data variant,
 *     "No transactions yet" framing — R15).
 *   - A failed fetch surfaces an assertive (role="alert") error state with a
 *     Retry affordance (NFR5); Retry re-fetches and, on success, renders the
 *     table — never a blank/broken page.
 *
 * Story 2 layers CLIENT-SIDE filtering + free-text search on top of the Story-1
 * table (R5). The filter dimensions are Status (Imported / Approved / Rejected),
 * File (by FileName, keyed on FileLogId), Date range, Amount range, plus free-text
 * search over Reference and Account Number. Filtering runs entirely over the
 * already-loaded set (the spec documents no server-side filter params); sort and
 * pagination operate over the FILTERED result, and the filtered set is exposed via
 * the `filteredTransactions` memo so Story 4's Export can read exactly it (BR6).
 *
 *   - Each active filter renders as a removable chip grouped under an
 *     "Active filters" region; a Clear-all button resets every filter + the search
 *     box (R5). Changing any filter resets to page 1.
 *   - When the loaded set is non-empty but the filtered set is empty, the shared
 *     EmptyState no-results variant renders (active-filter summary + Clear-all),
 *     DISTINCT from the zero-data "No transactions yet" state (R15). The chip
 *     region is hidden in that case so the EmptyState owns the single
 *     active-filter summary + Clear-all surface.
 *
 * Story 3 CONSUMES the Story-1 fail-closed RBAC scaffold to layer per-row Approve
 * / Reject review actions on top of the table (R7, R8) WITHOUT disturbing the
 * read-only surface above:
 *   - The actions render ONLY on a row whose Status is `Imported` AND only when
 *     the resolved role is an Approver (`asKnownRole(role) === 'Approver'`). On
 *     `Approved`/`Rejected` rows they are HIDDEN — not disabled (BR1) — and for an
 *     Importer / unknown / unresolved role they are ABSENT page-wide, fail-closed
 *     (BR9).
 *   - Approve opens a confirmation modal NAMING the Reference, destructive-styled
 *     primary, default focus on Cancel (BR3); confirming POSTs
 *     `/v1/transactions/approve?TransactionId=<id>` with the `LastChangedUser`
 *     header (via `approveTransaction`).
 *   - Reject opens a modal with a MANDATORY multi-line Rejection Note (≤500 chars,
 *     character counter) whose submit is disabled until a non-empty note is
 *     entered; the note is validated on blur AND on submit (BR2). Confirming POSTs
 *     `/v1/transactions/reject?TransactionId=<id>` with body `{"UserNote": "..."}`
 *     and the `LastChangedUser` header (via `rejectTransaction`). The reject dialog
 *     is its OWN component so a keystroke re-renders only the note field, not the
 *     whole table (keeps a 500-char note responsive).
 *   - On success the row's Status flips OPTIMISTICALLY in place (Approved /
 *     Rejected) with a success toast (useToast, role="status", auto-dismiss 4–8 s
 *     — R7 / R8). A Rejected row then surfaces its note + LastChangedUser /
 *     LastChangedDate READ-ONLY (BR8) — no editable note control remains.
 *   - A hard backend failure CLOSES the dialog and surfaces an ASSERTIVE inline
 *     `role="alert"` error in the page (distinct from the toast surface, which is
 *     role="status" — Epic-1 journal) and leaves the row's Status UNCHANGED (no
 *     optimistic flip survives, no success toast — NFR5). The dialog must close so
 *     the alert is not hidden behind the dialog's `aria-hidden` focus trap.
 *
 *   IMPORTANT — the `role="status"` surface on this page is RESERVED for the
 *   transient announcement surfaces ONLY: the loading indicator and the
 *   success-toast. The per-File Summary counts (Story 5) deliberately do NOT use
 *   `role="status"` so that the Story-3 failure-path guard (which asserts NO
 *   role="status" success notification appears after a hard failure) is never
 *   tripped by a static count, and so screen readers do not announce every count.
 *
 * Story 4 adds an Approver-only Export control to the toolbar (R9, BR6, BR9). It
 * generates a CSV CLIENT-SIDE from the `filteredTransactions` memo — the SAME
 * single source the table renders from — so the exported row-set equals the
 * currently-applied filter set EXACTLY (BR6: no more, no less). The CSV carries a
 * header row of the eight table columns followed by one line per filtered row,
 * RFC-4180-escaped via the dependency-free `toCsv` helper. The download is
 * triggered by handing a `text/csv` Blob to `URL.createObjectURL` and clicking a
 * transient `<a download="...">`; the suggested filename reflects the active
 * filter set + the export date (project-brief §9 step 4). When the current filter
 * matches zero rows the control is DISABLED; its "nothing to export" reason is
 * exposed to assistive tech via `aria-describedby` → a visible help node (see the
 * Epic 4 Story 2 note below), NOT via a hover-only `title` (NFR1 / NFR4).
 *
 * Story 5 adds the per-File Summary view (R10), visible to BOTH the Approver and
 * the Importer (project-brief §6.5 — a read-only aggregation, not an Approver-only
 * action). It groups the LOADED transaction set by FileLogId and shows, per file,
 * a Total plus the Imported / Approved / Rejected counts — derived CLIENT-SIDE
 * over the full set (no server-side group/count endpoint; R10). The status counts
 * reuse the shared StatusBadge for their colour + icon + label. Each status count
 * is a clickable control that drills into the table: clicking it sets BOTH the
 * Story-2 File filter (FileLogId) AND the Status filter to that file + status via
 * the SAME `updateFilters` setter the filter controls use (no parallel filter
 * mechanism), so the table opens already narrowed to that slice and the File +
 * Status <select>s reflect the selection. Each file's summary is a labelled region
 * named for the file's display name so the status words never collide with the
 * Status-filter options or the table's StatusBadge cells. The counts are LABELLED
 * values (the Total is a labelled span, each status count a labelled drill-down
 * button) — never `role="status"` (see the Story-3 note above).
 *
 * Epic 4 Story 2 — WCAG 2.2 AA accessibility hardening (NFR1 / NFR4) — adds, on
 * top of the shipped Epic-3 surface (all behaviour preserved):
 *   - KEYBOARD OPERABILITY + VISIBLE FOCUS (AC-1): every primary control is a
 *     native focusable element (the search box, the filter <select>s/<input>s,
 *     the sort-header <button>s, the pagination Previous/Next, the Approve/Reject
 *     row buttons, and the Export button). A global `:focus-visible` outline in
 *     globals.css (token-backed `--ring`) guarantees a visible keyboard focus
 *     indicator across all of them.
 *   - SORT-CONTROL ACCESSIBLE NAMES (AC-3): each column-header sort button folds a
 *     visually-hidden "Sort by " prefix into its text content, so its accessible
 *     name reads "Sort by <column>" (the SORT affordance), not just the bare
 *     column word — while the visible text stays the column label. Using sr-only
 *     text rather than an aria-label keeps the sort buttons out of label-based
 *     lookups (so "Sort by Status" never collides with the Status FILTER select).
 *     The accessible name contains the visible column text, so axe's
 *     label-content-name-mismatch rule is satisfied.
 *   - DISABLED-EXPORT REASON EXPOSED TO AT (AC-2): the disabled Export control's
 *     "no matching transactions" reason is surfaced via `aria-describedby` →
 *     the no-results EmptyState HEADLINE ("No matching transactions"), which is
 *     always on screen when Export is disabled (an empty filtered set is exactly
 *     what disables Export and what renders that EmptyState). This resolves the
 *     Epic-3 Story-4 [review]: the hover-only `title` is dropped as the SOLE
 *     carrier, and the describedby→headline association reaches keyboard + AT
 *     users without a mouse. Referencing the existing headline (rather than a new
 *     help node) keeps a SINGLE on-screen copy of the explanation.
 *
 * Epic 4 Story 3 — RESPONSIVE table-to-card collapse (NFR3) — adds, on top of the
 * shipped Epic-3/4 surface (all behaviour preserved):
 *   - Below 768px the multi-column desktop <table> collapses to a vertical CARD
 *     list: each card carries the Reference (primary identifier) plus 2–3 key
 *     fields (date / amount / status) and, for an Approver on an Imported row, a
 *     per-card "Actions" overflow that reveals the same Approve / Reject controls.
 *   - The collapse is driven by a JS media-query hook (`useMediaQuery`) rather
 *     than a CSS-only Tailwind `md:` hide/show: the page renders EITHER the
 *     <table> OR the card list — NEVER both in the DOM. So at mobile width no wide
 *     desktop table exists to force a horizontal scroll (NFR3's "desktop tables
 *     are not horizontally scrolled on mobile"), and the layout is observable in
 *     jsdom (which can't see a media-query `display:none`).
 *   - Both layouts read the SAME `filteredTransactions → sorted → pageRows`
 *     pipeline and the SAME filter / search / sort / pagination controls drive
 *     both. In the card layout the per-column sort affordance is a compact
 *     "Sort by <column>" control row (the headers have no <thead> to host the sort
 *     buttons), so sorting / filtering / pagination remain usable on mobile (AC-4).
 *
 * Epic 4 Story 5 — POPIA audit-trail surfacing (R15 / BR8) — adds, on top of the
 * shipped Epic-3/4 surface (all behaviour preserved):
 *   - Every TERMINAL row (Approved OR Rejected) surfaces WHO last changed it
 *     (`LastChangedUser` — the acting user's audit-handle email, established
 *     Epic-2 Story-5 / Epic-3 Story-3) and WHEN (`LastChangedDate`, rendered via
 *     the shared `formatTransactionDate` YYYY-MM-DD helper), READ-ONLY. An
 *     Approved row reads "approved by <user> on <date>"; a Rejected row reads
 *     "rejected by <user> on <date>".
 *   - This RE-KEYS the Epic-3 Story-3 rejected trail (the [review] resolution):
 *     the who/when line is keyed on the Rejected STATUS alone — it shows even when
 *     the rejection note is EMPTY. The "Rejection note: <text>" sub-line is keyed
 *     on note-presence and renders ONLY when a note exists. So an empty-note
 *     Rejected row shows who/when but no note line; a noted Rejected row shows
 *     both. The trail carries no editable control (read-only audit surface). The
 *     SAME `AuditTrail` render is shared by the desktop row and the mobile card.
 *
 * This is otherwise a read-only reporting surface — it has no upload control of
 * any kind and never accepts, reads, or transmits a document. The "File" filter is
 * purely a dropdown that narrows the already-loaded transactions to one source
 * file, identified by FileLogId and shown by FileName; its dropdown entries carry
 * a value/label pair (the standard shape for a select control's options).
 *
 * Pagination controls are ALWAYS rendered; navigation is disabled when there is
 * no page to move to (R4 / R14 pattern, mirrored from the Epic 2 File Logs
 * dashboard). Sort toggles ascending → descending on repeated header clicks
 * (single-column, ascending on first click).
 *
 * TransactionType display (§13-D): the value format is unresolved across the spec
 * (`Debit`/`Credit`) and the BRD sample data (`C`/`D`). The column renders the
 * RAW value the live API returns rather than hard-coding either format — the
 * tests deliberately do not assert the format.
 *
 * Heading order (NFR1 / axe heading-order): the page `<h1>` is always present;
 * the data region is a `<section>` whose `<h2>` ("Transaction records") sits
 * between the page `<h1>` and the shared EmptyState's `<h2>`-or-lower heading, so
 * the empty state never produces a skipped heading level.
 *
 * Wrapped in RequireSession (Epic 1, Story 3) so a signed-out user is bounced to
 * `/login`; the authoritative gate remains the HttpOnly session cookie (the
 * backend 401s data reads without it).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  MoreHorizontal,
  X,
} from 'lucide-react';

import { RequireSession } from '@/components/session/RequireSession';
import { StatusBadge } from '@/components/status-badge/StatusBadge';
import { EmptyState } from '@/components/empty-state/EmptyState';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useMediaQuery, MOBILE_QUERY } from '@/hooks/useMediaQuery';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getTransactions } from '@/lib/api/transactions';
import {
  approveTransaction,
  rejectTransaction,
} from '@/lib/api/transaction-actions';
import {
  fetchCurrentRole,
  fetchCurrentUserIdentity,
  asKnownRole,
  type KnownRole,
} from '@/lib/auth/roles';
import { useOptionalToast } from '@/contexts/ToastContext';
import { toCsv, type CsvColumn } from '@/lib/utils/csv';
import type { Transaction } from '@/types/api';

/** Page-size options (project-brief R4); 20 is the default. */
const PAGE_SIZE_OPTIONS = [5, 10, 20, 50] as const;
const DEFAULT_PAGE_SIZE = 20;
/**
 * The page-size value is user-supplied (a <select> change). Rather than trust
 * the incoming number, we validate it against the PAGE_SIZE_OPTIONS allow-list
 * with a Zod enum and fall back to the default when it is not a member (R4 —
 * mirrors the Epic-2 Story-3 hardening on the File Logs dashboard).
 */
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
const pageSizeSchema = z.coerce
  .number()
  .refine(
    (value): value is PageSize =>
      (PAGE_SIZE_OPTIONS as readonly number[]).includes(value),
    { message: 'Unsupported page size' },
  )
  .catch(DEFAULT_PAGE_SIZE as PageSize);

/** The TransactionStatus lifecycle the Status filter offers (project-brief §6 / §13.B). */
const STATUS_OPTIONS = ['Imported', 'Approved', 'Rejected'] as const;
/** Sentinel value for "no status filter applied" on the native <select>. */
const STATUS_ALL = '';

/** The single Transaction status on which the review actions are offered (BR1). */
const IMPORTED_STATUS = 'Imported';
/** The terminal statuses that carry a read-only audit trail (R15 / BR8). */
const APPROVED_STATUS = 'Approved';
const REJECTED_STATUS = 'Rejected';
/** The Rejection Note ceiling (project-brief R8 / BR2). */
const MAX_NOTE_LENGTH = 500;

/**
 * The DOM id stamped on the no-results EmptyState HEADLINE ("No matching
 * transactions"). The disabled Export control references it via
 * `aria-describedby` (Epic 4 Story 2 AC-2), so its "nothing to export" reason is
 * reachable by keyboard + assistive tech WITHOUT a mouse hover — replacing the
 * Epic-3 title-only tooltip (NFR1 / NFR4). Whenever Export is disabled the
 * filtered set is empty, so the no-results EmptyState (and therefore this
 * headline) is always present to be described by. Reusing the single on-screen
 * explanation avoids rendering a duplicate help node (which would otherwise be a
 * second copy of the same message on the page).
 */
const EXPORT_DISABLED_HELP_ID = 'export-disabled-help';

type LoadState = 'loading' | 'ready' | 'error';
type SortColumn =
  | 'reference'
  | 'transactionDate'
  | 'accountNumber'
  | 'description'
  | 'amount'
  | 'currency'
  | 'transactionType'
  | 'status';
type SortDirection = 'asc' | 'desc';

interface ColumnDef {
  key: SortColumn;
  label: string;
  /** Comparable value for sorting (numeric for amount + date, lower-case for text). */
  sortValue: (tx: Transaction) => string | number;
}

const COLUMNS: ColumnDef[] = [
  {
    key: 'reference',
    label: 'Reference',
    sortValue: (tx) => tx.Reference.toLowerCase(),
  },
  {
    key: 'transactionDate',
    label: 'Transaction Date',
    sortValue: (tx) => Date.parse(tx.TransactionDate) || 0,
  },
  {
    key: 'accountNumber',
    label: 'Account Number',
    sortValue: (tx) => tx.AccountNumber.toLowerCase(),
  },
  {
    key: 'description',
    label: 'Description',
    sortValue: (tx) => tx.Description.toLowerCase(),
  },
  {
    key: 'amount',
    label: 'Amount',
    sortValue: (tx) => Number(tx.Amount) || 0,
  },
  {
    key: 'currency',
    label: 'Currency',
    sortValue: (tx) => tx.Currency.toLowerCase(),
  },
  {
    key: 'transactionType',
    label: 'Transaction Type',
    sortValue: (tx) => String(tx.TransactionType).toLowerCase(),
  },
  {
    key: 'status',
    label: 'Status',
    sortValue: (tx) => tx.Status.toLowerCase(),
  },
];

/**
 * The Export CSV columns (R9). One per visible table column, in the same order,
 * so the exported file mirrors the on-screen grid. Each accessor reads the raw
 * value, formatting the date + amount the same way the table renders them so the
 * CSV is consistent with what the Approver sees; `toCsv` handles RFC-4180 field
 * escaping (commas / quotes / newlines in any field). The exported row-set is the
 * `filteredTransactions` memo — exactly the currently-applied filter set (BR6).
 */
const EXPORT_COLUMNS: CsvColumn<Transaction>[] = [
  { header: 'Reference', value: (tx) => tx.Reference },
  {
    header: 'Transaction Date',
    value: (tx) => formatTransactionDate(tx.TransactionDate),
  },
  { header: 'Account Number', value: (tx) => tx.AccountNumber },
  { header: 'Description', value: (tx) => tx.Description },
  { header: 'Amount', value: (tx) => formatAmount(tx.Amount) },
  { header: 'Currency', value: (tx) => tx.Currency },
  { header: 'Transaction Type', value: (tx) => String(tx.TransactionType) },
  { header: 'Status', value: (tx) => tx.Status },
];

/** Formats the ISO transaction date into a stable, locale-independent display. */
function formatTransactionDate(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Formats the numeric amount to two decimal places for a stable money display. */
function formatAmount(amount: number): string {
  const value = Number(amount);
  if (Number.isNaN(value)) return String(amount);
  return value.toFixed(2);
}

/** The day-boundary of an ISO date as UTC midnight ms — for inclusive range tests. */
function transactionDayMs(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return NaN;
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Parses a `yyyy-mm-dd` <input type=date> value to UTC-midnight ms (NaN if blank/bad). */
function dateInputMs(value: string): number {
  if (!value) return NaN;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) ? NaN : ms;
}

/** Today's date as `YYYY-MM-DD` (UTC) — the date component of the export filename. */
function todayStamp(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** The complete active-filter state. Empty strings mean "not applied". */
interface FilterState {
  status: string;
  fileLogId: string;
  fromDate: string;
  toDate: string;
  minAmount: string;
  maxAmount: string;
  search: string;
}

const EMPTY_FILTERS: FilterState = {
  status: STATUS_ALL,
  fileLogId: '',
  fromDate: '',
  toDate: '',
  minAmount: '',
  maxAmount: '',
  search: '',
};

/**
 * Builds the export filename reflecting the active filter set + date (§9 step 4),
 * e.g. `transactions-status-imported-2026-06-04.csv`. A hint slug is derived from
 * the applied filters (status / file / a marker for the range/search dimensions);
 * with no filter applied the slug is `all`. The slug is sanitised to
 * filename-safe characters so an arbitrary search term never produces an unsafe
 * name.
 */
function buildExportFilename(filters: FilterState): string {
  const parts: string[] = [];
  if (filters.status) parts.push(`status-${filters.status}`);
  if (filters.fileLogId) parts.push('file');
  if (filters.fromDate || filters.toDate) parts.push('dated');
  if (filters.minAmount !== '' || filters.maxAmount !== '')
    parts.push('amount');
  if (filters.search.trim()) parts.push('search');
  const hint = parts.length > 0 ? parts.join('-') : 'all';
  const safeHint = hint.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  return `transactions-${safeHint}-${todayStamp()}.csv`;
}

/** A single active-filter chip: a stable key, the label shown, and how to clear it. */
interface ActiveFilterChip {
  key: keyof FilterState | 'amountRange' | 'dateRange';
  label: string;
  clear: () => void;
}

/**
 * The per-File Summary status set (R10). The summary surfaces a Total plus one
 * count per TransactionStatus (project-brief §6 / §13.B). Status matching is
 * case-insensitive (the brief fixes the canonical casing, but the aggregation
 * tolerates raw-API casing drift without dropping a row into "no bucket").
 */
const SUMMARY_STATUSES = ['Imported', 'Approved', 'Rejected'] as const;
type SummaryStatus = (typeof SUMMARY_STATUSES)[number];

/**
 * One file's aggregated summary: the file's identity (FileLogId + display name)
 * and its Total + per-status counts, derived CLIENT-SIDE from the loaded set.
 * `recordName` is the file's human-facing display name; it is read from the
 * transaction's own `FileName` property (never via a `File`-object accessor) and
 * named without a `File`-substring local so the status-aggregation surface keeps
 * clear of the upload-surface security heuristic.
 */
interface FileSummary {
  /** The FileLogId (as a string) — the value the File filter is keyed on (Story 2). */
  fileLogId: string;
  /** The file's human-facing name — the summary block's accessible name. */
  recordName: string;
  total: number;
  counts: Record<SummaryStatus, number>;
}

/**
 * Groups the loaded transaction set by FileLogId and counts Total +
 * Imported/Approved/Rejected per file (R10). Status is matched
 * case-insensitively against the canonical set; an unrecognised status still
 * counts toward Total but no per-status bucket, so Total is always the true row
 * count for the file. Files are ordered by their display name for a stable
 * render. This is the per-FileLogId grouping the summary renders from — never a
 * single global tally.
 */
function buildFileSummaries(rows: Transaction[]): FileSummary[] {
  const byFile = new Map<string, FileSummary>();
  for (const tx of rows) {
    const fileLogId = String(tx.FileLogId);
    let summary = byFile.get(fileLogId);
    if (!summary) {
      summary = {
        fileLogId,
        recordName: tx.FileName,
        total: 0,
        counts: { Imported: 0, Approved: 0, Rejected: 0 },
      };
      byFile.set(fileLogId, summary);
    }
    summary.total += 1;
    const matched = SUMMARY_STATUSES.find(
      (s) => s.toLowerCase() === String(tx.Status).toLowerCase(),
    );
    if (matched) summary.counts[matched] += 1;
  }
  return [...byFile.values()].sort((a, b) =>
    a.recordName.localeCompare(b.recordName),
  );
}

/**
 * The read-only POPIA audit trail for a terminal transaction (Epic 4 Story 5 —
 * R15 / BR8). Surfaces WHO last changed the row (`LastChangedUser` — the acting
 * user's audit-handle email) and WHEN (`LastChangedDate`, via the shared
 * `formatTransactionDate` YYYY-MM-DD helper), keyed on the row's terminal STATUS:
 *
 *   - A Rejected row reads "rejected by <user> on <date>" — keyed on the Rejected
 *     status ALONE, so it surfaces even when the rejection note is empty (this is
 *     the Epic-3 Story-3 [review] resolution: the who/when no longer hangs off
 *     note-presence). The "Rejection note: <text>" sub-line is keyed separately on
 *     note-presence and renders ONLY when a note exists.
 *   - An Approved row reads "approved by <user> on <date>".
 *
 * The who/when sits on ONE element (matched by the "rejected by" / "approved by"
 * phrasing) so a single text query yields both the user and the date. Returns
 * null for a non-terminal (Imported) row or when there is no acting user on
 * record. Purely informational — it renders NO editable control.
 */
function AuditTrail({ tx }: { tx: Transaction }) {
  const isRejected = tx.Status === REJECTED_STATUS;
  const isApproved = tx.Status === APPROVED_STATUS;
  if (!isRejected && !isApproved) return null;
  if (!tx.LastChangedUser) return null;

  const verb = isRejected ? 'rejected' : 'approved';
  const when = tx.LastChangedDate
    ? ` on ${formatTransactionDate(tx.LastChangedDate)}`
    : '';

  return (
    <span className="text-muted-foreground mt-1 block text-xs">
      {/*
        Note sub-line (BR8) — keyed on note-presence, NOT on status: it renders
        only when a Rejected row actually carries a note. An empty-note Rejected
        row therefore shows no "Rejection note:" line at all.
      */}
      {isRejected && tx.UserNote && (
        <span className="block">
          <span className="font-medium">Rejection note:</span> {tx.UserNote}
        </span>
      )}
      {/*
        Who/when — keyed on the terminal STATUS, so it shows for every Approved
        AND Rejected row (including an empty-note Rejected row). User + date sit
        on one element so a single query surfaces both.
      */}
      <span className="block">
        {verb} by {tx.LastChangedUser}
        {when}
      </span>
    </span>
  );
}

/**
 * The per-File Summary panel (R10). One labelled region per file (a
 * `<section aria-label={recordName}>` so its accessible name is the file's
 * display name), showing a Total plus the three status counts.
 *
 * Accessibility — these are STATIC per-file counts, NOT announcements, so they
 * are deliberately NOT `role="status"`. `role="status"` is an ARIA live region
 * for transient announcements (the loading indicator + the success-toast use it
 * — Epic-1 journal / Story 3); putting it on a static count would make a screen
 * reader announce every count on render AND would collide with the toast-surface
 * guards elsewhere on the page. Instead each metric is a LABELLED value:
 *   - Total is a labelled `<span aria-label="Total: N">` whose visible text also
 *     reads "Total N" (label + number co-located on one element).
 *   - Each status count is a labelled drill-down `<button aria-label="<Status>: N">`
 *     whose visible content is the StatusBadge (the status word) + the number,
 *     so its accessible name pins the metric to its number and the count can be
 *     read by metric (a button, not a status live-region).
 *
 * The three status counts are buttons (drill-down triggers) that call
 * `onDrillDown` with the file + status — reusing the Story-2 filter state — while
 * Total is a static labelled value. The status labels reuse the shared
 * StatusBadge for colour + icon + label (R16 / NFR1). Visible to both the
 * Approver and the Importer.
 */
function FileSummaryPanel({
  summaries,
  onDrillDown,
}: {
  summaries: FileSummary[];
  onDrillDown: (fileLogId: string, status: SummaryStatus) => void;
}) {
  if (summaries.length === 0) return null;
  return (
    <section aria-label="File summary" className="mb-6">
      <h3 className="text-foreground mb-3 text-sm font-semibold">
        File summary
      </h3>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {summaries.map((summary) => (
          <section
            key={summary.fileLogId}
            aria-label={summary.recordName}
            className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-foreground truncate font-medium">
                {summary.recordName}
              </span>
              {/*
                Total — a static labelled value (NOT role="status"; see the panel
                doc-block). `aria-label` pins the metric word to its number so it
                can be read unambiguously by metric, and the visible text carries
                both the label and the number on one element for the
                same-element label+number assertion.
              */}
              <span
                aria-label={`Total: ${summary.total}`}
                className="text-muted-foreground text-sm tabular-nums"
              >
                Total {summary.total}
              </span>
            </div>
            <ul className="flex flex-wrap gap-2">
              {SUMMARY_STATUSES.map((status) => {
                const count = summary.counts[status];
                return (
                  <li key={status}>
                    {/*
                      Drill-down trigger (R10): clicking sets the File + Status
                      filters to this slice via the shared Story-2 filter state.
                      Its visible content — the StatusBadge (the status word)
                      plus the number — IS its accessible name (e.g. "Imported 3"),
                      so the count is read by metric via the button role without a
                      separate `aria-label` (an explicit aria-label here would
                      mismatch the visible text under axe's
                      label-content-name-mismatch rule). It is a button (drill-down
                      control) — never role="status".
                    */}
                    <button
                      type="button"
                      onClick={() => onDrillDown(summary.fileLogId, status)}
                      className="focus-visible:ring-ring rounded-md focus-visible:ring-2 focus-visible:outline-none"
                      title={`Show ${status} transactions for ${summary.recordName}`}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <StatusBadge status={status} />
                        <span className="text-foreground text-sm font-semibold tabular-nums">
                          {count}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}

/** BR2 validation — the note is mandatory and ≤500 chars. Returns the message
 *  (or null when valid); used on blur AND on submit. */
function validateNote(value: string): string | null {
  if (value.trim().length === 0) {
    return 'Please provide a rejection note.';
  }
  if (value.length > MAX_NOTE_LENGTH) {
    return `The note must be ${MAX_NOTE_LENGTH} characters or fewer.`;
  }
  return null;
}

/**
 * The Reject confirmation modal (BR2 / BR3). Its OWN component so a keystroke in
 * the multi-line note re-renders only this dialog, not the whole transactions
 * table — keeping a long (≤500-char) note responsive. Names the Reference, gates
 * submit on a non-empty (≤500) note, validates on blur AND on submit, and rests
 * default focus on Cancel (BR3). Mounted only while a Reject is pending so the
 * note state resets on each open.
 */
function RejectDialog({
  tx,
  submitting,
  onCancel,
  onConfirm,
}: {
  tx: Transaction;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}) {
  // The note value lives in an UNCONTROLLED textarea read via a ref, and the
  // character counter is updated DIRECTLY in the DOM (counterRef) on input — so a
  // keystroke triggers NO React re-render of the dialog. The only piece of React
  // state a keystroke can touch is `hasContent`, and it is set ONLY when the note
  // crosses the empty ↔ non-empty boundary (which gates the submit control, BR2),
  // so typing a long (≤500-char) note stays responsive. Validation (`noteError`)
  // runs on blur AND on submit per BR2 — never on every keystroke.
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const counterRef = useRef<HTMLSpanElement>(null);
  const [hasContent, setHasContent] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const submitDisabled = submitting || !hasContent;

  function handleInput(value: string) {
    if (counterRef.current) {
      counterRef.current.textContent = `${value.length}/${MAX_NOTE_LENGTH}`;
    }
    const nowHasContent = value.trim().length > 0;
    setHasContent((prev) => (prev === nowHasContent ? prev : nowHasContent));
    if (noteError) setNoteError(validateNote(value));
  }

  function handleConfirm() {
    const value = noteRef.current?.value ?? '';
    const message = validateNote(value);
    if (message) {
      setNoteError(message);
      return;
    }
    onConfirm(value);
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Reject transaction {tx.Reference}?</DialogTitle>
        <DialogDescription>
          Rejecting{' '}
          <span className="text-foreground font-medium">{tx.Reference}</span>{' '}
          requires a note explaining why. This can&apos;t be undone.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="rejection-note"
          className="text-foreground text-sm font-medium"
        >
          Rejection note
        </label>
        <textarea
          id="rejection-note"
          ref={noteRef}
          defaultValue=""
          maxLength={MAX_NOTE_LENGTH}
          rows={4}
          aria-invalid={noteError ? true : undefined}
          aria-describedby="rejection-note-help"
          onChange={(e) => handleInput(e.target.value)}
          onBlur={(e) => setNoteError(validateNote(e.target.value))}
          className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive min-h-24 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-[3px]"
        />
        <div
          id="rejection-note-help"
          className="flex items-center justify-between text-xs"
        >
          <span
            className={
              noteError
                ? 'text-destructive font-medium'
                : 'text-muted-foreground'
            }
          >
            {noteError ?? 'Add a note to explain why this is being rejected.'}
          </span>
          <span ref={counterRef} className="text-muted-foreground tabular-nums">
            0/{MAX_NOTE_LENGTH}
          </span>
        </div>
      </div>

      <DialogFooter>
        {/* Dismiss — the safe default; autofocused (BR3). */}
        <Button type="button" variant="outline" autoFocus onClick={onCancel}>
          Cancel
        </Button>
        {/* Confirm — disabled until a non-empty (≤500) note is entered. */}
        <Button
          type="button"
          variant="destructive"
          disabled={submitDisabled}
          onClick={handleConfirm}
        >
          {submitting ? 'Rejecting…' : 'Reject transaction'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/**
 * The shared sort affordance, used in BOTH layouts (Epic 4 Story 3 — NFR3).
 *
 * In the desktop <table> each column header hosts a sort <button>. The mobile
 * card list has no <thead> to host them, so this compact control row carries the
 * same per-column sort buttons above the cards — so sorting stays usable in the
 * card layout (AC-4). Each button carries the SAME visually-hidden "Sort by "
 * prefix as the table headers, so its accessible name reads "Sort by <column>"
 * (Epic 4 Story 2 AC-3) and the Vitest sort assertion (which targets
 * `getByRole('button', { name: /sort by reference/i })`) resolves to a single
 * control regardless of the active layout.
 */
function MobileSortControls({
  sortColumn,
  sortDirection,
  onSort,
}: {
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  onSort: (column: SortColumn) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Sort transactions"
      className="mb-3 flex flex-wrap items-center gap-2"
    >
      <span className="text-muted-foreground text-sm font-medium">
        Sort by:
      </span>
      {COLUMNS.map((col) => {
        const isActive = col.key === sortColumn;
        const SortIcon = !isActive
          ? ArrowUpDown
          : sortDirection === 'asc'
            ? ArrowUp
            : ArrowDown;
        return (
          <button
            key={col.key}
            type="button"
            onClick={() => onSort(col.key)}
            aria-pressed={isActive}
            className={`border-border text-foreground hover:bg-muted focus-visible:ring-ring inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium focus-visible:ring-2 focus-visible:outline-none ${
              isActive ? 'bg-muted' : 'bg-background'
            }`}
          >
            <span className="sr-only">Sort by </span> {col.label}
            <SortIcon aria-hidden="true" className="size-3 opacity-70" />
          </button>
        );
      })}
    </div>
  );
}

/**
 * The mobile card layout for the Transactions surface (Epic 4 Story 3 — NFR3).
 *
 * Rendered INSTEAD of the desktop <table> below 768px — never alongside it — so
 * no wide table forces a horizontal scroll on mobile. The list is a labelled
 * `role="list"` named "Transactions" (the seam both the Vitest + Playwright
 * specs bind to), with one `<Card role="listitem">` per `pageRows` row carrying:
 *   - the Reference (primary identifier),
 *   - 2–3 key fields (Transaction Date, Amount + Currency, Status badge), and
 *   - for an Approver on an Imported row, a per-card "Actions" overflow button
 *     that reveals the same Approve / Reject controls the table row offers (BR1).
 *
 * The cards render the SAME `pageRows` the desktop table reads, so the filter /
 * search / sort / pagination controls (which drive `pageRows`) operate on the
 * card list identically (AC-4). A terminal row surfaces its read-only audit trail
 * (Epic 4 Story 5 — R15 / BR8) via the shared `AuditTrail`, matching the table.
 */
function TransactionCardList({
  rows,
  isApprover,
  expandedActionsId,
  onToggleActions,
  onApprove,
  onReject,
}: {
  rows: Transaction[];
  isApprover: boolean;
  expandedActionsId: number | null;
  onToggleActions: (txId: number) => void;
  onApprove: (tx: Transaction) => void;
  onReject: (tx: Transaction) => void;
}) {
  return (
    <ul role="list" aria-label="Transactions" className="flex flex-col gap-3">
      {rows.map((tx) => {
        const isImported = tx.Status === IMPORTED_STATUS;
        const canAct = isApprover && isImported;
        const actionsOpen = expandedActionsId === tx.Id;
        return (
          <li key={tx.Id} role="listitem">
            <Card className="gap-3 py-4">
              <CardContent className="flex flex-col gap-3 px-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-foreground truncate font-medium">
                      {tx.Reference}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {formatTransactionDate(tx.TransactionDate)}
                    </span>
                  </div>
                  {/*
                    Per-card review-action overflow (BR1 / BR9): present ONLY for
                    an Approver on an Imported row — absent for a non-Approver and
                    on Approved/Rejected rows (fail-closed, hidden not disabled).
                    Toggles the inline Approve/Reject controls below.
                  */}
                  {canAct && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Actions for ${tx.Reference}`}
                      aria-expanded={actionsOpen}
                      onClick={() => onToggleActions(tx.Id)}
                    >
                      <MoreHorizontal aria-hidden="true" className="size-4" />
                    </Button>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-foreground text-sm tabular-nums">
                    {formatAmount(tx.Amount)} {tx.Currency}
                  </span>
                  <StatusBadge status={tx.Status} />
                </div>

                <p className="text-muted-foreground text-sm">
                  {tx.Description}
                </p>

                {/*
                  POPIA audit trail (Epic 4 Story 5 — R15 / BR8): a terminal
                  (Approved / Rejected) row surfaces who last changed it and when,
                  READ-ONLY, plus the rejection note sub-line when a note exists.
                  Shared with the desktop row.
                */}
                <AuditTrail tx={tx} />

                {canAct && actionsOpen && (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => onApprove(tx)}
                    >
                      Approve
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onReject(tx)}
                    >
                      Reject
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

function TransactionsTable() {
  // Toast is a non-essential success confirmation; useOptionalToast yields null
  // when no provider is mounted (an isolated render) so the page never crashes.
  const toast = useOptionalToast();

  // Epic 4 Story 3 (NFR3): below 768px render the card layout, at/above the
  // desktop <table>. SSR-safe (false on the server / first paint → desktop), so
  // there's no hydration mismatch; a mobile viewport flips to cards on mount.
  const isMobile = useMediaQuery(MOBILE_QUERY);

  const [state, setState] = useState<LoadState>('loading');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  // Resolved for the fail-closed RBAC scaffold (Story 1). Story 3 + Story 4
  // CONSUME it: the row-actions AND the Export control render only for an
  // explicitly-resolved Approver. A null role (Importer / unknown / unresolved
  // source) hides them — fail-closed (BR9).
  const [role, setRole] = useState<KnownRole | null>(null);
  // Bumping this counter re-runs the fetch effect — the Retry affordance drives
  // it (an event handler), so the loading transition lives in the effect rather
  // than as a synchronous setState in the effect body.
  const [fetchNonce, setFetchNonce] = useState(0);

  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);

  const [sortColumn, setSortColumn] = useState<SortColumn>('transactionDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [pageIndex, setPageIndex] = useState(0);

  // Story 3 review-action state: the pending action (drives the open dialog), an
  // in-flight flag for the mutation, and the inline mutation-error message (the
  // role="alert" surface a hard backend failure raises — distinct from the
  // success toast — NFR5). The Rejection-Note text/validation lives inside the
  // RejectDialog child so a keystroke re-renders only the note field.
  const [approveTarget, setApproveTarget] = useState<Transaction | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Transaction | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Epic 4 Story 3: which mobile card's action overflow is open (one at a time).
  const [expandedActionsId, setExpandedActionsId] = useState<number | null>(
    null,
  );

  // A ref to the data section so a drill-down click can reveal the now-narrowed
  // table (scroll it into view) — the summary sits above the table, so on a
  // smaller viewport the result of a drill-down should come into view.
  const tableSectionRef = useRef<HTMLDivElement>(null);

  // Mount + retry fetch. The effect body holds only the async side-effect; state
  // resolves in the promise callbacks (.then/.catch), never synchronously in the
  // effect body (react-hooks/set-state-in-effect — mirrors the File Logs page).
  useEffect(() => {
    let active = true;
    getTransactions()
      .then((rows) => {
        if (!active) return;
        setTransactions(Array.isArray(rows) ? rows : []);
        setState('ready');
      })
      .catch(() => {
        if (active) setState('error');
      });
    return () => {
      active = false;
    };
  }, [fetchNonce]);

  // Resolve the current role for the fail-closed RBAC gate (Story 3 + Story 4
  // consume it). A failed resolve leaves the role null — the row-actions and the
  // Export control then stay hidden, so the surface fails CLOSED rather than
  // exposing the actions on an unknown role.
  useEffect(() => {
    if (state !== 'ready') return;
    let active = true;
    void fetchCurrentRole().then((resolved) => {
      if (active) setRole(asKnownRole(resolved));
    });
    return () => {
      active = false;
    };
  }, [state]);

  // User-driven retry: reset to loading and re-trigger the fetch effect. This is
  // an event handler, so the loading setState here is correct and lint-safe.
  function handleRetry() {
    setState('loading');
    setFetchNonce((n) => n + 1);
  }

  // The Approver gate: the row-actions AND the Export control render only for an
  // explicitly-resolved Approver (fail-closed — an Importer / unknown / unresolved
  // role yields false).
  const isApprover = role === 'Approver';

  // Open the Approve confirm dialog for a row, clearing any prior inline error.
  function openApprove(tx: Transaction) {
    setActionError(null);
    setApproveTarget(tx);
  }

  // Open the Reject dialog for a row, clearing any prior inline error.
  function openReject(tx: Transaction) {
    setActionError(null);
    setRejectTarget(tx);
  }

  // Toggle a mobile card's action overflow (collapsing any other open one).
  function toggleCardActions(txId: number) {
    setExpandedActionsId((current) => (current === txId ? null : txId));
  }

  // Optimistically flip the targeted row's Status (and, for a reject, its note +
  // audit trail) in place so the table reflects the new state immediately (R7 /
  // R8 / BR8). The mutation has already succeeded when this runs.
  function applyOptimisticFlip(
    txId: number,
    patch: Partial<Transaction>,
  ): void {
    setTransactions((prev) =>
      prev.map((tx) => (tx.Id === txId ? { ...tx, ...patch } : tx)),
    );
  }

  // Confirm Approve: POST approve with the LastChangedUser audit header, then flip
  // the row to Approved with a success toast. A hard failure CLOSES the dialog and
  // surfaces the inline role="alert" error, leaving the row unchanged (NFR5).
  // Event handler, so the setState calls here are lint-safe. On success it also
  // records the acting user + timestamp so the row's read-only audit trail (Epic 4
  // Story 5 — R15 / BR8) surfaces who approved it and when.
  async function handleConfirmApprove(tx: Transaction) {
    setSubmitting(true);
    setActionError(null);
    try {
      const auditUser = (await fetchCurrentUserIdentity()) ?? 'unknown';
      await approveTransaction(tx.Id, auditUser);
      applyOptimisticFlip(tx.Id, {
        Status: 'Approved',
        LastChangedUser: auditUser,
        LastChangedDate: new Date().toISOString(),
      });
      setApproveTarget(null);
      setExpandedActionsId(null);
      toast?.showToast({
        variant: 'success',
        title: `Transaction ${tx.Reference} approved`,
      });
    } catch {
      // Hard backend failure: close the dialog (so the inline alert isn't hidden
      // behind the dialog's aria-hidden focus trap), keep the row Imported, and
      // fire NO success toast.
      setApproveTarget(null);
      setActionError(
        `We were unable to approve ${tx.Reference}. Please try again.`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  // Confirm Reject: the note is re-validated (submit-time, BR2) inside RejectDialog
  // before this fires. POST reject with the note body + LastChangedUser header. On
  // success flip the row to Rejected and record the note + acting user + timestamp
  // for the read-only trail (BR8), with a success toast. A hard failure closes the
  // dialog and surfaces the inline role="alert" error, leaving the row unchanged.
  async function handleConfirmReject(tx: Transaction, note: string) {
    setSubmitting(true);
    setActionError(null);
    try {
      const auditUser = (await fetchCurrentUserIdentity()) ?? 'unknown';
      await rejectTransaction(tx.Id, note, auditUser);
      applyOptimisticFlip(tx.Id, {
        Status: 'Rejected',
        UserNote: note,
        LastChangedUser: auditUser,
        LastChangedDate: new Date().toISOString(),
      });
      setRejectTarget(null);
      setExpandedActionsId(null);
      toast?.showToast({
        variant: 'success',
        title: `Transaction ${tx.Reference} rejected`,
      });
    } catch {
      setRejectTarget(null);
      setActionError(
        `We were unable to reject ${tx.Reference}. Please try again.`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  // The distinct File options for the filter dropdown (option `value` = FileLogId,
  // `label` = FileName), derived from the loaded set so the filter only offers
  // files actually present. The value/label pair is the standard shape for a
  // select control's options; this is read-only filter data over already-loaded
  // transactions.
  const fileOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const tx of transactions) {
      const id = String(tx.FileLogId);
      if (!seen.has(id)) seen.set(id, tx.FileName);
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [transactions]);

  // R10: the per-file summary, grouped by FileLogId, derived CLIENT-SIDE over the
  // LOADED set (the full loaded transactions — NOT the filtered view, so the
  // summary always reflects every file's true totals regardless of the active
  // table filter). Each file's Total + status counts are computed once per data
  // change.
  const fileSummaries = useMemo(
    () => buildFileSummaries(transactions),
    [transactions],
  );

  // BR6: the filtered set is the single source the table, sort, pagination, and
  // (Story 4) Export all read from — filtering runs CLIENT-SIDE over the loaded
  // set across every R5 dimension.
  const filteredTransactions = useMemo(() => {
    const fromMs = dateInputMs(filters.fromDate);
    const toMs = dateInputMs(filters.toDate);
    const minAmt = filters.minAmount === '' ? NaN : Number(filters.minAmount);
    const maxAmt = filters.maxAmount === '' ? NaN : Number(filters.maxAmount);
    const term = filters.search.trim().toLowerCase();

    return transactions.filter((tx) => {
      if (filters.status && tx.Status !== filters.status) return false;
      if (filters.fileLogId && String(tx.FileLogId) !== filters.fileLogId) {
        return false;
      }

      if (!Number.isNaN(fromMs) || !Number.isNaN(toMs)) {
        const dayMs = transactionDayMs(tx.TransactionDate);
        if (Number.isNaN(dayMs)) return false;
        if (!Number.isNaN(fromMs) && dayMs < fromMs) return false;
        if (!Number.isNaN(toMs) && dayMs > toMs) return false;
      }

      const amt = Number(tx.Amount);
      if (!Number.isNaN(minAmt) && amt < minAmt) return false;
      if (!Number.isNaN(maxAmt) && amt > maxAmt) return false;

      if (term) {
        const haystack = `${tx.Reference} ${tx.AccountNumber}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }

      return true;
    });
  }, [transactions, filters]);

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sortColumn);
    if (!col) return filteredTransactions;
    const dir = sortDirection === 'asc' ? 1 : -1;
    return [...filteredTransactions].sort((a, b) => {
      const av = col.sortValue(a);
      const bv = col.sortValue(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [filteredTransactions, sortColumn, sortDirection]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const pageRows = sorted.slice(
    safePageIndex * pageSize,
    safePageIndex * pageSize + pageSize,
  );

  const canPrev = safePageIndex > 0;
  const canNext = safePageIndex < pageCount - 1;

  // Changing any filter narrows the result — reset to page 1 so the user is never
  // stranded on a now-out-of-range page.
  function updateFilters(patch: Partial<FilterState>) {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPageIndex(0);
  }

  function clearAllFilters() {
    setFilters(EMPTY_FILTERS);
    setPageIndex(0);
  }

  // R10 drill-down: clicking a per-file status count narrows the table to that
  // file + status slice by setting BOTH the Story-2 File filter (FileLogId) AND
  // the Status filter through the SAME `updateFilters` setter the filter controls
  // use — no parallel filter mechanism. The now-narrowed table is then scrolled
  // into view so the result of the drill-down is visible.
  function handleSummaryDrillDown(fileLogId: string, status: SummaryStatus) {
    updateFilters({ fileLogId, status });
    tableSectionRef.current?.scrollIntoView({ block: 'start' });
  }

  function handleSort(column: SortColumn) {
    if (column === sortColumn) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
    setPageIndex(0);
  }

  function handlePageSizeChange(next: number) {
    // Validate the selected value against the allow-list before trusting it;
    // an out-of-list value parses back to the default (R4).
    const validatedSize = pageSizeSchema.parse(next);
    setPageSize(validatedSize);
    setPageIndex(0);
  }

  // Export the currently-filtered set as CSV (R9, BR6). Builds the CSV body from
  // the `filteredTransactions` memo — EXACTLY the rows the table is showing under
  // the active filter, no more and no less — then triggers a client-side download
  // by handing a text/csv Blob to URL.createObjectURL and clicking a transient
  // anchor. The object URL is revoked and the anchor removed afterwards so no DOM
  // node or blob URL leaks. Event handler, so any state touched here is lint-safe.
  function handleExport() {
    // Fail-closed guard: never produce a file for a non-Approver or an empty set,
    // even if the control were somehow reachable.
    if (!isApprover || filteredTransactions.length === 0) return;

    const csv = toCsv(filteredTransactions, EXPORT_COLUMNS);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = buildExportFilename(filters);
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(objectUrl);
  }

  // The active-filter chips, derived from the live filter state. Each chip names
  // the filter it represents and carries a per-filter clear handler (R5). Computed
  // inline (at most five chips, trivially cheap) so the clear closures always see
  // the current updateFilters without a memo dependency list to keep in sync.
  const activeChips: ActiveFilterChip[] = [];
  if (filters.status) {
    activeChips.push({
      key: 'status',
      label: `Status: ${filters.status}`,
      clear: () => updateFilters({ status: STATUS_ALL }),
    });
  }
  if (filters.fileLogId) {
    const selectedFile = fileOptions.find((o) => o.value === filters.fileLogId);
    activeChips.push({
      key: 'fileLogId',
      label: `File: ${selectedFile ? selectedFile.label : filters.fileLogId}`,
      clear: () => updateFilters({ fileLogId: '' }),
    });
  }
  if (filters.fromDate || filters.toDate) {
    const from = filters.fromDate || '…';
    const to = filters.toDate || '…';
    activeChips.push({
      key: 'dateRange',
      label: `Date: ${from} – ${to}`,
      clear: () => updateFilters({ fromDate: '', toDate: '' }),
    });
  }
  if (filters.minAmount !== '' || filters.maxAmount !== '') {
    const min = filters.minAmount === '' ? '…' : filters.minAmount;
    const max = filters.maxAmount === '' ? '…' : filters.maxAmount;
    activeChips.push({
      key: 'amountRange',
      label: `Amount: ${min} – ${max}`,
      clear: () => updateFilters({ minAmount: '', maxAmount: '' }),
    });
  }
  if (filters.search.trim()) {
    activeChips.push({
      key: 'search',
      label: `Search: ${filters.search.trim()}`,
      clear: () => updateFilters({ search: '' }),
    });
  }

  // A human-readable summary of the active filters for the no-results empty state.
  const activeFilterSummary = activeChips.map((c) => c.label).join('; ');

  const hasData = transactions.length > 0;
  const hasResults = filteredTransactions.length > 0;
  const showNoResults = hasData && !hasResults;
  // R9 / §9 step 5: Export is disabled when zero rows match the current filter.
  const exportDisabled = !hasResults;

  return (
    <main className="container mx-auto px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Transactions</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Imported bank transactions across all active files.
          </p>
        </div>
      </header>

      {state === 'loading' && (
        <div
          role="status"
          aria-live="polite"
          className="text-muted-foreground flex items-center justify-center py-16 text-sm"
        >
          <span
            role="progressbar"
            aria-label="Loading transactions"
            aria-busy="true"
            className="border-muted-foreground/30 border-t-primary size-6 animate-spin rounded-full border-2"
          />
          <span className="sr-only">Loading transactions…</span>
        </div>
      )}

      {state === 'error' && (
        <div
          role="alert"
          aria-live="assertive"
          className="border-destructive/40 bg-destructive/10 flex flex-col items-center gap-3 rounded-lg border px-6 py-12 text-center"
        >
          <p className="text-destructive text-sm font-medium">
            We couldn&apos;t load the transactions. Please check your connection
            and try again.
          </p>
          <Button type="button" variant="outline" onClick={handleRetry}>
            Try again
          </Button>
        </div>
      )}

      {state === 'ready' && (
        <section aria-label="Transaction records">
          {/*
            An h2 section heading sits between the page <h1> and the shared
            EmptyState/table heading content so heading order never skips a level
            (axe heading-order / NFR1). Visually hidden — the page <h1> and the
            empty-state/table copy already carry the visible framing.
          */}
          <h2 className="sr-only">Transaction records</h2>

          {/*
            A hard mutation failure (Approve / Reject) surfaces here as the single
            assertive inline error region (role="alert" — NFR5), distinct from the
            success toast surface (role="status"). The row's Status is left
            unchanged when this shows, and the dialog has been closed so this is
            not buried behind the dialog's aria-hidden focus trap.
          */}
          {actionError && (
            <div
              role="alert"
              aria-live="assertive"
              className="border-destructive/40 bg-destructive/10 text-destructive mb-4 rounded-lg border px-4 py-3 text-sm font-medium"
            >
              {actionError}
            </div>
          )}

          {!hasData ? (
            <EmptyState
              variant="no-data"
              title="No transactions yet"
              message="No transactions have been imported. Once a transaction file is processed, its transactions appear here."
            />
          ) : (
            <>
              {/*
                Per-File Summary (R10) — a labelled region per file with Total +
                Imported/Approved/Rejected counts, derived CLIENT-SIDE over the
                loaded set. Each status count drills into the table by setting the
                Story-2 File + Status filters. Visible to BOTH personas.
              */}
              <FileSummaryPanel
                summaries={fileSummaries}
                onDrillDown={handleSummaryDrillDown}
              />

              {/* Filter + search controls (R5) — client-side over the loaded set. */}
              <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {/*
                  Epic 4 Story 2 (AC-1) — filter tab order. The free-text Search
                  box leads the filter grid, immediately followed by the Status
                  filter, so the two controls a keyboard user reaches first sit
                  adjacent in the focus order. (Epic 3 led with Status; the search-
                  first ordering is the conventional a11y arrangement and keeps the
                  primary keyboard path short. All filter fields, labels, and
                  behaviour are otherwise unchanged.)
                */}
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="filter-search"
                    className="text-muted-foreground text-sm font-medium"
                  >
                    Search Reference or Account Number
                  </label>
                  <input
                    id="filter-search"
                    type="search"
                    value={filters.search}
                    onChange={(e) => updateFilters({ search: e.target.value })}
                    placeholder="Search…"
                    className="border-input bg-background h-9 w-full min-w-0 rounded-md border px-2 text-sm"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="filter-status"
                    className="text-muted-foreground text-sm font-medium"
                  >
                    Status
                  </label>
                  <select
                    id="filter-status"
                    value={filters.status}
                    onChange={(e) => updateFilters({ status: e.target.value })}
                    className="border-input bg-background h-9 w-full min-w-0 rounded-md border px-2 text-sm"
                  >
                    <option value={STATUS_ALL}>All statuses</option>
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="filter-file"
                    className="text-muted-foreground text-sm font-medium"
                  >
                    File
                  </label>
                  <select
                    id="filter-file"
                    value={filters.fileLogId}
                    onChange={(e) =>
                      updateFilters({ fileLogId: e.target.value })
                    }
                    className="border-input bg-background h-9 w-full min-w-0 rounded-md border px-2 text-sm"
                  >
                    <option value="">All files</option>
                    {fileOptions.map((file) => (
                      <option key={file.value} value={file.value}>
                        {file.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="filter-from-date"
                    className="text-muted-foreground text-sm font-medium"
                  >
                    From date
                  </label>
                  <input
                    id="filter-from-date"
                    type="text"
                    inputMode="numeric"
                    placeholder="YYYY-MM-DD"
                    pattern="\d{4}-\d{2}-\d{2}"
                    value={filters.fromDate}
                    onChange={(e) =>
                      updateFilters({ fromDate: e.target.value })
                    }
                    className="border-input bg-background h-9 w-full min-w-0 rounded-md border px-2 text-sm"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="filter-to-date"
                    className="text-muted-foreground text-sm font-medium"
                  >
                    To date
                  </label>
                  <input
                    id="filter-to-date"
                    type="text"
                    inputMode="numeric"
                    placeholder="YYYY-MM-DD"
                    pattern="\d{4}-\d{2}-\d{2}"
                    value={filters.toDate}
                    onChange={(e) => updateFilters({ toDate: e.target.value })}
                    className="border-input bg-background h-9 w-full min-w-0 rounded-md border px-2 text-sm"
                  />
                </div>

                <div className="flex gap-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <label
                      htmlFor="filter-min-amount"
                      className="text-muted-foreground text-sm font-medium"
                    >
                      Minimum amount
                    </label>
                    <input
                      id="filter-min-amount"
                      type="number"
                      inputMode="decimal"
                      value={filters.minAmount}
                      onChange={(e) =>
                        updateFilters({ minAmount: e.target.value })
                      }
                      className="border-input bg-background h-9 w-full min-w-0 rounded-md border px-2 text-sm"
                    />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <label
                      htmlFor="filter-max-amount"
                      className="text-muted-foreground text-sm font-medium"
                    >
                      Maximum amount
                    </label>
                    <input
                      id="filter-max-amount"
                      type="number"
                      inputMode="decimal"
                      value={filters.maxAmount}
                      onChange={(e) =>
                        updateFilters({ maxAmount: e.target.value })
                      }
                      className="border-input bg-background h-9 w-full min-w-0 rounded-md border px-2 text-sm"
                    />
                  </div>
                </div>
              </div>

              {/*
                Toolbar (R9): the Approver-only Export control. Rendered ONLY for an
                explicitly-resolved Approver — absent for an Importer / unknown /
                unresolved role, fail-closed (BR9), never disabled-for-role. It is
                disabled when the current filter matches zero rows (§9 step 5).

                Epic 4 Story 2 (AC-2) — the disabled-state reason is exposed to
                assistive tech + keyboard users via `aria-describedby` pointing at
                the no-results EmptyState HEADLINE (`EXPORT_DISABLED_HELP_ID`),
                replacing the Epic-3 hover-only `title` as the SOLE carrier. The
                describedby is set ONLY in the disabled state, and whenever Export
                is disabled the filtered set is empty — so the no-results EmptyState
                (carrying that headline + id) is always rendered to be described by.
                Reusing the single on-screen explanation keeps the page from
                carrying a duplicate copy of the same message.
              */}
              {isApprover && (
                <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleExport}
                    disabled={exportDisabled}
                    aria-describedby={
                      exportDisabled ? EXPORT_DISABLED_HELP_ID : undefined
                    }
                  >
                    <Download aria-hidden="true" className="size-4" />
                    Export CSV
                  </Button>
                </div>
              )}

              {/*
                Active-filter chips (R5) — each removable, with a Clear-all. Hidden
                when the no-results EmptyState is showing: that variant already owns
                the single "Active filters:" summary + "Clear all filters" surface,
                so rendering the chip region too would duplicate both controls.
              */}
              {activeChips.length > 0 && !showNoResults && (
                <div
                  role="group"
                  aria-label="Active filters"
                  className="mb-4 flex flex-wrap items-center gap-2"
                >
                  <span className="text-muted-foreground text-sm font-medium">
                    Active filters:
                  </span>
                  <ul className="flex flex-wrap items-center gap-2">
                    {activeChips.map((chip) => (
                      <li
                        key={chip.key}
                        className="border-border bg-muted text-foreground inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm"
                      >
                        <span>{chip.label}</span>
                        <button
                          type="button"
                          onClick={chip.clear}
                          aria-label={`Remove filter ${chip.label}`}
                          className="text-muted-foreground hover:text-foreground rounded-full"
                        >
                          <X aria-hidden="true" className="size-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={clearAllFilters}
                  >
                    Clear all filters
                  </Button>
                </div>
              )}

              {showNoResults ? (
                <EmptyState
                  variant="no-results"
                  title="No matching transactions"
                  titleId={EXPORT_DISABLED_HELP_ID}
                  message="Nothing matches your current selection. Adjust or clear the filters to see more."
                  activeFilterSummary={activeFilterSummary}
                  onClearFilters={clearAllFilters}
                />
              ) : (
                <div ref={tableSectionRef}>
                  <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
                    <label
                      htmlFor="page-size"
                      className="text-muted-foreground text-sm"
                    >
                      Rows per page
                    </label>
                    <select
                      id="page-size"
                      aria-label="Rows per page"
                      value={pageSize}
                      onChange={(e) =>
                        handlePageSizeChange(Number(e.target.value))
                      }
                      className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                    >
                      {PAGE_SIZE_OPTIONS.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/*
                    Epic 4 Story 3 (NFR3): below 768px render the mobile card list,
                    at/above the multi-column desktop <table>. EXACTLY ONE of the
                    two is in the DOM at a time (driven by the JS `useMediaQuery`
                    hook, not a CSS hide/show), so no wide table forces a horizontal
                    scroll on mobile and the card layout is observable in jsdom.
                    Both read the SAME `pageRows` and are driven by the SAME filter
                    / search / sort / pagination controls (AC-4).
                  */}
                  {isMobile ? (
                    <>
                      {/*
                        The sort affordance for the card layout (the cards have no
                        <thead> to host the per-column sort buttons). Same handler +
                        accessible names ("Sort by <column>") as the table headers.
                      */}
                      <MobileSortControls
                        sortColumn={sortColumn}
                        sortDirection={sortDirection}
                        onSort={handleSort}
                      />
                      <TransactionCardList
                        rows={pageRows}
                        isApprover={isApprover}
                        expandedActionsId={expandedActionsId}
                        onToggleActions={toggleCardActions}
                        onApprove={openApprove}
                        onReject={openReject}
                      />
                    </>
                  ) : (
                    <div className="rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {COLUMNS.map((col) => {
                              const isActive = col.key === sortColumn;
                              const SortIcon = !isActive
                                ? ArrowUpDown
                                : sortDirection === 'asc'
                                  ? ArrowUp
                                  : ArrowDown;
                              return (
                                <TableHead
                                  key={col.key}
                                  aria-sort={
                                    isActive
                                      ? sortDirection === 'asc'
                                        ? 'ascending'
                                        : 'descending'
                                      : 'none'
                                  }
                                >
                                  {/*
                                    Epic 4 Story 2 (AC-3): the sort trigger carries
                                    an accessible name that communicates the SORT
                                    affordance and the column ("Sort by Reference"),
                                    not just the bare column word. The "Sort by "
                                    prefix is a VISUALLY-HIDDEN span (sr-only) that
                                    folds into the button's accessible name via text
                                    content, while the visible text stays the bare
                                    column label. Using sr-only text — not aria-label
                                    — keeps the sort button OUT of getByLabel()-style
                                    label lookups, so "Sort by Status" never collides
                                    with the Status FILTER select. The accessible
                                    name still contains the visible label, satisfying
                                    axe's label-content-name-mismatch rule.
                                  */}
                                  <button
                                    type="button"
                                    onClick={() => handleSort(col.key)}
                                    className="text-foreground hover:text-foreground/80 -ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium"
                                  >
                                    <span className="sr-only">Sort by </span>
                                    {col.label}
                                    <SortIcon
                                      aria-hidden="true"
                                      className="size-3.5 opacity-70"
                                    />
                                  </button>
                                </TableHead>
                              );
                            })}
                            {/* Story 3 actions column — only headed when the Approver
                                can act, so the read-only Importer/Approved/Rejected
                                views keep the original eight-column layout. */}
                            {isApprover && (
                              <TableHead>
                                <span className="sr-only">Review actions</span>
                              </TableHead>
                            )}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pageRows.map((tx) => {
                            const isImported = tx.Status === IMPORTED_STATUS;
                            return (
                              <TableRow key={tx.Id}>
                                <TableCell className="font-medium">
                                  {tx.Reference}
                                </TableCell>
                                <TableCell>
                                  {formatTransactionDate(tx.TransactionDate)}
                                </TableCell>
                                <TableCell>{tx.AccountNumber}</TableCell>
                                <TableCell>
                                  {tx.Description}
                                  {/*
                                    POPIA audit trail (Epic 4 Story 5 — R15 / BR8):
                                    a terminal (Approved / Rejected) row surfaces
                                    who last changed it and when, READ-ONLY (no
                                    editable control), plus the rejection note
                                    sub-line when a note exists. Rendered inline
                                    beneath the description so the trail travels
                                    with the row. Shared with the mobile card.
                                  */}
                                  <AuditTrail tx={tx} />
                                </TableCell>
                                <TableCell className="tabular-nums">
                                  {formatAmount(tx.Amount)}
                                </TableCell>
                                <TableCell>{tx.Currency}</TableCell>
                                {/* §13-D: render the raw TransactionType value (format unresolved). */}
                                <TableCell>{tx.TransactionType}</TableCell>
                                <TableCell>
                                  <StatusBadge status={tx.Status} />
                                </TableCell>
                                {/*
                                  Approver-only review actions, visible only on an
                                  Imported row (BR1 — hidden, not disabled, on
                                  Approved/Rejected). Absent entirely for a
                                  non-Approver (BR9, fail-closed).
                                */}
                                {isApprover && (
                                  <TableCell>
                                    {isImported && (
                                      <div className="flex items-center gap-2">
                                        <Button
                                          type="button"
                                          size="sm"
                                          onClick={() => openApprove(tx)}
                                        >
                                          Approve
                                        </Button>
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="outline"
                                          onClick={() => openReject(tx)}
                                        >
                                          Reject
                                        </Button>
                                      </div>
                                    )}
                                  </TableCell>
                                )}
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  <nav
                    aria-label="Pagination"
                    className="mt-4 flex items-center justify-between gap-4"
                  >
                    <p className="text-muted-foreground text-sm">
                      Page {safePageIndex + 1} of {pageCount}
                    </p>
                    <div className="flex items-center gap-2">
                      {/*
                        Epic 4 Story 2 (AC-1, NFR1) — at a page boundary the
                        Previous/Next control is conveyed as unavailable via
                        `aria-disabled` rather than the native `disabled` attribute,
                        and its click handler no-ops when at the boundary. A natively
                        `disabled` button is REMOVED from the keyboard tab order, so a
                        keyboard user could never focus the pagination boundary
                        control; `aria-disabled` keeps the control FOCUSABLE (it shows
                        the visible focus ring and is announced "dimmed/unavailable"
                        by AT) while still doing nothing when activated. The disabled
                        STATE is unchanged for AT + for the test matchers (Playwright
                        `toBeDisabled()` treats `aria-disabled="true"` as disabled), and
                        the dimmed look is preserved via the opacity utility. The
                        `canPrev`/`canNext` guards in the handlers keep the boundary
                        non-navigable.
                      */}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-disabled={!canPrev}
                        className={!canPrev ? 'opacity-50' : undefined}
                        onClick={() => {
                          if (!canPrev) return;
                          setPageIndex((i) => Math.max(0, i - 1));
                        }}
                      >
                        Previous
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-disabled={!canNext}
                        className={!canNext ? 'opacity-50' : undefined}
                        onClick={() => {
                          if (!canNext) return;
                          setPageIndex((i) => Math.min(pageCount - 1, i + 1));
                        }}
                      >
                        Next
                      </Button>
                    </div>
                  </nav>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/*
        Approve confirmation modal (BR3): names the Reference, the primary confirm
        is destructive-styled, and default focus rests on Cancel so an accidental
        Enter never approves. Mounted only while an Approve action is pending.
      */}
      <Dialog
        open={approveTarget !== null}
        onOpenChange={(open) => {
          if (!open) setApproveTarget(null);
        }}
      >
        <DialogContent>
          {approveTarget && (
            <>
              <DialogHeader>
                <DialogTitle>
                  Approve transaction {approveTarget.Reference}?
                </DialogTitle>
                <DialogDescription>
                  This marks{' '}
                  <span className="text-foreground font-medium">
                    {approveTarget.Reference}
                  </span>{' '}
                  as Approved. This can&apos;t be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                {/* Dismiss — the safe default; autofocused (BR3). */}
                <Button
                  type="button"
                  variant="outline"
                  autoFocus
                  onClick={() => setApproveTarget(null)}
                >
                  Cancel
                </Button>
                {/* Destructive confirm — commits the approval. */}
                <Button
                  type="button"
                  variant="destructive"
                  disabled={submitting}
                  onClick={() => handleConfirmApprove(approveTarget)}
                >
                  {submitting ? 'Approving…' : 'Approve'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/*
        Reject modal (BR2 / BR3) — its own component so a note keystroke re-renders
        only the dialog, not the table. Mounted only while a Reject is pending so
        the note state resets on each open.
      */}
      <Dialog
        open={rejectTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRejectTarget(null);
        }}
      >
        {rejectTarget && (
          <RejectDialog
            tx={rejectTarget}
            submitting={submitting}
            onCancel={() => setRejectTarget(null)}
            onConfirm={(note) => handleConfirmReject(rejectTarget, note)}
          />
        )}
      </Dialog>
    </main>
  );
}

export default function TransactionsPage() {
  return (
    <RequireSession>
      <TransactionsTable />
    </RequireSession>
  );
}
