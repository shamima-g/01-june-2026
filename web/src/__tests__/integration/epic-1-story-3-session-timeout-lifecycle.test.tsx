/**
 * Story Metadata:
 * - Epic 1, Story 3: Sign-out and session-timeout lifecycle
 * - Route: null (SessionManager is a global component mounted in the app shell,
 *           not a routable page)
 * - Target Files:
 *     web/src/components/session/SessionManager.tsx  (new — global session layer)
 *     web/src/lib/session/constants.ts               (new — shared thresholds)
 * - Page Action: create_new
 *
 * Failing-first (TDD red) tests for the TIMER-DRIVEN session behaviour, which
 * lives in the React render (the warning dialog shows/hides; on expiry a
 * logout + redirect side-effect fires) and is therefore the Vitest layer
 * (testing-policy §"Test at the layer where the behaviour lives"):
 *
 *   - AC-1: after 15 min idle a 60-second warning countdown dialog appears
 *           BEFORE sign-out.
 *   - AC-2: acting during the countdown keeps the session active and dismisses
 *           the warning (the idle clock resets, logout never fires).
 *   - AC-3: reaching the 8-hour absolute cap ends the session regardless of
 *           recent activity.
 *
 * AC-4 (explicit sign-out returns to the sign-in screen with the cookie cleared
 * across a real browser round-trip) is playwright-tagged and lives in the
 * sibling E2E spec — not re-driven here.
 *
 * Time is controlled deterministically with Vitest fake timers; user input is
 * driven through `userEvent` wired to advance those fake timers. Per the
 * testing-policy mocking strategy, only the HTTP client (@/lib/api/client) and
 * the Next.js navigation boundary are mocked — SessionManager and the shared
 * session constants are the REAL code under test. Assertions target
 * user-observable outcomes (dialog visibility, the logout call firing, the
 * redirect target), never internal timer variables.
 *
 * Requirements: R17, NFR6 (project-brief §7 / §10, source requirements-2c.md §6.6.1).
 */
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Production imports — these WILL FAIL until implemented (TDD red).
import { SessionManager } from '@/components/session/SessionManager';
import { post } from '@/lib/api/client';
import {
  IDLE_TIMEOUT_MS,
  WARNING_COUNTDOWN_MS,
  ABSOLUTE_SESSION_MS,
  LOGOUT_PATH,
  SIGNED_OUT_ROUTE,
} from '@/lib/session/constants';

// HTTP client — mocked per testing-policy (client.ts is never exercised here).
// SessionManager signs out via `post(LOGOUT_PATH)`, which proxies the backend
// `POST /v1/auth/logout` so the session cookie is cleared server-side.
vi.mock('@/lib/api/client', () => ({
  post: vi.fn(),
}));

// Navigation boundary — assert the post-sign-out redirect target without a
// real router. SessionManager pushes the user back to the sign-in screen once
// the session is cleared.
const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: pushMock, refresh: vi.fn() }),
  usePathname: () => '/transactions',
  useSearchParams: () => new URLSearchParams(),
}));

const mockPost = post as ReturnType<typeof vi.fn>;

/**
 * Advances the fake clock by `ms` inside `act()` so React flushes the timer-
 * driven state updates (dialog open, countdown tick, expiry side-effects)
 * before any assertion runs.
 */
async function advanceTime(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Matches the warning dialog by its accessible role + name. */
function queryWarningDialog(): HTMLElement | null {
  return screen.queryByRole('dialog', {
    name: /session|expir|inactiv|sign|time/i,
  });
}

describe('Epic 1 Story 3: session-timeout lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockPost.mockResolvedValue({ Messages: ['Logged out'] });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  // AC-1 — after 15 minutes of inactivity the warning dialog appears with a
  // 60-second countdown, and crucially sign-out has NOT yet fired: the warning
  // precedes the logout. Just before the idle mark there is no dialog; crossing
  // the mark opens it; the visible text reflects the 60-second grace window.
  it('shows a 60-second warning countdown dialog after 15 minutes of inactivity, before signing out', async () => {
    render(<SessionManager />);

    // Just short of the idle threshold: no warning yet.
    await advanceTime(IDLE_TIMEOUT_MS - 1000);
    expect(queryWarningDialog()).not.toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();

    // Cross the idle threshold: the warning dialog opens with a 60s countdown.
    await advanceTime(1000);
    const dialog = queryWarningDialog();
    expect(dialog).toBeInTheDocument();
    // The countdown communicates roughly 60 seconds remaining (matches "60",
    // not a stray "6" elsewhere) and the logout has NOT fired yet — the warning
    // is shown BEFORE sign-out.
    expect(dialog).toHaveTextContent(/\b60\b/);
    expect(mockPost).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  // AC-1 (expiry half) — if the user does nothing, the 60-second countdown
  // elapses and the session is signed out: logout POSTs through the proxy and
  // the user is redirected to the sign-in screen.
  it('signs out and redirects to the sign-in screen when the warning countdown elapses', async () => {
    render(<SessionManager />);

    // Open the warning, then let the full countdown run out with no activity.
    await advanceTime(IDLE_TIMEOUT_MS);
    expect(queryWarningDialog()).toBeInTheDocument();

    await advanceTime(WARNING_COUNTDOWN_MS);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(LOGOUT_PATH);
    });
    expect(pushMock).toHaveBeenCalledWith(SIGNED_OUT_ROUTE);
  });

  // AC-2 — acting during the warning countdown keeps the session active: the
  // dialog is dismissed, NO logout fires, and the idle clock resets (a fresh
  // 15-minute window must elapse again before any new warning appears).
  it('keeps the session active and dismisses the warning when the user acts during the countdown', async () => {
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTimeAsync.bind(vi),
    });
    render(<SessionManager />);

    // Idle long enough to raise the warning, but act partway through the grace
    // window via the dialog's "Stay signed in" affordance.
    await advanceTime(IDLE_TIMEOUT_MS);
    const dialog = queryWarningDialog();
    expect(dialog).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', {
        name: /stay signed in|keep|continue|i'm here|dismiss/i,
      }),
    );

    // Warning gone, session intact: no logout, no redirect.
    await waitFor(() => {
      expect(queryWarningDialog()).not.toBeInTheDocument();
    });
    expect(mockPost).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();

    // The idle clock reset: advancing past the OLD countdown deadline (but
    // short of a fresh idle window) raises no warning and signs nobody out.
    await advanceTime(IDLE_TIMEOUT_MS - 1000);
    expect(queryWarningDialog()).not.toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  // AC-2 (activity-event half) — a raw user-activity event (pointer / key) on
  // the document during the IDLE window, before the warning is even raised,
  // also resets the idle clock: the warning is deferred, not skipped.
  it('resets the idle timer on user activity so the warning is deferred', async () => {
    render(<SessionManager />);

    // Almost at the idle mark, then a genuine activity event arrives.
    await advanceTime(IDLE_TIMEOUT_MS - 2000);
    expect(queryWarningDialog()).not.toBeInTheDocument();

    await act(async () => {
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });

    // The original deadline passes with no warning — the clock was reset.
    await advanceTime(2000);
    expect(queryWarningDialog()).not.toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();

    // A fresh full idle window from the activity event still raises the warning.
    await advanceTime(IDLE_TIMEOUT_MS);
    expect(queryWarningDialog()).toBeInTheDocument();
  });

  // AC-3 — the 8-hour absolute cap ends the session regardless of activity:
  // even with continuous activity keeping the idle timer perpetually reset, the
  // absolute deadline forces a sign-out (logout POST + redirect) once 8 hours
  // have elapsed since sign-in.
  it('ends the session at the 8-hour absolute cap despite ongoing activity', async () => {
    render(<SessionManager />);

    // Keep the session "busy": fire activity roughly every 10 minutes so the
    // 15-minute idle timer never expires on its own across the 8 hours.
    const tenMinutes = 10 * 60 * 1000;
    const ticks = Math.floor(ABSOLUTE_SESSION_MS / tenMinutes);
    for (let i = 0; i < ticks; i += 1) {
      await advanceTime(tenMinutes);
      await act(async () => {
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      });
    }

    // Idle-driven sign-out has NOT fired (activity kept resetting it)...
    expect(pushMock).not.toHaveBeenCalled();

    // ...but advancing to the absolute deadline forces the session to end.
    await advanceTime(ABSOLUTE_SESSION_MS - ticks * tenMinutes);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(LOGOUT_PATH);
    });
    expect(pushMock).toHaveBeenCalledWith(SIGNED_OUT_ROUTE);
  });

  // NFR1 / WCAG 2.2 AA — the warning countdown dialog has no axe violations
  // when shown (it is a focus-trapping modal a keyboard / screen-reader user
  // must be able to act on to stay signed in).
  it('has no accessibility violations on the warning dialog', async () => {
    render(<SessionManager />);

    await advanceTime(IDLE_TIMEOUT_MS);
    expect(queryWarningDialog()).toBeInTheDocument();

    expect(await axe(document.body)).toHaveNoViolations();
  });
});
