/**
 * Story Metadata:
 * - Route: /login
 * - Target File: web/src/app/login/page.tsx
 * - Page Action: create
 *
 * E2E spec for Epic 1, Story 2: Sign-in with role-based landing (R1, R18).
 *
 * Mocking strategy: project default is `page-route-with-shape-report`
 * (intake-manifest.json -> context.testInfrastructure.playwrightMockingDefault),
 * but no api-shape-report.md exists yet, so response bodies below are built from
 * the observed runtime shapes recorded in intake-manifest.json -> observedDrift
 * and project-brief.md §6 / §13.C (PascalCase single-key envelopes; `{Users:[...]}`).
 *
 * Same-origin /api/* calls are intercepted with page.route():
 *   - POST .../auth/login  -> 200 + Set-Cookie `session` for valid creds, 401 for a bad password
 *   - GET  .../auth/userinfo and GET .../v1/users -> the signed-in user's role
 * The role-resolution source is unconfirmed on the live backend (brief §13.E), so
 * all three plausible sources (login body, userinfo, /v1/users) carry the role —
 * whichever the implementation reads, the Importer->file-import and
 * Approver->transactions landing assertions resolve correctly.
 *
 * Alert locator note: the Next.js App Router injects a permanently-present,
 * EMPTY `<div role="alert" id="__next-route-announcer__">` at the body level on
 * every hydrated page. A bare `page.getByRole('alert')` therefore always matches
 * that framework announcer IN ADDITION to the form's own error alert, producing
 * a strict-mode "resolved to N elements" collision. The AC-4 assertions below
 * scope to the page's single MEANINGFUL (non-empty) alert via
 * `.filter({ hasText: /\S/ })` — narrowing an over-broad selector to the one
 * canonical error region the implementation owns, without relaxing any
 * assertion (visibility, the required wording, and the must-NOT wording are all
 * still asserted against that single alert).
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import {
  importerUser,
  approverUser,
  wrongPassword,
  type TestUser,
} from './fixtures/credentials';

const LOGIN_ROUTE = '/login';

/** Build a single User record in the observed PascalCase shape. */
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
 * Wire same-origin /api/* mocks. After a successful login the signed-in user is
 * captured in a closure so userinfo / users reflect that user's role.
 *
 * @param validUser   the credentials that will be accepted by the mocked login.
 * @param onLoginRoute optional override for the login handler (used for the
 *                     connectivity-failure case, which aborts instead of replying).
 */
async function mockAuthApi(
  page: Page,
  validUser: TestUser,
  onLoginRoute?: (route: Route) => Promise<void>,
): Promise<void> {
  let signedIn: TestUser | null = null;

  // Login: same-origin proxy path. Match any /api/.../login to stay tolerant of
  // the final proxy path shape (/api/auth/login vs /api/auth/v1/login).
  await page.route(/\/api\/.*login.*/i, async (route) => {
    if (onLoginRoute) {
      await onLoginRoute(route);
      return;
    }
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
        // Carry the role in the login body too — one of the three resolution sources.
        body: JSON.stringify(userRecord(validUser)),
      });
      return;
    }

    // Wrong credentials -> 401 (credential failure, NOT connectivity failure).
    await route.fulfill({
      status: 401,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        detail: 'Invalid email or password.',
      }),
    });
  });

  // userinfo: returns the signed-in user's record (role-resolution source #2).
  await page.route(/\/api\/.*userinfo.*/i, async (route) => {
    if (!signedIn) {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{}',
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(userRecord(signedIn)),
    });
  });

  // /v1/users: PascalCase `{Users:[...]}` envelope (role-resolution source #3).
  await page.route(/\/api\/.*\/users(\?.*)?$/i, async (route) => {
    if (!signedIn) {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{}',
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ Users: [userRecord(signedIn)] }),
    });
  });
}

/** Fill the email/password form and submit. */
async function submitLogin(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in|log in|login/i }).click();
}

/**
 * The page's single MEANINGFUL alert — the form's error region — excluding the
 * always-present, EMPTY Next.js route-announcer alert. `hasText: /\S/` keeps
 * only an alert that contains at least one non-whitespace character.
 */
function meaningfulAlert(page: Page) {
  return page.getByRole('alert').filter({ hasText: /\S/ });
}

test.describe('Epic 1, Story 2: Sign-in with role-based landing', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-1: an unauthenticated visitor is shown the email-and-password sign-in form.
  test('unauthenticated visitor is shown the email-and-password sign-in form', async ({
    page,
  }) => {
    await page.goto(LOGIN_ROUTE);

    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(
      page.getByRole('button', { name: /sign in|log in|login/i }),
    ).toBeVisible();
  });

  // AC-2: signing in as an Importer lands on the file-import surface.
  test('Importer signs in and lands on the file-import surface', async ({
    page,
  }) => {
    await mockAuthApi(page, importerUser);
    await page.goto(LOGIN_ROUTE);

    await submitLogin(page, importerUser.email, importerUser.password);

    // Importer landing is the upload / file-import surface — not the login page,
    // and not the Approver's transactions surface.
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page).toHaveURL(
      /\/(upload|files|file-logs|import|dashboard)/i,
    );
    await expect(
      page.getByRole('heading', { name: /upload|import|file log/i }),
    ).toBeVisible();
  });

  // AC-3: signing in as an Approver lands on the transactions surface.
  test('Approver signs in and lands on the transactions surface', async ({
    page,
  }) => {
    await mockAuthApi(page, approverUser);
    await page.goto(LOGIN_ROUTE);

    await submitLogin(page, approverUser.email, approverUser.password);

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page).toHaveURL(/\/transactions/i);
    await expect(
      page.getByRole('heading', { name: /transactions/i }),
    ).toBeVisible();
  });

  // AC-4 (part 1): a wrong email/password shows a credential-failure message.
  test('wrong credentials show a credential-failure message', async ({
    page,
  }) => {
    await mockAuthApi(page, approverUser);
    await page.goto(LOGIN_ROUTE);

    await submitLogin(page, approverUser.email, wrongPassword);

    // Stays on the login page and surfaces a credential-specific error.
    await expect(page).toHaveURL(/\/login/);
    const alert = meaningfulAlert(page);
    await expect(alert).toBeVisible();
    await expect(alert).toHaveText(
      /invalid|incorrect|email or password|credential/i,
    );
    // Must NOT be phrased as a connectivity problem.
    await expect(alert).not.toHaveText(
      /reach|connect|network|service unavailable|try again later/i,
    );
  });

  // AC-4 (part 2): a connectivity failure shows a DISTINCT "can't reach the service" message.
  test('a connectivity failure shows a distinct service-unreachable message', async ({
    page,
  }) => {
    // Login aborts (network failure) instead of returning a 401 body.
    await mockAuthApi(page, approverUser, async (route) => {
      await route.abort('failed');
    });
    await page.goto(LOGIN_ROUTE);

    await submitLogin(page, approverUser.email, approverUser.password);

    await expect(page).toHaveURL(/\/login/);
    const alert = meaningfulAlert(page);
    await expect(alert).toBeVisible();
    // Connectivity-specific wording — distinct from the credential-failure copy.
    await expect(alert).toHaveText(/reach|connect|network|service|try again/i);
    await expect(alert).not.toHaveText(
      /invalid email or password|incorrect password|wrong credential/i,
    );
  });
});
