/**
 * Story Metadata:
 * - Route: /login
 * - Target File: web/src/lib/auth/roles.ts
 * - Page Action: modify_existing
 *
 * E2E spec for Epic 5, Story 1: backend role-name aliasing fix (R1, BR9, BR10, BR11).
 *
 * THE BUG THIS LOCKS DOWN
 * -----------------------
 * The LIVE backend returns the Importer's role as "File Importer" (the Approver's
 * stays "Approver"). The app only recognised the bare names "Importer"/"Approver"
 * exactly (web/src/lib/auth/roles.ts → LANDING_ROUTES keyed on "Importer"), so an
 * Importer's "File Importer" role resolved to UNKNOWN → the safe fallback route
 * (/transactions) → the Importer landed on Transactions with the Upload / Retry /
 * Cancel affordances hidden. The fix aliases "File Importer" → Importer in
 * roles.ts so the real wire name resolves to the Importer landing surface (/files)
 * and the Importer-only Upload CTA (BR11/BR12).
 *
 * Unlike every OTHER e2e spec — whose mocks previously emitted the bare
 * "Importer" name and therefore PASSED against a backend the app already
 * understood — this spec deliberately mocks the Importer with the PRODUCTION role
 * name "File Importer". It FAILS today (unknown role → /transactions, Upload
 * hidden) and goes green once the developer's alias lands. TDD red.
 *
 * Mocking strategy: project default `page-route-with-shape-report`
 * (intake-manifest.json → context.testInfrastructure.playwrightMockingDefault).
 * No api-shape-report.md exists yet, so response bodies are built from the observed
 * runtime shapes (PascalCase single-key envelopes; `{Users:[...]}`, `{FileLog:[...]}`)
 * — the SAME established same-origin /api/* login → Set-Cookie → userinfo/users
 * pattern as epic-1-story-2, with ONE deliberate deviation: the importer's role
 * NAME on the wire is "File Importer", not "Importer".
 *
 * The Upload CTA only renders in the file-logs EMPTY state for an Importer
 * (web/src/app/files/page.tsx), so file-logs is mocked empty `[]` here — that puts
 * the Importer-only Upload affordance on screen as the BR11 assertion target.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { importerUser, type TestUser } from './fixtures/credentials';

const LOGIN_ROUTE = '/login';
const FILES_ROUTE = '/files';

/**
 * Cold-compile navigation tolerance. The first protected-route navigation after a
 * fresh `next dev` boot triggers an on-demand compile that can exceed Playwright's
 * default 5s expect timeout; 30s absorbs that ONE-TIME cost. This is a
 * setup-mechanism timeout, not a behavioural assertion. Lifted verbatim from the
 * Epic 1/2/3 specs.
 */
const SIGN_IN_NAV_TIMEOUT_MS = 30_000;

/**
 * The PRODUCTION role NAME the live backend emits for each persona. This is the
 * crux of the story: the Importer is "File Importer" on the wire (NOT "Importer"),
 * while the Approver stays "Approver". `TestUser.role` remains the canonical
 * test-logic discriminator ('Importer' | 'Approver'); only the emitted role-name
 * STRING is mapped to the backend spelling here.
 */
function backendRoleName(user: TestUser): string {
  return user.role === 'Importer' ? 'File Importer' : 'Approver';
}

/**
 * Build a single User record in the observed PascalCase shape, carrying the
 * PRODUCTION role name (`backendRoleName`) in both the scalar `RolesString` and
 * the `Roles[].Name` array — whichever source the implementation reads, it sees
 * the real wire spelling "File Importer".
 */
function userRecord(user: TestUser) {
  const roleName = backendRoleName(user);
  return {
    Id: user.role === 'Importer' ? 101 : 202,
    Email: user.email,
    FirstName: user.firstName,
    LastName: user.lastName,
    RolesString: roleName,
    Roles: [{ Id: user.role === 'Importer' ? 1 : 2, Name: roleName }],
    Pages: [],
    LastChangedUser: 'system',
    LastChangedDate: '2026-06-01T08:00:00Z',
  };
}

/**
 * Wire the same-origin /api/* mocks the role-resolution + landing flow needs:
 *   - POST .../login    → 200 + Set-Cookie `session` for valid creds (role in body);
 *   - GET  .../userinfo → the signed-in user's record (role-resolution source #2);
 *   - GET  .../users    → `{Users:[...]}` envelope (role-resolution source #3);
 *   - GET  .../file-logs → empty `{FileLog:[]}` so the Importer-only Upload CTA
 *     renders in the empty state (the BR11 assertion target).
 *
 * Every role-bearing source emits the PRODUCTION name via `userRecord`.
 */
async function mockAuthAndFilesApi(
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
        // Carry the production role name in the login body too (source #1).
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

  // File Logs: empty PascalCase `{FileLog:[]}` envelope → zero-data empty state,
  // where the Importer-only Upload CTA lives.
  await page.route(/\/api\/.*file-logs(\?.*)?$/i, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ FileLog: [] }),
    });
  });
}

/** Fill the email/password form and submit. */
async function submitLogin(page: Page, user: TestUser): Promise<void> {
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole('button', { name: /sign in|log in|login/i }).click();
}

test.describe('Epic 5, Story 1: backend role-name aliasing fix', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-4 (PLAYWRIGHT): an Importer whose BACKEND role name is "File Importer"
  // signs in and lands on the Files screen (/files) — NOT Transactions — with the
  // Importer-only Upload control visible. (R1, BR11)
  test('Importer with backend role "File Importer" lands on /files with the Upload control visible', async ({
    page,
  }) => {
    await mockAuthAndFilesApi(page, importerUser);
    await page.goto(LOGIN_ROUTE);

    await submitLogin(page, importerUser);

    // Lands off the login page and on the Importer's Files surface — explicitly
    // NOT the Approver's transactions fallback the unaliased name would route to.
    await expect(page).not.toHaveURL(/\/login/, {
      timeout: SIGN_IN_NAV_TIMEOUT_MS,
    });
    await expect(page).toHaveURL(new RegExp(`${FILES_ROUTE}(/|\\?|$)`), {
      timeout: SIGN_IN_NAV_TIMEOUT_MS,
    });
    await expect(page).not.toHaveURL(/\/transactions/);

    // The Files screen heading confirms we're on the file-import surface. Matched
    // by EXACT name so it targets ONLY the page title "File Logs" — not the
    // empty-state heading "No file logs yet", which the prior /file logs/i regex
    // also matched, tripping Playwright strict mode.
    await expect(
      page.getByRole('heading', { name: 'File Logs', exact: true }),
    ).toBeVisible();

    // The Importer-only Upload affordance is on screen (BR11). It renders as a
    // link or a button depending on the empty-state composition — accept either,
    // scoped by its accessible name so it stays dev-tools-safe.
    await expect(
      page
        .getByRole('link', { name: /upload/i })
        .or(page.getByRole('button', { name: /upload/i })),
    ).toBeVisible();
  });
});
