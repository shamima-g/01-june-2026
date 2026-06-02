'use client';

/**
 * File detail surface (Epic 2, Story 2 — R3, BR4).
 *
 * Replaces the Story 1 navigation placeholder with the production detail view:
 * one FileLog's metadata + the read-only slice of Transactions belonging to it.
 * Renders identically for both personas (Importer, Approver) and carries no
 * action controls of its own — Stories 3-5 hang Importer-only actions on this
 * shared shell.
 *
 * How the data resolves (spec gaps — story summary):
 *   - The spec has NO single-FileLog fetch, so the page resolves the viewed
 *     FileLog from the active file-logs LIST
 *     (`GET /api/transactions/v1/file-logs?IsActive=Yes`, the client unwraps the
 *     singular `{ FileLog: [...] }` envelope) and matches by `Id`. An id absent
 *     from that `?IsActive=Yes` list is the not-found path (AC-4) — a
 *     non-existent OR an inactive file is likewise absent.
 *   - `GET /api/transactions/v1/transactions` takes NO `FileLogId` filter param,
 *     so the page fetches ALL transactions and filters CLIENT-SIDE by
 *     `FileLogId` (`transactionsForFile`).
 *
 * The two reads are INDEPENDENTLY retryable: the file-logs read resolves the
 * FileLog (and its derived File Status badge + work-in-progress banner), while
 * the transactions read populates the slice. A failed transactions fetch (with
 * the FileLog itself healthy) surfaces a user-visible error state with a Retry
 * affordance (AC-5 / NFR5) without blanking the file header.
 *
 * Behaviours:
 *   - BR4 / AC-2: when the derived File Status is `Uploaded` or `Processing`, a
 *     work-in-progress banner (role="status") tells the user the dataset is not
 *     yet final. A `Completed`/`Failed` file shows no banner.
 *   - AC-3: a file with zero transactions shows the shared zero-data EmptyState
 *     (no-data variant — no clear-filters control, no empty grid).
 *   - AC-1: the file's name (heading) + derived File Status badge + the
 *     read-only transaction slice (own FileLogId only).
 *
 * Wrapped in RequireSession (Epic 1, Story 3) so a signed-out user is bounced to
 * `/login`. The route param is a Promise in Next 16; it is resolved in the same
 * mount effect that kicks off the file-logs read (rather than `use(params)`) so
 * the param-resolution never suspends the tree — keeping the surface testable
 * under React Testing Library while honouring the Next 16 async-params contract.
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
import { FileStatus, type FileLog, type Transaction } from '@/types/api';

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

  // File-logs read: resolves the viewed FileLog from the active list.
  const [fileState, setFileState] = useState<LoadState>('loading');
  const [fileLog, setFileLog] = useState<FileLog | null>(null);

  // Transactions read: independently retryable. We keep the full set in state
  // and derive the file's slice with a memo so a retry only re-runs the fetch.
  const [txState, setTxState] = useState<LoadState>('loading');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txNonce, setTxNonce] = useState(0);

  // Resolve the route param, then the FileLog by Id from the active file-logs
  // list. The effect body holds only the async side-effect; state resolves in
  // the promise callbacks (react-hooks/set-state-in-effect). The two reads run
  // concurrently — the transactions read does not wait on the id.
  useEffect(() => {
    let active = true;
    void params
      .then(({ id: raw }) => {
        const resolvedId = Number(raw);
        if (active) setId(resolvedId);
        return getActiveFileLogs().then((logs) => ({ resolvedId, logs }));
      })
      .then(({ resolvedId, logs }) => {
        if (!active) return;
        const match = Array.isArray(logs)
          ? (logs.find((log) => Number(log.Id) === resolvedId) ?? null)
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
  }, [params]);

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

  // User-driven retry of the transactions read only — reset to loading and
  // re-trigger the fetch effect (event handler, so this setState is lint-safe).
  function handleRetryTransactions() {
    setTxState('loading');
    setTxNonce((n) => n + 1);
  }

  const slice = useMemo(
    () => (id === null ? [] : transactionsForFile(transactions, id)),
    [transactions, id],
  );

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
  // (the list is ?IsActive=Yes). A clear, human not-found message (AC-4), not a
  // crash or a generic error page.
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

  const status = deriveFileStatus(fileLog);
  const isWorkInProgress = WORK_IN_PROGRESS_STATUSES.has(status);

  return (
    <main className="container mx-auto px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">{fileLog.CurrentFileName}</h1>
          <div className="flex items-center gap-2">
            <StatusBadge status={status} />
            <span className="text-muted-foreground text-sm">
              {Number(fileLog.RecordCount) || 0} records
            </span>
          </div>
        </div>
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

      {txState === 'ready' && slice.length === 0 && (
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
