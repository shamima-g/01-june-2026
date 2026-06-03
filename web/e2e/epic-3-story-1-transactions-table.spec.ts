/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: web/src/app/transactions/page.tsx
 * - Page Action: modify_existing
 *
 * E2E spec for Epic 3, Story 1: the read-only Transactions table on
 * /transactions — sortable, paginated, no action controls yet (R4, BR9, BR10).
 *
 * Mocking strategy: project default is `page-route-with-shape-report`
 * (intake-manifest.json -> context.testInfrastructure.playwrightMockingDefault),
 * but no api-shape-report.md exists in this repo yet, so the response bodies are
 * built from documentation/transactions-api.yaml (TransactionReadList /
 * TransactionRead) + the PascalCase runtime shapes established by Epic 2:
 *   - GET .../v1/transactions -> the SINGULAR-keyed `{ Transactions: [...] }`
 *     envelope (project-brief §6 / §13.C — the API client unwraps the single-key
 *     envelope before the page sees it). The spec takes NO server-side sort or
 *     page param the table relies on, so sorting + pagination are CLIENT-SIDE
 *     over the full set returned here (R4: single-column sort; 5/10/20/50,
 *     default 20).
 *   - Each Transaction carries Reference, TransactionDate, AccountNumber,
 *     Description, Amount, Currency, TransactionType, Status, FileLogId in the
 *     observed PascalCase shape. `TransactionType` is modelled as the full word
 *     `Debit`/`Credit` (the value resolved during Epic 2 BUILD per §13.D and
 *     carried by the shared epic-2 mock-data factory).
 *
 * The Approver lands on /transactions (LANDING_ROUTES.Approver). Both Approver
 * and Importer see the SAME read-only table; this story adds no Approve / Reject /
 * Export / Upload controls (BR9 / BR10 — those land in later Epic 3 / Epic 2
 * stories). The empty/error states and the no-action-baseline are covered by the
 * sibling Vitest integration test (AC-4, AC-5 are vitest-tagged), not here.
 *
 * The /transactions surface is auth-gated (RequireSession + HttpOnly session
 * cookie), so each test drives the real login flow first — reusing the same
 * same-origin /api/* auth-mock + login pattern established by Epic 2 (login ->
 * Set-Cookie session; userinfo / users carry the signed-in user's role).
 *
 * Alert/announcer note: the App Router injects a permanently-present EMPTY
 * `<div role="alert">` route announcer. This spec never relies on a bare alert
 * selector — assertions target visible column headers (getByRole('columnheader')),
 * cell text, named controls, and the rows-per-page control.
 *
 * These tests WILL FAIL until the full Transactions table is implemented on
 * /transactions (current page.tsx is an under-construction placeholder) — TDD red.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import {
  approverUser,
  importerUser,
  type TestUser,
} from './fixtures/credentials';

/**
 * Post-login navigation must tolerate a `next dev` COLD-ROUTE compile. The
 * /transactions page was just rewritten from the Epic-1 placeholder into the
 * full table (Table + StatusBadge + EmptyState + zod), so its first client-side
 * `router.push` navigation triggers a fresh server compile that can exceed the
 * 5s default `toHaveURL` timeout — the URL stays on /login until the destination
 * route finishes compiling (see playwright.config.ts cold-route note). The login
 * itself succeeds; only the navigation-settle wait needs more headroom. This is a
 * setup-mechanism timeout, not a behavioural assertion.
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
 * 25 transactions — deliberately MORE than the default page size of 20 so the
 * default-20 view plus a page size of 5 are both demonstrable, and a name sort
 * has an unambiguous ordering to assert against.
 *
 * - References are zero-padded and unique so `getByText` lookups never collide.
 * - We seed the array in DESCENDING reference order so the fetch order is NOT
 *   already ascending-by-reference — the page's Reference sort is the thing the
 *   sort test exercises, and it must re-sort rather than echo the fetch order.
 * - TransactionDates VARY by Id: lower Id => MORE RECENT date (base date minus
 *   `id` days). The page's DEFAULT sort is Transaction Date DESCENDING, so under
 *   that default the most-recent date — the row carrying TXN-...-0001 — sorts to
 *   the TOP and is therefore visible on the default page-1 view. This keeps the
 *   spec internally consistent with the page's real default sort: the badge and
 *   importer tests both assert TXN-...-0001 is visible on page 1, so it must
 *   actually land there under the page's own ordering.
 * - Statuses cycle through Imported / Approved / Rejected so the Status column
 *   renders the colour+label badge for each value — EXCEPT the TXN-...-0001 row,
 *   which is pinned to 'Imported' so the badge test's reference row (the same row
 *   it asserts visible on page 1) shows the labelled Imported badge it verifies.
 */
const STATUS_CYCLE = ['Imported', 'Approved', 'Rejected'] as const;

/** The Id whose row the badge + importer tests assert visible on the default page-1 view. */
const REFERENCE_ID = 1;

/** Base date the per-row TransactionDate is offset back from (one day per Id). */
const BASE_DATE_MS = Date.parse('2026-04-30T15:00:00Z');
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const ALL_TRANSACTIONS: MockTransaction[] = Array.from(
  { length: 25 },
  (_, i) => {
    // Seed in DESCENDING id order so the fetch order is NOT already
    // ascending-by-reference — the page's sort is the thing under test.
    const id = 25 - i;
    // Lower Id => more recent date, so the page's default date-DESC sort places
    // TXN-...-0001 first (visible on page 1, the default view the tests assert).
    const transactionDate = new Date(
      BASE_DATE_MS - id * ONE_DAY_MS,
    ).toISOString();
    return transaction({
      Id: id,
      Reference: `TXN-20260415-${String(id).padStart(4, '0')}`,
      AccountNumber: `1000-0000-${String(id).padStart(4, '0')}`,
      Amount: id * 100,
      TransactionDate: transactionDate,
      // The reference row is pinned to 'Imported' (the badge test asserts that
      // row shows an Imported badge); the rest cycle so each status renders.
      Status:
        id === REFERENCE_ID
          ? 'Imported'
          : STATUS_CYCLE[id % STATUS_CYCLE.length],
      TransactionType: id % 2 === 0 ? 'Debit' : 'Credit',
    });
  },
);

const FIRST_REF = 'TXN-20260415-0001';
const SECOND_REF = 'TXN-20260415-0002';
const LAST_REF = 'TXN-20260415-0025';

/** Build a single User record in the observed PascalCase shape (mirrors Epic 2 specs). */
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
 * Wire the same-origin /api/* mocks the Transactions table needs:
 *   - auth login / userinfo / users (so login succeeds and the role resolves);
 *   - GET .../transactions -> the SINGULAR-keyed `{ Transactions: [...] }`
 *     envelope (project-brief §6 / §13.C), returning the full set so the page
 *     sorts + paginates CLIENT-SIDE.
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
 * established, then wait for the post-login navigation to leave /login.
 *
 * The wait uses a generous explicit timeout (SIGN_IN_NAV_TIMEOUT_MS) rather than
 * the 5s `toHaveURL` default: under `next dev` the destination route may be
 * compiling on its first hit, during which the URL legitimately stays on /login
 * until the route is ready. This is a setup-mechanism wait — it changes only how
 * long we tolerate a cold compile, not what the behavioural assertions verify.
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

/** The rows-per-page control — a named combobox/select offering 5/10/20/50. */
function rowsPerPage(page: Page) {
  return page.getByRole('combobox', {
    name: /rows per page|page size|per page/i,
  });
}

/**
 * The page's pagination region — a `<nav aria-label="Pagination">` containing the
 * Previous / Next controls. Scoping the Next / Previous lookups INSIDE this
 * region is essential: a bare `getByRole('button', { name: /next/i })` also
 * matches the Next.js dev-tools button injected into the page during `next dev`,
 * so the page-level locator would be ambiguous. Resolving within the pagination
 * nav binds to the single real control regardless of the dev-tools overlay.
 */
function pagination(page: Page) {
  return page.getByRole('navigation', { name: /pagination/i });
}

test.describe('Epic 3, Story 1: Transactions table', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-1 (R4): on load the Approver sees the transactions table with the eight
  // brief columns, and the Status cell rendered as a colour+label badge (text
  // label always present per R16 — colour alone is never the only signal).
  test('Approver sees the eight-column table with Status rendered as a labelled badge', async ({
    page,
  }) => {
    await mockTransactionsApi(page, approverUser, ALL_TRANSACTIONS);
    await signIn(page, approverUser);
    await page.goto('/transactions');

    // The eight brief columns are rendered as column headers (R4). Targeting
    // columnheader role (not a bare alert/text) keeps the assertion on the table.
    await expect(
      page.getByRole('columnheader', { name: /reference/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: /transaction date/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: /account number/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: /description/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: /amount/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: /currency/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: /transaction type/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: /status/i }),
    ).toBeVisible();

    // The first page's rows are present (default 20 shows row 1).
    await expect(page.getByText(FIRST_REF)).toBeVisible();

    // Status is shown as a labelled badge — the text label is always rendered
    // alongside the colour (R16). Scope to the first row so the badge text is
    // unambiguous: the row carrying TXN-...-0001 has Status 'Imported'.
    const firstRow = page.getByRole('row').filter({ hasText: FIRST_REF });
    await expect(firstRow.getByText(/imported/i)).toBeVisible();
  });

  // AC-2 (R4): clicking a column header sorts ascending on the first click and
  // descending on the second; only one column sorts at a time. Reference is a
  // good probe because the fetch order is seeded DESCENDING — so a working
  // ascending sort must surface TXN-...-0001 ahead of TXN-...-0002.
  test('clicking a column header sorts ascending then descending (single-column)', async ({
    page,
  }) => {
    await mockTransactionsApi(page, approverUser, ALL_TRANSACTIONS);
    await signIn(page, approverUser);
    await page.goto('/transactions');

    // Make the full set visible on one page so sort order is asserted without
    // pagination interfering: switch to the largest page size (50 ≥ 25 rows).
    await rowsPerPage(page).selectOption('50');

    // The Reference column header is an interactive sort control.
    const referenceHeader = page.getByRole('columnheader', {
      name: /reference/i,
    });

    // First click -> ascending: TXN-...-0001 sorts ABOVE TXN-...-0002.
    await referenceHeader.getByRole('button', { name: /reference/i }).click();

    const refCells = page.getByRole('cell', { name: /^TXN-20260415-\d{4}$/ });
    await expect(refCells.first()).toHaveText(FIRST_REF);
    await expect(refCells.nth(1)).toHaveText(SECOND_REF);

    // Second click on the SAME header -> descending: the largest reference leads.
    await referenceHeader.getByRole('button', { name: /reference/i }).click();
    await expect(refCells.first()).toHaveText(LAST_REF);
  });

  // AC-3 (R4): pagination offers 5/10/20/50 (default 20) and navigates pages; the
  // controls are ALWAYS rendered, with navigation disabled when there's no page
  // to move to.
  test('pagination defaults to 20, offers 5/10/20/50, and navigates pages', async ({
    page,
  }) => {
    await mockTransactionsApi(page, approverUser, ALL_TRANSACTIONS);
    await signIn(page, approverUser);
    await page.goto('/transactions');

    // Default page size is 20: with 25 rows, page 1 shows the first 20 and the
    // 21st (TXN-...-0021, seeded order aside) is NOT on page 1.
    await expect(
      page.getByRole('cell', { name: /^TXN-20260415-\d{4}$/ }),
    ).toHaveCount(20);

    // Pagination controls are always rendered. On page 1, Previous is disabled
    // (no earlier page) while Next is enabled (a second page of 5 rows exists).
    // Both are resolved INSIDE the pagination nav so the /next/i lookup never
    // collides with the Next.js dev-tools button (see `pagination()`).
    const previous = pagination(page).getByRole('button', {
      name: /previous|prev/i,
    });
    const next = pagination(page).getByRole('button', { name: /next/i });
    await expect(previous).toBeVisible();
    await expect(next).toBeVisible();
    await expect(previous).toBeDisabled();
    await expect(next).toBeEnabled();

    // Navigate to page 2: the remaining 5 rows render (25 - 20 = 5) and Next is
    // now disabled (no further page) while Previous becomes enabled.
    await next.click();
    await expect(
      page.getByRole('cell', { name: /^TXN-20260415-\d{4}$/ }),
    ).toHaveCount(5);
    await expect(next).toBeDisabled();
    await expect(previous).toBeEnabled();

    // Switching the page size to 5 re-paginates: page 1 now shows exactly 5 rows.
    await rowsPerPage(page).selectOption('5');
    await expect(
      page.getByRole('cell', { name: /^TXN-20260415-\d{4}$/ }),
    ).toHaveCount(5);
  });

  // AC-1 (R4 / BR9 / BR10): the Importer sees the SAME read-only table as the
  // Approver — same eight columns, same rows — confirming both personas share the
  // read-only surface (this story adds no role-gated action controls).
  test('Importer sees the same read-only transactions table as the Approver', async ({
    page,
  }) => {
    await mockTransactionsApi(page, importerUser, ALL_TRANSACTIONS);
    await signIn(page, importerUser);
    await page.goto('/transactions');

    // The same eight-column table renders for the Importer.
    await expect(
      page.getByRole('columnheader', { name: /reference/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: /status/i }),
    ).toBeVisible();

    // The same transaction rows are present.
    await expect(page.getByText(FIRST_REF)).toBeVisible();
  });
});
