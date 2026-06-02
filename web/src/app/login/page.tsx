'use client';

/**
 * Sign-in with role-based landing + account lockout (Epic 1, Stories 2 & 4 —
 * R1, R18, NFR6).
 *
 * Email + password form composed from Shadcn primitives. On submit it posts
 * `{ Username, Password }` to the same-origin auth login path (proxied to the
 * auth backend), then resolves the signed-in user's role from the swappable
 * source in `@/lib/auth/roles` and routes to the role-specific landing surface
 * (Importer → file import, Approver → transactions).
 *
 * Error handling (R18) DISTINGUISHES three failure classes with non-overlapping
 * wording, all surfaced inline via the single canonical `role="alert"` region
 * (and a toast) — never a redirect:
 *   - a 401 → a CREDENTIAL-failure message ("email or password is incorrect"),
 *   - a network / connectivity failure (the client surfaces `statusCode: 0`) →
 *     a DISTINCT "can't reach the service" message,
 *   - repeated credential failures → a LOCKOUT message (see below).
 *
 * Account lockout (R18 / NFR6): the form counts CONSECUTIVE failed sign-in
 * attempts. On the 5th consecutive 401 (MAX_FAILED_ATTEMPTS) it enters a
 * lockout state — the inline message swaps to distinct lockout wording that
 * communicates the 15-minute cooldown and a retry-time hint, and the submit
 * control is DISABLED so no further login requests can fire. The lockout is
 * SELF-CLEARING: a client-side timer fires at the cooldown end (LOCKOUT_COOLDOWN_MS
 * from now / `retryAt`) and recovers the form IN PLACE — clearing the lock state,
 * the error message, and resetting the failed-attempt counter — so the user can
 * retry without reloading the page, honouring AC-2's "try again at HH:MM" promise.
 * A successful sign-in also resets the counter. SPEC GAP (project-brief §13): the
 * auth spec documents no lockout response, so lockout is CLIENT-TRACKED; a backend
 * lockout signal (423/429) is additionally honoured as a tolerant fallback that
 * locks immediately regardless of the client counter.
 *
 * On success it also records the client-side session-start marker (Epic 1,
 * Story 3) so the SessionManager can enforce the 8-hour absolute cap and so
 * authenticated surfaces can perform their lightweight "is there a session?"
 * route check. The submit control stays disabled through the async portion of
 * the success chain (login → role resolve) so a fast double-click cannot fire a
 * second login POST while the role is resolving; it is only re-enabled once
 * navigation has been kicked off (router.push) or on an error path.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { post } from '@/lib/api/client';
import type { APIError } from '@/types/api';
import { fetchSignedInRole, resolveLandingRoute } from '@/lib/auth/roles';
import { markSessionStart } from '@/lib/session/session-client';
import {
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_COOLDOWN_MS,
  BACKEND_LOCKOUT_STATUS_CODES,
  buildLockoutMessage,
} from '@/lib/auth/lockout';
import { useToast } from '@/contexts/ToastContext';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Same-origin login path — proxied to `${AUTH_BASE}/v1/auth/login`. */
const LOGIN_PATH = '/api/auth/login';

const CREDENTIAL_ERROR =
  'The email or password you entered is incorrect. Please try again.';
const CONNECTIVITY_ERROR =
  "We can't reach the sign-in service right now. Please check your connection and try again.";

/**
 * Narrows an unknown thrown value to the client's typed APIError shape.
 * Anything without a numeric `statusCode` is treated as a connectivity failure
 * (the safest default — we never imply "wrong password" for an unknown fault).
 */
function isApiError(error: unknown): error is APIError {
  return typeof error === 'object' && error !== null && 'statusCode' in error;
}

export default function LoginPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Consecutive failed sign-in attempts. Reset to 0 on a successful sign-in or
  // when the lockout cooldown elapses.
  const [failedAttempts, setFailedAttempts] = useState(0);
  // When set, the form is locked: submit is blocked and the lockout message is
  // shown. Holds the wall-clock ms at which sign-in may be retried.
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);

  const isLocked = lockedUntil !== null;

  // Handle to the pending cooldown timer so we can clear it on unmount / when the
  // lock state changes (avoids leaks and stale fires).
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Cooldown recovery (MEDIUM-1 fix): while the form is locked, schedule a timer
   * that fires at the cooldown end (`lockedUntil`) and recovers the form IN PLACE
   * — clears the lock, wipes the lockout message, and resets the failed-attempt
   * counter — so the user can retry without reloading. The "try again at HH:MM"
   * hint now reflects real in-place recovery. The timer is torn down on unmount
   * and whenever `lockedUntil` changes (re-lock / manual clear).
   */
  useEffect(() => {
    if (lockedUntil === null) return;

    const remainingMs = Math.max(0, lockedUntil - Date.now());
    cooldownTimer.current = setTimeout(() => {
      setLockedUntil(null);
      setFailedAttempts(0);
      setError(null);
      cooldownTimer.current = null;
    }, remainingMs);

    return () => {
      if (cooldownTimer.current !== null) {
        clearTimeout(cooldownTimer.current);
        cooldownTimer.current = null;
      }
    };
  }, [lockedUntil]);

  /** Enters the lockout state: blocks submit + surfaces the lockout message. */
  function lockForm() {
    const retryAt = Date.now() + LOCKOUT_COOLDOWN_MS;
    setLockedUntil(retryAt);
    const message = buildLockoutMessage(retryAt);
    setError(message);
    showToast({
      variant: 'error',
      title: 'Account temporarily locked',
      message,
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A locked form fires NO further login requests (R18 — blocks attempts).
    // Also guard against re-entry while a submit is in flight (defence in depth
    // against a fast double-submit before React re-disables the control).
    if (isLocked || submitting) return;

    setError(null);
    setSubmitting(true);

    try {
      // The backend expects PascalCase {Username, Password}; the email field is
      // the username (project-brief §3 / §9).
      await post(LOGIN_PATH, { Username: email, Password: password });

      // Login succeeded (session cookie now set). Reset the failed-attempt
      // counter so accumulated near-threshold failures don't carry over.
      setFailedAttempts(0);
      setLockedUntil(null);

      // Record the client-side session-start marker so the SessionManager's
      // absolute-cap clock and the authenticated-surface route guard have a
      // signal to read.
      markSessionStart();

      // Resolve the role from the swappable source, then route to the
      // role-specific landing surface. `submitting` is deliberately KEPT true
      // across this async role fetch (MEDIUM-2 fix): it is a network round-trip,
      // and re-enabling the button while it is in flight would let a fast
      // double-click fire a second login POST during role resolution. We only
      // re-enable AFTER navigation has been kicked off (below) — by which point
      // the real app is already leaving this surface, and a leftover-mounted
      // form (e.g. navigation interrupted) is not stuck permanently disabled.
      const role = await fetchSignedInRole(email);
      router.push(resolveLandingRoute(role));
      setSubmitting(false);
    } catch (err) {
      const statusCode = isApiError(err) ? err.statusCode : undefined;
      const isCredentialFailure = statusCode === 401;
      const isBackendLockout =
        typeof statusCode === 'number' &&
        BACKEND_LOCKOUT_STATUS_CODES.includes(statusCode);

      // Re-enable the form so the user can retry after a failure.
      setSubmitting(false);

      // A backend lockout signal (423/429) locks immediately, regardless of the
      // client counter (tolerant fallback for the spec gap, project-brief §13).
      if (isBackendLockout) {
        lockForm();
        return;
      }

      if (isCredentialFailure) {
        // Count this consecutive credential failure. On the threshold-th one,
        // enter the lockout state instead of the ordinary credential message.
        const nextCount = failedAttempts + 1;
        setFailedAttempts(nextCount);

        if (nextCount >= MAX_FAILED_ATTEMPTS) {
          lockForm();
          return;
        }

        setError(CREDENTIAL_ERROR);
        showToast({
          variant: 'error',
          title: 'Sign-in failed',
          message: CREDENTIAL_ERROR,
        });
        return;
      }

      // Anything else (incl. statusCode 0 / unknown) is a connectivity failure.
      setError(CONNECTIVITY_ERROR);
      showToast({
        variant: 'error',
        title: 'Connection problem',
        message: CONNECTIVITY_ERROR,
      });
    }
  }

  return (
    <main
      aria-labelledby="login-heading"
      className="bg-background flex min-h-screen items-center justify-center px-4 py-8"
    >
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle id="login-heading" className="text-2xl">
            Sign in
          </CardTitle>
          <CardDescription>
            Enter your email and password to access the Transaction Import &amp;
            Approval System.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit}
            noValidate
            className="flex flex-col gap-6"
          >
            {error && (
              <p
                role="alert"
                className="text-destructive border-destructive/40 bg-destructive/10 rounded-md border px-3 py-2 text-sm"
              >
                {error}
              </p>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLocked}
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLocked}
                required
              />
            </div>

            <Button
              type="submit"
              disabled={submitting || isLocked}
              className="w-full"
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
