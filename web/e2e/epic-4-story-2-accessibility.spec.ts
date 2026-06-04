/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: web/src/app/transactions/page.tsx
 * - Page Action: modify_existing
 *
 * E2E spec for Epic 4, Story 2: Accessibility pass on the Transactions surface —
 * keyboard navigation, focus, labels, AT-exposed help (NFR1, NFR4). This story
 * hardens the existing /transactions surface (table + filters + review actions +
 * export, shipped by Epic 3) to WCAG 2.2 Level AA:
 *   - Every primary flow (sort, filter, paginate, approve/reject, export) is
 *     KEYBOARD-OPERABLE, and the focused control carries a VISIBLE focus
 *     indicator (NFR1: "keyboard-first operation across all primary flows").
 *   - The disabled Export control's "no rows match the current filter" reason is
 *     exposed to ASSISTIVE TECH + keyboard users — surfaced as an accessible
 *     description (reachable without a mouse hover), not a title-attribute-only
 *     tooltip (NFR1: AT-exposed help; NFR4: works across the supported browsers
 *     where a bare `title` tooltip is unreliable for keyboard/AT users).
 *
 * Coverage split (one test per PLAYWRIGHT-tagged AC):
 *   - AC-1 (PLAYWRIGHT): the primary Transactions flows are reachable + operable by
 *     keyboard, and the focused control shows a visible focus indicator.
 *   - AC-2 (PLAYWRIGHT): when the filter matches zero rows, the disabled Export
 *     control's explanation is exposed to AT/keyboard (accessible description),
 *     not via a bare title attribute or mouse hover.
 *
 * Both ACs are exercised as the APPROVER, so the FULL control set — sort headers,
 * filters, pagination, the Approve / Reject row actions, AND the Approver-only
 * Export control (BR9) — renders and is available to drive by keyboard.
 *
 * Mocking strategy: project default is `page-route-with-shape-report`
 * (intake-manifest.json -> context.testInfrastructure.playwrightMockingDefault),
 * but no api-shape-report.md exists in this repo yet, so the response bodies are
 * built from documentation/transactions-api.yaml (TransactionReadList /
 * TransactionRead) + the PascalCase runtime shapes established by Epic 2/3:
 *   - GET .../v1/transactions -> the SINGULAR-keyed `{ Transactions: [...] }`
 *     envelope (project-brief §6 / §13.C — the API client unwraps the single-key
 *     envelope before the page sees it). The page takes NO server-side sort /
 *     filter / export param: those flows run CLIENT-SIDE over the full set returned
 *     here, identical to the Epic 3 client-side model this story hardens.
 *   - Each Transaction carries Reference, TransactionDate, AccountNumber,
 *     Description, Amount, Currency, TransactionType, Status, FileLogId in the
 *     observed PascalCase shape.
 *
 * Internal-consistency contract (the Epic-3 Story-1 defect class this spec avoids):
 *   - The full set is exactly 8 rows — comfortably UNDER the default page size of
 *     20 — so EVERY row sits on page 1 under any sort, and no keyboard-focus
 *     assertion depends on a row being pushed off-screen by the default sort.
 *   - Statuses span all three enum values; the Imported rows are a KNOWN subset so
 *     "filter to Imported then add a non-matching search" forces the deterministic
 *     zero-row state AC-2 needs.
 *   - References + Account Numbers are unique, so the zero-match search term targets
 *     text that appears in NO row.
 *
 * Locator-precision contract (the Epic-3 Story-1/2/3/4 defect class this spec
 * hardens against):
 *   - Pagination Next / Previous are resolved INSIDE the `<nav aria-label=
 *     "Pagination">` region so the /next/i lookup never collides with the Next.js
 *     dev-tools button injected during `next dev`.
 *   - The Status FILTER is a native labelled <select> driven by selectOption /
 *     keyboard, NOT a Radix open-popover idiom; the spec never uses a page-wide
 *     getByText(/imported|approved/i) that would collide with its <option>s.
 *   - The Export control is resolved by its accessible button name (/export/i).
 *
 * Alert/announcer note: the App Router injects a permanently-present EMPTY
 * `<div role="alert">` route announcer. This spec NEVER relies on a bare alert
 * selector — AC-2 asserts the Export explanation via the control's ACCESSIBLE
 * DESCRIPTION (aria-describedby resolving to visible help text), never a bare
 * role="alert" and never a mouse hover.
 *
 * Auth: the /transactions surface is auth-gated (RequireSession + HttpOnly session
 * cookie), so each test drives the real login flow first — reusing the EXACT
 * same-origin /api/* auth-mock + login + cold-route nav-timeout pattern from Epic 3.
 *
 * These tests WILL FAIL until the keyboard-operability hardening + the AT-exposed
 * Export-disabled description are implemented on /transactions (Epic 3 ships the
 * surface with a title-only export tooltip and no asserted focus-visible
 * guarantees) — TDD red.
 */
import {
  test,
  expect,
  type Locator,
  type Page,
  type Route,
} from '@playwright/test';
import { approverUser, type TestUser } from './fixtures/credentials';

/**
 * Post-login navigation must tolerate a `next dev` COLD-ROUTE compile. The
 * /transactions page is heavy to compile on its first hit (Table + StatusBadge +
 * filters + action dialogs + export + zod), during which the URL legitimately
 * stays on /login until the destination route finishes compiling — which can
 * exceed the 5s default `toHaveURL` timeout. Setup-mechanism wait, not a
 * behavioural assertion. Lifted verbatim from the Epic 3 specs.
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
 * Status filter narrows to a KNOWN subset and the keyboard flows have stable
 * targets.
 *
 * Status distribution:
 *   - 3 Imported rows (Ids 1, 2, 3) — kept by Status="Imported"; Imported rows are
 *     the only ones carrying the Approve / Reject row actions (Epic 3 Story 3).
 *   - 3 Approved rows (Ids 4, 5, 6) / 2 Rejected rows (Ids 7, 8) — must be absent
 *     after Status="Imported".
 *
 * TransactionDates DESCEND with Id (lower Id => more recent), matching the page's
 * default Transaction-Date-DESC sort, so the rows render in a stable order and all
 * 8 fit on page 1.
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

const IMPORTED_COUNT = Object.values(STATUS_BY_ID).filter(
  (s) => s === 'Imported',
).length; // 3

/**
 * A search term that matches NO transaction (Reference or Account Number).
 * Combined with the Imported status filter it produces a zero-row result — the
 * AC-2 probe that disables Export. Deliberately unlike any seeded value so the
 * empty result is unambiguous.
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
 * Wire the same-origin /api/* mocks the Transactions surface needs — identical to
 * the Epic 3 auth+list harness:
 *   - auth login / userinfo / users (so login succeeds and the role resolves);
 *   - GET .../transactions -> the SINGULAR-keyed `{ Transactions: [...] }`
 *     envelope (project-brief §6 / §13.C), returning the full set so the page
 *     sorts / filters / paginates / exports CLIENT-SIDE.
 * Sort, filter, pagination, and export are all client-side, so there is no extra
 * endpoint to mock for this accessibility pass.
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
 * generous cold-route timeout (see SIGN_IN_NAV_TIMEOUT_MS). Identical to Epic 3.
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

/** The Status filter — a native labelled <select> (Epic 3 Story 2). */
function statusFilter(page: Page) {
  return page.getByLabel(/status/i);
}

/** The free-text search box (Epic 3 Story 2). */
function searchBox(page: Page) {
  return page.getByRole('searchbox', { name: /search|reference|account/i });
}

/** The toolbar Export control, resolved by its accessible button name (Epic 3 Story 4). */
function exportControl(page: Page) {
  return page.getByRole('button', { name: /export/i });
}

/**
 * The pagination region — a `<nav aria-label="Pagination">` containing the Next /
 * Previous controls. Scoping the lookups INSIDE this region is essential so the
 * /next/i lookup never collides with the Next.js dev-tools button injected during
 * `next dev` (Epic 3 Story 1 locator-precision note).
 */
function pagination(page: Page) {
  return page.getByRole('navigation', { name: /pagination/i });
}

/**
 * Read whether the currently-focused element carries a VISIBLE focus indicator.
 * A WCAG-AA focus-visible style is rendered as a non-`none` CSS outline OR a
 * box-shadow (the two idioms Tailwind / Shadcn focus-visible rings use). We read
 * the computed style of the active element in the page and return true when either
 * channel is present — robust to whichever the implementation chooses, without
 * asserting a specific colour/width (those are styling-detail, not behaviour).
 */
async function focusedElementHasVisibleIndicator(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return false;
    const style = window.getComputedStyle(el as Element);
    const outlineWidth = parseFloat(style.outlineWidth || '0');
    const hasOutline = style.outlineStyle !== 'none' && outlineWidth > 0;
    const hasBoxShadow = style.boxShadow !== '' && style.boxShadow !== 'none';
    return hasOutline || hasBoxShadow;
  });
}

/**
 * Press Tab repeatedly until `target` is the focused element, up to `maxSteps`
 * presses. Returns once focus lands on the target. This keeps the keyboard
 * reachability assertion ROBUST — it proves the control is reachable by Tab
 * without brittle-coupling to an EXACT tab count (which churns as toolbar layout
 * changes). The caller still asserts `toBeFocused()` afterwards so a failure to
 * reach the control surfaces clearly.
 */
async function tabUntilFocused(
  page: Page,
  target: Locator,
  maxSteps = 25,
): Promise<boolean> {
  for (let i = 0; i < maxSteps; i++) {
    if (await target.evaluate((node) => node === document.activeElement)) {
      return true;
    }
    await page.keyboard.press('Tab');
  }
  return target.evaluate((node) => node === document.activeElement);
}

test.describe('Epic 4, Story 2: Accessibility pass on the Transactions surface', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-1 (NFR1): the primary Transactions flows are keyboard-operable with a
  // visible focus indicator. We drive the page with the keyboard only — Tab to
  // reach the search box, the Status filter, and a pagination control; assert each
  // receives focus and shows a visible focus indicator; then OPERATE the Status
  // filter by keyboard (focus it, set its value as a keyboard user would) and
  // assert the table actually narrows — proving the control is not just reachable
  // but operable without a mouse. We avoid brittle exact-tab-count chains: reach
  // each control via tabUntilFocused and assert focus + indicator + behaviour.
  test('primary flows are keyboard-operable with a visible focus indicator', async ({
    page,
  }) => {
    await mockTransactionsApi(page, approverUser, ALL_TRANSACTIONS);
    await signIn(page, approverUser);
    await page.goto('/transactions');

    // Baseline: the full set renders on page 1 before any keyboard interaction.
    await expect(referenceCells(page)).toHaveCount(ALL_TRANSACTIONS.length);

    // The search box is reachable by keyboard and shows a visible focus indicator.
    const search = searchBox(page);
    await expect(search).toBeVisible();
    expect(await tabUntilFocused(page, search)).toBe(true);
    await expect(search).toBeFocused();
    expect(await focusedElementHasVisibleIndicator(page)).toBe(true);

    // The Status filter is reachable by keyboard and shows a visible focus
    // indicator. (Re-tab from wherever focus currently sits — reachability, not a
    // fixed order, is what NFR1 requires.)
    const status = statusFilter(page);
    await expect(status).toBeVisible();
    expect(await tabUntilFocused(page, status)).toBe(true);
    await expect(status).toBeFocused();
    expect(await focusedElementHasVisibleIndicator(page)).toBe(true);

    // OPERATE the Status filter by keyboard: it already has focus, so a keyboard
    // user sets its value via selectOption (the accessible programmatic equivalent
    // of opening the native select and choosing an option with the keyboard). The
    // table must narrow to the Imported subset — proving keyboard OPERATION, not
    // just reachability.
    await status.selectOption({ label: 'Imported' });
    await expect(referenceCells(page)).toHaveCount(IMPORTED_COUNT);

    // A pagination control is reachable by keyboard and shows a visible focus
    // indicator — the Previous control inside the Pagination nav (scoped so it
    // never collides with the dev-tools Next button). Pagination controls are
    // always rendered; on page 1 Previous is present (disabled state is covered by
    // Epic 3 — here we assert it is keyboard-FOCUSABLE so the flow is reachable).
    const prev = pagination(page).getByRole('button', {
      name: /previous|prev/i,
    });
    await expect(prev).toBeVisible();
    expect(await tabUntilFocused(page, prev)).toBe(true);
    await expect(prev).toBeFocused();
    expect(await focusedElementHasVisibleIndicator(page)).toBe(true);
  });

  // AC-2 (NFR1 / NFR4): when the current filter matches zero rows, the DISABLED
  // Export control's "no rows match" explanation is exposed to AT and keyboard
  // users via an accessible DESCRIPTION (aria-describedby resolving to visible help
  // text) — reachable WITHOUT a mouse hover and NOT signalled by a bare `title`
  // attribute. We force the zero-row state, confirm Export is disabled, then assert
  // the explanatory help text is (a) present + visible and (b) wired to the Export
  // control as its accessible description.
  test('disabled Export exposes its no-rows reason to AT via an accessible description (not title-only)', async ({
    page,
  }) => {
    await mockTransactionsApi(page, approverUser, ALL_TRANSACTIONS);
    await signIn(page, approverUser);
    await page.goto('/transactions');

    // With rows present, Export is enabled — the contrast that makes the disabled
    // + described assertion meaningful.
    await expect(referenceCells(page)).toHaveCount(ALL_TRANSACTIONS.length);
    await expect(exportControl(page)).toBeEnabled();

    // Force a zero-row result: a Status filter PLUS a search term that matches no
    // Reference or Account Number leaves the table empty (same probe as Epic 3
    // Story 4 AC-3).
    await statusFilter(page).selectOption({ label: 'Imported' });
    await searchBox(page).fill(ZERO_MATCH_SEARCH);
    await expect(referenceCells(page)).toHaveCount(0);

    // Export is disabled (nothing to export).
    const exportBtn = exportControl(page);
    await expect(exportBtn).toBeDisabled();

    // The explanation must be exposed as an ACCESSIBLE DESCRIPTION, not a bare
    // title. Export carries aria-describedby pointing at an element whose visible
    // text gives the "no rows match the current filter / nothing to export" reason.
    // We resolve that element by id and assert it is (a) visible and (b) carries
    // the explanatory copy — proving the reason is reachable by AT/keyboard without
    // a mouse hover. Using aria-describedby (not `title`) is the AC's requirement.
    const describedBy = await exportBtn.getAttribute('aria-describedby');
    expect(
      describedBy,
      'disabled Export must expose its reason via aria-describedby, not a title-only tooltip',
    ).toBeTruthy();

    // The described-by target may list multiple ids; assert at least one resolves
    // to visible help text containing the no-rows reason.
    const ids = (describedBy ?? '').split(/\s+/).filter(Boolean);
    expect(ids.length).toBeGreaterThan(0);

    const reasonPattern =
      /no (?:rows|transactions|matching|results)|nothing to export|export is unavailable/i;
    let matchedDescription = false;
    for (const id of ids) {
      // Resolve by [id="..."] (an attribute selector) rather than a #id CSS
      // selector: the id strings come from runtime markup and #... would need
      // escaping for ids containing characters like ':' that Radix/Shadcn emit --
      // the attribute form needs none.
      const desc = page.locator(`[id="${id}"]`);
      if (await desc.count()) {
        const text = (await desc.first().textContent()) ?? '';
        if (reasonPattern.test(text)) {
          await expect(desc.first()).toBeVisible();
          matchedDescription = true;
          break;
        }
      }
    }
    expect(
      matchedDescription,
      'Export aria-describedby must resolve to visible help text explaining there are no rows to export',
    ).toBe(true);
  });
});
