/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: web/src/app/transactions/page.tsx
 * - Page Action: modify_existing
 *
 * E2E spec for Epic 3, Story 4: Export the current filtered Transactions as CSV
 * (R9, BR6, BR9). This story adds an Export control to the Transactions toolbar:
 *   - Clicking Export generates a CSV CLIENT-SIDE from the active filtered dataset
 *     (data already loaded from GET /v1/transactions) — the exported row-set must
 *     equal the currently-applied filter set EXACTLY (BR6).
 *   - The download's name reflects the active filter set + date (project-brief §9).
 *   - When zero rows match the current filter, Export is DISABLED with a tooltip
 *     explanation (R9 / §9 step 5).
 *   - Export is Approver-only and fail-closed; the Importer never sees it (BR9) —
 *     that RBAC-absent assertion is vitest-tagged (AC-4), not here.
 *
 * Coverage split (one test per PLAYWRIGHT-tagged AC):
 *   - AC-1 (PLAYWRIGHT): clicking Export downloads a CSV whose rows equal EXACTLY
 *     the currently-filtered set shown in the table.
 *   - AC-3 (PLAYWRIGHT): when the current filter matches zero rows, the Export
 *     control is disabled with a tooltip explanation.
 * AC-2 (export tracks the live filter) and AC-4 (RBAC — Export absent for the
 * Importer) are vitest-tagged — covered by the sibling integration test, not here.
 *
 * Mocking strategy: project default is `page-route-with-shape-report`
 * (intake-manifest.json -> context.testInfrastructure.playwrightMockingDefault),
 * but no api-shape-report.md exists in this repo yet, so the response bodies are
 * built from documentation/transactions-api.yaml (TransactionReadList /
 * TransactionRead) + the PascalCase runtime shapes established by Epic 2/3:
 *   - GET .../v1/transactions -> the SINGULAR-keyed `{ Transactions: [...] }`
 *     envelope (project-brief §6 / §13.C — the API client unwraps the single-key
 *     envelope before the page sees it). The page takes NO server-side filter or
 *     export param: filtering AND the CSV generation run CLIENT-SIDE over the full
 *     set returned here (R9 / §9 step 3) — same client-side model as Story 1/2/3.
 *   - Each Transaction carries Reference, TransactionDate, AccountNumber,
 *     Description, Amount, Currency, TransactionType, Status, FileLogId in the
 *     observed PascalCase shape.
 *
 * Download-capture mechanism (AC-1): Playwright's download API. The click that
 * triggers the client-side CSV is raced against `page.waitForEvent('download')`,
 * then the saved file is read off disk (`download.path()`) and its text parsed.
 * `acceptDownloads` defaults to true in Playwright, so no config change is needed.
 * The assertion checks the user-observable end state — the CSV contains a header
 * row and exactly the References of the currently-filtered (Imported) set, and
 * none of the filtered-out (Approved / Rejected) References — never how the bytes
 * were produced.
 *
 * Internal-consistency contract (the Story-1 defect class this spec avoids):
 *   - The full set is exactly 8 rows — comfortably UNDER the default page size of
 *     20 — so EVERY row sits on page 1 under any sort. No assertion below depends
 *     on pagination, so the default Transaction-Date-DESC sort can never push an
 *     asserted row off-screen, and the in-table count the export must match is the
 *     full filtered slice (pagination never trims what export covers — export is
 *     the filtered SET, not the current page).
 *   - Statuses span all three enum values; the Imported rows are a KNOWN subset so
 *     "filter to Imported then export" has an unambiguous, assertable row-set.
 *   - References + Account Numbers are unique, so the CSV row-set is checkable by
 *     exact Reference membership, and the zero-match search term targets text that
 *     appears in NO row.
 *
 * Locator-precision contract (the Story-1/2/3 defect class this spec hardens
 * against):
 *   - The Status FILTER is a native labelled <select> (Story 2) whose hidden
 *     <option> values include "Imported"/"Approved"/"Rejected". It is driven with
 *     `getByLabel(/status/i).selectOption(...)`, NOT a Radix open-popover idiom,
 *     and the spec NEVER uses a page-wide getByText(/imported|approved/i) that
 *     would collide with those options — in-table presence is asserted via the
 *     Reference-cell role lookup, and the export assertion reads the CSV text.
 *   - The Export control is resolved by its accessible button name (/export/i),
 *     distinct from the Story-1 pagination Next/Previous and the Next.js dev-tools
 *     button injected during `next dev`.
 *
 * Alert/announcer note: the App Router injects a permanently-present EMPTY
 * `<div role="alert">` route announcer. This spec NEVER relies on a bare alert
 * selector — AC-3 asserts the tooltip explanation by its ACCESSIBLE TEXT
 * (aria-describedby / tooltip role / accessible name), not a bare role="alert".
 *
 * Auth: the /transactions surface is auth-gated (RequireSession + HttpOnly session
 * cookie), so each test drives the real login flow first — reusing the EXACT
 * same-origin /api/* auth-mock + login + cold-route nav-timeout pattern from Epic 3
 * Story 1/2/3. Both tests sign in as the APPROVER so the Export control renders
 * (BR9: Export is Approver-only).
 *
 * These tests WILL FAIL until the Export control + client-side CSV generation +
 * zero-match disabled/tooltip behaviour are implemented on /transactions (Story
 * 1/2/3 ship the table + filters + review actions with no Export control) — TDD red.
 */
import { readFile } from 'node:fs/promises';
import { test, expect, type Page, type Route } from '@playwright/test';
import { approverUser, type TestUser } from './fixtures/credentials';

/**
 * Post-login navigation must tolerate a `next dev` COLD-ROUTE compile. The
 * /transactions page is heavy to compile on its first hit (Table + StatusBadge +
 * filters + action dialogs + export + zod), during which the URL legitimately
 * stays on /login until the destination route finishes compiling — which can
 * exceed the 5s default `toHaveURL` timeout. Setup-mechanism wait, not a
 * behavioural assertion. Lifted verbatim from Epic 3 Story 1/2/3.
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
 * The full set: exactly 8 rows, all on page 1 (default page size 20). Each row has
 * a UNIQUE Reference and Account Number, and Statuses span the whole enum so the
 * Status filter narrows to a KNOWN, assertable subset that the export must match.
 *
 * Status distribution (the source of truth the export assertion derives from):
 *   - 3 Imported rows (Ids 1, 2, 3) — the subset kept by Status="Imported" and the
 *     EXACT set the exported CSV must contain after that filter (BR6).
 *   - 3 Approved rows (Ids 4, 5, 6) — must be ABSENT from the Imported-filtered CSV.
 *   - 2 Rejected rows (Ids 7, 8) — must be ABSENT from the Imported-filtered CSV.
 *
 * TransactionDates DESCEND with Id (lower Id => more recent), matching the page's
 * default Transaction-Date-DESC sort, so the rows render in a stable order. All 8
 * fit on page 1, so the export covers the full filtered SET (not just one page).
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

/** The References of the Imported subset — the EXACT row-set the export must carry. */
const IMPORTED_REFS = ALL_TRANSACTIONS.filter(
  (t) => t.Status === 'Imported',
).map((t) => t.Reference);

/** References that are NOT Imported — must be ABSENT from the Imported-filtered CSV. */
const NON_IMPORTED_REFS = ALL_TRANSACTIONS.filter(
  (t) => t.Status !== 'Imported',
).map((t) => t.Reference);

/**
 * A search term that matches NO transaction (Reference or Account Number). Combined
 * with the Imported status filter it produces a zero-row result — the AC-3 probe.
 * It is deliberately unlike any seeded Reference / Account Number so the empty
 * result is unambiguous.
 */
const ZERO_MATCH_SEARCH = 'ZZZ-NO-SUCH-TRANSACTION-9999';

/** Build a single User record in the observed PascalCase shape (mirrors Epic 2/3 specs). */
function userRecord(user: TestUser) {
  return {
    Id: user.role === 'Importer' ? 101 : 202,
    Email: user.email,
    FirstName: user.firstName,
    LastName: user.lastName,
    // Emit the PRODUCTION role NAME on the wire: the live backend returns the
    // Importer as 'File Importer' (the Approver as 'Approver'). The bare
    // TestUser.role stays the test-logic discriminator; only the emitted name is
    // mapped here (Epic 5 Story 1 — role-name realism).
    RolesString: user.role === 'Importer' ? 'File Importer' : 'Approver',
    Roles: [
      {
        Id: user.role === 'Importer' ? 1 : 2,
        Name: user.role === 'Importer' ? 'File Importer' : 'Approver',
      },
    ],
    Pages: [],
    LastChangedUser: 'system',
    LastChangedDate: '2026-06-01T08:00:00Z',
  };
}

/**
 * Wire the same-origin /api/* mocks the Transactions table needs — identical to
 * Epic 3 Story 1/2's auth+list harness:
 *   - auth login / userinfo / users (so login succeeds and the role resolves);
 *   - GET .../transactions -> the SINGULAR-keyed `{ Transactions: [...] }`
 *     envelope (project-brief §6 / §13.C), returning the full set so the page
 *     filters CLIENT-SIDE and the CSV is generated CLIENT-SIDE from that slice.
 * Export is a purely client-side operation (§9 step 3), so there is NO export
 * endpoint to mock.
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
 * generous cold-route timeout (see SIGN_IN_NAV_TIMEOUT_MS). Identical to Story 1/2/3.
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
 * the header row) gives an exact data-row count. The pattern matches only TXN
 * references, so it never collides with chrome injected by `next dev`.
 */
function referenceCells(page: Page) {
  return page.getByRole('cell', { name: /^TXN-20260415-\d{4}$/ });
}

/** The toolbar Export control, resolved by its accessible button name. */
function exportControl(page: Page) {
  return page.getByRole('button', { name: /export/i });
}

test.describe('Epic 3, Story 4: Export the current filtered transactions as CSV', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-1 (R9 / BR6): clicking Export downloads a CSV whose rows equal EXACTLY the
  // currently-filtered set shown in the table. We apply Status=Imported (a known
  // subset), trigger Export, capture the download, read its text, and assert the
  // CSV carries a header row plus precisely the Imported References — and none of
  // the filtered-out Approved / Rejected References.
  test('Export downloads a CSV containing exactly the currently-filtered rows', async ({
    page,
  }) => {
    await mockTransactionsApi(page, approverUser, ALL_TRANSACTIONS);
    await signIn(page, approverUser);
    await page.goto('/transactions');

    // Baseline: all 8 rows render on page 1 before any filter is applied.
    await expect(referenceCells(page)).toHaveCount(ALL_TRANSACTIONS.length);

    // Apply the Status=Imported filter (native labelled <select> driven by
    // selectOption — see the locator-precision note) so the active filtered set is
    // the known 3-row Imported subset. Confirm the table now shows exactly that
    // many data rows BEFORE exporting, so the in-table set and the CSV are checked
    // against the same source of truth.
    await page.getByLabel(/status/i).selectOption({ label: 'Imported' });
    await expect(referenceCells(page)).toHaveCount(IMPORTED_REFS.length);

    // Trigger Export and capture the client-side download. The click is raced
    // against the download event so the file is captured no matter how quickly the
    // CSV is generated.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      exportControl(page).click(),
    ]);

    // The download's suggested filename reflects a CSV export (§9 step 4: the name
    // reflects the active filter set + date). We assert the extension/shape, not an
    // exact name, since the date+filter slug is implementation-detail.
    expect(download.suggestedFilename()).toMatch(/\.csv$/i);

    // Read the saved file off disk and parse its text.
    const savedPath = await download.path();
    expect(savedPath).toBeTruthy();
    const csv = await readFile(savedPath as string, 'utf8');

    // A header row is present (the export carries column names, not bare data).
    const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
    expect(lines.length).toBeGreaterThan(0);
    const header = lines[0];
    expect(header).toMatch(/reference/i);

    // EXACTLY the currently-filtered (Imported) References appear in the CSV...
    for (const ref of IMPORTED_REFS) {
      expect(csv).toContain(ref);
    }
    // ...and NONE of the filtered-out (Approved / Rejected) References do (BR6: the
    // exported row-set equals the active filter set — no more, no less).
    for (const ref of NON_IMPORTED_REFS) {
      expect(csv).not.toContain(ref);
    }

    // The data-row count (total lines minus the header) equals the filtered set
    // size — a precise membership check that the CSV is neither padded nor trimmed.
    const dataRowCount = lines.length - 1;
    expect(dataRowCount).toBe(IMPORTED_REFS.length);
  });

  // AC-3 (R9 / §9 step 5): when the current filter matches zero rows, the Export
  // control is DISABLED with a tooltip explanation. We combine the Imported status
  // filter with a search term that matches NO row to force an empty result, then
  // assert Export is disabled and that an explanatory tooltip text is available
  // (asserted by accessible text — never a bare role="alert").
  test('Export is disabled with a tooltip explanation when the filter matches zero rows', async ({
    page,
  }) => {
    await mockTransactionsApi(page, approverUser, ALL_TRANSACTIONS);
    await signIn(page, approverUser);
    await page.goto('/transactions');

    // With rows present, Export is enabled — the contrast that makes the disabled
    // assertion meaningful.
    await expect(referenceCells(page)).toHaveCount(ALL_TRANSACTIONS.length);
    await expect(exportControl(page)).toBeEnabled();

    // Force a zero-row result: a Status filter PLUS a search term that matches no
    // Reference or Account Number leaves the table empty.
    await page.getByLabel(/status/i).selectOption({ label: 'Imported' });
    const search = page.getByRole('searchbox', {
      name: /search|reference|account/i,
    });
    await search.fill(ZERO_MATCH_SEARCH);

    // The table now shows zero data rows.
    await expect(referenceCells(page)).toHaveCount(0);

    // Export is disabled (nothing to export, §9 step 5).
    const exportBtn = exportControl(page);
    await expect(exportBtn).toBeDisabled();

    // A tooltip explanation is AVAILABLE — surfaced as accessible text. The page
    // may expose it via an accessible description (aria-describedby) or a tooltip
    // revealed on hover/focus; either way the explanation must be reachable as
    // TEXT, not signalled by the disabled state alone. We assert the explanatory
    // copy (mentioning there are no rows / nothing to export) is present in the
    // document, scoped away from a bare role="alert".
    const tooltipExplanation = page.getByText(
      /no (?:rows|transactions|matching|results)|nothing to export|export is unavailable/i,
    );
    await expect(tooltipExplanation).toBeVisible();
  });
});
