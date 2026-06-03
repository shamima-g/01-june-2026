'use client';

/**
 * File detail surface (Epic 2, Stories 2 + 4 — R3, BR4, R11, R13, BR5).
 *
 * Story 2 established the shared detail shell: one FileLog's metadata + the
 * read-only slice of Transactions belonging to it, with a work-in-progress
 * banner for an Uploaded/Processing file, a not-found path, and an independently
 * retryable transactions read.
 *
 * Story 4 EXTENDS that shell for a `Failed` file (BR5) without disturbing any of
 * the above:
 *   - When the derived File Status is `Failed`, the page fetches the validation-
 *     error column metadata (`GET /v1/files/validation-errors/columns?FileLogId=`,
 *     a `{ ColumnList: [...] }` envelope the client unwraps to a bare array) and
 *     the invalid rows (`GET /v1/files/validation-errors?FileLogId=`, a nested
 *     `{ ValidationErrors: { JsonArray: "<stringified[]>" } }` the page parses —
 *     §13-C) and renders an invalid-row grid headed by each VISIBLE column's
 *     `HeaderText` (R13). A `Visible:false` column does not render.
 *   - An Importer (and only an explicitly-resolved Importer — fail-closed) sees a
 *     "Retry Validation" control on a Failed file (BR5). Clicking it POSTs
 *     `/v1/files/retry-validation?LogId=`, then re-resolves the FileLog (so the
 *     File Status flips to a non-failed state on success — R11) and refreshes the
 *     invalid-row list (so a continued failure shows the updated rows — R11). The
 *     Approver sees the same error list read-only with no Retry control.
 *   - A failed validation-errors LOAD surfaces a user-visible error state
 *     (role="alert") with a wired retry affordance (AC-4 / NFR5) rather than a
 *     blank/broken grid.
 *
 * How the data resolves (spec gaps — story summary):
 *   - The spec has NO single-FileLog fetch, so the page resolves the viewed
 *     FileLog from the active file-logs LIST
 *     (`GET /api/transactions/v1/file-logs?IsActive=Yes`, the client unwraps the
 *     singular `{ FileLog: [...] }` envelope) and matches by `Id`. An id absent
 *     from that `?IsActive=Yes` list is the not-found path — a non-existent OR an
 *     inactive file is likewise absent.
 *   - `GET /api/transactions/v1/transactions` takes NO `FileLogId` filter param,
 *     so the page fetches ALL transactions and filters CLIENT-SIDE by
 *     `FileLogId` (`transactionsForFile`).
 *
 * Wrapped in RequireSession (Epic 1, Story 3) so a signed-out user is bounced to
 * `/login`. The route param is a Promise in Next 16; it is resolved in a mount
 * effect (rather than `use(params)`) so param-resolution never suspends the tree
 * — keeping the surface testable under React Testing Library while honouring the
 * Next 16 async-params contract.
 */

import { useEffect, useMemo, useState } from 'react';

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
import { getActiveFileLogs, deriveFileStatus } from '@/lib/api/file-logs';
import { getTransactions, transactionsForFile } from '@/lib/api/transactions';
import {
  getValidationColumns,
  getValidationErrors,
  retryValidation,
} from '@/lib/api/validation-errors';
import { fetchCurrentRole, asKnownRole } from '@/lib/auth/roles';
import {
  FileStatus,
  type FileLog,
  type InvalidRow,
  type Transaction,
  type ValidationColumn,
} from '@/types/api';

/** Statuses for which the dataset is still settling (BR4 / AC-2). */
const WORK_IN_PROGRESS_STATUSES = new Set<string>([
  FileStatus.Uploaded,
  FileStatus.Processing,
]);

type LoadState = 'loading' | 'ready' | 'error';

/** Formats the transaction Amount as ZAR-friendly fixed-2dp, locale-independent. */
function formatAmount(amount: number, currency: string): string {
  const value = Number.isFinite(amount) ? amount : 0;
  return `${currency} ${value.toFixed(2)}`;
}

/** Formats a timestamp into a stable YYYY-MM-DD display; falls back to raw. */
function formatDate(raw: string): string {
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return raw;
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function FileDetail({ params }: { params: Promise<{ id: string }> }) {
  // Resolved route id (Next 16 async param), or null until the param promise
  // settles. Resolving the param here — alongside the data reads in a single
  // loading window — avoids a separate param-only render gate.
  const [id, setId] = useState<number | null>(null);

  // File-logs read: resolves the viewed FileLog from the active list. Re-runs
  // when `fileNonce` is bumped (a successful retry re-reads it to pick up the
  // flipped File Status — R11).
  const [fileState, setFileState] = useState<LoadState>('loading');
  const [fileLog, setFileLog] = useState<FileLog | null>(null);
  const [fileNonce, setFileNonce] = useState(0);

  // Transactions read: independently retryable. We keep the full set in state
  // and derive the file's slice with a memo so a retry only re-runs the fetch.
  const [txState, setTxState] = useState<LoadState>('loading');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txNonce, setTxNonce] = useState(0);

  // Role gating (BR5): the Retry Validation control is Importer-only and
  // fail-closed — only an explicitly-resolved Importer sees it; a null/Approver
  // role hides it. Resolved once on mount via the swappable role source.
  const [role, setRole] = useState<string | null>(null);

  // Validation-errors view (only loaded for a Failed file): the column metadata
  // + the parsed invalid rows. `veNonce` re-runs the read (the load-error retry
  // affordance AND a retry-validation re-run both bump it — R11 / AC-4).
  const [veState, setVeState] = useState<LoadState>('loading');
  const [columns, setColumns] = useState<ValidationColumn[]>([]);
  const [invalidRows, setInvalidRows] = useState<InvalidRow[]>([]);
  const [veNonce, setVeNonce] = useState(0);

  // True while the retry-validation POST is in flight (disables the control).
  const [retrying, setRetrying] = useState(false);

  // Resolve the route param once on mount (independent of the data reads so a
  // file-logs re-read on retry never re-resolves the param).
  useEffect(() => {
    let active = true;
    void params.then(({ id: raw }) => {
      if (active) setId(Number(raw));
    });
    return () => {
      active = false;
    };
  }, [params]);

  // File-logs read — resolves the viewed FileLog by Id from the active list.
  // Re-runs on `fileNonce` (post-retry re-read) once the id is known.
  useEffect(() => {
    if (id === null) return;
    let active = true;
    getActiveFileLogs()
      .then((logs) => {
        if (!active) return;
        const match = Array.isArray(logs)
          ? (logs.find((log) => Number(log.Id) === id) ?? null)
          : null;
        setFileLog(match);
        setFileState('ready');
      })
      .catch(() => {
        if (active) setFileState('error');
      });
    return () => {
      active = false;
    };
  }, [id, fileNonce]);

  // Fetch all transactions (re-runs on retry via txNonce). The slice is derived
  // below from the full set + the resolved FileLogId.
  useEffect(() => {
    let active = true;
    getTransactions()
      .then((all) => {
        if (!active) return;
        setTransactions(Array.isArray(all) ? all : []);
        setTxState('ready');
      })
      .catch(() => {
        if (active) setTxState('error');
      });
    return () => {
      active = false;
    };
  }, [txNonce]);

  // Resolve the signed-in role once on mount. A failed resolve leaves `role`
  // null, which HIDES the Retry control (fail-closed for a privileged action).
  useEffect(() => {
    let active = true;
    void fetchCurrentRole().then((resolved) => {
      if (active) setRole(resolved);
    });
    return () => {
      active = false;
    };
  }, []);

  const status = fileLog ? deriveFileStatus(fileLog) : null;
  const isFailed = status === FileStatus.Failed;

  // Validation-errors read — only for a Failed file. Loads the column metadata
  // and the parsed invalid rows together; either rejecting surfaces the load-
  // error state (AC-4). Re-runs on `veNonce` (error retry / retry-validation).
  useEffect(() => {
    if (id === null || !isFailed) return;
    let active = true;
    setVeState('loading');
    Promise.all([getValidationColumns(id), getValidationErrors(id)])
      .then(([cols, rows]) => {
        if (!active) return;
        setColumns(Array.isArray(cols) ? cols : []);
        setInvalidRows(Array.isArray(rows) ? rows : []);
        setVeState('ready');
      })
      .catch(() => {
        if (active) setVeState('error');
      });
    return () => {
      active = false;
    };
  }, [id, isFailed, veNonce]);

  // User-driven retry of the transactions read only.
  function handleRetryTransactions() {
    setTxState('loading');
    setTxNonce((n) => n + 1);
  }

  // User-driven retry of the validation-errors LOAD (the error-state affordance,
  // AC-4) — re-attempts the columns + rows fetch.
  function handleRetryValidationErrors() {
    setVeNonce((n) => n + 1);
  }

  // Importer-only Retry Validation (R11): POST retry-validation, then re-read the
  // FileLog (status may flip to a non-failed state) and refresh the invalid-row
  // list (continued-failure path). An event handler, so the setState calls here
  // are lint-safe.
  async function handleRetryValidation() {
    if (id === null) return;
    setRetrying(true);
    try {
      await retryValidation(id);
    } catch {
      // The mutation failed outright; we still re-read the FileLog + rows below
      // so the surface reflects the backend's current state rather than stalling.
    } finally {
      setRetrying(false);
      // Re-resolve the FileLog (status flip on success) and refresh the rows
      // (continued-failure path). The validation-errors effect re-runs off
      // `veNonce`; if the status flips away from Failed it simply stops rendering.
      setFileNonce((n) => n + 1);
      setVeNonce((n) => n + 1);
    }
  }

  const slice = useMemo(
    () => (id === null ? [] : transactionsForFile(transactions, id)),
    [transactions, id],
  );

  // Only the VISIBLE columns render — a `Visible:false` column contributes
  // neither a heading nor a cell (R13).
  const visibleColumns = useMemo(
    () => columns.filter((col) => col.Visible),
    [columns],
  );

  const isImporter = asKnownRole(role) === 'Importer';

  // Both reads (and the param) in flight on first mount: a single progressbar
  // gates the page so the tests' "wait for progressbar gone" helper settles on
  // the loaded state.
  if (id === null || fileState === 'loading' || txState === 'loading') {
    return (
      <main className="container mx-auto px-4 py-8">
        <div className="text-muted-foreground flex items-center justify-center py-16 text-sm">
          <span
            role="progressbar"
            aria-label="Loading file detail"
            aria-busy="true"
            className="border-muted-foreground/30 border-t-primary size-6 animate-spin rounded-full border-2"
          />
          <span className="sr-only">Loading file detail…</span>
        </div>
      </main>
    );
  }

  // The file-logs read failed outright — distinct from the not-found path
  // (resolved-but-absent). Surface an error with a full-page reload retry.
  if (fileState === 'error') {
    return (
      <main className="container mx-auto px-4 py-8">
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/10 flex flex-col items-center gap-3 rounded-lg border px-6 py-12 text-center"
        >
          <p className="text-destructive text-sm font-medium">
            We couldn&apos;t load this file. Please check your connection and
            try again.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => window.location.reload()}
          >
            Try again
          </Button>
        </div>
      </main>
    );
  }

  // Resolved the active list but the id wasn't in it — non-existent OR inactive
  // (the list is ?IsActive=Yes). A clear, human not-found message, not a crash.
  if (!fileLog) {
    return (
      <main className="container mx-auto px-4 py-8">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
          <h1 className="text-xl font-semibold">File not found</h1>
          <p className="text-muted-foreground max-w-md text-sm">
            We couldn&apos;t find an active file with this id. It may have been
            cancelled or no longer exists.
          </p>
        </div>
      </main>
    );
  }

  const resolvedStatus = status ?? FileStatus.Uploaded;
  const isWorkInProgress = WORK_IN_PROGRESS_STATUSES.has(resolvedStatus);

  return (
    <main className="container mx-auto px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">{fileLog.CurrentFileName}</h1>
          <div className="flex items-center gap-2">
            <StatusBadge status={resolvedStatus} />
            <span className="text-muted-foreground text-sm">
              {Number(fileLog.RecordCount) || 0} records
            </span>
          </div>
        </div>

        {/* Importer-only Retry Validation control on a Failed file (BR5, R11). */}
        {isFailed && isImporter && (
          <Button
            type="button"
            onClick={handleRetryValidation}
            disabled={retrying}
          >
            {retrying ? 'Retrying validation…' : 'Retry Validation'}
          </Button>
        )}
      </header>

      {isWorkInProgress && (
        <div
          role="status"
          aria-live="polite"
          className="border-status-info-border bg-status-info-bg text-status-info-fg mb-6 rounded-lg border px-4 py-3 text-sm"
        >
          This file is still being processed — its transactions are not yet
          final and may change.
        </div>
      )}

      {/* Failed file: the validation-errors view (R13, BR5). */}
      {isFailed && (
        <section aria-label="Validation errors" className="mb-8">
          <h2 className="mb-3 text-lg font-semibold">Validation errors</h2>

          {veState === 'loading' && (
            <div
              role="status"
              aria-live="polite"
              className="text-muted-foreground flex items-center justify-center py-12 text-sm"
            >
              <span
                role="progressbar"
                aria-label="Loading validation errors"
                aria-busy="true"
                className="border-muted-foreground/30 border-t-primary size-6 animate-spin rounded-full border-2"
              />
              <span className="sr-only">Loading validation errors…</span>
            </div>
          )}

          {veState === 'error' && (
            <div
              role="alert"
              className="border-destructive/40 bg-destructive/10 flex flex-col items-center gap-3 rounded-lg border px-6 py-12 text-center"
            >
              <p className="text-destructive text-sm font-medium">
                We couldn&apos;t load the validation errors for this file.
                Please check your connection and try again.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={handleRetryValidationErrors}
              >
                Try again
              </Button>
            </div>
          )}

          {veState === 'ready' && invalidRows.length === 0 && (
            <EmptyState
              variant="no-data"
              title="No validation errors"
              message="This file is marked as failed but reported no invalid rows."
            />
          )}

          {veState === 'ready' && invalidRows.length > 0 && (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {visibleColumns.map((col) => (
                      <TableHead key={col.Name}>{col.HeaderText}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invalidRows.map((row, rowIndex) => (
                    <TableRow key={row.Reference ?? rowIndex}>
                      {visibleColumns.map((col) => (
                        <TableCell key={col.Name}>
                          {row[col.Name] ?? ''}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}

      {txState === 'error' && (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/10 flex flex-col items-center gap-3 rounded-lg border px-6 py-12 text-center"
        >
          <p className="text-destructive text-sm font-medium">
            We couldn&apos;t load the transactions for this file. Please check
            your connection and try again.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={handleRetryTransactions}
          >
            Try again
          </Button>
        </div>
      )}

      {txState === 'ready' && slice.length === 0 && !isFailed && (
        <EmptyState
          variant="no-data"
          title="No transactions yet"
          message="This file has no transactions. Once its records are processed, they will appear here."
        />
      )}

      {txState === 'ready' && slice.length > 0 && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Transaction Date</TableHead>
                <TableHead>Account Number</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slice.map((tx) => (
                <TableRow key={tx.Id}>
                  <TableCell className="font-medium">{tx.Reference}</TableCell>
                  <TableCell>{formatDate(tx.TransactionDate)}</TableCell>
                  <TableCell>{tx.AccountNumber}</TableCell>
                  <TableCell>{tx.Description}</TableCell>
                  <TableCell>{formatAmount(tx.Amount, tx.Currency)}</TableCell>
                  <TableCell>{tx.TransactionType}</TableCell>
                  <TableCell>
                    <StatusBadge status={tx.Status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </main>
  );
}

export default function FileDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <RequireSession>
      <FileDetail params={params} />
    </RequireSession>
  );
}
