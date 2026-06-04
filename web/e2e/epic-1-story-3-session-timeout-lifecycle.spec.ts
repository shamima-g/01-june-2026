/**
 * Story Metadata:
 * - Route: null (SessionManager is a GLOBAL component mounted app-wide, not its own page)
 * - Target File: web/src/components/session/SessionManager.tsx
 * - Page Action: create
 *
 * E2E spec for Epic 1, Story 3: Sign-out and session timeout lifecycle (R17, NFR6).
 *
 * Routability nuance: the story has no route of its own because SessionManager is a
 * global component, BUT the explicit sign-out behaviour (AC-4) is genuinely
 * user-observable end-to-end on a real authenticated surface — sign out, land back
 * on /login, and confirm the session is cleared (protected navigation afterward
 * bounces to /login). That is exercised by a LIVE test() below.
 *
 * NOT covered live here (intentionally): the 15-minute idle timeout (with 60-second
 * warning) and the 8-hour absolute timeout. Those are wall-clock behaviours that
 * cannot be driven in a real browser without waiting real minutes/hours; they are
 * covered by the Vitest fake-timer suite (separate call) and are left as a
 * documented test.fixme() at the bottom of this file.
 *
 * Mocking strategy: project default is `page-route-with-shape-report`
 * (intake-manifest.json -> context.testInfrastructure.playwrightMockingDefault),
 * but no api-shape-report.md exists yet, so response bodies below are built from
 * project-brief.md §3 / §6 / §9 and the Story 2 spec's observed shapes:
 *   - POST /api/auth/login  -> 200 + Set-Cookie `session` (HttpOnly; SameSite=Strict)
 *   - POST /api/auth/logout -> 200 + clears the `session` cookie (Max-Age=0)
 *   - GET  /api/auth/userinfo and GET /api/.../v1/users -> the signed-in user's
 *     record while authenticated; 401 once the session is cleared.
 * A small in-closure `signedIn` flag models server-side session state so that, after
 * logout clears it, protected reads return 401 and the app redirects to /login —
 * the user-observable proof that the session was actually cleared, not just the URL.
 *
 * Alert/announcer note inherited from Story 2: the Next.js App Router injects a
 * permanently-present EMPTY `<div role="alert">` route announcer, so any alert
 * assertion must scope to a meaningful (non-empty) alert. This spec asserts on URL
 * and a heading/sign-out control, not on a bare alert, so no scoping helper is
 * needed here.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { importerUser, type TestUser } from './fixtures/credentials';

const LOGIN_ROUTE = '/login';

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

/** A 401 problem+json body for protected reads once the session is cleared. */
async function fulfillUnauthorized(route: Route): Promise<void> {
  await route.fulfill({
    status: 401,
    contentType: 'application/problem+json',
    body: JSON.stringify({
      type: 'about:blank',
      title: 'Unauthorized',
      status: 401,
      detail: 'No active session.',
    }),
  });
}

/**
 * Wire same-origin /api/* mocks modelling a single mutable server-side session.
 * Returns the closure flag holder so a test can assert it flipped to false.
 *
 *  - login  : accepts `validUser`, sets `signedIn=true`, sets the `session` cookie.
 *  - logout : sets `signedIn=false`, clears the `session` cookie (Max-Age=0), 200.
 *  - userinfo / users : 200 with the user's record while signedIn, else 401.
 *  - transactions / file-logs : 200 with an (empty) envelope while signedIn, else 401.
 */
async function mockSessionApi(
  page: Page,
  validUser: TestUser,
): Promise<{ get signedIn(): boolean }> {
  const state = { signedIn: false };

  await page.route(/\/api\/.*logout.*/i, async (route) => {
    state.signedIn = false;
    await route.fulfill({
      status: 200,
      headers: {
        // Expire the cookie immediately — the user-observable "session cleared".
        'set-cookie': 'session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
      },
      contentType: 'application/json',
      body: '{}',
    });
  });

  await page.route(/\/api\/.*login.*/i, async (route) => {
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
      state.signedIn = true;
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
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        detail: 'Invalid email or password.',
      }),
    });
  });

  await page.route(/\/api\/.*userinfo.*/i, async (route) => {
    if (!state.signedIn) {
      await fulfillUnauthorized(route);
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(userRecord(validUser)),
    });
  });

  await page.route(/\/api\/.*\/users(\?.*)?$/i, async (route) => {
    if (!state.signedIn) {
      await fulfillUnauthorized(route);
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ Users: [userRecord(validUser)] }),
    });
  });

  // Importer's landing surface reads (file-logs / upload metadata). 401 once cleared
  // so post-logout navigation to a protected surface bounces back to /login.
  await page.route(/\/api\/.*(file-logs|transactions).*/i, async (route) => {
    if (!state.signedIn) {
      await fulfillUnauthorized(route);
      return;
    }
    const isTransactions = /transactions/i.test(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        isTransactions ? { Transactions: [] } : { FileLogs: [] },
      ),
    });
  });

  return {
    get signedIn() {
      return state.signedIn;
    },
  };
}

/** Fill the email/password form and submit (mirrors Story 2). */
async function submitLogin(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in|log in|login/i }).click();
}

/** Sign in as the given user and wait until off the login page (authenticated). */
async function signInToAuthenticatedSurface(
  page: Page,
  user: TestUser,
): Promise<void> {
  await page.goto(LOGIN_ROUTE);
  await submitLogin(page, user.email, user.password);
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe('Epic 1, Story 3: Sign-out and session timeout lifecycle', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-4: signing out returns the user to the sign-in screen and clears the session.
  test('signing out returns to /login and clears the session', async ({
    page,
    context,
  }) => {
    const session = await mockSessionApi(page, importerUser);
    await signInToAuthenticatedSurface(page, importerUser);

    // The sign-out control is part of the global SessionManager / app chrome,
    // exposed as an accessible button. Tolerate "Sign out" / "Log out" wording.
    await page
      .getByRole('button', { name: /sign out|log out|logout/i })
      .click();

    // Returns to the sign-in screen.
    await expect(page).toHaveURL(/\/login/);
    await expect(
      page.getByRole('button', { name: /sign in|log in|login/i }),
    ).toBeVisible();

    // The mocked server-side session is gone…
    expect(session.signedIn).toBe(false);

    // …and the `session` cookie has been cleared from the browser.
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === 'session')?.value ?? '').toBe('');

    // Proof the session is truly cleared, not just the URL: attempting to reach a
    // protected surface directly bounces back to /login (protected reads now 401).
    await page.goto('/transactions');
    await expect(page).toHaveURL(/\/login/);
  });

  // R17 / NFR6 idle + absolute timeout — NOT a live Playwright test.
  //
  // The 15-minute idle timeout (with its 60-second warning countdown) and the
  // 8-hour absolute timeout are wall-clock behaviours: driving them in a real
  // browser would require waiting real minutes/hours, which is not viable in an
  // E2E run. They are verified instead by the Vitest fake-timer suite for this
  // story (vi.useFakeTimers + vi.advanceTimersByTime). Kept here as a documented
  // marker so the coverage gap is explicit rather than silent.
  test.fixme('idle (15 min) and absolute (8 hr) timeouts force re-authentication — covered by Vitest fake-timer suite', async () => {
    // Intentionally empty: wall-clock timeouts are not E2E-testable.
  });
});
