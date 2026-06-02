/**
 * Story Metadata:
 * - Route: /login
 * - Target File: web/src/app/login/page.tsx
 * - Page Action: modify_existing
 *
 * E2E spec for Epic 1, Story 4: Account lockout after repeated failed sign-ins (R18, NFR6).
 *
 * Mocking strategy: project default is `page-route-with-shape-report`
 * (intake-manifest.json -> context.testInfrastructure.playwrightMockingDefault),
 * but no api-shape-report.md exists yet, so the 401 body below is built from the
 * observed runtime shape used by the Story 2 spec (RFC-7807 problem+json on the
 * credential-failure path). Same-origin /api/.../login is intercepted with
 * page.route() and returns 401 for every wrong-password attempt.
 *
 * Lockout is CLIENT-TRACKED: the auth spec documents NO lockout response code, so
 * the backend keeps returning 401 for each bad attempt. The login page itself
 * counts failures and, after the 5th, must transition into a lockout state
 * (R18 / NFR6: 5 failed attempts -> 15-minute cooldown) that blocks further
 * submissions — independent of what the API returns. The mock therefore replies
 * 401 uniformly; the assertions verify the client-side lockout behaviour.
 *
 * Alert locator note (carried from the Story 2 spec): the Next.js App Router
 * injects a permanently-present, EMPTY `<div role="alert"
 * id="__next-route-announcer__">` at the body level on every hydrated page, and
 * Approve/Reject toasts use role="status" — so a bare `getByRole('alert')` would
 * collide in strict mode. The inline form error/lockout region is this story's
 * single MEANINGFUL alert; `meaningfulAlert()` scopes to the one non-empty alert
 * the implementation owns (`.filter({ hasText: /\S/ })`) without relaxing any
 * assertion.
 */
import { test, expect, type Page } from '@playwright/test';
import { approverUser, wrongPassword } from './fixtures/credentials';

const LOGIN_ROUTE = '/login';

/**
 * Wire the same-origin /api/.../login mock to return 401 for every attempt and
 * count how many times it was called (lets us assert that, once locked, the form
 * stops hitting the API). Matches any /api/.../login to stay tolerant of the
 * final proxy path shape (/api/auth/login vs /api/auth/v1/login), mirroring the
 * Story 2 spec.
 */
async function mockAlwaysReject(page: Page): Promise<{ count: () => number }> {
  let calls = 0;
  await page.route(/\/api\/.*login.*/i, async (route) => {
    calls += 1;
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
  return { count: () => calls };
}

/** Fill the email/password form and submit one attempt. */
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
 * The page's single MEANINGFUL alert — the form's error / lockout region —
 * excluding the always-present, EMPTY Next.js route-announcer alert.
 * `hasText: /\S/` keeps only an alert containing at least one non-whitespace
 * character. (Same pattern the Story 2 spec established.)
 */
function meaningfulAlert(page: Page) {
  return page.getByRole('alert').filter({ hasText: /\S/ });
}

const submitButton = (page: Page) =>
  page.getByRole('button', { name: /sign in|log in|login/i });

test.describe('Epic 1, Story 4: Account lockout after repeated failed sign-ins', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-1: after 5 failed attempts the form shows a lockout message and blocks
  // further attempts. The backend returns 401 each time (no lockout response is
  // specified), so the lockout is driven entirely by the client-side counter.
  test('locks the form after 5 failed sign-in attempts and blocks further attempts', async ({
    page,
  }) => {
    const api = await mockAlwaysReject(page);
    await page.goto(LOGIN_ROUTE);

    // Five failed attempts with the deliberately-wrong password.
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await submitLogin(page, approverUser.email, wrongPassword);
      // Each pre-lockout attempt surfaces a (meaningful) error before the next try.
      await expect(meaningfulAlert(page)).toBeVisible();
    }

    // After the 5th failure the lockout message appears and is distinct from the
    // ordinary credential-failure copy.
    const alert = meaningfulAlert(page);
    await expect(alert).toBeVisible();
    await expect(alert).toHaveText(/lock(ed)?|too many|locked out/i);

    // Further attempts are blocked: the submit control is disabled. (If the
    // implementation instead removes/hides it, `toBeDisabled` would fail — the
    // intended contract is a visible-but-disabled control communicating WHY.)
    await expect(submitButton(page)).toBeDisabled();

    // And the locked form does NOT send any further login request. Capture the
    // call count, attempt one more submit, and confirm the API was not hit again.
    //
    // The submit control is disabled, so Playwright's click actionability never
    // resolves — it would auto-wait for the button to become enabled until the
    // whole-test timeout. We bound this probing click with a short explicit
    // timeout so it rejects FAST (proving the disabled control rejects input)
    // instead of hanging the test; the `.catch()` then swallows that expected
    // rejection. The real proof the block held is the unchanged call count below.
    const callsAfterLock = api.count();
    await submitButton(page)
      .click({ trial: false, timeout: 1000 })
      .catch(() => {
        // A disabled button rejects the click — that itself proves the block.
      });
    // Give any (erroneous) request a beat to fire before asserting it did not.
    await expect.poll(() => api.count()).toBe(callsAfterLock);
  });

  // AC-2: the lockout message communicates the 15-minute cooldown and roughly
  // when sign-in can be retried.
  test('lockout message communicates the 15-minute cooldown and retry time', async ({
    page,
  }) => {
    await mockAlwaysReject(page);
    await page.goto(LOGIN_ROUTE);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await submitLogin(page, approverUser.email, wrongPassword);
      await expect(meaningfulAlert(page)).toBeVisible();
    }

    const alert = meaningfulAlert(page);
    await expect(alert).toBeVisible();
    // Communicates the locked state...
    await expect(alert).toHaveText(/lock(ed)?|locked out/i);
    // ...the 15-minute cooldown duration...
    await expect(alert).toHaveText(/15\s*min(ute)?s?/i);
    // ...and a retry-time hint (when sign-in can be tried again).
    await expect(alert).toHaveText(/try again|retry|wait|in 15/i);
  });

  // Reinforces the distinction at the E2E layer (mirrors Vitest AC-3, kept light):
  // BELOW the threshold the ORDINARY credential-failure message shows — not the
  // lockout message — and the form remains submittable.
  test('below the lockout threshold the ordinary credential-failure message shows, not lockout', async ({
    page,
  }) => {
    await mockAlwaysReject(page);
    await page.goto(LOGIN_ROUTE);

    // Two failures — well under the 5-attempt threshold.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await submitLogin(page, approverUser.email, wrongPassword);
      await expect(meaningfulAlert(page)).toBeVisible();
    }

    const alert = meaningfulAlert(page);
    await expect(alert).toBeVisible();
    // Ordinary credential-failure wording...
    await expect(alert).toHaveText(
      /invalid|incorrect|email or password|credential/i,
    );
    // ...and NOT the lockout wording yet.
    await expect(alert).not.toHaveText(/lock(ed)?|locked out|15\s*min/i);

    // The form is still usable below the threshold.
    await expect(submitButton(page)).toBeEnabled();
  });
});
