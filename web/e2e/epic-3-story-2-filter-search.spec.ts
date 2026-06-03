/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: web/src/app/transactions/page.tsx
 * - Page Action: modify_existing
 *
 * E2E spec for Epic 3, Story 2: Filter and search the Transactions table
 * (R5, BR6). This story layers CLIENT-SIDE filtering + free-text search on top of
 * the Story-1 read-only table:
 *   - Status filter (Imported / Approved / Rejected)
 *   - File filter, Date-range filter, Amount-range filter
 *   - Free-text search over Reference and Account Number
 *   - Active filters render as removable chips, with a Clear-all that resets to
 *     the full set; a zero-results-of-filter empty state when nothing matches.
 *
 * Coverage split (one test per PLAYWRIGHT-tagged AC):
 *   - AC-1 (PLAYWRIGHT): selecting a Status filter narrows the table to matching
 *     rows only.
 *   - AC-3 (PLAYWRIGHT): typing in the search box narrows the table to rows whose
 *     Reference OR Account Number matches.
 *   - AC-4 (PLAYWRIGHT): each active filter shows as a removable chip, and
 *     Clear-all resets all filters back to the full set.
 * AC-2 (File / Date / Amount filters) and AC-5 (no-results empty state) are
 * vitest-tagged — covered by the sibling integration test, not here.
 *
 * Both the Approver and the Importer share this read-only filter+search surface
 * (project-brief §6.5: "Search & filter" is ticked for both personas), so these
 * persona-neutral filter behaviours are exercised once, as the Approver.
 *
 * Interaction-mechanism note (Status + File filters are native labelled
 * <select>s): the page reuses the brief's native-select reuse note — Status and
 * File are plain accessible <select>s (the same control kind as Story 1's
 * rows-per-page select), NOT a Radix/Shadcn popover combobox. Native selects are
 * therefore driven with `getByLabel(...).selectOption(...)` (by visible option
 * label), not an open-popover-then-click-option idiom. This spec was reconciled
 * to that mechanism (same fix class as Epic 3 Story 1's spec). The behavioural
 * assertions — what narrows, which chips appear, what Clear-all/remove do — are
 * unchanged.
 *
 * Mocking strategy: project default is `page-route-with-shape-report`
 * (intake-manifest.json -> context.testInfrastructure.playwrightMockingDefault),
 * but no api-shape-report.md exists in this repo yet, so the response bodies are
 * built from documentation/transactions-api.yaml (TransactionReadList /
 * TransactionRead) + the PascalCase runtime shapes established by Epic 2/3:
 *   - GET .../v1/transactions -> the SINGULAR-keyed `{ Transactions: [...] }`
 *     envelope (project-brief §6 / §13.C — the API client unwraps the single-key
 *     envelope before the page sees it). The page takes NO server-side filter
 *     param: filtering + search run CLIENT-SIDE over the full set returned here
 *     (R5). This mirrors Epic 3 Story 1's client-side sort/paginate model.
 *   - Each Transaction carries Reference, TransactionDate, AccountNumber,
 *     Description, Amount, Currency, TransactionType, Status, FileLogId in the
 *     observed PascalCase shape.
 *
 * Internal-consistency contract (the Story-1 defect class this spec avoids):
 *   - The full set is exactly 8 rows — comfortably UNDER the default page size of
 *     20 — so EVERY row sits on page 1 under any sort. No assertion below depends
 *     on pagination, so the default Transaction-Date-DESC sort can never push an
 *     asserted row off-screen.
 *   - Statuses span all three enum values; the Imported rows are a KNOWN subset so
 *     "select Imported" has an unambiguous, assertable narrowing.
 *   - References + Account Numbers are unique, so a search term can target exactly
 *     one row, and the rows expected to vanish are distinct text the test asserts
 *     hidden.
 *
 * Alert/announcer note: the App Router injects a permanently-present EMPTY
 * `<div role="alert">` route announcer. This spec never relies on a bare alert
 * selector — assertions target the filter controls, the search box, the named
 * filter chips, the named Clear-all control, column headers, and cell text.
 *
 * Auth: the /transactions surface is auth-gated (RequireSession + HttpOnly
 * session cookie), so each test drives the real login flow first — reusing the
 * EXACT same-origin /api/* auth-mock + login + cold-route nav-timeout pattern
 * established by Epic 3 Story 1.
 *
 * These tests WILL FAIL until the filter + search UI is implemented on
 * /transactions (Story 1 ships the table with no filter controls) — TDD red.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { approverUser, type TestUser } from './fixtures/credentials';

/**
 * Post-login navigation must tolerate a `next dev` COLD-ROUTE compile. The
 * /transactions page is heavy to compile on its first hit (Table + StatusBadge +
 * filter controls + zod), during which the URL legitimately stays on /login until
 * the destination route finishes compiling — which can exceed the 5s default
 * `toHaveURL` timeout. This is a setup-mechanism wait (it changes only how long we
 * tolerate a cold compile), not a behavioural assertion. Lifted verbatim from
 * Epic 3 Story 1, which added it to fix exactly this flake.
 */
const SIGN_IN_NAV_TIMEOUT_MS = 30_000;

/** A Transaction row in the observed PascalCase shape (transactions-api.yaml TransactionRead). */
interface MockTransaction {
  Id: number;
  FileLogId: number;
  FileName: string;
  Reference: string;
  TransactionDate: string;
  AccountNumber: string;
  Description: string;
  Amount: number;
  TransactionType: string;
  Currency: string;
  Status: string;
  UserNote: string;
  LastChangedUser: string;
  LastChangedDate: string;
}

function transaction(
  overrides: Partial<MockTransaction> & { Id: number },
): MockTransaction {
  return {
    FileLogId: 5001,
    FileName: 'transactions_2026-04-15.csv',
    Reference: `TXN-20260415-${String(overrides.Id).padStart(4, '0')}`,
    TransactionDate: '2026-04-15T15:00:00Z',
    AccountNumber: '1234-5678-9012',
    Description: 'Payment for invoice',
    Amount: 1500.5,
    TransactionType: 'Debit',
    Currency: 'ZAR',
    Status: 'Imported',
    UserNote: '',
    LastChangedUser: 'system',
    LastChangedDate: '2026-04-15T09:30:00Z',
    ...overrides,
  };
}

/**
 * The full set: exactly 8 rows, all on page 1 (default page size 20). Each row
 * has a UNIQUE Reference and Account Number, and Statuses span the whole enum so
 * the Status filter and free-text search both narrow meaningfully and assertably.
 *
 * Status distribution:
 *   - 3 Imported rows (Ids 1, 2, 3) — the subset the Status="Imported" test keeps.
 *   - 3 Approved rows (Ids 4, 5, 6) — must DISAPPEAR when Imported is selected.
 *   - 2 Rejected rows (Ids 7, 8) — must DISAPPEAR when Imported is selected.
 *
 * TransactionDates DESCEND with Id (lower Id => more recent), matching the page's
 * default Transaction-Date-DESC sort, so the rows render in a stable, predictable
 * order. Because all 8 fit on page 1, no test depends on that ordering — it just
 * keeps the fixture honest about the page's real default sort.
 */
const BASE_DATE_MS = Date.parse('2026-04-30T15:00:00Z');
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const STATUS_BY_ID: Record<number, string> = {
  1: 'Imported',
  2: 'Imported',
  3: 'Imported',
  4: 'Approved',
  5: 'Approved',
  6: 'Approved',
  7: 'Rejected',
  8: 'Rejected',
};

const ALL_TRANSACTIONS: MockTransaction[] = Array.from(
  { length: 8 },
  (_, i) => {
    const id = i + 1;
    return transaction({
      Id: id,
      Reference: `TXN-20260415-${String(id).padStart(4, '0')}`,
      AccountNumber: `ACCT-${String(id).padStart(4, '0')}`,
      Amount: id * 100,
      TransactionDate: new Date(BASE_DATE_MS - id * ONE_DAY_MS).toISOString(),
      Status: STATUS_BY_ID[id],
    });
  },
);

const IMPORTED_REF = 'TXN-20260415-0001'; // an Imported row (kept by Status=Imported)
const APPROVED_REF = 'TXN-20260415-0004'; // an Approved row (dropped by Status=Imported)
const REJECTED_REF = 'TXN-20260415-0007'; // a Rejected row (dropped by Status=Imported)

/** Count of rows in each status, derived from the same source of truth as the fixture. */
const IMPORTED_COUNT = Object.values(STATUS_BY_ID).filter(
  (s) => s === 'Imported',
).length; // 3

/**
 * A single, unambiguous search target: this row's Reference and Account Number
 * are both unique, so a free-text search for either narrows to exactly this row.
 */
const SEARCH_TARGET = ALL_TRANSACTIONS[1]; // Id 2: TXN-20260415-0002 / ACCT-0002
const SEARCH_NONMATCH_REF = 'TXN-20260415-0005'; // a row that must vanish on search

/** Build a single User record in the observed PascalCase shape (mirrors Epic 2/3 specs). */
function userRecord(user: TestUser) {
  return {
    Id: user.role === 'Importer' ? 101 : 202,
    Email: user.email,
    FirstName: user.firstName,
    LastName: user.lastName,
    RolesString: user.role,
    Roles: [{ Id: user.role === 'Importer' ? 1 : 2, Name: user.role }],
    Pages: [],
    LastChangedUser: 'system',
    LastChangedDate: '2026-06-01T08:00:00Z',
  };
}

/**
 * Wire the same-origin /api/* mocks the Transactions table needs — identical to
 * Epic 3 Story 1's mock harness:
 *   - auth login / userinfo / users (so login succeeds and the role resolves);
 *   - GET .../transactions -> the SINGULAR-keyed `{ Transactions: [...] }`
 *     envelope (project-brief §6 / §13.C), returning the full set so the page
 *     filters + searches CLIENT-SIDE.
 */
async function mockTransactionsApi(
  page: Page,
  validUser: TestUser,
  transactions: MockTransaction[],
): Promise<void> {
  let signedIn: TestUser | null = null;

  await page.route(/\/api\/.*login.*/i, async (route: Route) => {
    const raw = route.request().postData() ?? '{}';
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const username = (body.Username ?? body.username ?? body.email) as
      | string
      | undefined;
    const password = (body.Password ?? body.password) as string | undefined;

    if (username === validUser.email && password === validUser.password) {
      signedIn = validUser;
      await route.fulfill({
        status: 200,
        headers: {
          'set-cookie':
            'session=mock-session-token; Path=/; HttpOnly; SameSite=Strict',
        },
        contentType: 'application/json',
        body: JSON.stringify(userRecord(validUser)),
      });
      return;
    }
    await route.fulfill({
      status: 401,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        status: 401,
        detail: 'Invalid email or password.',
      }),
    });
  });

  await page.route(/\/api\/.*userinfo.*/i, async (route: Route) => {
    await route.fulfill({
      status: signedIn ? 200 : 401,
      contentType: 'application/json',
      body: signedIn ? JSON.stringify(userRecord(signedIn)) : '{}',
    });
  });

  await page.route(/\/api\/.*\/users(\?.*)?$/i, async (route: Route) => {
    await route.fulfill({
      status: signedIn ? 200 : 401,
      contentType: 'application/json',
      body: signedIn ? JSON.stringify({ Users: [userRecord(signedIn)] }) : '{}',
    });
  });

  // Transactions: SINGULAR-keyed `{ Transactions: [...] }` envelope (§6 / §13.C).
  await page.route(/\/api\/.*\/transactions(\?.*)?$/i, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ Transactions: transactions }),
    });
  });
}

/**
 * Drive the real login form so the session cookie + client marker are
 * established, then wait for the post-login navigation to leave /login using the
 * generous cold-route timeout (see SIGN_IN_NAV_TIMEOUT_MS). Identical to Story 1.
 */
async function signIn(page: Page, user: TestUser): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole('button', { name: /sign in|log in|login/i }).click();
  await expect(page).not.toHaveURL(/\/login/, {
    timeout: SIGN_IN_NAV_TIMEOUT_MS,
  });
}

/**
 * Count of rendered transaction ROWS, identified by their Reference cell. Scoping
 * to the Reference-cell pattern (not a bare `getByRole('row')`, which also counts
 * the header row) gives an exact data-row count the filter assertions can compare
 * against. The pattern matches only TXN references, so it never collides with
 * chrome injected by `next dev`.
 */
function referenceCells(page: Page) {
  return page.getByRole('cell', { name: /^TXN-20260415-\d{4}$/ });
}

/**
 * A single Reference TABLE CELL by exact reference. Used where the bare page-wide
 * `getByText(reference)` would collide with the active-filter SEARCH chip (which
 * also displays the searched reference per AC-4): scoping the post-search "the
 * matching row is shown" assertion to the table cell keeps it unambiguous under
 * Playwright strict mode while asserting exactly the same thing — the row is
 * present in the table.
 */
function referenceCell(page: Page, reference: string) {
  return page.getByRole('cell', { name: reference, exact: true });
}

test.describe('Epic 3, Story 2: Filter and search the Transactions table', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-1 (R5): selecting a Status filter (Imported) narrows the table to the
  // matching rows ONLY — Approved and Rejected rows disappear, and the visible
  // data-row count drops to the known Imported subset.
  test('selecting Status=Imported narrows the table to Imported rows only', async ({
    page,
  }) => {
    await mockTransactionsApi(page, approverUser, ALL_TRANSACTIONS);
    await signIn(page, approverUser);
    await page.goto('/transactions');

    // Baseline: all 8 rows render on page 1 before any filter is applied.
    await expect(referenceCells(page)).toHaveCount(ALL_TRANSACTIONS.length);
    await expect(page.getByText(IMPORTED_REF)).toBeVisible();
    await expect(page.getByText(APPROVED_REF)).toBeVisible();
    await expect(page.getByText(REJECTED_REF)).toBeVisible();

    // Choose Imported from the Status filter. The control is a native labelled
    // <select> (accessible name "Status"; option labels "Imported"/"Approved"/
    // "Rejected" alongside an "All statuses" default) — the same native-select
    // kind Story 1 drives for rows-per-page — so it is set with selectOption(by
    // visible label), NOT a Radix open-popover-then-click-option idiom.
    await page.getByLabel(/status/i).selectOption({ label: 'Imported' });

    // Only the Imported subset remains: the count drops to IMPORTED_COUNT and the
    // Approved / Rejected reference rows are gone, while an Imported one stays.
    await expect(referenceCells(page)).toHaveCount(IMPORTED_COUNT);
    await expect(page.getByText(IMPORTED_REF)).toBeVisible();
    await expect(page.getByText(APPROVED_REF)).toBeHidden();
    await expect(page.getByText(REJECTED_REF)).toBeHidden();
  });

  // AC-3 (R5): typing in the free-text search box narrows the table to rows whose
  // Reference OR Account Number matches — first by Reference, then by Account
  // Number — and clearing the box restores the full set.
  test('search box narrows to rows matching Reference or Account Number', async ({
    page,
  }) => {
    await mockTransactionsApi(page, approverUser, ALL_TRANSACTIONS);
    await signIn(page, approverUser);
    await page.goto('/transactions');

    await expect(referenceCells(page)).toHaveCount(ALL_TRANSACTIONS.length);

    const search = page.getByRole('searchbox', {
      name: /search|reference|account/i,
    });

    // Search by REFERENCE: typing the target's unique reference leaves exactly
    // that one row, and a non-matching reference row is gone. The "matching row
    // is shown" check is scoped to the TABLE CELL (referenceCell) rather than a
    // page-wide getByText, because once a search is active the active-filter
    // SEARCH chip also displays the searched reference (AC-4) — a page-wide text
    // lookup would then match two nodes and trip strict mode. The intent is
    // unchanged: after searching, the matching row is the one shown in the table.
    await search.fill(SEARCH_TARGET.Reference);
    await expect(referenceCells(page)).toHaveCount(1);
    await expect(referenceCell(page, SEARCH_TARGET.Reference)).toBeVisible();
    await expect(page.getByText(SEARCH_NONMATCH_REF)).toBeHidden();

    // Search by ACCOUNT NUMBER: the same row's unique account number also matches,
    // proving search spans both fields (R5: "Reference and Account Number").
    // The reference is asserted via its table cell for the same chip-collision
    // reason (the active SEARCH chip now shows the account number, not the
    // reference, but we keep the table-scoped locator for consistency/robustness).
    await search.fill('');
    await search.fill(SEARCH_TARGET.AccountNumber);
    await expect(referenceCells(page)).toHaveCount(1);
    await expect(referenceCell(page, SEARCH_TARGET.Reference)).toBeVisible();

    // Clearing the search restores the full set.
    await search.fill('');
    await expect(referenceCells(page)).toHaveCount(ALL_TRANSACTIONS.length);
  });

  // AC-4 (R5): each active filter renders as a removable chip, and the named
  // Clear-all control resets every filter back to the full set. Drive two
  // independent filters (Status + search) so "all" is genuinely more than one.
  test('active filters render as removable chips and Clear-all resets to the full set', async ({
    page,
  }) => {
    await mockTransactionsApi(page, approverUser, ALL_TRANSACTIONS);
    await signIn(page, approverUser);
    await page.goto('/transactions');

    await expect(referenceCells(page)).toHaveCount(ALL_TRANSACTIONS.length);

    // Apply a Status filter -> a chip naming the active Status appears. Native
    // labelled <select> driven by selectOption (see AC-1 note), not a popover.
    await page.getByLabel(/status/i).selectOption({ label: 'Imported' });

    // Apply a free-text search too -> a second active filter chip appears.
    const search = page.getByRole('searchbox', {
      name: /search|reference|account/i,
    });
    await search.fill(SEARCH_TARGET.Reference);

    // Both active filters are reflected as chips. The chips live in a named region
    // (group "Active filters") so the lookup is scoped away from table chrome.
    const activeFilters = page.getByRole('group', { name: /active filters/i });
    const statusChip = activeFilters
      .getByRole('listitem')
      .filter({ hasText: /imported/i });
    const searchChip = activeFilters
      .getByRole('listitem')
      .filter({ hasText: SEARCH_TARGET.Reference });
    await expect(statusChip).toBeVisible();
    await expect(searchChip).toBeVisible();

    // Each chip is individually REMOVABLE — its remove control names the filter
    // it clears. Removing the search chip restores the search slice (Status still
    // applied), proving chip removal is per-filter, not all-or-nothing.
    await searchChip.getByRole('button', { name: /remove|clear/i }).click();
    await expect(searchChip).toBeHidden();
    await expect(statusChip).toBeVisible();
    await expect(referenceCells(page)).toHaveCount(IMPORTED_COUNT);

    // Clear-all resets EVERY remaining filter: chips disappear and the full
    // unfiltered set returns.
    await page
      .getByRole('button', { name: /clear all|clear filters/i })
      .click();
    await expect(statusChip).toBeHidden();
    await expect(referenceCells(page)).toHaveCount(ALL_TRANSACTIONS.length);
    await expect(page.getByText(APPROVED_REF)).toBeVisible();
    await expect(page.getByText(REJECTED_REF)).toBeVisible();
  });
});
