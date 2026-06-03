/**
 * Story Metadata:
 * - Route: /files/upload
 * - Target File: web/src/app/files/upload/page.tsx
 * - Page Action: create_new
 *
 * E2E spec for Epic 2, Story 3: Upload a transaction file (R2, BR11).
 *
 * Mocking strategy: project default is `page-route-with-shape-report`
 * (intake-manifest.json -> context.testInfrastructure.playwrightMockingDefault),
 * but no api-shape-report.md exists in this repo yet, so the response bodies are
 * built from documentation/transactions-api.yaml + the PascalCase runtime shapes
 * established by Epic 2, Stories 1-2:
 *   - GET .../file-settings -> the FileSettingReadList envelope. The spec schema
 *     names the collection key `FileSettings` (PLURAL) — distinct from the file-logs
 *     `{FileLog:[...]}` singular oddity — so this spec uses `{FileSettings:[...]}`
 *     with each entry shaped as FileSettingRead (Id:int, Name, IsActive, ...).
 *   - POST .../files/upload -> 200 returning DefaultResponse ({Id, MessageType,
 *     Messages}). The endpoint takes FileSettingId / FileSettingName / FileName as
 *     query params and the file binary as application/octet-stream (transactions-api
 *     §/v1/files/upload). A 500 failure variant is also wired but driven only when a
 *     test opts into it (AC-3's failure path is owned by the Vitest sibling).
 *
 * The /files/upload surface is auth-gated (RequireSession + HttpOnly session
 * cookie) AND Importer-only (BR11), so each test drives the real login flow first —
 * reusing the same same-origin /api/* auth-mock + login pattern from Stories 1-2
 * (login -> Set-Cookie session, userinfo / users carry the signed-in user's role).
 *
 * Role matters for AC-5: an Approver who reaches /files/upload directly must see an
 * in-page permission-denied banner — NOT the upload form and NOT a generic error
 * page (BR11).
 *
 * Alert/announcer note: the App Router injects a permanently-present EMPTY
 * `<div role="alert">` route announcer. This spec never relies on a bare alert
 * selector — assertions target visible copy / headings / named controls instead.
 *
 * These tests WILL FAIL until the production upload surface is implemented
 * (web/src/app/files/upload/page.tsx does not exist yet) — TDD red.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import {
  importerUser,
  approverUser,
  type TestUser,
} from './fixtures/credentials';

const UPLOAD_ROUTE = '/files/upload';

/** A File Setting in the observed PascalCase shape (transactions-api FileSettingRead). */
interface MockFileSetting {
  Id: number;
  Name: string;
  SourceId: number;
  SourceName: string;
  TypeId: number;
  TypeName: string;
  Direction: string;
  IsActive: boolean;
  LastChangedUser: string;
  LastChangedDate: string;
}

function fileSetting(
  overrides: Partial<MockFileSetting> & { Id: number; Name: string },
): MockFileSetting {
  return {
    SourceId: 1,
    SourceName: 'Bank',
    TypeId: 1,
    TypeName: 'CSV',
    Direction: 'Inbound',
    IsActive: true,
    LastChangedUser: 'system',
    LastChangedDate: '2026-06-01T08:00:00Z',
    ...overrides,
  };
}

/** Deterministic File Settings the selector should offer. */
const FILE_SETTINGS: MockFileSetting[] = [
  fileSetting({ Id: 7, Name: 'Daily Bank Import' }),
  fileSetting({ Id: 8, Name: 'Vendor Reconciliation' }),
];

const PRIMARY_SETTING = FILE_SETTINGS[0];

/** Build a single User record in the observed PascalCase shape (mirrors Stories 1-2). */
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

interface UploadMockOptions {
  /** When 'fail', POST .../files/upload returns 500 (DefaultResponse with errors). */
  uploadOutcome?: 'success' | 'fail';
}

/**
 * Wire the same-origin /api/* mocks the upload surface needs:
 *   - auth login / userinfo / users (so login succeeds and the role resolves);
 *   - GET .../file-settings -> the `{FileSettings:[...]}` envelope (selector source);
 *   - POST .../files/upload -> 200 DefaultResponse on success (or 500 on 'fail').
 */
async function mockUploadApi(
  page: Page,
  validUser: TestUser,
  options: UploadMockOptions = {},
): Promise<void> {
  const { uploadOutcome = 'success' } = options;
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

  // File Settings: `{FileSettings:[...]}` plural envelope (transactions-api FileSettingReadList).
  await page.route(/\/api\/.*file-settings(\?.*)?$/i, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ FileSettings: FILE_SETTINGS }),
    });
  });

  // Upload: POST .../files/upload (binary body + query params) -> DefaultResponse.
  await page.route(/\/api\/.*files\/upload(\?.*)?$/i, async (route: Route) => {
    if (uploadOutcome === 'fail') {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          Id: 0,
          MessageType: 'Error',
          Messages: ['The file could not be uploaded. Please try again.'],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        Id: 6001,
        MessageType: 'Success',
        Messages: ['File uploaded successfully.'],
      }),
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

/**
 * Attach a CSV file to the dropzone's file-input fallback (the picker path).
 * The dropzone keeps a real <input type="file"> for the picker fallback; we set
 * its files directly rather than simulating a native drag (AC-1's picker path).
 */
async function pickFile(page: Page, fileName = 'transactions-upload.csv') {
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({
    name: fileName,
    mimeType: 'text/csv',
    buffer: Buffer.from('Reference,Amount\nTXN-1,100.00\n'),
  });
}

/**
 * Choose the primary File Setting from the selector by its visible name.
 *
 * The production control is a native labelled <select> (required by the Vitest
 * sibling's `user.selectOptions` contract and accessible / jsdom-testable), so we
 * drive it via Playwright's native-select API rather than a Shadcn popup. The
 * label text matches /file setting/i; each option's visible text is the setting
 * Name. Only the interaction mechanism is reconciled here — every assertion in
 * the tests below is unchanged.
 */
async function chooseSetting(page: Page, setting: MockFileSetting) {
  await page.getByLabel(/file setting/i).selectOption({ label: setting.Name });
}

/** The Confirm / Upload submit control. */
function confirmButton(page: Page) {
  return page.getByRole('button', { name: /confirm|upload/i });
}

test.describe('Epic 2, Story 3: Upload a transaction file', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-1: the Importer can select a file via the picker fallback and pick a File
  // Setting; once both are chosen, Confirm becomes available.
  test('Importer selects a file and a File Setting, enabling Confirm', async ({
    page,
  }) => {
    await mockUploadApi(page, importerUser);
    await signIn(page, importerUser);
    await page.goto(UPLOAD_ROUTE);

    // The upload form is present for the Importer.
    await expect(page.getByRole('heading', { name: /upload/i })).toBeVisible();

    // Pick a file via the file-input fallback, then pick a File Setting.
    await pickFile(page);
    await chooseSetting(page, PRIMARY_SETTING);

    // The chosen setting is reflected and Confirm is now actionable.
    // The production control is a native <select> (sanctioned reconciliation —
    // see chooseSetting); a native <select>'s selected <option> is 'hidden' to
    // Playwright and its name also collides with the visible reflection, so this
    // assertion targets the visible (non-<option>) reflection of the chosen
    // setting Name rather than the option text. Intent is unchanged: the chosen
    // setting Name is reflected on the page.
    await expect(
      page
        .getByText(new RegExp(PRIMARY_SETTING.Name, 'i'))
        .and(page.locator(':not(option)')),
    ).toBeVisible();
    await expect(confirmButton(page)).toBeEnabled();
  });

  // AC-2: on confirm the user sees upload progress, then an explicit success
  // message AND a path/link to the File Logs list showing the new entry.
  test('confirming shows progress then a success message with a link to File Logs', async ({
    page,
  }) => {
    await mockUploadApi(page, importerUser, { uploadOutcome: 'success' });
    await signIn(page, importerUser);
    await page.goto(UPLOAD_ROUTE);

    await pickFile(page);
    await chooseSetting(page, PRIMARY_SETTING);
    await confirmButton(page).click();

    // An explicit success message is surfaced (NFR5).
    await expect(
      page.getByText(/uploaded successfully|upload complete|success/i),
    ).toBeVisible();

    // A path to the File Logs list is offered (link back to /files).
    const filesLink = page
      .getByRole('link', { name: /file logs|view file|back to files|files/i })
      .filter({ hasNot: page.locator('text=/upload/i') });
    await expect(filesLink.first()).toBeVisible();
    await expect(filesLink.first()).toHaveAttribute('href', /\/files\b/);
  });

  // AC-5 (BR11): an Approver navigating directly to /files/upload sees an in-page
  // permission-denied banner — NOT the upload form and NOT a generic error page.
  test('Approver reaching the Upload route sees a permission-denied banner, not the form', async ({
    page,
  }) => {
    await mockUploadApi(page, approverUser);
    await signIn(page, approverUser);
    await page.goto(UPLOAD_ROUTE);

    // The in-page permission-denied banner is shown (BR11). Scope to a heading so
    // the assertion targets a single element (the empty route announcer is ignored).
    await expect(
      page
        .getByText(
          /permission denied|don'?t have permission|not authori[sz]ed|importer/i,
        )
        .first(),
    ).toBeVisible();

    // The upload affordances are NOT rendered: no file input, no Confirm control.
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /confirm|upload/i }),
    ).toHaveCount(0);

    // It is NOT a generic Next.js error page — the app still owns the URL.
    await expect(page).toHaveURL(/\/files\/upload/);
  });
});
