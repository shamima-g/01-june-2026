/**
 * Story Metadata:
 * - Route: /files/[id]
 * - Target File: web/src/app/files/[id]/page.tsx
 * - Page Action: modify_existing
 *
 * E2E spec for Epic 2, Story 4: Retry validation and review validation errors
 * on a Failed file (R11, R13, BR5).
 *
 * Mocking strategy: project default is `page-route-with-shape-report`
 * (intake-manifest.json -> context.testInfrastructure.playwrightMockingDefault),
 * but no api-shape-report.md exists in this repo yet, so the response bodies are
 * built from documentation/transactions-api.yaml + the PascalCase runtime shapes
 * established by Epic 2, Stories 1-3:
 *   - The file detail still resolves its FileLog from the file-logs LIST
 *     (GET .../file-logs?IsActive=Yes, singular `{FileLog:[...]}` envelope) and
 *     filters GET .../transactions ({Transactions:[...]}) CLIENT-SIDE — same as
 *     Story 2. For this story the viewed file's derived status is `Failed`
 *     (LastExecutedActivityName / CurrentStatus = 'Failed').
 *   - GET .../files/validation-errors?FileLogId= -> a NESTED envelope
 *     `{ ValidationErrors: { JsonArray: "<stringified JSON array>" } }`
 *     (transactions-api ValidationErrors schema). JsonArray is a STRING the page
 *     must JSON.parse to recover the per-row objects — the fixture below keeps it
 *     stringified so the test proves the page unwraps it, not the fixture.
 *   - GET .../files/validation-errors/columns?FileLogId= -> `{ ColumnList: [...] }`
 *     where each entry is a ColumnDefinition ({Name, HeaderText, Visible,
 *     CellAlignment, CellDisplay, Classes}). `HeaderText` is the VISIBLE heading;
 *     `Name` keys into each row object; a `Visible:false` column must NOT render.
 *   - POST .../files/retry-validation?LogId= -> 200 DefaultResponse on success
 *     (the retry-reprocessing path itself is owned by the Vitest sibling, AC-3).
 *
 * The /files/[id] surface is auth-gated (RequireSession + HttpOnly session
 * cookie) AND role-aware, so each test drives the real login flow first — reusing
 * the same same-origin /api/* auth-mock + login pattern from Stories 1-3 (login ->
 * Set-Cookie session, userinfo / users carry the signed-in user's role).
 *
 * Role matters for AC-2 (BR5): an Importer sees a Retry Validation control on the
 * Failed file; an Approver sees the SAME validation-error rows read-only with NO
 * retry control.
 *
 * Alert/announcer note: the App Router injects a permanently-present EMPTY
 * `<div role="alert">` route announcer. This spec never relies on a bare alert
 * selector — assertions target visible copy / headings / named controls instead.
 *
 * These tests WILL FAIL until the Failed-file validation-errors surface is
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

/** A ColumnDefinition in the observed shape (transactions-api ColumnDefinition). */
interface MockColumn {
  Name: string;
  HeaderText: string;
  Visible: boolean;
  CellAlignment: string;
  CellDisplay: string;
  Classes: string;
}

function fileLog(
  overrides: Partial<MockFileLog> & { Id: number },
): MockFileLog {
  return {
    ProcessDate: '2026-04-15T09:30:00Z',
    SettingId: 7,
    SettingName: 'Daily Bank Import',
    CurrentFileName: `transactions_${overrides.Id}.csv`,
    RecordCount: '3',
    CurrentStatus: 'Failed',
    LastExecutedActivityName: 'Failed',
    IsActive: true,
    HasBulkErrorFile: 'Yes',
    BulkErrorFile: 'errors.csv',
    ...overrides,
  };
}

/** The Failed file under view. */
const FAILED_FILE = fileLog({
  Id: 5040,
  CurrentFileName: 'failed-import-2026-04-15.csv',
  RecordCount: '3',
  CurrentStatus: 'Failed',
  LastExecutedActivityName: 'Failed',
});

const ACTIVE_FILE_LOGS: MockFileLog[] = [FAILED_FILE];

/**
 * Column metadata the backend supplies for this file. `HeaderText` is the heading
 * the table renders; `Name` keys into each error row. The `Notes` column is
 * `Visible:false` so a test can prove a hidden column's HEADER does not render.
 */
const VALIDATION_COLUMNS: MockColumn[] = [
  {
    Name: 'Reference',
    HeaderText: 'Transaction Reference',
    Visible: true,
    CellAlignment: 'left',
    CellDisplay: 'text',
    Classes: 'col-ref',
  },
  {
    Name: 'Amount',
    HeaderText: 'Amount (ZAR)',
    Visible: true,
    CellAlignment: 'right',
    CellDisplay: 'number',
    Classes: 'col-amount',
  },
  {
    Name: 'ErrorMessage',
    HeaderText: 'Validation Error',
    Visible: true,
    CellAlignment: 'left',
    CellDisplay: 'text',
    Classes: 'col-error',
  },
  {
    Name: 'Notes',
    HeaderText: 'Internal Notes',
    Visible: false,
    CellAlignment: 'left',
    CellDisplay: 'text',
    Classes: 'col-notes',
  },
];

/** The per-row invalid-row objects — keyed by the column `Name`s above. */
const VALIDATION_ROWS = [
  {
    Reference: 'TXN-ERR-0001',
    Amount: '1500.00',
    ErrorMessage: 'Amount exceeds the daily limit',
    Notes: 'flagged by rule R-12',
  },
  {
    Reference: 'TXN-ERR-0002',
    Amount: 'not-a-number',
    ErrorMessage: 'Amount is not a valid number',
    Notes: 'parse failure',
  },
];

/** Build a single User record in the observed PascalCase shape (mirrors Stories 1-3). */
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
 * Wire the same-origin /api/* mocks the Failed-file detail surface needs:
 *   - auth login / userinfo / users (so login succeeds and the role resolves);
 *   - GET .../file-logs -> singular `{FileLog:[...]}` (the page resolves the
 *     viewed Failed file from this active list — §13.C);
 *   - GET .../transactions -> `{Transactions:[...]}` (empty for a Failed file —
 *     no transactions were imported);
 *   - GET .../files/validation-errors/columns -> `{ ColumnList:[...] }`;
 *   - GET .../files/validation-errors -> `{ ValidationErrors:{ JsonArray:"..." } }`
 *     with JsonArray STRINGIFIED (the page must JSON.parse it);
 *   - POST .../files/retry-validation -> 200 DefaultResponse.
 *
 * The columns route is registered BEFORE the bare validation-errors route so the
 * more-specific `/validation-errors/columns` path is matched first and not
 * shadowed by the `/validation-errors` matcher.
 */
async function mockFailedFileApi(
  page: Page,
  validUser: TestUser,
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

  // Validation-error COLUMNS (most specific path) — register first.
  await page.route(
    /\/api\/.*files\/validation-errors\/columns(\?.*)?$/i,
    async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ColumnList: VALIDATION_COLUMNS }),
      });
    },
  );

  // Validation-error ROWS — nested envelope, JsonArray is a STRING (unwrapped by page).
  await page.route(
    /\/api\/.*files\/validation-errors(\?.*)?$/i,
    async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ValidationErrors: { JsonArray: JSON.stringify(VALIDATION_ROWS) },
        }),
      });
    },
  );

  // Retry validation -> 200 DefaultResponse (re-processing path owned by Vitest sibling).
  await page.route(
    /\/api\/.*files\/retry-validation(\?.*)?$/i,
    async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          Id: FAILED_FILE.Id,
          MessageType: 'Success',
          Messages: ['Validation retry started.'],
        }),
      });
    },
  );

  // Transactions: empty for a Failed file (no rows were imported).
  await page.route(/\/api\/.*\/transactions(\?.*)?$/i, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ Transactions: [] }),
    });
  });

  // File Logs: singular `{FileLog:[...]}` envelope (project-brief §6 / §13.C).
  await page.route(/\/api\/.*file-logs(\?.*)?$/i, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ FileLog: ACTIVE_FILE_LOGS }),
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

/** The Importer-only Retry Validation control. */
function retryControl(page: Page) {
  return page.getByRole('button', { name: /retry validation/i });
}

test.describe('Epic 2, Story 4: Retry validation and review validation errors', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-1 (R13, BR5): on a Failed file the detail page shows the list of invalid
  // rows with the column HEADINGS supplied by the backend's column metadata. The
  // JsonArray STRING must be unwrapped to render the per-row values, and a
  // Visible:false column's heading must NOT appear.
  test('Failed file shows invalid rows under the backend-supplied column headings', async ({
    page,
  }) => {
    await mockFailedFileApi(page, importerUser);
    await signIn(page, importerUser);
    await page.goto(`/files/${FAILED_FILE.Id}`);

    // The Failed status is surfaced for the viewed file.
    await expect(page.getByText(/failed/i).first()).toBeVisible();

    // The visible column HeaderTexts (not the raw `Name` keys) are rendered as
    // column headings.
    await expect(
      page.getByRole('columnheader', { name: /transaction reference/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: /amount \(zar\)/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: /validation error/i }),
    ).toBeVisible();

    // The Visible:false `Notes` column's heading is NOT rendered.
    await expect(
      page.getByRole('columnheader', { name: /internal notes/i }),
    ).toHaveCount(0);

    // The per-row values from the unwrapped JsonArray STRING are shown — proving
    // the page JSON.parsed the stringified envelope rather than rendering [object].
    await expect(page.getByText('TXN-ERR-0001')).toBeVisible();
    await expect(page.getByText('TXN-ERR-0002')).toBeVisible();
    await expect(
      page.getByText(/amount exceeds the daily limit/i),
    ).toBeVisible();
    await expect(page.getByText(/amount is not a valid number/i)).toBeVisible();
  });

  // AC-2 (BR5): an Importer sees a Retry Validation control on the Failed file; an
  // Approver sees the SAME validation-error rows read-only with NO retry control.
  test('Importer sees the Retry Validation control; Approver sees the rows without it', async ({
    page,
  }) => {
    // Importer: the Retry Validation control is present alongside the error rows.
    await mockFailedFileApi(page, importerUser);
    await signIn(page, importerUser);
    await page.goto(`/files/${FAILED_FILE.Id}`);

    await expect(page.getByText('TXN-ERR-0001')).toBeVisible();
    await expect(retryControl(page)).toBeVisible();
    await expect(retryControl(page)).toBeEnabled();

    // Approver (fresh session): the SAME error rows render read-only, with NO
    // retry control.
    await page.context().clearCookies();
    await mockFailedFileApi(page, approverUser);
    await signIn(page, approverUser);
    await page.goto(`/files/${FAILED_FILE.Id}`);

    // The validation-error rows are still shown to the Approver (read-only view).
    await expect(page.getByText('TXN-ERR-0001')).toBeVisible();
    await expect(page.getByText('TXN-ERR-0002')).toBeVisible();

    // The Retry Validation control is NOT present for the Approver (Importer-only).
    await expect(retryControl(page)).toHaveCount(0);
  });
});
