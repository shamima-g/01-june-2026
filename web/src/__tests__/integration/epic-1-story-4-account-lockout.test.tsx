/**
 * Story Metadata:
 * - Epic 1, Story 4: Account lockout after repeated failed sign-ins
 * - Route: /login
 * - Target Files:
 *     web/src/app/login/page.tsx   (modify_existing — add failed-attempt tracking + lockout state)
 *     web/src/lib/auth/lockout.ts  (new — shared threshold/cooldown constants)
 * - Page Action: modify_existing
 *
 * Requirements: R18 (lockout after 5 failed attempts, 15-min cooldown), NFR6
 * (5-failed-attempt lockout with 15-minute cooldown).
 *
 * Failing-first (TDD red) tests for the lockout-tracking logic that lives in the
 * React render and is therefore the Vitest layer (testing-policy §"Test at the
 * layer where the behaviour lives"):
 *   - below threshold (1–4 × 401) → ordinary CREDENTIAL-failure message, NOT
 *     the lockout message (AC-3, the sole vitest-tagged AC);
 *   - at threshold (5th consecutive 401) → form transitions to LOCKOUT state:
 *     lockout message shown + submit blocked (the testable core of AC-1);
 *   - the lockout message communicates the 15-minute cooldown (the testable core
 *     of AC-2 — exact wall-clock retry time is browser-observable and deferred to
 *     the Playwright sibling);
 *   - a SUCCESSFUL login before threshold resets the failed-attempt counter, so a
 *     subsequent single 401 does NOT trip the lockout (counter-reset contract).
 *
 * AC-1 and AC-2 are playwright-tagged and driven end-to-end (real cooldown clock,
 * real submit blocking across the round-trip) by the sibling spec
 * web/e2e/epic-1-story-4-account-lockout.spec.ts. This file pins the
 * jsdom-observable state machine those E2E tests sit on top of.
 *
 * SPEC GAP (project-brief §13 / story specGaps): the auth spec documents NO
 * lockout response (no 423/429). Lockout is therefore CLIENT-TRACKED — the form
 * counts consecutive 401s on the login endpoint and enforces a client-side
 * 15-minute cooldown. These tests pin that client-tracked contract (5 × 401 →
 * lockout) as the PRIMARY guarantee, since it's what we can enforce without
 * backend support. A backend lockout signal (423/429) surfacing the same message
 * is additionally asserted as a tolerant fallback. The threshold (5) and cooldown
 * (15 min) come from `@/lib/auth/lockout` so tests and impl share ONE source.
 *
 * Per testing-policy mocking strategy: only the HTTP client (@/lib/api/client)
 * and the Next.js navigation + toast boundaries are mocked. The login page is the
 * REAL code under test.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Production imports — these WILL FAIL until implemented (TDD red).
import LoginPage from '@/app/login/page';
import {
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_COOLDOWN_MINUTES,
} from '@/lib/auth/lockout';
import { get, post } from '@/lib/api/client';
import type { APIError } from '@/types/api';
import {
  createLoginSuccessResponse,
  createMockUserInfo,
} from '../helpers/epic-1-mock-data';

// HTTP client — mocked per testing-policy (client.ts is never exercised here).
vi.mock('@/lib/api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
}));

// Navigation boundary — assert client-side push targets (jsdom-observable).
const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: pushMock, refresh: vi.fn() }),
  usePathname: () => '/login',
  useSearchParams: () => new URLSearchParams(),
}));

// Toast boundary — error surfacing reuses the shared toast system.
const showToastMock = vi.fn();
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({
    showToast: showToastMock,
    toasts: [],
    dismissToast: vi.fn(),
    clearAllToasts: vi.fn(),
  }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const mockGet = get as ReturnType<typeof vi.fn>;
const mockPost = post as ReturnType<typeof vi.fn>;

/** Builds a typed APIError as the client throws it (see client.ts handleErrorResponse). */
function apiError(statusCode: number, message: string): APIError {
  return {
    message,
    statusCode,
    details: [message],
    endpoint: '/api/auth/login',
  };
}

/** Fills the sign-in form and submits it once. */
async function attemptSignIn(
  user: ReturnType<typeof userEvent.setup>,
  email = 'approver@example.com',
  password = 'bad-pw',
) {
  const emailField = screen.getByLabelText(/email/i);
  const passwordField = screen.getByLabelText(/password/i);
  await user.clear(emailField);
  await user.clear(passwordField);
  await user.type(emailField, email);
  await user.type(passwordField, password);
  await user.click(screen.getByRole('button', { name: /sign in/i }));
}

/** Wording that means "ordinary credential failure" (Story 2 message). */
const CREDENTIAL_WORDING = /incorrect|invalid|credential|email or password/i;
/** Wording that means "the account is locked / in cooldown". */
const LOCKOUT_WORDING = /lock|too many|temporarily|cooldown|try again in/i;

describe('Epic 1 Story 4: account lockout after repeated failed sign-ins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Sanity-pin the shared constants the contract is built on so a drift in the
  // threshold/cooldown source surfaces here rather than silently in the impl.
  it('exposes the brief-mandated threshold (5) and cooldown (15 min) constants', () => {
    expect(MAX_FAILED_ATTEMPTS).toBe(5);
    expect(LOCKOUT_COOLDOWN_MINUTES).toBe(15);
  });

  // AC-3 — below threshold the form keeps showing the ORDINARY credential-failure
  // message and does NOT show the lockout message. Exercises 1 fewer than the
  // threshold so the boundary is pinned to the shared constant, not a literal.
  it('shows the ordinary credential message (not lockout) for failures below the threshold', async () => {
    const user = userEvent.setup();
    mockPost.mockRejectedValue(apiError(401, 'Unauthorized'));

    render(<LoginPage />);

    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
      await attemptSignIn(user);
      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(CREDENTIAL_WORDING);
      });
    }

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(CREDENTIAL_WORDING);
    expect(alert).not.toHaveTextContent(LOCKOUT_WORDING);
    // Still able to keep trying — submit is not blocked below threshold.
    expect(screen.getByRole('button', { name: /sign in/i })).toBeEnabled();
  });

  // AC-1 (jsdom-observable core) — on the Nth consecutive 401 (N = threshold) the
  // form transitions to the LOCKOUT state: the message switches to lockout wording
  // and the submit control is blocked from making further attempts.
  it('transitions to lockout (message + blocked submit) on the threshold-th failure', async () => {
    const user = userEvent.setup();
    mockPost.mockRejectedValue(apiError(401, 'Unauthorized'));

    render(<LoginPage />);

    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      await attemptSignIn(user);
    }

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(LOCKOUT_WORDING);
    });
    // Submit must be blocked once locked — no further attempts can be made.
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled();
  });

  // AC-2 (jsdom-observable core) — the lockout message communicates the 15-minute
  // cooldown. The exact wall-clock retry timestamp is browser-time-dependent and
  // is asserted in the Playwright sibling; here we pin that the duration shown is
  // derived from the shared cooldown constant.
  it('communicates the 15-minute cooldown in the lockout message', async () => {
    const user = userEvent.setup();
    mockPost.mockRejectedValue(apiError(401, 'Unauthorized'));

    render(<LoginPage />);

    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      await attemptSignIn(user);
    }

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(LOCKOUT_WORDING);
    // The cooldown figure must come from the shared constant (15), and be framed
    // as minutes so the user knows how long to wait.
    expect(alert).toHaveTextContent(
      new RegExp(`${LOCKOUT_COOLDOWN_MINUTES}\\s*min`, 'i'),
    );
  });

  // Counter-reset contract — a SUCCESSFUL login resets the failed-attempt counter,
  // so accumulated near-threshold failures don't carry over. After (threshold − 1)
  // failures, one success, then a single new 401, the form must still show the
  // ORDINARY credential message and stay UNLOCKED.
  it('resets the failed-attempt counter after a successful sign-in', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    // (threshold − 1) consecutive 401s — one short of lockout.
    mockPost.mockRejectedValue(apiError(401, 'Unauthorized'));
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
      await attemptSignIn(user);
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent(CREDENTIAL_WORDING),
      );
    }

    // A successful login resolves the role and routes away — this resets the
    // counter (success path).
    mockPost.mockResolvedValue(createLoginSuccessResponse());
    mockGet.mockResolvedValue(createMockUserInfo('Approver'));
    await attemptSignIn(user, 'approver@example.com', 'correct-pw');
    await waitFor(() => expect(pushMock).toHaveBeenCalled());

    // A single fresh 401 must read as an ordinary credential failure — NOT lockout
    // (the prior near-threshold failures were cleared by the success).
    mockPost.mockReset();
    mockPost.mockRejectedValue(apiError(401, 'Unauthorized'));
    await attemptSignIn(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(CREDENTIAL_WORDING);
    expect(alert).not.toHaveTextContent(LOCKOUT_WORDING);
    expect(screen.getByRole('button', { name: /sign in/i })).toBeEnabled();
  });

  // Tolerant fallback (spec-gap §13) — if the backend itself returns a lockout
  // signal (423 Locked / 429 Too Many Requests) the form must surface the lockout
  // message and block submit even BEFORE the client counter reaches the threshold.
  // This keeps the form correct if the backend later grows server-side lockout.
  it('surfaces lockout when the backend returns a lockout signal (423/429)', async () => {
    const user = userEvent.setup();
    mockPost.mockRejectedValue(apiError(429, 'Too Many Requests'));

    render(<LoginPage />);
    await attemptSignIn(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(LOCKOUT_WORDING);
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled();
  });
});
