/**
 * Story Metadata:
 * - Route: /files
 * - Target File: web/src/app/files/page.tsx
 * - Page Action: modify_existing
 *
 * E2E spec for Epic 2, Story 1: File Logs dashboard with status, sorting, and
 * pagination (R3, R6, R14, BR12).
 *
 * Mocking strategy: project default is `page-route-with-shape-report`
 * (intake-manifest.json -> context.testInfrastructure.playwrightMockingDefault),
 * but no api-shape-report.md exists in this repo yet, so the file-logs response
 * body is built from the runtime shapes recorded in
 * intake-manifest.json -> observedDrift and project-brief.md §6 / §13.C / §13.F:
 *   - the collection is wrapped in the PascalCase single-key envelope `{FileLog:[...]}`
 *     (spec schema name FileLogList.FileLog — singular key);
 *   - each row carries Id, ProcessDate, CurrentFileName (the "File Name" column —
 *     §13.F), RecordCount (string/numeric), CurrentStatus / LastExecutedActivityName
 *     (File Status is derived from these);
 *   - the endpoint requires `?IsActive=Yes` (§13.B — a missing param 400s).
 *
 * The /files surface is auth-gated (RequireSession + HttpOnly session cookie), so
 * each test drives the real login flow first — reusing the same same-origin /api/*
 * auth-mock shape established by Epic 1, Story 2 (login -> Set-Cookie session,
 * userinfo / users carry the signed-in user's role for post-login routing). That
 * login also sets the client-side session marker the route guard reads, so the
 * protected surface renders. After login we navigate to /files and assert against
 * the mocked file-logs response.
 *
 * Role matters for AC-5: the zero-data empty state shows an Upload CTA for an
 * Importer but NOT for an Approver (BR12) — so that criterion is exercised twice,
 * once per persona, against an empty `{FileLog:[]}` response.
 *
 * Alert/announcer note (inherited from Story 2): the App Router injects a
 * permanently-present EMPTY `<div role="alert">` route announcer; this spec never
 * relies on a bare alert selector, so no filtering is needed here.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import {
  importerUser,
  approverUser,
  type TestUser,
} from './fixtures/credentials';

const FILES_ROUTE = '/files';

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

/** A small, deterministic set of active file logs covering distinct statuses. */
const ACTIVE_FILE_LOGS: MockFileLog[] = [
  fileLog({
    Id: 5001,
    CurrentFileName: 'march-payroll.csv',
    ProcessDate: '2026-04-15T09:30:00Z',
    RecordCount: '128',
    CurrentStatus: 'Completed',
    LastExecutedActivityName: 'Completed',
  }),
  fileLog({
    Id: 5002,
    CurrentFileName: 'april-vendors.csv',
    ProcessDate: '2026-04-14T14:05:00Z',
    RecordCount: '42',
    CurrentStatus: 'Processing',
    LastExecutedActivityName: 'Processing',
  }),
  fileLog({
    Id: 5003,
    CurrentFileName: 'reconciliation.csv',
    ProcessDate: '2026-04-13T11:20:00Z',
    RecordCount: '9',
    CurrentStatus: 'Failed',
    LastExecutedActivityName: 'Failed',
  }),
];

/** Build a single User record in the observed PascalCase shape (mirrors Story 2). */
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
 * Wire the same-origin /api/* mocks needed by the File Logs surface:
 *   - auth login / userinfo / users (so login succeeds and the role resolves);
 *   - GET .../file-logs -> the PascalCase `{FileLog:[...]}` envelope.
 *
 * @param logs the file-logs the dashboard should render (use [] for the empty state).
 */
async function mockFilesApi(
  page: Page,
  validUser: TestUser,
  logs: MockFileLog[],
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

  // File Logs: PascalCase single-key envelope `{FileLog:[...]}` (project-brief §6 / §13.C).
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
  // Land off the login page before navigating on to the protected surface.
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe('Epic 2, Story 1: File Logs dashboard', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-1: on load the user sees the File Logs table with the brief's columns
  // (File Name, Process Date, Record Count, File Status) populated from active logs.
  test('renders the File Logs table with the brief columns populated from active logs', async ({
    page,
  }) => {
    await mockFilesApi(page, importerUser, ACTIVE_FILE_LOGS);
    await signIn(page, importerUser);
    await page.goto(FILES_ROUTE);

    const table = page.getByRole('table');
    await expect(table).toBeVisible();

    // The four brief-specified column headers are present.
    await expect(
      table.getByRole('columnheader', { name: /file name/i }),
    ).toBeVisible();
    await expect(
      table.getByRole('columnheader', { name: /process date/i }),
    ).toBeVisible();
    await expect(
      table.getByRole('columnheader', { name: /record count/i }),
    ).toBeVisible();
    await expect(
      table.getByRole('columnheader', { name: /file status|status/i }),
    ).toBeVisible();

    // Each mocked file log surfaces as a row keyed by its file name (scoped to the
    // row so the record count assertion can't collide with another "128" elsewhere).
    for (const log of ACTIVE_FILE_LOGS) {
      const row = page.getByRole('row', {
        name: new RegExp(log.CurrentFileName, 'i'),
      });
      await expect(row).toBeVisible();
      await expect(
        row.getByText(log.RecordCount, { exact: false }),
      ).toBeVisible();
    }
  });

  // AC-4: clicking a row navigates to that file's detail surface.
  test('clicking a file log row navigates to that file detail surface', async ({
    page,
  }) => {
    await mockFilesApi(page, importerUser, ACTIVE_FILE_LOGS);
    await signIn(page, importerUser);
    await page.goto(FILES_ROUTE);

    const target = ACTIVE_FILE_LOGS[0];
    const row = page.getByRole('row', {
      name: new RegExp(target.CurrentFileName, 'i'),
    });
    await expect(row).toBeVisible();

    // Click-through to the detail surface (Story 2). The row may expose its
    // click-through as a link or be a clickable row — try the row's link first,
    // falling back to clicking the row itself.
    const rowLink = row.getByRole('link');
    if (await rowLink.count()) {
      await rowLink.first().click();
    } else {
      await row.click();
    }

    // We leave the list URL and land on a file-scoped detail URL carrying the id.
    await expect(page).not.toHaveURL(/\/files\/?(\?.*)?$/);
    await expect(page).toHaveURL(new RegExp(`/files/.*${target.Id}`));
  });

  // AC-5 (Importer): the zero-data empty state shows the Upload call-to-action.
  test('shows the zero-data empty state with an Upload CTA for an Importer', async ({
    page,
  }) => {
    await mockFilesApi(page, importerUser, []);
    await signIn(page, importerUser);
    await page.goto(FILES_ROUTE);

    // Zero-data empty state copy (distinct from a filtered no-results state).
    await expect(page.getByText(/no file logs/i)).toBeVisible();
    // No data table rows are rendered.
    await expect(page.getByRole('row', { name: /\.csv/i })).toHaveCount(0);
    // The Importer is offered the Upload CTA (BR12).
    await expect(
      page
        .getByRole('link', { name: /upload/i })
        .or(page.getByRole('button', { name: /upload/i })),
    ).toBeVisible();
  });

  // AC-5 (Approver): the same zero-data empty state appears WITHOUT the Upload CTA.
  test('shows the zero-data empty state without an Upload CTA for an Approver', async ({
    page,
  }) => {
    await mockFilesApi(page, approverUser, []);
    await signIn(page, approverUser);
    await page.goto(FILES_ROUTE);

    await expect(page.getByText(/no file logs/i)).toBeVisible();
    // The Approver does NOT see the Upload CTA (BR12) — it is absent, not disabled.
    await expect(page.getByRole('link', { name: /upload/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /upload/i })).toHaveCount(0);
  });
});
