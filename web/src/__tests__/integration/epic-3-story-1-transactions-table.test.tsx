/**
 * Story Metadata:
 * - Epic 3, Story 1: Transactions table — sortable, paginated, read-only surface
 * - Route: /transactions
 * - Target File: web/src/app/transactions/page.tsx (modify_existing)
 * - Page Action: modify_existing (REPLACES the Epic-1 under-construction
 *   placeholder at this path; keeps the RequireSession wrapper)
 *
 * Requirements: R4 (Transactions listed in a sortable, paginated table —
 * pagination 5 / 10 / 20 / 50, default 20, single-column sort; columns
 * Reference, Transaction Date, Account Number, Description, Amount, Currency,
 * Transaction Type, Status), BR9 / BR10 (fail-closed Approver / Importer RBAC —
 * read-only baseline: NO action controls for any role yet).
 *
 * Failing-first (TDD red) tests for the VITEST-tagged acceptance criteria — the
 * behaviour lives in the React render and is jsdom-observable (testing-policy
 * §"Test at the layer where the behaviour lives"):
 *   - AC-4: a zero-data fetch shows the no-data EmptyState ("No transactions
 *           yet"); a failed fetch surfaces an assertive (role="alert") error
 *           state with a retry affordance — never a blank/broken page.
 *   - AC-5: the read-only baseline renders NO Approve / Reject / Export action
 *           controls for ANY role — proven by resolving an Approver (the persona
 *           that LATER gains those actions) and asserting they are absent NOW.
 *
 * AC-1 (columns + Status badge on load), AC-2 (header click sorts asc then desc)
 * and AC-3 (page-size 5/10/20/50 default 20, always-rendered controls) are
 * PLAYWRIGHT-tagged and covered by the sibling spec — they are not re-driven here.
 *
 * Mocking (testing-policy §Mocking strategy): only the HTTP client
 * (@/lib/api/client) and the Next.js navigation boundary are mocked. The page,
 * the shared EmptyState, the sort/pagination logic, and the fail-closed RBAC are
 * the REAL code under test. The page is wrapped in the existing RequireSession
 * guard, which reads the client-side session marker via useSyncExternalStore — so
 * each test seeds the marker through the real session-client helper to render the
 * protected surface (rather than mocking the guard, which would skip a real
 * boundary).
 *
 * Shape source: documentation/transactions-api.yaml (TransactionRead /
 * TransactionReadList) + project-brief §6 / §13. No api-shape-report.md exists for
 * this build. The Transaction collection arrives under the SINGULAR `Transactions`
 * envelope key, which the API client unwraps to a bare array before the page sees
 * it — so the mocked get() resolves the UNWRAPPED MockTransaction[].
 *
 * The page resolves the current role via fetchCurrentRole (web/src/lib/auth/roles.ts),
 * which itself calls the mocked client (best-effort userinfo, then /v1/users). For
 * the RBAC test we drive get() to return an Approver record so the role resolves —
 * the read-only baseline then means even an Approver sees NO action controls yet.
 *
 * The axe matcher is registered globally by web/vitest.setup.ts.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Production import — WILL FAIL until the live Transactions table replaces the
// Epic-1 placeholder at /transactions (TDD red).
import TransactionsPage from '@/app/transactions/page';
import { get } from '@/lib/api/client';
import { markSessionStart, clearSession } from '@/lib/session/session-client';
import {
  createMockTransactionList,
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
 * Renders the Transactions page with an authenticated client-side session so the
 * RequireSession guard yields its protected content, and waits for the initial
 * fetch to settle (loading indicator gone).
 */
async function renderTransactionsPage() {
  markSessionStart();
  const utils = render(<TransactionsPage />);
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

describe('Epic 3, Story 1 — Transactions table: empty + error states (AC-4)', () => {
  // AC-4 (zero-data): with no transactions the page shows the no-data EmptyState
  // — the "No transactions yet" framing — NOT a bare empty table. We assert the
  // distinct no-data copy AND that no data table is rendered, so the test fails
  // on the under-construction placeholder (which shows neither) and on a future
  // regression that drops the empty state.
  it('shows the "No transactions yet" zero-data empty state when there are no transactions', async () => {
    mockGet.mockResolvedValue([] as MockTransaction[]);
    await renderTransactionsPage();

    expect(await screen.findByText(/no transactions yet/i)).toBeInTheDocument();
    // No data grid when empty (the empty state replaces the table).
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  // AC-4 (read failure): a failed transactions fetch surfaces an ASSERTIVE error
  // (role="alert") with a retry affordance — never a blank/broken page. Mirrors
  // the Epic-2 File Logs dashboard error pattern.
  it('surfaces an assertive error with a retry affordance when the fetch fails', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    markSessionStart();
    render(<TransactionsPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /(retry|try again)/i }),
    ).toBeInTheDocument();
  });

  // AC-4 (retry is wired): clicking Retry re-attempts the fetch and, on success,
  // replaces the error state with the populated table — proving the retry
  // affordance is functional, not decorative.
  it('re-fetches and renders the table when the user clicks retry', async () => {
    const user = userEvent.setup();
    const recovered = createMockTransactionList();
    mockGet
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(recovered);

    markSessionStart();
    render(<TransactionsPage />);

    const retryButton = await screen.findByRole('button', {
      name: /(retry|try again)/i,
    });
    await user.click(retryButton);

    await waitFor(() => {
      expect(screen.getByText('TXN-ALPHA')).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // AC-4 (accessibility baseline): the empty state has no axe violations. We
  // first assert the no-data copy actually rendered so the axe check is not a
  // vacuous pass on a placeholder (anti-pattern §4).
  it('has no accessibility violations in the zero-data empty state', async () => {
    mockGet.mockResolvedValue([] as MockTransaction[]);
    const { container } = await renderTransactionsPage();

    expect(await screen.findByText(/no transactions yet/i)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Epic 3, Story 1 — Transactions table: read-only RBAC baseline (AC-5)', () => {
  // AC-5: the read-only baseline renders NO Approve / Reject / Export action
  // controls for ANY role. We resolve an APPROVER — the persona that LATER gains
  // Approve/Reject/Export (BR1, BR6) — and assert those controls are absent NOW,
  // a contrast assertion that breaks the moment a row-action leaks in early. The
  // populated table is asserted present first so this is not a vacuous pass.
  it('renders no Approve / Reject / Export action controls for an Approver', async () => {
    // First call (transactions list) → populated; subsequent role-source calls
    // → the Approver record so fetchCurrentRole resolves "Approver".
    mockGet.mockImplementation((path: string) => {
      if (path.includes('/v1/transactions')) {
        return Promise.resolve(createMockTransactionList());
      }
      if (path.includes('/userinfo')) {
        return Promise.resolve(approverUserRecord);
      }
      if (path.includes('/v1/users')) {
        return Promise.resolve([approverUserRecord]);
      }
      return Promise.resolve([]);
    });

    await renderTransactionsPage();

    // The populated table must be present — guards against a vacuous pass on the
    // placeholder, where the controls would also be "absent".
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByText('TXN-ALPHA')).toBeInTheDocument();

    // No action controls of any kind on the read-only baseline.
    expect(
      screen.queryByRole('button', { name: /approve/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /reject/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /export/i }),
    ).not.toBeInTheDocument();
    // Export sometimes ships as a link rather than a button — assert both shapes.
    expect(
      screen.queryByRole('link', { name: /export/i }),
    ).not.toBeInTheDocument();
  });

  // AC-5 (per-row contrast): scoped to a single Imported transaction row — the
  // exact status that LATER exposes Approve/Reject (BR1) — there are still no
  // per-row action controls. Proves the read-only baseline holds at row level,
  // not just globally.
  it('renders no per-row action controls on an Imported transaction row', async () => {
    mockGet.mockImplementation((path: string) => {
      if (path.includes('/v1/transactions')) {
        return Promise.resolve(createMockTransactionList());
      }
      if (path.includes('/userinfo')) {
        return Promise.resolve(approverUserRecord);
      }
      if (path.includes('/v1/users')) {
        return Promise.resolve([approverUserRecord]);
      }
      return Promise.resolve([]);
    });

    await renderTransactionsPage();

    // TXN-CHARLIE is the Imported row in createMockTransactionList().
    const importedRow = (await screen.findByText('TXN-CHARLIE')).closest('tr')!;
    expect(importedRow).not.toBeNull();
    expect(
      within(importedRow).queryByRole('button', { name: /approve/i }),
    ).not.toBeInTheDocument();
    expect(
      within(importedRow).queryByRole('button', { name: /reject/i }),
    ).not.toBeInTheDocument();
  });
});
