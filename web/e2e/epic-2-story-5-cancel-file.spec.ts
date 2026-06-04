/**
 * Story Metadata:
 * - Route: /files/[id]
 * - Target File: web/src/app/files/[id]/page.tsx
 * - Page Action: modify_existing
 *
 * E2E spec for Epic 2, Story 5: Cancel a file with the approved-transaction
 * guard (R12, BR7).
 *
 * Mocking strategy: project default is `page-route-with-shape-report`
 * (intake-manifest.json -> context.testInfrastructure.playwrightMockingDefault),
 * but no api-shape-report.md exists in this repo yet, so the response bodies are
 * built from the runtime shapes recorded in project-brief.md §6 / §13.C / §13.F
 * and reuse the PascalCase fixtures established by Epic 2, Stories 1-4:
 *   - The file detail still resolves its FileLog from the file-logs LIST
 *     (GET .../file-logs?IsActive=Yes, singular `{FileLog:[...]}` envelope) and
 *     filters GET .../transactions ({Transactions:[...]}) CLIENT-SIDE by the
 *     `FileLogId` carried on each transaction — same as Story 2.
 *   - The Cancel mutation is `DELETE /api/transactions/v1/files?LogId=<id>` with
 *     a `LastChangedUser` header (project-brief §9 Cancel File, R12). It returns a
 *     DefaultResponse-shaped body; success = 200. The destructive-confirmation
 *     dialog's default-focus + styling is owned by the Vitest sibling (AC-2), and
 *     the approved-guard BANNER copy is owned by the Vitest sibling (AC-4) — this
 *     spec covers only the PLAYWRIGHT-tagged behaviours AC-1 and AC-3.
 *
 * The /files/[id] surface is auth-gated (RequireSession + HttpOnly session
 * cookie) AND role-aware, so each test drives the real login flow first — reusing
 * the same same-origin /api/* auth-mock + login pattern from Stories 1-4 (login ->
 * Set-Cookie session, userinfo / users carry the signed-in user's role).
 *
 * Role matters for AC-1 (BR10): an Importer sees a Cancel control on a file with
 * no Approved transactions; the SAME control is ABSENT for an Approver.
 *
 * Route-matching note: the Cancel DELETE targets `.../files?LogId=` which would be
 * shadowed by the broader `.../file-logs` GET matcher if registered after it. The
 * DELETE-on-`/files` route is therefore registered BEFORE `file-logs`, and is
 * method-scoped (DELETE only) so the GET paths fall through to their own handlers.
 *
 * Alert/announcer note: the App Router injects a permanently-present EMPTY
 * `<div role="alert">` route announcer. This spec never relies on a bare alert
 * selector — assertions target visible copy / headings / named controls / the
 * dialog role instead.
 *
 * These tests WILL FAIL until the Cancel-File control + confirmation flow is
 * implemented on /files/[id] — TDD red.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import {
  importerUser,
  approverUser,
  type TestUser,
} from './fixtures/credentials';

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
    FileName: 'cancellable-import.csv',
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

/**
 * The file under view: a Completed file whose transaction slice has NO Approved
 * transactions, so Cancel is offered (BR7 not triggered). A second, untouched
 * sibling file lets AC-3 prove the active list still renders OTHER files after the
 * cancelled file drops out.
 */
const TARGET_FILE = fileLog({
  Id: 5040,
  CurrentFileName: 'cancellable-import-2026-04-15.csv',
  RecordCount: '2',
  CurrentStatus: 'Completed',
  LastExecutedActivityName: 'Completed',
});

const SIBLING_FILE = fileLog({
  Id: 5041,
  CurrentFileName: 'unrelated-import-2026-04-16.csv',
  CurrentStatus: 'Completed',
  LastExecutedActivityName: 'Completed',
});

/** Only `Imported`/`Rejected` statuses — NOTHING is `Approved`, so Cancel is allowed. */
const TARGET_TRANSACTIONS: MockTransaction[] = [
  transaction({
    Id: 9101,
    FileLogId: TARGET_FILE.Id,
    FileName: TARGET_FILE.CurrentFileName,
    Reference: 'TXN-20260415-0001',
    AccountNumber: '1234-5678-9012',
    Status: 'Imported',
  }),
  transaction({
    Id: 9102,
    FileLogId: TARGET_FILE.Id,
    FileName: TARGET_FILE.CurrentFileName,
    Reference: 'TXN-20260415-0002',
    AccountNumber: '2222-3333-4444',
    Status: 'Rejected',
  }),
];

/** Build a single User record in the observed PascalCase shape (mirrors Stories 1-4). */
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
 * Wire the same-origin /api/* mocks the Cancel-File surface needs:
 *   - auth login / userinfo / users (so login succeeds and the role resolves);
 *   - DELETE .../files?LogId= -> 200 DefaultResponse; flips a STATEFUL flag so the
 *     subsequent GET .../file-logs no longer returns the cancelled file (the
 *     backend deactivates it; the ?IsActive=Yes list therefore omits it — §9);
 *   - GET .../transactions -> `{Transactions:[...]}` (filtered client-side by
 *     FileLogId);
 *   - GET .../file-logs -> singular `{FileLog:[...]}`, with the cancelled file
 *     removed once the DELETE has run.
 *
 * The DELETE-on-`/files` route is registered BEFORE the `file-logs` GET matcher so
 * the more-specific `?LogId=` delete is matched first and not shadowed by the
 * broader `file-logs` path; it is method-scoped to DELETE so GETs fall through.
 *
 * @returns helpers to read whether the cancel DELETE fired and which LogId/header
 *   it carried, so AC-3 can assert the mutation contract.
 */
function mockCancelFileApi(page: Page, validUser: TestUser) {
  let signedIn: TestUser | null = null;
  let cancelled = false;
  let lastDeleteLogId: string | null = null;
  let lastDeleteChangedUser: string | null = null;

  const activeLogs = (): MockFileLog[] =>
    cancelled ? [SIBLING_FILE] : [TARGET_FILE, SIBLING_FILE];

  return {
    wire: async (): Promise<void> => {
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
          body: signedIn
            ? JSON.stringify({ Users: [userRecord(signedIn)] })
            : '{}',
        });
      });

      // Cancel DELETE on `.../files?LogId=` — registered BEFORE file-logs and
      // method-scoped to DELETE so the GET list/detail paths fall through.
      await page.route(/\/api\/.*\/files(\?.*)?$/i, async (route: Route) => {
        const request = route.request();
        if (request.method() !== 'DELETE') {
          await route.fallback();
          return;
        }
        const url = new URL(request.url());
        lastDeleteLogId =
          url.searchParams.get('LogId') ?? url.searchParams.get('logId');
        lastDeleteChangedUser =
          request.headers()['lastchangeduser'] ??
          request.headers()['LastChangedUser'] ??
          null;
        cancelled = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            Id: TARGET_FILE.Id,
            MessageType: 'Success',
            Messages: ['File cancelled.'],
          }),
        });
      });

      // Transactions: client-side filtered by FileLogId; none are Approved.
      await page.route(
        /\/api\/.*\/transactions(\?.*)?$/i,
        async (route: Route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ Transactions: TARGET_TRANSACTIONS }),
          });
        },
      );

      // File Logs: singular `{FileLog:[...]}`; the cancelled file is omitted once
      // the DELETE has flipped the stateful flag (the ?IsActive=Yes list drops it).
      await page.route(/\/api\/.*file-logs(\?.*)?$/i, async (route: Route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ FileLog: activeLogs() }),
        });
      });
    },
    deleteFired: (): boolean => cancelled,
    deletedLogId: (): string | null => lastDeleteLogId,
    deleteChangedUser: (): string | null => lastDeleteChangedUser,
  };
}

/** Drive the real login form so the session cookie + client marker are established. */
async function signIn(page: Page, user: TestUser): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole('button', { name: /sign in|log in|login/i }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** The Importer-only Cancel control on the file-detail surface. */
function cancelControl(page: Page) {
  return page.getByRole('button', { name: /^cancel file$|^cancel$/i });
}

test.describe('Epic 2, Story 5: Cancel a file with the approved-transaction guard', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-1 (R12, BR10): an Importer sees a Cancel control on a file that has NO
  // Approved transactions; the SAME control is ABSENT for an Approver.
  test('Importer sees the Cancel control on a non-approved file; Approver does not', async ({
    page,
  }) => {
    // Importer: the Cancel control is present and actionable.
    const importerApi = mockCancelFileApi(page, importerUser);
    await importerApi.wire();
    await signIn(page, importerUser);
    await page.goto(`/files/${TARGET_FILE.Id}`);

    // The file's transactions render (proving we're on the right detail surface).
    await expect(page.getByText('TXN-20260415-0001')).toBeVisible();
    await expect(cancelControl(page)).toBeVisible();
    await expect(cancelControl(page)).toBeEnabled();

    // Approver (fresh session): the SAME detail surface shows NO Cancel control.
    await page.context().clearCookies();
    const approverApi = mockCancelFileApi(page, approverUser);
    await approverApi.wire();
    await signIn(page, approverUser);
    await page.goto(`/files/${TARGET_FILE.Id}`);

    // The Approver still sees the file's transactions (read-only view) ...
    await expect(page.getByText('TXN-20260415-0001')).toBeVisible();
    // ... but the Cancel control is absent (Importer-only — BR10).
    await expect(cancelControl(page)).toHaveCount(0);
  });

  // AC-3 (R12): confirming the cancel sends DELETE .../files?LogId=<id> (with the
  // LastChangedUser header) and deactivates the file, so it no longer appears in
  // the active File Logs list when the Importer returns to /files.
  test('confirming the cancel deactivates the file so it leaves the active File Logs list', async ({
    page,
  }) => {
    const api = mockCancelFileApi(page, importerUser);
    await api.wire();
    await signIn(page, importerUser);
    await page.goto(`/files/${TARGET_FILE.Id}`);

    await expect(cancelControl(page)).toBeVisible();
    await cancelControl(page).click();

    // The destructive-confirmation dialog appears, naming the file. (The dialog's
    // default-focus + destructive styling are asserted by the Vitest sibling, AC-2;
    // here we only need to confirm through it to drive the DELETE.)
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(new RegExp(TARGET_FILE.CurrentFileName, 'i')),
    ).toBeVisible();

    // Confirm the destructive primary action inside the dialog.
    await dialog
      .getByRole('button', {
        name: /cancel file|confirm|yes,? cancel|deactivate/i,
      })
      .click();

    // The DELETE fired with the viewed file's LogId and the audit header.
    await expect.poll(() => api.deleteFired()).toBe(true);
    expect(api.deletedLogId()).toBe(String(TARGET_FILE.Id));
    expect(api.deleteChangedUser()).toBeTruthy();

    // The cancelled file is gone from the active File Logs list, while the
    // untouched sibling file remains.
    await page.goto('/files');
    await expect(page.getByText(SIBLING_FILE.CurrentFileName)).toBeVisible();
    await expect(page.getByText(TARGET_FILE.CurrentFileName)).toHaveCount(0);
  });
});
