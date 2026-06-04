/**
 * Story Metadata:
 * - Route: /files/[id]
 * - Target File: web/src/app/files/[id]/page.tsx
 * - Page Action: modify_existing
 *
 * E2E spec for Epic 2, Story 2: File detail with its transactions and
 * processing banners (R3, BR4).
 *
 * Mocking strategy: project default is `page-route-with-shape-report`
 * (intake-manifest.json -> context.testInfrastructure.playwrightMockingDefault),
 * but no api-shape-report.md exists in this repo yet, so the response bodies are
 * built from the runtime shapes recorded in project-brief.md §6 / §13.C / §13.F
 * and the transactions-api.yaml TransactionRead schema:
 *   - the spec has NO single-FileLog fetch and NO FileLogId filter on
 *     GET /v1/transactions, so the page resolves the FileLog from the file-logs
 *     LIST (GET .../file-logs?IsActive=Yes, singular `{FileLog:[...]}` envelope)
 *     and filters GET .../transactions ({Transactions:[...]}) CLIENT-SIDE by the
 *     `FileLogId` carried on each transaction;
 *   - File Status is derived from `LastExecutedActivityName` / `CurrentStatus`;
 *   - a file id absent from the active-list response is the not-found path (AC-4) —
 *     an inactive file is likewise absent because the list is `?IsActive=Yes`.
 *
 * The /files/[id] surface is auth-gated (RequireSession + HttpOnly session
 * cookie), so each test drives the real login flow first — reusing the same
 * same-origin /api/* auth-mock + login pattern established by Epic 2, Story 1.
 *
 * Alert/announcer note: the App Router injects a permanently-present EMPTY
 * `<div role="alert">` route announcer. This spec never relies on a bare alert
 * selector — assertions target visible copy / headings instead.
 *
 * These tests WILL FAIL until the production detail surface is implemented
 * (current /files/[id]/page.tsx is a navigation placeholder) — TDD red.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { importerUser, type TestUser } from './fixtures/credentials';

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

function fileLog(
  overrides: Partial<MockFileLog> & { Id: number },
): MockFileLog {
  return {
    ProcessDate: '2026-04-15T09:30:00Z',
    SettingId: 7,
    SettingName: 'Daily Bank Import',
    CurrentFileName: `transactions_${overrides.Id}.csv`,
    RecordCount: '2',
    CurrentStatus: 'Completed',
    LastExecutedActivityName: 'Completed',
    IsActive: true,
    HasBulkErrorFile: 'No',
    BulkErrorFile: '',
    ...overrides,
  };
}

function transaction(
  overrides: Partial<MockTransaction> & { Id: number; FileLogId: number },
): MockTransaction {
  return {
    FileName: 'march-payroll.csv',
    Reference: `TXN-20260415-${String(overrides.Id).padStart(4, '0')}`,
    TransactionDate: '2026-04-15 15:00:00',
    AccountNumber: '1234-5678-9012',
    Description: 'Payment for invoice',
    Amount: 1500.5,
    TransactionType: 'D',
    Currency: 'ZAR',
    Status: 'Imported',
    UserNote: '',
    LastChangedUser: 'system',
    LastChangedDate: '2026-04-15T09:30:00Z',
    ...overrides,
  };
}

/** The file under test and its two transactions, plus a sibling file's transaction. */
const TARGET_FILE = fileLog({
  Id: 5001,
  CurrentFileName: 'march-payroll.csv',
  RecordCount: '2',
  CurrentStatus: 'Completed',
  LastExecutedActivityName: 'Completed',
});

const OTHER_FILE = fileLog({
  Id: 5002,
  CurrentFileName: 'april-vendors.csv',
  CurrentStatus: 'Completed',
  LastExecutedActivityName: 'Completed',
});

const ACTIVE_FILE_LOGS: MockFileLog[] = [TARGET_FILE, OTHER_FILE];

const ALL_TRANSACTIONS: MockTransaction[] = [
  transaction({
    Id: 9001,
    FileLogId: TARGET_FILE.Id,
    FileName: TARGET_FILE.CurrentFileName,
    Reference: 'TXN-20260415-0001',
    AccountNumber: '1234-5678-9012',
    Status: 'Imported',
  }),
  transaction({
    Id: 9002,
    FileLogId: TARGET_FILE.Id,
    FileName: TARGET_FILE.CurrentFileName,
    Reference: 'TXN-20260415-0002',
    AccountNumber: '2222-3333-4444',
    Status: 'Approved',
  }),
  // Belongs to a DIFFERENT file — must NOT appear on the target file's detail.
  transaction({
    Id: 9003,
    FileLogId: OTHER_FILE.Id,
    FileName: OTHER_FILE.CurrentFileName,
    Reference: 'TXN-20260415-9999',
    AccountNumber: '9999-9999-9999',
    Status: 'Imported',
  }),
];

/** Build a single User record in the observed PascalCase shape (mirrors Story 1). */
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
 * Wire the same-origin /api/* mocks the file-detail surface needs:
 *   - auth login / userinfo / users (so login succeeds and the role resolves);
 *   - GET .../file-logs -> the singular `{FileLog:[...]}` envelope (the page
 *     resolves the viewed FileLog from this active list — §13.C);
 *   - GET .../transactions -> the `{Transactions:[...]}` envelope (filtered
 *     client-side by FileLogId).
 *
 * @param logs the active file logs the list resolves the viewed file from.
 * @param transactions the full transactions set (client-side filtered by FileLogId).
 */
async function mockFileDetailApi(
  page: Page,
  validUser: TestUser,
  logs: MockFileLog[],
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

  // Transactions FIRST (more specific path) so it isn't shadowed by file-logs.
  await page.route(/\/api\/.*\/transactions(\?.*)?$/i, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ Transactions: transactions }),
    });
  });

  // File Logs: singular `{FileLog:[...]}` envelope (project-brief §6 / §13.C).
  await page.route(/\/api\/.*file-logs(\?.*)?$/i, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ FileLog: logs }),
    });
  });
}

/** Drive the real login form so the session cookie + client marker are established. */
async function signIn(page: Page, user: TestUser): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole('button', { name: /sign in|log in|login/i }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe('Epic 2, Story 2: File detail', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-1: opening a file's detail shows the file's name and File Status badge,
  // plus the read-only list of transactions that belong to THAT file (and only
  // that file — a sibling file's transaction must not leak in).
  test("shows the file's name, status badge, and only its own transactions", async ({
    page,
  }) => {
    await mockFileDetailApi(
      page,
      importerUser,
      ACTIVE_FILE_LOGS,
      ALL_TRANSACTIONS,
    );
    await signIn(page, importerUser);
    await page.goto(`/files/${TARGET_FILE.Id}`);

    // The file's name is surfaced (heading region, not a transactions cell).
    await expect(
      page.getByRole('heading', {
        name: new RegExp(TARGET_FILE.CurrentFileName, 'i'),
      }),
    ).toBeVisible();

    // The derived File Status badge for this Completed file is shown as text.
    await expect(page.getByText(/completed/i).first()).toBeVisible();

    // Both of THIS file's transactions are listed by their references.
    await expect(page.getByText('TXN-20260415-0001')).toBeVisible();
    await expect(page.getByText('TXN-20260415-0002')).toBeVisible();

    // The sibling file's transaction is filtered OUT (client-side by FileLogId).
    await expect(page.getByText('TXN-20260415-9999')).toHaveCount(0);
  });

  // AC-4: navigating to a file id that is absent from the active file-logs list
  // (non-existent OR inactive — the list is ?IsActive=Yes) shows a clear
  // not-found message rather than crashing or rendering an error page.
  test('shows a clear not-found message for a non-existent or inactive file id', async ({
    page,
  }) => {
    await mockFileDetailApi(
      page,
      importerUser,
      ACTIVE_FILE_LOGS,
      ALL_TRANSACTIONS,
    );
    await signIn(page, importerUser);

    const missingId = 999999;
    await page.goto(`/files/${missingId}`);

    // A clear, human not-found message is shown (copy may say "not found" /
    // "doesn't exist" / "no longer active"). Scoped to the heading so the
    // assertion targets a single element — the page also renders an explanatory
    // paragraph, and a bare getByText would match both (strict-mode violation).
    await expect(
      page.getByRole('heading', {
        name: /not found|doesn'?t exist|no longer active|couldn'?t find/i,
      }),
    ).toBeVisible();

    // It is NOT a crash: no transactions table rows render for the missing file.
    await expect(page.getByText(/TXN-20260415-/)).toHaveCount(0);
  });
});
