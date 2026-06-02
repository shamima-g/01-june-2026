'use client';

/**
 * Global session-lifecycle manager (Epic 1, Story 3 — R17 / NFR6).
 *
 * Mounted once, app-wide (see the root layout). On every AUTHENTICATED surface
 * it enforces three session-security rules from project-brief §10 (NFR6):
 *
 *   1. Idle timeout — after `IDLE_TIMEOUT_MS` (15 min) of no user activity a
 *      warning dialog appears with a `WARNING_COUNTDOWN_MS` (60 s) countdown
 *      BEFORE sign-out (AC-1). Any activity, or the dialog's "Stay signed in"
 *      button, dismisses the warning and resets the idle clock (AC-2).
 *   2. Absolute cap — `ABSOLUTE_SESSION_MS` (8 h) after sign-in the session ends
 *      regardless of activity (AC-3).
 *   3. Explicit sign-out — the "Sign out" control ends the session on demand.
 *
 * Every path that ends a session does the SAME thing: POST `LOGOUT_PATH` through
 * the API client (clearing the HttpOnly cookie server-side), clear the local
 * session marker, and redirect to `SIGNED_OUT_ROUTE` (/login) (AC-4).
 *
 * The manager is INERT on the sign-in screen itself — it must never sign out an
 * unauthenticated visitor sitting on `/login`.
 *
 * Implementation note: the whole timer machine is wired in a SINGLE mount effect
 * keyed only on the surface (authenticated vs /login). The timer callbacks read
 * the latest router/pathname through refs rather than being effect dependencies,
 * so the idle/absolute timers are never torn down and recreated by unrelated
 * re-renders (which would otherwise keep resetting the 15-minute clock).
 *
 * The warning dialog is composed from the Shadcn Dialog primitive (Radix under
 * the hood) so it is a real focus-trapping modal queryable as role="dialog" with
 * an accessible name — never a hand-rolled overlay.
 */

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { post } from '@/lib/api/client';
import {
  ABSOLUTE_SESSION_MS,
  IDLE_TIMEOUT_MS,
  LOGOUT_PATH,
  SIGNED_OUT_ROUTE,
  WARNING_COUNTDOWN_MS,
} from '@/lib/session/constants';
import { clearSession, getSessionStart } from '@/lib/session/session-client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Browser activity signals that count as "the user is still here" and reset the
 * idle clock. Pointer, keyboard, scroll, and touch cover desktop and mobile.
 */
const ACTIVITY_EVENTS: ReadonlyArray<keyof DocumentEventMap> = [
  'mousemove',
  'mousedown',
  'keydown',
  'scroll',
  'touchstart',
  'wheel',
];

/** Whole seconds remaining, rounded up, for the human-readable countdown copy. */
function secondsFrom(ms: number): number {
  return Math.max(0, Math.ceil(ms / 1000));
}

/**
 * Tiny grace appended to the absolute-cap deadline so the cap fires STRICTLY
 * AFTER the 8-hour window elapses, never exactly on the final permitted instant
 * of activity. Sub-second at an 8-hour scale, so it is immaterial to the
 * security guarantee — it just makes "after 8 hours" literal.
 */
const ABSOLUTE_CAP_GRACE_MS = 250;

export function SessionManager() {
  const router = useRouter();
  const pathname = usePathname();

  // The manager runs everywhere EXCEPT the sign-in screen, so it never logs out
  // an unauthenticated visitor parked on /login.
  const isActiveSurface = pathname !== SIGNED_OUT_ROUTE;

  const [warningVisible, setWarningVisible] = useState(false);
  const [remainingMs, setRemainingMs] = useState(WARNING_COUNTDOWN_MS);

  // Keep the router reachable from the (mount-only) timer callbacks without
  // making it an effect dependency — a fresh router object per render must not
  // tear down and restart the idle/absolute timers.
  const routerRef = useRef(router);
  routerRef.current = router;

  // Imperative handle the dialog buttons call to reset the idle clock. Assigned
  // inside the mount effect; stable identity for the button onClick handlers.
  const resetIdleRef = useRef<() => void>(() => {});
  const endSessionRef = useRef<() => void>(() => {});

  // Idle-timeout + activity tracking + absolute-cap, all wired once per surface.
  useEffect(() => {
    if (!isActiveSurface) return;

    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let countdownTimer: ReturnType<typeof setInterval> | null = null;
    let absoluteTimer: ReturnType<typeof setTimeout> | null = null;
    let signingOut = false;

    const clearIdle = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };
    const clearCountdown = () => {
      if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }
    };

    /**
     * Ends the session: backend logout (clears the HttpOnly cookie), clear the
     * local marker, then redirect to the sign-in screen. Shared by idle expiry,
     * the absolute cap, and the explicit "Sign out" control.
     */
    const endSession = () => {
      if (signingOut) return;
      signingOut = true;

      clearIdle();
      clearCountdown();
      if (absoluteTimer) {
        clearTimeout(absoluteTimer);
        absoluteTimer = null;
      }
      setWarningVisible(false);

      void (async () => {
        try {
          await post(LOGOUT_PATH);
        } catch {
          // Even if the logout POST fails (e.g. network), we still clear the
          // local session and bounce the user — never strand them in an
          // ambiguous signed-in-but-expired state. The cookie's own ~1 h expiry
          // backstops the server.
        } finally {
          clearSession();
          routerRef.current.push(SIGNED_OUT_ROUTE);
        }
      })();
    };

    /** Opens the warning dialog and starts the 60-second grace countdown. */
    const beginWarning = () => {
      setRemainingMs(WARNING_COUNTDOWN_MS);
      setWarningVisible(true);

      const deadline = Date.now() + WARNING_COUNTDOWN_MS;
      clearCountdown();
      countdownTimer = setInterval(() => {
        const left = deadline - Date.now();
        if (left <= 0) {
          clearCountdown();
          setRemainingMs(0);
          endSession();
          return;
        }
        setRemainingMs(left);
      }, 1000);
    };

    /**
     * Resets the idle clock: cancels any pending warning/countdown and schedules
     * a fresh idle timeout. Called on mount and on every user-activity event and
     * by the dialog's "Stay signed in" button.
     */
    const resetIdle = () => {
      if (signingOut) return;
      clearCountdown();
      setWarningVisible(false);
      clearIdle();
      idleTimer = setTimeout(beginWarning, IDLE_TIMEOUT_MS);
    };

    // Expose the imperative handles the dialog buttons invoke.
    resetIdleRef.current = resetIdle;
    endSessionRef.current = endSession;

    // Arm the idle clock and start listening for activity.
    resetIdle();
    const handleActivity = () => resetIdle();
    ACTIVITY_EVENTS.forEach((event) =>
      document.addEventListener(event, handleActivity, { passive: true }),
    );

    // Arm the absolute cap from the recorded sign-in time when present, else
    // from this mount (e.g. a freshly rendered manager in tests). Fires
    // regardless of activity — activity only ever resets the idle clock.
    const startedAt = getSessionStart() ?? Date.now();
    const elapsed = Date.now() - startedAt;
    const absoluteRemaining =
      Math.max(0, ABSOLUTE_SESSION_MS - elapsed) + ABSOLUTE_CAP_GRACE_MS;
    absoluteTimer = setTimeout(endSession, absoluteRemaining);

    return () => {
      ACTIVITY_EVENTS.forEach((event) =>
        document.removeEventListener(event, handleActivity),
      );
      clearIdle();
      clearCountdown();
      if (absoluteTimer) {
        clearTimeout(absoluteTimer);
        absoluteTimer = null;
      }
    };
  }, [isActiveSurface]);

  const remainingSeconds = secondsFrom(remainingMs);

  return (
    <>
      {/* Explicit sign-out control — authenticated surfaces only. A minimal
          top-right chrome bar keeps it consistently reachable from every page;
          Epics 2-4 extend this chrome with role-aware navigation. Inert (absent)
          on /login. */}
      {isActiveSurface && (
        <div className="bg-card border-border flex justify-end border-b px-4 py-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => endSessionRef.current()}
          >
            Sign out
          </Button>
        </div>
      )}

      <Dialog open={warningVisible}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Your session is about to expire</DialogTitle>
            <DialogDescription>
              You&apos;ve been inactive for a while. For your security
              you&apos;ll be signed out in{' '}
              <span aria-live="polite">{remainingSeconds}</span> seconds. Choose
              &quot;Stay signed in&quot; to continue.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => endSessionRef.current()}
            >
              Sign out now
            </Button>
            <Button type="button" onClick={() => resetIdleRef.current()}>
              Stay signed in
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
