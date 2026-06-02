/**
 * Story Metadata:
 * - Epic 2, Story 2: File detail with its transactions and processing banners
 * - Route: /files/[id]
 * - Target File: web/src/app/files/[id]/page.tsx (modify_existing)
 * - Page Action: modify_existing
 *
 * Requirements: R3 (drill into a file's transactions), BR4 (when File Status is
 * Uploaded or Processing the detail must indicate work-in-progress and the
 * Transactions table must surface a "dataset not yet final" banner).
 *
 * Failing-first (TDD red) tests for the VITEST-tagged acceptance criteria — each
 * behaviour lives in the React render and is jsdom-observable (testing-policy
 * §"Test at the layer where the behaviour lives"):
 *   - AC-2: when the resolved file's status is Uploaded OR Processing, a banner
 *           states the dataset is not yet final; a Completed file shows NO banner.
 *   - AC-3: a file with no transactions yet shows a zero-data EmptyState, not a
 *           blank table.
 *   - AC-5: a failed transactions fetch shows a user-visible error state with a
 *           retry affordance, and a successful retry replaces it with the slice.
 *
 * AC-1 (name + status badge + read-only slice across the browser round-trip) and
 * AC-4 (non-existent / inactive id → not-found message) are PLAYWRIGHT-tagged and
 * covered by the sibling spec — they are not re-driven here.
 *
 * How the page resolves its data (story summary + spec gaps):
 *   - The spec has NO single-FileLog fetch, so the page resolves the FileLog from
 *     the active file-logs list (`GET /api/transactions/v1/file-logs?IsActive=Yes`,
 *     singular `{ FileLog: [...] }` envelope) and matches by Id.
 *   - `GET /api/transactions/v1/transactions` takes NO FileLogId filter param, so
 *     the page fetches ALL transactions and filters CLIENT-SIDE by FileLogId.
 * The page therefore makes TWO distinct `get()` calls. We mock by URL path so the
 * file-logs read and the transactions read resolve independently — letting a test
 * keep the FileLog healthy while failing only the transactions fetch (AC-5).
 *
 * Mocking (testing-policy §Mocking strategy): only the HTTP client
 * (@/lib/api/client) is mocked. The page, deriveFileStatus, the shared StatusBadge
 * and EmptyState, and the client-side filter are the REAL code under test. The
 * page is wrapped in the existing RequireSession guard (reads the session marker
 * via useSyncExternalStore), so each test seeds the marker through the real
 * session-client helper rather than mocking the guard.
 *
 * Shape source: documentation/transactions-api.yaml (FileLog/FileLogList,
 * TransactionRead/TransactionReadList) + project-brief §6/§13. No
 * api-shape-report.md exists for this build. The unwrapped arrays the mocked
 * get() resolves model exactly what the page sees after the client strips the
 * single-key envelope.
 *
 * The axe matcher is registered globally by web/vitest.setup.ts, so only `axe`
 * is imported here.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Production import — WILL FAIL meaningfully against the Story 1 PLACEHOLDER,
// which renders neither a banner, an empty state, nor an error+retry (TDD red).
import FileDetailPage from '@/app/files/[id]/page';
import { get } from '@/lib/api/client';
import { markSessionStart, clearSession } from '@/lib/session/session-client';
import {
  createMockFileLog,
  createMockTransactionsForFile,
  type MockFileLog,
  type MockTransaction,
} from '../helpers/epic-2-mock-data';

// HTTP client — mocked per testing-policy (client.ts is never exercised here).
vi.mock('@/lib/api/client', () => ({
  get: vi.fn(),
}));
const mockGet = get as ReturnType<typeof vi.fn>;

// Navigation boundary — RequireSession touches the router; the file-detail page
// may also use params/pathname. We don't assert navigation here (AC-4 is
// Playwright), so stub the surface so the protected content renders.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/files/5001',
  useSearchParams: () => new URLSearchParams(),
}));

/** The file id under view across these tests. */
const FILE_ID = 5001;

/**
 * Routes a mocked `get(endpoint)` call to the right fixture by URL path:
 *   - file-logs path  → resolve the supplied FileLog list (unwrapped array)
 *   - transactions path → resolve the supplied Transactions (unwrapped array)
 * Either side may be a rejection to simulate that single read failing.
 */
function wireGet({
  fileLogs,
  transactions,
}: {
  fileLogs: MockFileLog[] | Error;
  transactions: MockTransaction[] | Error;
}) {
  mockGet.mockImplementation((endpoint: string) => {
    if (endpoint.includes('/file-logs')) {
      return fileLogs instanceof Error
        ? Promise.reject(fileLogs)
        : Promise.resolve(fileLogs);
    }
    if (endpoint.includes('/transactions')) {
      return transactions instanceof Error
        ? Promise.reject(transactions)
        : Promise.resolve(transactions);
    }
    return Promise.reject(new Error(`Unexpected endpoint: ${endpoint}`));
  });
}

/**
 * Renders the file-detail page for `id` with an authenticated client-side
 * session so RequireSession yields its protected content, then waits for the
 * initial reads to settle (loading indicator gone).
 *
 * React 19's `use(params)` accepts a thenable, so we pass a resolved promise of
 * the route params exactly as the App Router would.
 */
async function renderFileDetail(id: number = FILE_ID) {
  markSessionStart();
  const utils = render(
    <FileDetailPage params={Promise.resolve({ id: String(id) })} />,
  );
  await waitFor(() =>
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument(),
  );
  return utils;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  clearSession();
});

describe('Epic 2, Story 2 — File detail: work-in-progress banner (AC-2, BR4)', () => {
  // AC-2 / BR4: when the resolved file's derived status is Processing, the detail
  // surfaces a banner telling the user the dataset is not yet final. We assert the
  // status role AND the "not yet final" framing, so the banner is the thing under
  // test rather than any incidental text.
  it('shows a "dataset not yet final" banner when the file status is Processing', async () => {
    wireGet({
      fileLogs: [
        createMockFileLog({
          Id: FILE_ID,
          LastExecutedActivityName: 'Processing',
          CurrentStatus: 'Processing',
        }),
      ],
      transactions: createMockTransactionsForFile(FILE_ID),
    });

    await renderFileDetail();

    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent(/not (yet )?final/i);
  });

  // AC-2 / BR4: the SAME banner appears for the Uploaded status — proving the
  // banner is gated on the work-in-progress lifecycle states (Uploaded OR
  // Processing), not hard-coded to one value.
  it('shows the same not-yet-final banner when the file status is Uploaded', async () => {
    wireGet({
      fileLogs: [
        createMockFileLog({
          Id: FILE_ID,
          LastExecutedActivityName: 'Uploaded',
          CurrentStatus: 'Uploaded',
        }),
      ],
      transactions: createMockTransactionsForFile(FILE_ID),
    });

    await renderFileDetail();

    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent(/not (yet )?final/i);
  });

  // AC-2 / BR4 (negative): a Completed file is final, so the banner must be
  // ABSENT. Pins the boundary so the banner can't be a permanent fixture that
  // happens to satisfy the positive cases (anti-pattern §4 — assert the contrast).
  it('does NOT show the not-yet-final banner when the file status is Completed', async () => {
    wireGet({
      fileLogs: [
        createMockFileLog({
          Id: FILE_ID,
          LastExecutedActivityName: 'Completed',
          CurrentStatus: 'Completed',
        }),
      ],
      transactions: createMockTransactionsForFile(FILE_ID),
    });

    await renderFileDetail();

    // The slice rendered (so the page settled into its loaded state) ...
    expect(await screen.findByText('TXN-001')).toBeInTheDocument();
    // ... and no work-in-progress banner is present.
    expect(screen.queryByText(/not (yet )?final/i)).not.toBeInTheDocument();
  });
});

describe('Epic 2, Story 2 — File detail: zero-data empty state (AC-3)', () => {
  // AC-3: a file that exists but has no transactions yet shows the zero-data
  // EmptyState, NOT a blank table. The shared EmptyState renders an <h3> headline
  // (role="heading") and, crucially, does NOT render the "Clear all filters"
  // control that the zero-FILTER-results variant does — so asserting heading-
  // present + clear-filters-absent + table-absent pins the genuine zero-DATA state
  // rather than a no-results state or an empty grid.
  it('renders the zero-data empty state when the file has no transactions', async () => {
    wireGet({
      fileLogs: [createMockFileLog({ Id: FILE_ID })],
      transactions: [], // file exists, but its transaction slice is empty
    });

    await renderFileDetail();

    // A headline framing the empty state is present ...
    expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument();
    // ... it is the zero-DATA state, not a zero-filter-results state (which would
    // offer a clear-filters control) ...
    expect(
      screen.queryByRole('button', { name: /clear (all )?filters/i }),
    ).not.toBeInTheDocument();
    // ... and no data table is rendered alongside it.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('Epic 2, Story 2 — File detail: transactions error + retry (AC-5)', () => {
  // AC-5: a failed transactions fetch (the FileLog itself resolving fine) surfaces
  // a user-visible error state with a retry affordance — never a blank/broken
  // page. Assert the alert role and a retry control are both present.
  it('shows an error state with a retry affordance when the transactions fetch fails', async () => {
    wireGet({
      fileLogs: [createMockFileLog({ Id: FILE_ID })],
      transactions: new Error('Network error'),
    });

    markSessionStart();
    render(
      <FileDetailPage params={Promise.resolve({ id: String(FILE_ID) })} />,
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /(retry|try again)/i }),
    ).toBeInTheDocument();
  });

  // AC-5: clicking Retry re-attempts the transactions fetch and, on success,
  // replaces the error state with the populated slice — proving the retry
  // affordance is wired, not decorative.
  it('re-fetches and renders the transaction slice when the user clicks retry', async () => {
    const user = userEvent.setup();
    const recovered = createMockTransactionsForFile(FILE_ID, 1);

    // FileLog always resolves; transactions fail once then succeed.
    let txAttempts = 0;
    mockGet.mockImplementation((endpoint: string) => {
      if (endpoint.includes('/file-logs')) {
        return Promise.resolve([createMockFileLog({ Id: FILE_ID })]);
      }
      if (endpoint.includes('/transactions')) {
        txAttempts += 1;
        return txAttempts === 1
          ? Promise.reject(new Error('Network error'))
          : Promise.resolve(recovered);
      }
      return Promise.reject(new Error(`Unexpected endpoint: ${endpoint}`));
    });

    markSessionStart();
    render(
      <FileDetailPage params={Promise.resolve({ id: String(FILE_ID) })} />,
    );

    const retryButton = await screen.findByRole('button', {
      name: /(retry|try again)/i,
    });
    await user.click(retryButton);

    await waitFor(() => {
      expect(screen.getByText('TXN-001')).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('Epic 2, Story 2 — File detail: accessibility (AC-2 baseline)', () => {
  // The POPULATED detail (name + status badge + read-only slice + work-in-progress
  // banner) has no axe violations. We first assert the slice rendered so this test
  // breaks on the placeholder page rather than vacuously passing on an empty DOM
  // (anti-pattern §4).
  it('has no accessibility violations when populated with a work-in-progress file', async () => {
    wireGet({
      fileLogs: [
        createMockFileLog({
          Id: FILE_ID,
          LastExecutedActivityName: 'Processing',
          CurrentStatus: 'Processing',
        }),
      ],
      transactions: createMockTransactionsForFile(FILE_ID),
    });

    const { container } = await renderFileDetail();

    // The read-only slice and the banner must be present before axe is meaningful.
    expect(await screen.findByText('TXN-001')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });
});
