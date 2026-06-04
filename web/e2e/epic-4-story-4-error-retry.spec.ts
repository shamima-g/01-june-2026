/**
 * Story Metadata:
 * - Route: /files/[id]
 * - Target File: web/src/app/files/[id]/page.tsx
 * - Page Action: modify_existing
 *
 * E2E spec for Epic 4, Story 4: Consistent error + retry UX across async actions
 * (NFR5 — user-visible error states with a retry affordance for every async
 * operation; the story summary tags it NFR8 in the planner metadata, but the
 * driving requirement is the NFR5 error-UX guarantee).
 *
 * This story closes the Epic-2 Story-5 GAP: today, when a file cancellation
 * DELETE fails, `handleConfirmCancel` swallows the error and silently closes the
 * confirmation dialog (web/src/app/files/[id]/page.tsx — the catch branch only
 * calls `setCancelDialogOpen(false)`), leaving the Importer with no feedback and
 * the file still in place. After this story a failed cancel must surface an
 * ASSERTIVE on-page error explaining the failure AND offer a retry affordance,
 * without navigating away from the file-detail surface.
 *
 * Mocking strategy: project default is `page-route-with-shape-report`
 * (intake-manifest.json -> context.testInfrastructure.playwrightMockingDefault),
 * but no api-shape-report.md exists in this repo yet, so the response bodies are
 * built from the runtime shapes recorded in project-brief.md §6 / §13.C / §13.F
 * and reuse the PascalCase fixtures + the EXACT same-origin /api/* auth + file
 * detail mocks established by Epic 2, Story 5 (web/e2e/epic-2-story-5-cancel-
 * file.spec.ts). The only deviation is the DELETE handler: this spec drives it
 * down BOTH branches — a 500 failure (AC-1 error+retry path) and a stateful 200
 * success (the positive contrast). Documented here because it intentionally
 * departs from Story 5's always-succeed DELETE.
 *
 * The /files/[id] surface is auth-gated (RequireSession + HttpOnly session
 * cookie) AND role-aware, so each test drives the real login flow first — signing
 * in as the Importer so the Cancel control renders (BR10; the Approver never sees
 * it). The file under view is a Completed file whose transaction slice has NO
 * Approved transactions, so the BR7 guard does not fire and Cancel is offered.
 *
 * Route-matching note (lifted from Story 5): the Cancel DELETE targets
 * `.../files?LogId=` which would be shadowed by the broader `.../file-logs` GET
 * matcher if registered after it. The DELETE-on-`/files` route is therefore
 * registered BEFORE `file-logs`, and is method-scoped (DELETE only) so the GET
 * paths fall through to their own handlers.
 *
 * Alert/announcer note: the App Router injects a permanently-present EMPTY
 * `<div role="alert">` route announcer, so a bare `getByRole('alert')` is
 * ambiguous. Every assertion here targets the error's VISIBLE copy or a NAMED
 * retry control instead of a bare alert selector.
 *
 * These tests WILL FAIL until the consistent error+retry UX is implemented on the
 * Cancel flow — TDD red.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { importerUser, type TestUser } from './fixtures/credentials';

/**
 * Post-login navigation can exceed the 5s default `toHaveURL` timeout while
 * `next dev` compiles the destination route on its first hit. This is a
 * setup-mechanism wait, not a behavioural assertion. Lifted verbatim from the
 * Epic 3 / Epic 4 specs.
 */
const SIGN_IN_NAV_TIMEOUT_MS = 30_000;

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
 * sibling file lets the success path prove the active list still renders OTHER
 * files after the cancelled file drops out.
 */
const TARGET_FILE = fileLog({
  Id: 5240,
  CurrentFileName: 'error-retry-import-2026-04-15.csv',
  RecordCount: '2',
  CurrentStatus: 'Completed',
  LastExecutedActivityName: 'Completed',
});

const SIBLING_FILE = fileLog({
  Id: 5241,
  CurrentFileName: 'unrelated-import-2026-04-16.csv',
  CurrentStatus: 'Completed',
  LastExecutedActivityName: 'Completed',
});

/** Only `Imported`/`Rejected` statuses — NOTHING is `Approved`, so Cancel is allowed. */
const TARGET_TRANSACTIONS: MockTransaction[] = [
  transaction({
    Id: 9201,
    FileLogId: TARGET_FILE.Id,
    FileName: TARGET_FILE.CurrentFileName,
    Reference: 'TXN-20260415-0001',
    AccountNumber: '1234-5678-9012',
    Status: 'Imported',
  }),
  transaction({
    Id: 9202,
    FileLogId: TARGET_FILE.Id,
    FileName: TARGET_FILE.CurrentFileName,
    Reference: 'TXN-20260415-0002',
    AccountNumber: '2222-3333-4444',
    Status: 'Rejected',
  }),
];

/** Build a single User record in the observed PascalCase shape (mirrors Story 5). */
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

/** How the DELETE .../files?LogId= mock should behave for a given test. */
type DeleteMode = 'fail-500' | 'success';

/**
 * Wire the same-origin /api/* mocks the Cancel-File surface needs — identical to
 * Epic 2, Story 5 EXCEPT the DELETE handler is parameterised:
 *   - `fail-500`: the DELETE returns 500 (DefaultResponse-shaped error) and does
 *     NOT flip the stateful active-list flag, so the file remains in place. This
 *     drives the AC-1 error+retry path. The handler counts how many DELETEs fire
 *     so a retry can be proven to re-attempt the mutation.
 *   - `success`: the DELETE returns 200 and flips the stateful flag so the
 *     subsequent GET .../file-logs?IsActive=Yes omits the cancelled file (the
 *     positive contrast — reuses Story 5's stateful-flag approach).
 *
 * The DELETE-on-`/files` route is registered BEFORE the `file-logs` GET matcher
 * so the more-specific `?LogId=` delete is matched first; it is method-scoped to
 * DELETE so GETs fall through.
 *
 * @returns helpers to read how many cancel DELETEs fired and which LogId the last
 *   one carried.
 */
function mockCancelFileApi(
  page: Page,
  validUser: TestUser,
  deleteMode: DeleteMode,
) {
  let signedIn: TestUser | null = null;
  let cancelled = false;
  let deleteCount = 0;
  let lastDeleteLogId: string | null = null;

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
        deleteCount += 1;
        const url = new URL(request.url());
        lastDeleteLogId =
          url.searchParams.get('LogId') ?? url.searchParams.get('logId');

        if (deleteMode === 'fail-500') {
          // The mutation fails — the file stays active (no flag flip).
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({
              Id: TARGET_FILE.Id,
              MessageType: 'Error',
              Messages: ['Unable to cancel the file. Please try again.'],
            }),
          });
          return;
        }

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
      // a SUCCESSFUL DELETE has flipped the stateful flag (the ?IsActive=Yes list
      // drops it). A failed DELETE leaves the list unchanged.
      await page.route(/\/api\/.*file-logs(\?.*)?$/i, async (route: Route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ FileLog: activeLogs() }),
        });
      });
    },
    deleteCount: (): number => deleteCount,
    deletedLogId: (): string | null => lastDeleteLogId,
  };
}

/**
 * Drive the real login form so the session cookie + client marker are
 * established, then wait for the post-login navigation to leave /login using the
 * generous cold-route timeout (see SIGN_IN_NAV_TIMEOUT_MS).
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

/** The Importer-only Cancel control on the file-detail surface. */
function cancelControl(page: Page) {
  return page.getByRole('button', { name: /^cancel file$|^cancel$/i });
}

/** Open the cancel confirmation dialog and confirm the destructive action. */
async function openAndConfirmCancel(page: Page): Promise<void> {
  await expect(cancelControl(page)).toBeVisible();
  await cancelControl(page).click();

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
}

test.describe('Epic 4, Story 4: Consistent error + retry UX across async actions', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-1 (NFR5): when a file cancellation FAILS, an assertive error explains the
  // failure and offers a retry — instead of the dialog closing silently. The
  // Importer stays on /files/[id] (NOT navigated to /files) and a retry affordance
  // re-attempts the cancel (a second DELETE fires).
  test('a failed cancellation shows an assertive error + retry instead of closing silently', async ({
    page,
  }) => {
    const api = mockCancelFileApi(page, importerUser, 'fail-500');
    await api.wire();
    await signIn(page, importerUser);
    await page.goto(`/files/${TARGET_FILE.Id}`);

    // We're on the right detail surface (the file's transactions render).
    await expect(page.getByText('TXN-20260415-0001')).toBeVisible();

    await openAndConfirmCancel(page);

    // The DELETE fired against the viewed file and FAILED.
    await expect.poll(() => api.deleteCount()).toBe(1);
    expect(api.deletedLogId()).toBe(String(TARGET_FILE.Id));

    // An ASSERTIVE, user-visible error explains the failure. We scope to the
    // error's visible copy (NOT a bare role="alert", which the App Router's empty
    // route announcer also matches) — the failure message references the cancel.
    const cancelError = page.getByText(
      /(couldn'?t|could not|unable to|failed to).*(cancel|cancellation)|(cancel|cancellation).*(failed|didn'?t|did not)/i,
    );
    await expect(cancelError).toBeVisible();

    // The dialog did NOT silently close into a navigation — we are STILL on the
    // file-detail surface, not bounced to the /files list.
    await expect(page).toHaveURL(new RegExp(`/files/${TARGET_FILE.Id}`));
    await expect(page).not.toHaveURL(/\/files\/?$/);

    // A retry affordance is present and re-attempts the cancel: clicking it fires
    // a SECOND DELETE.
    const retry = page.getByRole('button', { name: /retry|try again/i });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect.poll(() => api.deleteCount()).toBe(2);
  });

  // AC-1 (positive contrast): a SUCCESSFUL cancel still works end-to-end — the
  // file is deactivated and the Importer returns to /files with the file gone,
  // confirming the error path is additive and doesn't break the happy path (reuses
  // Epic 2, Story 5's stateful-flag success pattern).
  test('a successful cancellation still deactivates the file and returns to /files', async ({
    page,
  }) => {
    const api = mockCancelFileApi(page, importerUser, 'success');
    await api.wire();
    await signIn(page, importerUser);
    await page.goto(`/files/${TARGET_FILE.Id}`);

    await expect(page.getByText('TXN-20260415-0001')).toBeVisible();

    await openAndConfirmCancel(page);

    // The DELETE fired once with the viewed file's LogId and succeeded.
    await expect.poll(() => api.deleteCount()).toBe(1);
    expect(api.deletedLogId()).toBe(String(TARGET_FILE.Id));

    // We land back on the /files list, and the cancelled file is gone while the
    // untouched sibling remains.
    await expect(page).toHaveURL(/\/files\/?$/);
    await expect(page.getByText(SIBLING_FILE.CurrentFileName)).toBeVisible();
    await expect(page.getByText(TARGET_FILE.CurrentFileName)).toHaveCount(0);
  });
});
