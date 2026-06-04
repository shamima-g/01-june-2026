/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: web/src/app/transactions/page.tsx
 * - Page Action: modify_existing
 *
 * E2E spec for Epic 3, Story 5: Per-file summary with status counts and
 * drill-down (R10). This story adds a per-File Summary view on top of the
 * Story-1/2 Transactions surface:
 *   - For each file (grouped by FileLogId), a summary shows Total records and the
 *     Imported / Approved / Rejected counts (client-side aggregation over the
 *     already-loaded transaction set — same client-side model as Story 1/2/4).
 *   - Clicking a status count drills into the Transactions table pre-filtered to
 *     that file + status slice, REUSING the Story-2 filter state (File + Status
 *     filters), so the table then shows only that file's rows in that status.
 *
 * Coverage split (one test per PLAYWRIGHT-tagged AC):
 *   - AC-1 (PLAYWRIGHT): the per-file summary shows Total records and the
 *     Imported, Approved, and Rejected counts for the file.
 *   - AC-3 (PLAYWRIGHT): clicking a status count opens the Transactions table
 *     pre-filtered to that file and status slice.
 * AC-2 (counts match the underlying data) is vitest-tagged — covered by the
 * sibling integration test, not here.
 *
 * Both the Approver and the Importer share this read-only File-Summary surface
 * (project-brief §6.5: "View File Summary (status counts per file)" is ticked for
 * both personas), so these persona-neutral behaviours are exercised once, as the
 * Approver — reusing the same auth-mock + login pattern as Story 1/2/4.
 *
 * Mocking strategy: project default is `page-route-with-shape-report`
 * (intake-manifest.json -> context.testInfrastructure.playwrightMockingDefault),
 * but no api-shape-report.md exists in this repo yet, so the response bodies are
 * built from documentation/transactions-api.yaml (TransactionReadList /
 * TransactionRead) + the PascalCase runtime shapes established by Epic 2/3:
 *   - GET .../v1/transactions -> the SINGULAR-keyed `{ Transactions: [...] }`
 *     envelope (project-brief §6 / §13.C — the API client unwraps the single-key
 *     envelope before the page sees it). The page takes NO server-side group/count
 *     param: the per-file aggregation runs CLIENT-SIDE over the full set returned
 *     here (R10) — same client-side model as Story 1/2/4.
 *   - Each Transaction carries Reference, TransactionDate, AccountNumber,
 *     Description, Amount, Currency, TransactionType, Status, FileLogId, FileName
 *     in the observed PascalCase shape.
 *
 * Internal-consistency contract (the Story-1 defect class this spec avoids):
 *   - The full set is exactly 9 rows — comfortably UNDER the default page size of
 *     20 — so EVERY row sits on page 1 under any sort. No assertion below depends
 *     on pagination, so the default Transaction-Date-DESC sort can never push an
 *     asserted row off-screen, and the drill-down slice is never trimmed by paging.
 *   - The rows belong to TWO files (FileLogId 5001 "File A" and 5002 "File B")
 *     with a KNOWN per-file status distribution that is the single source of truth
 *     for both the summary-count assertions (AC-1) and the drill-down membership
 *     assertions (AC-3):
 *       File A (5001): 3 Imported, 1 Approved, 1 Rejected  -> Total 5
 *       File B (5002): 1 Imported, 2 Approved, 1 Rejected  -> Total 4
 *     The two files differ in their per-status counts, so an assertion against
 *     File A's numbers can never accidentally pass against File B's, and the
 *     drill-down (File A + Approved -> exactly 1 row) targets a slice with a
 *     unique, checkable membership.
 *   - References are unique, so the drill-down can assert the included Reference is
 *     present and every excluded Reference is absent via row/cell-scoped locators.
 *
 * Locator-precision contract (the Story-1/2/4 defect class this spec hardens
 * against): the words "Imported"/"Approved"/"Rejected" appear in THREE places on
 * this page — the Status filter <option>s, the StatusBadge cells in the table, and
 * the per-file summary counts. A bare page-wide getByText(/imported|approved/i)
 * would collide across all three. Therefore:
 *   - Summary-count assertions are scoped to the per-file summary REGION (an
 *     accessible region/group named for the file), never page-wide text.
 *   - In-table presence/absence is asserted via the Reference-cell role lookup
 *     (getByRole('cell', { name: /^TXN-.../ })) and row-scoped status checks, never
 *     a bare status-word text lookup that would hit the filter options or badges.
 *   - The File / Status filter controls are native labelled <select>s (Story 2),
 *     read via their value to confirm the drill-down populated them.
 *
 * Alert/announcer note: the App Router injects a permanently-present EMPTY
 * `<div role="alert">` route announcer. This spec NEVER relies on a bare alert
 * selector — assertions target the named summary region, its labelled count
 * controls, the filter selects, column/cell text, and the rows.
 *
 * Auth: the /transactions surface is auth-gated (RequireSession + HttpOnly session
 * cookie), so each test drives the real login flow first — reusing the EXACT
 * same-origin /api/* auth-mock + login + cold-route nav-timeout pattern from Epic 3
 * Story 1/2/4.
 *
 * These tests WILL FAIL until the per-file summary + status-count drill-down are
 * implemented on /transactions (Story 1/2/4 ship the table + filters + export with
 * no per-file summary) — TDD red.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { approverUser, type TestUser } from './fixtures/credentials';

/**
 * Post-login navigation must tolerate a `next dev` COLD-ROUTE compile. The
 * /transactions page is heavy to compile on its first hit (Table + StatusBadge +
 * filters + summary + zod), during which the URL legitimately stays on /login until
 * the destination route finishes compiling — which can exceed the 5s default
 * `toHaveURL` timeout. Setup-mechanism wait, not a behavioural assertion. Lifted
 * verbatim from Epic 3 Story 1/2/4.
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
 * Two files with a KNOWN per-file status distribution — the single source of truth
 * for both the summary counts (AC-1) and the drill-down membership (AC-3):
 *
 *   File A (FileLogId 5001 / "file_a_2026-04-15.csv"):
 *     - 3 Imported (Ids 1, 2, 3)
 *     - 1 Approved (Id 4)
 *     - 1 Rejected (Id 5)
 *     -> Total 5
 *   File B (FileLogId 5002 / "file_b_2026-04-16.csv"):
 *     - 1 Imported (Id 6)
 *     - 2 Approved (Ids 7, 8)
 *     - 1 Rejected (Id 9)
 *     -> Total 4
 *
 * Files A and B differ in their per-status counts, so File A's summary numbers
 * cannot accidentally satisfy an assertion meant for File B. The drill-down probe
 * (File A + Approved) targets EXACTLY ONE row (TXN-...-0004), giving an unambiguous
 * included/excluded membership check.
 */
const FILE_A = { id: 5001, name: 'file_a_2026-04-15.csv' };
const FILE_B = { id: 5002, name: 'file_b_2026-04-16.csv' };

interface RowSpec {
  id: number;
  file: { id: number; name: string };
  status: string;
}

const ROW_SPECS: RowSpec[] = [
  // File A — 3 Imported, 1 Approved, 1 Rejected (Total 5)
  { id: 1, file: FILE_A, status: 'Imported' },
  { id: 2, file: FILE_A, status: 'Imported' },
  { id: 3, file: FILE_A, status: 'Imported' },
  { id: 4, file: FILE_A, status: 'Approved' },
  { id: 5, file: FILE_A, status: 'Rejected' },
  // File B — 1 Imported, 2 Approved, 1 Rejected (Total 4)
  { id: 6, file: FILE_B, status: 'Imported' },
  { id: 7, file: FILE_B, status: 'Approved' },
  { id: 8, file: FILE_B, status: 'Approved' },
  { id: 9, file: FILE_B, status: 'Rejected' },
];

const BASE_DATE_MS = Date.parse('2026-04-30T15:00:00Z');
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const ALL_TRANSACTIONS: MockTransaction[] = ROW_SPECS.map((spec) =>
  transaction({
    Id: spec.id,
    FileLogId: spec.file.id,
    FileName: spec.file.name,
    Reference: `TXN-20260415-${String(spec.id).padStart(4, '0')}`,
    AccountNumber: `ACCT-${String(spec.id).padStart(4, '0')}`,
    Amount: spec.id * 100,
    // Lower Id => more recent date, matching the page's default
    // Transaction-Date-DESC sort. All 9 rows fit on page 1, so no assertion
    // depends on this ordering — it just keeps the fixture honest.
    TransactionDate: new Date(
      BASE_DATE_MS - spec.id * ONE_DAY_MS,
    ).toISOString(),
    Status: spec.status,
  }),
);

/** File A's expected per-status counts + total (derived from ROW_SPECS). */
const FILE_A_ROWS = ROW_SPECS.filter((r) => r.file.id === FILE_A.id);
const FILE_A_COUNTS = {
  total: FILE_A_ROWS.length, // 5
  imported: FILE_A_ROWS.filter((r) => r.status === 'Imported').length, // 3
  approved: FILE_A_ROWS.filter((r) => r.status === 'Approved').length, // 1
  rejected: FILE_A_ROWS.filter((r) => r.status === 'Rejected').length, // 1
};

/**
 * The drill-down probe: File A + Approved. The fixture above has EXACTLY ONE such
 * row, so after drilling in the table must show that one Reference and none other.
 */
const DRILLDOWN_INCLUDED_REF = 'TXN-20260415-0004'; // File A, Approved (the only one)
const DRILLDOWN_EXCLUDED_REFS = ROW_SPECS.filter(
  (r) => !(r.file.id === FILE_A.id && r.status === 'Approved'),
).map((r) => `TXN-20260415-${String(r.id).padStart(4, '0')}`);

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
 * Wire the same-origin /api/* mocks the Transactions surface needs — identical to
 * Epic 3 Story 1/2/4's auth+list harness:
 *   - auth login / userinfo / users (so login succeeds and the role resolves);
 *   - GET .../transactions -> the SINGULAR-keyed `{ Transactions: [...] }`
 *     envelope (project-brief §6 / §13.C), returning the full set so the page
 *     aggregates the per-file counts and applies the drill-down filter CLIENT-SIDE.
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
 * generous cold-route timeout (see SIGN_IN_NAV_TIMEOUT_MS). Identical to Story 1/2/4.
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
 * the header row) gives an exact data-row count the drill-down assertions can
 * compare against. The pattern matches only TXN references, so it never collides
 * with chrome injected by `next dev`.
 */
function referenceCells(page: Page) {
  return page.getByRole('cell', { name: /^TXN-20260415-\d{4}$/ });
}

/**
 * File A's per-file summary REGION. The summary for each file is an accessible
 * region/group named for the file (its file name), so scoping count lookups inside
 * it keeps the status words ("Imported"/"Approved"/"Rejected") from colliding with
 * the Status filter <option>s or the StatusBadge cells elsewhere on the page.
 */
function fileSummary(page: Page, fileName: string) {
  return page.getByRole('region', { name: new RegExp(fileName, 'i') });
}

test.describe('Epic 3, Story 5: Per-file summary with status counts and drill-down', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-1 (R10): the per-file summary shows Total records and the Imported,
  // Approved, and Rejected counts for the file. We assert File A's four numbers
  // (Total 5; Imported 3; Approved 1; Rejected 1) INSIDE File A's named summary
  // region, so the status words never collide with the filter options or the
  // table's StatusBadge cells. File A and File B differ in their per-status counts,
  // so these numbers are unique to File A.
  test('the per-file summary shows Total, Imported, Approved, and Rejected counts for the file', async ({
    page,
  }) => {
    await mockTransactionsApi(page, approverUser, ALL_TRANSACTIONS);
    await signIn(page, approverUser);
    await page.goto('/transactions');

    // The page has loaded the full set (baseline) — all 9 rows on page 1.
    await expect(referenceCells(page)).toHaveCount(ALL_TRANSACTIONS.length);

    // File A's summary region is present and labelled for the file.
    const summaryA = fileSummary(page, FILE_A.name);
    await expect(summaryA).toBeVisible();

    // Each count is a labelled value within the region. The labels (Total /
    // Imported / Approved / Rejected) are accessible names; the count appears
    // alongside its label. We assert label + number co-located within the region
    // so the figure is unambiguously the count for THIS file and THIS status.
    await expect(
      summaryA.getByText(
        new RegExp(`total[\\s\\S]*${FILE_A_COUNTS.total}`, 'i'),
      ),
    ).toBeVisible();
    await expect(
      summaryA.getByText(
        new RegExp(`imported[\\s\\S]*${FILE_A_COUNTS.imported}`, 'i'),
      ),
    ).toBeVisible();
    await expect(
      summaryA.getByText(
        new RegExp(`approved[\\s\\S]*${FILE_A_COUNTS.approved}`, 'i'),
      ),
    ).toBeVisible();
    await expect(
      summaryA.getByText(
        new RegExp(`rejected[\\s\\S]*${FILE_A_COUNTS.rejected}`, 'i'),
      ),
    ).toBeVisible();
  });

  // AC-3 (R10): clicking a status count opens the Transactions table pre-filtered
  // to that file + status slice (reusing the Story-2 filter state). We click File
  // A's Approved count — the fixture has EXACTLY ONE File-A/Approved row — and
  // assert the table now shows only that one Reference, every other Reference is
  // gone, and the File + Status filter controls reflect the drill-down.
  test('clicking a status count opens the table pre-filtered to that file and status slice', async ({
    page,
  }) => {
    await mockTransactionsApi(page, approverUser, ALL_TRANSACTIONS);
    await signIn(page, approverUser);
    await page.goto('/transactions');

    // Baseline: the full set is shown before drilling in.
    await expect(referenceCells(page)).toHaveCount(ALL_TRANSACTIONS.length);

    // The status counts are interactive — clicking File A's Approved count is the
    // drill-down trigger. It is a named control (a button/link) WITHIN File A's
    // summary region whose accessible name identifies the Approved slice, so it is
    // resolved by role inside the region (never a page-wide status-word text hit).
    const summaryA = fileSummary(page, FILE_A.name);
    await summaryA.getByRole('button', { name: /approved/i }).click();

    // The table is now pre-filtered to File A + Approved: EXACTLY the one matching
    // Reference is shown, and every excluded Reference (File A's other statuses and
    // all of File B) is absent. Asserted via Reference-cell locators, never status
    // text, so the StatusBadge/filter-option collisions are avoided.
    await expect(referenceCells(page)).toHaveCount(FILE_A_COUNTS.approved);
    await expect(
      page.getByRole('cell', { name: DRILLDOWN_INCLUDED_REF, exact: true }),
    ).toBeVisible();
    for (const ref of DRILLDOWN_EXCLUDED_REFS) {
      await expect(
        page.getByRole('cell', { name: ref, exact: true }),
      ).toHaveCount(0);
    }

    // The Story-2 filter controls reflect the drill-down: the File filter now
    // carries File A and the Status filter now carries Approved. The controls are
    // the native labelled <select>s from Story 2, read by their selected value via
    // toHaveValue — proving the drill-down populated the SHARED filter state rather
    // than a one-off view (R10: "drills into the filtered slice of the table").
    //
    // Locator precision (NOT an assertion change): the per-file summary blocks are
    // accessible regions named for the file (the fixture's file names literally
    // contain the word "file"), so a loose getByLabel(/file/i) would resolve those
    // regions too. We target the Story-2 filter <select>s by their stable ids so
    // the read pins to the actual filter control; the toHaveValue assertions below
    // are unchanged (same File-A + Approved expectations).
    await expect(page.locator('#filter-file')).toHaveValue(
      new RegExp(`${FILE_A.id}|${FILE_A.name}`, 'i'),
    );
    await expect(page.locator('#filter-status')).toHaveValue(/approved/i);
  });
});
