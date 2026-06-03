/**
 * Story Metadata:
 * - Epic 3, Story 2: Filter and search the Transactions table
 * - Route: /transactions
 * - Target File: web/src/app/transactions/page.tsx (modify_existing)
 * - Page Action: modify_existing (EXTENDS the Epic-3 Story-1 read-only table at
 *   this path with client-side filtering + free-text search — CLAUDE.md §7:
 *   replace/extend, don't nest a second surface)
 *
 * Requirements: R5 (filter Transactions by Status / File [FileLogId] / Date range
 * / Amount range, plus free-text search on Reference + Account Number; active
 * filters render as chips with a Clear-all), R15 (empty states distinguish
 * zero-data — "No transactions yet" — from zero-results-of-filter: active filter
 * summary + Clear-all, no creation CTA), BR6 (the filtered set is the basis Export
 * reads from — proven structurally here by sort/pagination operating over the
 * filtered set; the Export wiring itself lands in Story 4).
 *
 * Failing-first (TDD red) tests for the VITEST-tagged acceptance criteria — the
 * filter/search/empty-result behaviour lives in the React render and is
 * jsdom-observable (testing-policy §"test at the layer where the behaviour
 * lives"):
 *   - AC-2 (VITEST): filtering by File, Date range, and Amount range each narrows
 *           the table to rows WITHIN the chosen criteria. Each test asserts the
 *           CONTRAST — the in-criteria row REMAINS and the out-of-criteria rows
 *           DISAPPEAR — so it cannot pass vacuously on an unfiltered list.
 *   - AC-5 (VITEST): when the active filter set matches ZERO rows, the no-results
 *           EmptyState shows, DISTINCT from the zero-data "No transactions yet"
 *           state. The no-results state is identified by its USER-OBSERVABLE
 *           surface — the shared EmptyState's "Active filters:" summary and its
 *           "Clear all filters" button (web/src/components/empty-state/EmptyState.tsx,
 *           no-results variant) — and the distinction is proven by asserting the
 *           zero-data "No transactions yet" copy is ABSENT.
 *
 * AC-1 (Status filter narrows the table), AC-3 (search box narrows by Reference
 * or Account Number) and AC-4 (each active filter shows as a removable chip +
 * Clear-all resets all) are PLAYWRIGHT-tagged and covered by the sibling spec —
 * they are not re-driven here.
 *
 * Mocking (testing-policy §Mocking strategy): only the HTTP client
 * (@/lib/api/client) and the Next.js navigation boundary are mocked. The page,
 * the shared EmptyState (no-results variant), and the filter/search logic are the
 * REAL code under test. The page is wrapped in the existing RequireSession guard,
 * which reads the client-side session marker via useSyncExternalStore — so each
 * test seeds the marker through the real session-client helper to render the
 * protected surface (rather than mocking the guard, which would skip a real
 * boundary). An Approver role is resolved through the real fetchCurrentRole (which
 * itself calls the mocked client) so the surface matches the Story-1 wiring.
 *
 * Shape source: documentation/transactions-api.yaml (TransactionRead /
 * TransactionReadList) + project-brief §6 / §13. No api-shape-report.md exists for
 * this build. The Transaction collection arrives under the SINGULAR `Transactions`
 * envelope key, which the API client unwraps to a bare array before the page sees
 * it — so the mocked get() resolves the UNWRAPPED MockTransaction[]. The
 * filterable fixture lives in the shared helper (createMockFilterableTransactions)
 * with each dimension made discriminating; tests pick rows by their distinctive
 * Reference and assert the others vanish.
 *
 * The axe matcher is registered globally by web/vitest.setup.ts.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Production import — WILL FAIL to behave until the filter/search surface is built
// on top of the Story-1 table at /transactions (TDD red).
import TransactionsPage from '@/app/transactions/page';
import { get } from '@/lib/api/client';
import { markSessionStart, clearSession } from '@/lib/session/session-client';
import {
  createMockFilterableTransactions,
  type MockTransaction,
} from '../helpers/epic-2-mock-data';

// HTTP client — mocked per testing-policy (client.ts is never exercised here).
vi.mock('@/lib/api/client', () => ({
  get: vi.fn(),
}));
const mockGet = get as ReturnType<typeof vi.fn>;

// Navigation boundary — RequireSession touches the router on its mount path.
const pushMock = vi.fn();
const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, refresh: vi.fn() }),
  usePathname: () => '/transactions',
  useSearchParams: () => new URLSearchParams(),
}));

/** An Approver user record as the role source (`/v1/users`) emits it. */
const approverUserRecord = {
  Email: 'approver@example.com',
  RolesString: 'Approver',
  Roles: [{ Name: 'Approver' }],
};

/**
 * Drives get() so the transactions list resolves to `rows` while the role-source
 * calls resolve an Approver (matching the Story-1 wiring). Mirrors the Story-1
 * path-based mock so fetchCurrentRole resolves consistently.
 */
function seedTransactions(rows: MockTransaction[]) {
  mockGet.mockImplementation((path: string) => {
    if (path.includes('/v1/transactions')) {
      return Promise.resolve(rows);
    }
    if (path.includes('/userinfo')) {
      return Promise.resolve(approverUserRecord);
    }
    if (path.includes('/v1/users')) {
      return Promise.resolve([approverUserRecord]);
    }
    return Promise.resolve([]);
  });
}

/**
 * Renders the Transactions page with an authenticated client-side session so the
 * RequireSession guard yields its protected content, and waits for the initial
 * fetch to settle (loading indicator gone and the table on screen).
 */
async function renderTransactionsPage() {
  markSessionStart();
  const utils = render(<TransactionsPage />);
  await waitFor(() =>
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument(),
  );
  await screen.findByRole('table');
  return utils;
}

/**
 * Applies a date range that no fixture transaction can fall inside (a 2027
 * window — the fixtures span Jan–Jun 2026), driving the filtered set to ZERO
 * rows so the no-results empty state must appear.
 */
async function applyZeroMatchDateRange(
  user: ReturnType<typeof userEvent.setup>,
) {
  const fromDate = screen.getByLabelText(/from date|date from|start date/i);
  const toDate = screen.getByLabelText(/to date|date to|end date/i);
  await user.type(fromDate, '2027-01-01');
  await user.type(toDate, '2027-12-31');
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  clearSession();
});

describe('Epic 3, Story 2 — Transactions filter narrows the table (AC-2)', () => {
  // AC-2 (File / FileLogId): selecting one file narrows the table to that file's
  // transactions. The fixture spans FileLogId 5001 / 5002 / 5003; filtering to
  // 5002 must KEEP TXN-MAR-MID (FileLogId 5002) and REMOVE TXN-JAN-SMALL (5001)
  // and TXN-JUN-LARGE (5003) — the contrast guards against a no-op filter.
  it('filtering by File narrows to that file’s transactions', async () => {
    const user = userEvent.setup();
    seedTransactions(createMockFilterableTransactions());
    await renderTransactionsPage();

    // All three rows present before filtering.
    expect(screen.getByText('TXN-JAN-SMALL')).toBeInTheDocument();
    expect(screen.getByText('TXN-MAR-MID')).toBeInTheDocument();
    expect(screen.getByText('TXN-JUN-LARGE')).toBeInTheDocument();

    // Pick the File filter and choose the March file (FileLogId 5002).
    const fileFilter = screen.getByRole('combobox', { name: /file/i });
    await user.selectOptions(fileFilter, [
      within(fileFilter).getByRole('option', { name: /march_2026-03\.csv/i }),
    ]);

    await waitFor(() => {
      expect(screen.queryByText('TXN-JAN-SMALL')).not.toBeInTheDocument();
    });
    // In-criteria row remains; out-of-criteria rows are gone.
    expect(screen.getByText('TXN-MAR-MID')).toBeInTheDocument();
    expect(screen.queryByText('TXN-JUN-LARGE')).not.toBeInTheDocument();
  });

  // AC-2 (Date range): a mid-window range (March only) keeps the March row and
  // excludes the January and June rows. The fixture dates (Jan / Mar / Jun) are
  // well apart so the range cleanly includes one and excludes the other two.
  it('filtering by Date range narrows to rows within the range', async () => {
    const user = userEvent.setup();
    seedTransactions(createMockFilterableTransactions());
    await renderTransactionsPage();

    const fromDate = screen.getByLabelText(/from date|date from|start date/i);
    const toDate = screen.getByLabelText(/to date|date to|end date/i);

    // A window that brackets only the March transaction (2026-03-20).
    await user.type(fromDate, '2026-03-01');
    await user.type(toDate, '2026-03-31');

    await waitFor(() => {
      expect(screen.queryByText('TXN-JAN-SMALL')).not.toBeInTheDocument();
    });
    expect(screen.getByText('TXN-MAR-MID')).toBeInTheDocument();
    expect(screen.queryByText('TXN-JUN-LARGE')).not.toBeInTheDocument();
  });

  // AC-2 (Amount range): a mid-band range isolates the 500.00 March row from the
  // 25.00 January row (below) and the 9000.00 June row (above). Amounts are orders
  // of magnitude apart so the band unambiguously selects one row.
  it('filtering by Amount range narrows to rows within the range', async () => {
    const user = userEvent.setup();
    seedTransactions(createMockFilterableTransactions());
    await renderTransactionsPage();

    const minAmount = screen.getByLabelText(/min(imum)? amount|amount from/i);
    const maxAmount = screen.getByLabelText(/max(imum)? amount|amount to/i);

    // 100–1000 brackets only the 500.00 (March) transaction.
    await user.type(minAmount, '100');
    await user.type(maxAmount, '1000');

    await waitFor(() => {
      expect(screen.queryByText('TXN-JAN-SMALL')).not.toBeInTheDocument();
    });
    expect(screen.getByText('TXN-MAR-MID')).toBeInTheDocument();
    expect(screen.queryByText('TXN-JUN-LARGE')).not.toBeInTheDocument();
  });
});

describe('Epic 3, Story 2 — zero-results empty state (AC-5)', () => {
  // AC-5: an active filter set that matches ZERO rows shows the NO-RESULTS empty
  // state, DISTINCT from the zero-data "No transactions yet" state. The
  // no-results state is recognised by its user-observable surface (the shared
  // EmptyState no-results variant renders an "Active filters:" summary and a
  // "Clear all filters" button — neither appears on the no-data variant). We
  // assert:
  //   1. the active-filter summary copy is shown,
  //   2. the Clear-all affordance is offered,
  //   3. the zero-data "No transactions yet" copy is ABSENT (the two states are
  //      distinct — a filter, not absence of data, emptied the table),
  //   4. the data table is replaced by the empty state.
  it('shows the no-results empty state — distinct from zero-data — when filters match nothing', async () => {
    const user = userEvent.setup();
    seedTransactions(createMockFilterableTransactions());
    await renderTransactionsPage();

    // Sanity: rows are present before the filter hides them all.
    expect(screen.getByText('TXN-MAR-MID')).toBeInTheDocument();

    await applyZeroMatchDateRange(user);

    // The active-filter summary copy identifies the no-results variant.
    expect(await screen.findByText(/active filters/i)).toBeInTheDocument();
    // ...with a Clear-all affordance to recover from the empty filter result.
    expect(
      screen.getByRole('button', { name: /clear all/i }),
    ).toBeInTheDocument();
    // ...and it is DISTINCT from the zero-data state.
    expect(screen.queryByText(/no transactions yet/i)).not.toBeInTheDocument();
    // The table is replaced by the empty state.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  // AC-5 (recovery): clicking Clear-all from the no-results empty state restores
  // the full set — proving the affordance is functional, not decorative, and that
  // the no-results state really was filter-driven (the data was there all along).
  it('Clear-all from the no-results empty state restores the full table', async () => {
    const user = userEvent.setup();
    seedTransactions(createMockFilterableTransactions());
    await renderTransactionsPage();

    await applyZeroMatchDateRange(user);

    const clearAll = await screen.findByRole('button', { name: /clear all/i });
    await user.click(clearAll);

    // The full set is back and the no-results summary is gone.
    await waitFor(() => {
      expect(screen.getByText('TXN-JAN-SMALL')).toBeInTheDocument();
    });
    expect(screen.getByText('TXN-MAR-MID')).toBeInTheDocument();
    expect(screen.getByText('TXN-JUN-LARGE')).toBeInTheDocument();
    expect(screen.queryByText(/active filters/i)).not.toBeInTheDocument();
  });

  // AC-5 (accessibility): the no-results empty state has no axe violations. We
  // first assert the no-results summary actually rendered so the axe check is not
  // a vacuous pass (anti-pattern §4).
  it('has no accessibility violations in the no-results empty state', async () => {
    const user = userEvent.setup();
    seedTransactions(createMockFilterableTransactions());
    const { container } = await renderTransactionsPage();

    await applyZeroMatchDateRange(user);

    expect(await screen.findByText(/active filters/i)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
