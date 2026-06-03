'use client';

/**
 * Transactions table (Epic 3, Story 1 — R4, BR9, BR10).
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
 * Pagination controls are ALWAYS rendered; navigation is disabled when there is
 * no page to move to (R4 / R14 pattern, mirrored from the Epic 2 File Logs
 * dashboard). Sort toggles ascending → descending on repeated header clicks
 * (single-column, ascending on first click).
 *
 * Read-only baseline (BR9 / BR10): this story renders NO Approve / Reject /
 * Export action controls for ANY role — both Approver and Importer see the same
 * read-only table. The fail-closed RBAC scaffold (fetchCurrentRole + asKnownRole)
 * is resolved here so later Epic 3 stories can gate the row-actions onto it; an
 * unresolved role leaves the surface read-only (fail-closed).
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

import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

import { RequireSession } from '@/components/session/RequireSession';
import { StatusBadge } from '@/components/status-badge/StatusBadge';
import { EmptyState } from '@/components/empty-state/EmptyState';
import { Button } from '@/components/ui/button';
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
  fetchCurrentRole,
  asKnownRole,
  type KnownRole,
} from '@/lib/auth/roles';
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

function TransactionsTable() {
  const [state, setState] = useState<LoadState>('loading');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  // Resolved for the fail-closed RBAC scaffold later Epic 3 stories build on.
  // Read here so the wiring is in place; this read-only story renders no
  // role-gated controls regardless of the value.
  const [, setRole] = useState<KnownRole | null>(null);
  // Bumping this counter re-runs the fetch effect — the Retry affordance drives
  // it (an event handler), so the loading transition lives in the effect rather
  // than as a synchronous setState in the effect body.
  const [fetchNonce, setFetchNonce] = useState(0);

  const [sortColumn, setSortColumn] = useState<SortColumn>('transactionDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [pageIndex, setPageIndex] = useState(0);

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

  // Resolve the current role for the fail-closed RBAC scaffold. A failed resolve
  // leaves the role null — the read-only baseline already renders no action
  // controls, so this stays fail-closed for the actions later stories add.
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

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sortColumn);
    if (!col) return transactions;
    const dir = sortDirection === 'asc' ? 1 : -1;
    return [...transactions].sort((a, b) => {
      const av = col.sortValue(a);
      const bv = col.sortValue(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [transactions, sortColumn, sortDirection]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const pageRows = sorted.slice(
    safePageIndex * pageSize,
    safePageIndex * pageSize + pageSize,
  );

  const canPrev = safePageIndex > 0;
  const canNext = safePageIndex < pageCount - 1;

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

          {transactions.length === 0 ? (
            <EmptyState
              variant="no-data"
              title="No transactions yet"
              message="No transactions have been imported. Once a transaction file is processed, its transactions appear here."
            />
          ) : (
            <>
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
                  onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                  className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </div>

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
                            <button
                              type="button"
                              onClick={() => handleSort(col.key)}
                              className="text-foreground hover:text-foreground/80 -ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium"
                            >
                              {col.label}
                              <SortIcon
                                aria-hidden="true"
                                className="size-3.5 opacity-70"
                              />
                            </button>
                          </TableHead>
                        );
                      })}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageRows.map((tx) => (
                      <TableRow key={tx.Id}>
                        <TableCell className="font-medium">
                          {tx.Reference}
                        </TableCell>
                        <TableCell>
                          {formatTransactionDate(tx.TransactionDate)}
                        </TableCell>
                        <TableCell>{tx.AccountNumber}</TableCell>
                        <TableCell>{tx.Description}</TableCell>
                        <TableCell className="tabular-nums">
                          {formatAmount(tx.Amount)}
                        </TableCell>
                        <TableCell>{tx.Currency}</TableCell>
                        {/* §13-D: render the raw TransactionType value (format unresolved). */}
                        <TableCell>{tx.TransactionType}</TableCell>
                        <TableCell>
                          <StatusBadge status={tx.Status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <nav
                aria-label="Pagination"
                className="mt-4 flex items-center justify-between gap-4"
              >
                <p className="text-muted-foreground text-sm">
                  Page {safePageIndex + 1} of {pageCount}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canPrev}
                    onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canNext}
                    onClick={() =>
                      setPageIndex((i) => Math.min(pageCount - 1, i + 1))
                    }
                  >
                    Next
                  </Button>
                </div>
              </nav>
            </>
          )}
        </section>
      )}
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
