'use client';

/**
 * File Logs dashboard (Epic 2, Story 1 — R3, R6, R14, BR12; Epic 4, Story 3 —
 * NFR3).
 *
 * Replaces the Epic 1 placeholder with the live File Logs surface. On mount it
 * fetches the active file logs (`GET /api/transactions/v1/file-logs?IsActive=Yes`,
 * the client unwraps the singular `{ FileLog: [...] }` envelope) and renders a
 * sortable (single-column), paginated (5/10/20/50, default 20) table with the
 * brief's four columns: File Name, Process Date, Record Count, File Status.
 *
 *   - File Status is DERIVED from `LastExecutedActivityName` / `CurrentStatus`
 *     (project-brief §6 / §13.F) and shown via the shared StatusBadge, which
 *     pairs colour with an icon AND text label (R16 / NFR1).
 *   - Each row is click-through to that file's detail surface (Story 2),
 *     `/files/<id>`, via client-side App Router navigation (NFR2 TTI).
 *   - The zero-data empty state uses the shared EmptyState (no-data variant). The
 *     Upload call-to-action appears ONLY for an Importer (BR12) — absent, not
 *     disabled, for an Approver — gated on the role resolved from the swappable
 *     role source.
 *   - A failed fetch surfaces a user-visible error state with a Retry affordance
 *     (NFR5), never a blank/broken page.
 *
 * Pagination controls are ALWAYS rendered; navigation is disabled when the
 * dataset is smaller than the current page size (R14). Sort toggles ascending →
 * descending on repeated header clicks (single-column).
 *
 * Epic 4 Story 3 — RESPONSIVE table-to-card collapse (NFR3): below 768px the
 * multi-column table collapses to a vertical CARD list (one card per file with
 * the File Name as primary identifier + Process Date / Record Count + the File
 * Status badge); at/above 768px the full table renders as before. The collapse is
 * driven by a JS media-query hook (`useMediaQuery`) — the page renders EITHER the
 * <table> OR the card list, never both — so no wide table forces a horizontal
 * scroll on mobile. Both layouts read the SAME sorted/paged set, both keep the
 * row click-through to `/files/<id>`, and the sort + pagination controls drive
 * both (the card layout carries a compact sort-control row in place of the
 * <thead> sort headers).
 *
 * Wrapped in RequireSession (Epic 1, Story 3) so a signed-out user is bounced to
 * `/login`; the authoritative gate remains the HttpOnly session cookie (the
 * backend 401s data reads without it).
 */

import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, ArrowUpDown, Upload } from 'lucide-react';

import { RequireSession } from '@/components/session/RequireSession';
import { StatusBadge } from '@/components/status-badge/StatusBadge';
import { EmptyState } from '@/components/empty-state/EmptyState';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useMediaQuery, MOBILE_QUERY } from '@/hooks/useMediaQuery';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getActiveFileLogs, deriveFileStatus } from '@/lib/api/file-logs';
import { fetchCurrentRole, asKnownRole } from '@/lib/auth/roles';
import type { FileLog } from '@/types/api';

/** Page-size options (project-brief R14); 20 is the default. */
const PAGE_SIZE_OPTIONS = [5, 10, 20, 50] as const;
const DEFAULT_PAGE_SIZE = 20;
/**
 * The page-size value is user-supplied (a <select> change). Rather than trust
 * the incoming number, we validate it against the PAGE_SIZE_OPTIONS allow-list
 * with a Zod enum and fall back to the default when it is not a member (R14).
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
type SortColumn = 'fileName' | 'processDate' | 'recordCount' | 'fileStatus';
type SortDirection = 'asc' | 'desc';

interface ColumnDef {
  key: SortColumn;
  label: string;
  /** Comparable value for sorting (numeric for record count + date). */
  sortValue: (log: FileLog) => string | number;
}

const COLUMNS: ColumnDef[] = [
  {
    key: 'fileName',
    label: 'File Name',
    sortValue: (log) => log.CurrentFileName.toLowerCase(),
  },
  {
    key: 'processDate',
    label: 'Process Date',
    sortValue: (log) => Date.parse(log.ProcessDate) || 0,
  },
  {
    key: 'recordCount',
    label: 'Record Count',
    // RecordCount is a STRING per the spec (§13) — coerce for a numeric sort.
    sortValue: (log) => Number(log.RecordCount) || 0,
  },
  {
    key: 'fileStatus',
    label: 'File Status',
    sortValue: (log) => deriveFileStatus(log),
  },
];

/** Formats the ISO process date into a stable, locale-independent display. */
function formatProcessDate(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * The shared sort affordance for the card layout (Epic 4 Story 3 — NFR3). The
 * card list has no <thead> to host the per-column sort buttons, so this compact
 * control row carries the same per-column sort buttons above the cards — keeping
 * sorting usable on mobile. Each button folds a visually-hidden "Sort by " prefix
 * into its accessible name ("Sort by <column>"), matching the table headers.
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
      aria-label="Sort file logs"
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
 * The mobile card layout for the File Logs dashboard (Epic 4 Story 3 — NFR3).
 *
 * Rendered INSTEAD of the desktop <table> below 768px — never alongside it — so
 * no wide table forces a horizontal scroll on mobile. The list is a labelled
 * `role="list"` named "File logs" (the seam the Playwright spec binds to), with
 * one card per file carrying the File Name (primary identifier) + Process Date /
 * Record Count + the derived File Status badge. The whole card is a click-through
 * to `/files/<id>` (an anchor wrapping the card content), preserving the table
 * row's navigation.
 */
function FileLogCardList({ logs }: { logs: FileLog[] }) {
  return (
    <ul role="list" aria-label="File logs" className="flex flex-col gap-3">
      {logs.map((log) => {
        const status = deriveFileStatus(log);
        return (
          <li key={log.Id} role="listitem">
            <Link
              href={`/files/${log.Id}`}
              className="focus-visible:ring-ring block rounded-xl focus-visible:ring-2 focus-visible:outline-none"
            >
              <Card className="gap-3 py-4 transition-colors hover:bg-muted/40">
                <CardContent className="flex flex-col gap-3 px-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-foreground min-w-0 truncate font-medium">
                      {log.CurrentFileName}
                    </span>
                    <StatusBadge status={status} />
                  </div>
                  <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>{formatProcessDate(log.ProcessDate)}</span>
                    <span className="tabular-nums">
                      {Number(log.RecordCount) || 0} records
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function FileLogsDashboard() {
  const router = useRouter();

  // Epic 4 Story 3 (NFR3): below 768px render the card layout, at/above the
  // desktop <table>. SSR-safe (false on the server / first paint → desktop), so
  // there's no hydration mismatch; a mobile viewport flips to cards on mount.
  const isMobile = useMediaQuery(MOBILE_QUERY);

  const [state, setState] = useState<LoadState>('loading');
  const [fileLogs, setFileLogs] = useState<FileLog[]>([]);
  const [role, setRole] = useState<string | null>(null);
  // Bumping this counter re-runs the fetch effect — the retry affordance drives
  // it (an event handler), so the loading transition lives in the effect rather
  // than as a synchronous setState in the effect body.
  const [fetchNonce, setFetchNonce] = useState(0);

  const [sortColumn, setSortColumn] = useState<SortColumn>('processDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [pageIndex, setPageIndex] = useState(0);

  // Mount + retry fetch. The effect body holds only the async side-effect; state
  // resolves in the promise callbacks (.then/.catch), never synchronously in the
  // effect body — mirroring the role-resolution effect below and the effect-only
  // pattern in RequireSession (react-hooks/set-state-in-effect).
  useEffect(() => {
    let active = true;
    getActiveFileLogs()
      .then((logs) => {
        if (!active) return;
        setFileLogs(Array.isArray(logs) ? logs : []);
        setState('ready');
      })
      .catch(() => {
        if (active) setState('error');
      });
    return () => {
      active = false;
    };
  }, [fetchNonce]);

  // User-driven retry: reset to loading and re-trigger the fetch effect. This is
  // an event handler, so the loading setState here is correct and lint-safe.
  function handleRetry() {
    setState('loading');
    setFetchNonce((n) => n + 1);
  }

  // Resolve the role only once we know the dashboard is empty — the Upload CTA
  // is the only role-gated affordance on this surface (BR12), so we avoid an
  // extra role round-trip on the populated path. A failed resolve leaves `role`
  // null, which HIDES the CTA (fail-closed for a denied action).
  useEffect(() => {
    if (state !== 'ready' || fileLogs.length > 0) return;
    let active = true;
    void fetchCurrentRole().then((resolved) => {
      if (active) setRole(resolved);
    });
    return () => {
      active = false;
    };
  }, [state, fileLogs.length]);

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sortColumn);
    if (!col) return fileLogs;
    const dir = sortDirection === 'asc' ? 1 : -1;
    return [...fileLogs].sort((a, b) => {
      const av = col.sortValue(a);
      const bv = col.sortValue(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [fileLogs, sortColumn, sortDirection]);

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
    // an out-of-list value parses back to the default (R14).
    const validatedSize = pageSizeSchema.parse(next);
    setPageSize(validatedSize);
    setPageIndex(0);
  }

  return (
    <main className="container mx-auto px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">File Logs</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Active transaction-file ingestion logs.
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
            aria-label="Loading file logs"
            aria-busy="true"
            className="border-muted-foreground/30 border-t-primary size-6 animate-spin rounded-full border-2"
          />
          <span className="sr-only">Loading file logs…</span>
        </div>
      )}

      {state === 'error' && (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/10 flex flex-col items-center gap-3 rounded-lg border px-6 py-12 text-center"
        >
          <p className="text-destructive text-sm font-medium">
            We couldn&apos;t load the file logs. Please check your connection
            and try again.
          </p>
          <Button type="button" variant="outline" onClick={handleRetry}>
            Try again
          </Button>
        </div>
      )}

      {state === 'ready' && fileLogs.length === 0 && (
        <EmptyState
          variant="no-data"
          title="No file logs yet"
          message="No transaction files have been imported. Once a file is uploaded, its ingestion log appears here."
          action={
            asKnownRole(role) === 'Importer' ? (
              <Button asChild>
                <Link href="/files/upload">
                  <Upload aria-hidden="true" />
                  Upload a file
                </Link>
              </Button>
            ) : undefined
          }
        />
      )}

      {state === 'ready' && fileLogs.length > 0 && (
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

          {/*
            Epic 4 Story 3 (NFR3): below 768px render the mobile card list,
            at/above the multi-column desktop <table>. EXACTLY ONE of the two is in
            the DOM at a time (driven by the JS `useMediaQuery` hook, not a CSS
            hide/show), so no wide table forces a horizontal scroll on mobile. Both
            read the SAME `pageRows`, both click through to `/files/<id>`, and the
            sort + pagination controls drive both.
          */}
          {isMobile ? (
            <>
              <MobileSortControls
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
              <FileLogCardList logs={pageRows} />
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
                  {pageRows.map((log) => {
                    const status = deriveFileStatus(log);
                    return (
                      <TableRow
                        key={log.Id}
                        className="cursor-pointer"
                        onClick={() => {
                          router.push(`/files/${log.Id}`);
                        }}
                      >
                        <TableCell className="font-medium">
                          <Link
                            href={`/files/${log.Id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="hover:underline"
                          >
                            {log.CurrentFileName}
                          </Link>
                        </TableCell>
                        <TableCell>
                          {formatProcessDate(log.ProcessDate)}
                        </TableCell>
                        <TableCell>{Number(log.RecordCount) || 0}</TableCell>
                        <TableCell>
                          <StatusBadge status={status} />
                        </TableCell>
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
    </main>
  );
}

export default function FilesPage() {
  return (
    <RequireSession>
      <FileLogsDashboard />
    </RequireSession>
  );
}
