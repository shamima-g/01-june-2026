/**
 * Story Metadata:
 * - Route: /transactions (and /files)
 * - Target File: web/src/app/transactions/page.tsx (+ web/src/app/files/page.tsx)
 * - Page Action: modify_existing
 *
 * E2E spec for Epic 4, Story 3: responsive table-to-card collapse below 768px
 * (NFR3). Below 768px the File Logs + Transactions tables collapse to a vertical
 * card list (primary identifier + 2-3 key columns + row-action overflow) with no
 * horizontal scroll of a desktop table; at/above 768px the full multi-column
 * table renders as before. Sort/filter/pagination behaviour is preserved in the
 * card layout (its functional coverage lives in the Epic-3 specs; here we verify
 * only the layout-collapse behaviour at real viewport widths).
 *
 * Why Playwright (not Vitest/jsdom): the table-vs-card switch is a CSS-driven
 * responsive behaviour keyed off viewport width. jsdom has no layout engine and
 * reports a fixed 1024px width, so only a real browser viewport can exercise the
 * breakpoint. We assert at clearly-mobile (375px) and clearly-desktop (1280px)
 * widths — 768px itself is the boundary and is deliberately not probed (boundary
 * pixel-exactness is brittle and not what NFR3 promises).
 *
 * Mocking strategy: project default is `page-route-with-shape-report`
 * (intake-manifest.json -> context.testInfrastructure.playwrightMockingDefault),
 * but no api-shape-report.md exists in this repo yet, so the response bodies are
 * built from the runtime shapes already established + carried by the Epic 2 / 3
 * specs (project-brief §6 / §13.C / §13.F):
 *   - GET .../transactions -> SINGULAR-keyed `{ Transactions: [...] }` envelope,
 *     each row carrying Reference / TransactionDate / AccountNumber / Description /
 *     Amount / Currency / TransactionType / Status / FileLogId in PascalCase;
 *   - GET .../file-logs -> PascalCase single-key envelope `{ FileLog: [...] }`,
 *     each row carrying Id / ProcessDate / CurrentFileName / RecordCount /
 *     CurrentStatus / LastExecutedActivityName (requires `?IsActive=Yes`, §13.B).
 *
 * Both surfaces are auth-gated (RequireSession + HttpOnly session cookie), so each
 * test drives the real login flow first — reusing the same same-origin /api/*
 * auth-mock pattern (login -> Set-Cookie session; userinfo / users carry the
 * signed-in user's role). The Approver lands on /transactions; for /files either
 * role works, so the Importer is used (matching the Epic-2 File Logs specs).
 *
 * Alert/announcer note: the App Router injects a permanently-present EMPTY
 * `<div role="alert">` route announcer. This spec never relies on a bare alert
 * selector — assertions target the `table` role (visible vs hidden), the card
 * list (role/accessible-name the developer adds), column headers, and an overflow
 * scroll-width check on the document element.
 *
 * These tests WILL FAIL until the responsive table-to-card collapse is
 * implemented on /transactions and /files — TDD red.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import {
  approverUser,
  importerUser,
  type TestUser,
} from './fixtures/credentials';

/**
 * Post-login navigation must tolerate a `next dev` COLD-ROUTE compile: the first
 * client-side navigation to a freshly-rewritten route triggers a server compile
 * that can exceed the 5s default `toHaveURL` timeout, during which the URL stays
 * on /login until the destination is ready. This is a setup-mechanism wait — it
 * changes only how long a cold compile is tolerated, not what is asserted.
 */
const SIGN_IN_NAV_TIMEOUT_MS = 30_000;

/** Clearly-mobile viewport: below the 768px breakpoint -> card layout expected. */
const MOBILE_VIEWPORT = { width: 375, height: 800 } as const;
/** Clearly-desktop viewport: above the 768px breakpoint -> full table expected. */
const DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const;

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
 * A small set of transactions — enough to render several cards on mobile and
 * several table rows on desktop, with unique zero-padded references so the
 * primary-identifier lookups never collide.
 */
const ALL_TRANSACTIONS: MockTransaction[] = Array.from(
  { length: 6 },
  (_, i) => {
    const id = i + 1;
    return transaction({
      Id: id,
      Reference: `TXN-20260415-${String(id).padStart(4, '0')}`,
      AccountNumber: `1000-0000-${String(id).padStart(4, '0')}`,
      Amount: id * 100,
    });
  },
);

const TXN_FIRST_REF = 'TXN-20260415-0001';

/** A File Log row in the observed PascalCase runtime shape (project-brief §6 / §13.F). */
interface MockFileLog {
  Id: number;
  ProcessDate: string;
  SettingId: number;
  SettingName: string;
  CurrentFileName: string;
  RecordCount: string;
  CurrentStatus: string;
  LastExecutedActivityName: string;
  IsActive: boolean;
  HasBulkErrorFile: string;
  BulkErrorFile: string;
}

function fileLog(
  overrides: Partial<MockFileLog> & { Id: number },
): MockFileLog {
  return {
    ProcessDate: '2026-04-15T09:30:00Z',
    SettingId: 7,
    SettingName: 'Daily Bank Import',
    CurrentFileName: `transactions_${overrides.Id}.csv`,
    RecordCount: '128',
    CurrentStatus: 'Completed',
    LastExecutedActivityName: 'Completed',
    IsActive: true,
    HasBulkErrorFile: 'No',
    BulkErrorFile: '',
    ...overrides,
  };
}

const ACTIVE_FILE_LOGS: MockFileLog[] = [
  fileLog({
    Id: 5001,
    CurrentFileName: 'march-payroll.csv',
    ProcessDate: '2026-04-15T09:30:00Z',
    RecordCount: '128',
    CurrentStatus: 'Completed',
  }),
  fileLog({
    Id: 5002,
    CurrentFileName: 'april-vendors.csv',
    ProcessDate: '2026-04-14T14:05:00Z',
    RecordCount: '42',
    CurrentStatus: 'Processing',
  }),
  fileLog({
    Id: 5003,
    CurrentFileName: 'reconciliation.csv',
    ProcessDate: '2026-04-13T11:20:00Z',
    RecordCount: '9',
    CurrentStatus: 'Failed',
  }),
];

const FILE_LOG_FILE_NAME = 'march-payroll.csv';

/** Build a single User record in the observed PascalCase shape (mirrors Epic 2 / 3). */
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
 * Wire the same-origin /api/* auth mocks (login / userinfo / users) so the real
 * login flow succeeds and the role resolves. Shared by both surfaces.
 */
async function mockAuth(
  page: Page,
  validUser: TestUser,
  getSignedIn: () => TestUser | null,
  setSignedIn: (u: TestUser | null) => void,
): Promise<void> {
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
      setSignedIn(validUser);
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
    const signedIn = getSignedIn();
    await route.fulfill({
      status: signedIn ? 200 : 401,
      contentType: 'application/json',
      body: signedIn ? JSON.stringify(userRecord(signedIn)) : '{}',
    });
  });

  await page.route(/\/api\/.*\/users(\?.*)?$/i, async (route: Route) => {
    const signedIn = getSignedIn();
    await route.fulfill({
      status: signedIn ? 200 : 401,
      contentType: 'application/json',
      body: signedIn ? JSON.stringify({ Users: [userRecord(signedIn)] }) : '{}',
    });
  });
}

/** Wire auth + the Transactions endpoint (`{ Transactions: [...] }` envelope). */
async function mockTransactionsApi(
  page: Page,
  validUser: TestUser,
  transactions: MockTransaction[],
): Promise<void> {
  let signedIn: TestUser | null = null;
  await mockAuth(
    page,
    validUser,
    () => signedIn,
    (u) => {
      signedIn = u;
    },
  );

  await page.route(/\/api\/.*\/transactions(\?.*)?$/i, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ Transactions: transactions }),
    });
  });
}

/** Wire auth + the File Logs endpoint (`{ FileLog: [...] }` envelope). */
async function mockFilesApi(
  page: Page,
  validUser: TestUser,
  logs: MockFileLog[],
): Promise<void> {
  let signedIn: TestUser | null = null;
  await mockAuth(
    page,
    validUser,
    () => signedIn,
    (u) => {
      signedIn = u;
    },
  );

  await page.route(/\/api\/.*file-logs(\?.*)?$/i, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ FileLog: logs }),
    });
  });
}

/**
 * Drive the real login form so the session cookie + client marker are
 * established, then wait (with cold-compile headroom) for the navigation to
 * leave /login.
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
 * Assert the document has no horizontal overflow at the current viewport width —
 * i.e. nothing (such as a wide desktop table) is forcing a horizontal scrollbar
 * on mobile. A 1px tolerance absorbs sub-pixel rounding. This is the concrete
 * form of NFR3's "desktop tables are not horizontally scrolled on mobile".
 */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const el = document.documentElement;
        return el.scrollWidth - el.clientWidth;
      }),
    )
    .toBeLessThanOrEqual(1);
}

/**
 * The responsive card list the developer adds for the below-768px layout. Accept
 * either a named list landmark (`role="list"` with an accessible name) or a
 * stable test id — whichever the developer wires — so the assertion binds to the
 * card surface without over-specifying its markup.
 */
function cardList(page: Page, label: RegExp) {
  return page
    .getByRole('list', { name: label })
    .or(page.getByTestId(/card-list/i));
}

test.describe('Epic 4, Story 3: responsive table-to-card collapse (NFR3)', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-1 (NFR3): below 768px the Transactions table collapses to a vertical card
  // list — each card shows the primary identifier (Reference) plus key fields and
  // a row-action overflow affordance — and the desktop multi-column table is NOT
  // rendered, so nothing forces a horizontal scroll of a wide table.
  test('Transactions collapses to a card list with no horizontal scroll below 768px', async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await mockTransactionsApi(page, approverUser, ALL_TRANSACTIONS);
    await signIn(page, approverUser);
    await page.goto('/transactions');

    // The card layout is the active layout: the primary identifier renders inside
    // the card list, and a row-action overflow affordance is present per card.
    const cards = cardList(page, /transaction/i);
    await expect(cards).toBeVisible();
    await expect(cards.getByText(TXN_FIRST_REF)).toBeVisible();
    await expect(
      cards.getByRole('button', { name: /actions|more|options/i }).first(),
    ).toBeVisible();

    // The desktop multi-column data table is NOT the active layout at mobile width
    // (it is removed from the layout / not visible — not merely scrolled).
    await expect(page.getByRole('table')).toBeHidden();

    // No horizontal overflow: a wide desktop table is not forcing a scrollbar.
    await expectNoHorizontalOverflow(page);
  });

  // AC-2 (NFR3): at/above 768px the full multi-column Transactions table renders
  // as before — the column headers are visible and the mobile card list is not the
  // active layout.
  test('Transactions renders the full multi-column table at/above 768px', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await mockTransactionsApi(page, approverUser, ALL_TRANSACTIONS);
    await signIn(page, approverUser);
    await page.goto('/transactions');

    // The full table renders with its multi-column headers (R4 / Epic-3 columns).
    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    await expect(
      table.getByRole('columnheader', { name: /reference/i }),
    ).toBeVisible();
    await expect(
      table.getByRole('columnheader', { name: /amount/i }),
    ).toBeVisible();
    await expect(
      table.getByRole('columnheader', { name: /status/i }),
    ).toBeVisible();

    // The first transaction surfaces as a table row at desktop width.
    await expect(
      table.getByRole('cell', { name: TXN_FIRST_REF }),
    ).toBeVisible();

    // The mobile card list is not the active layout at desktop width.
    await expect(cardList(page, /transaction/i)).toBeHidden();
  });

  // AC-3 (NFR3): the File Logs table applies the same collapse — a card list with
  // no horizontal scroll below 768px, and the full multi-column table at/above
  // 768px. Either role may view /files; the Importer is used (matching Epic 2).
  test('File Logs collapses to cards below 768px and renders the full table at/above 768px', async ({
    page,
  }) => {
    await mockFilesApi(page, importerUser, ACTIVE_FILE_LOGS);
    await signIn(page, importerUser);

    // --- Below 768px: card layout, no desktop table, no horizontal overflow. ---
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/files');

    const cards = cardList(page, /file/i);
    await expect(cards).toBeVisible();
    await expect(cards.getByText(FILE_LOG_FILE_NAME)).toBeVisible();
    await expect(page.getByRole('table')).toBeHidden();
    await expectNoHorizontalOverflow(page);

    // --- At/above 768px: the full multi-column table renders, cards inactive. ---
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/files');

    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    await expect(
      table.getByRole('columnheader', { name: /file name/i }),
    ).toBeVisible();
    await expect(
      table.getByRole('columnheader', { name: /file status|status/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('row', { name: new RegExp(FILE_LOG_FILE_NAME, 'i') }),
    ).toBeVisible();
    await expect(cardList(page, /file/i)).toBeHidden();
  });
});
