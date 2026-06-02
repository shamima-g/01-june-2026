/**
 * Account-lockout thresholds (R18 / NFR6, project-brief §7 R18 + §10 NFR6).
 *
 * Single source of truth shared by the login page and its tests so the two
 * never drift. The brief mandates a lockout after 5 consecutive failed
 * sign-in attempts, with a 15-minute cooldown before sign-in can be retried.
 *
 * SPEC GAP (project-brief §13): the auth spec documents NO lockout response
 * code — the backend keeps returning 401 for each bad attempt. Lockout is
 * therefore CLIENT-TRACKED: the login form counts consecutive 401s and
 * enforces the cooldown itself. A backend-sent lockout signal (423 Locked /
 * 429 Too Many Requests) is additionally honoured as a tolerant fallback.
 *
 * Source: requirements-2c.md §6.6.1 → project-brief §7 (R18) / §10 (NFR6).
 */

/** Consecutive failed sign-in attempts that trip the lockout. */
export const MAX_FAILED_ATTEMPTS = 5;

/** Cooldown duration (minutes) before sign-in can be retried after lockout. */
export const LOCKOUT_COOLDOWN_MINUTES = 15;

/** Cooldown duration in milliseconds, derived from the minute constant. */
export const LOCKOUT_COOLDOWN_MS = LOCKOUT_COOLDOWN_MINUTES * 60 * 1000;

/**
 * HTTP status codes a backend MAY use to signal its own lockout. When the
 * login endpoint returns one of these, the form surfaces the lockout state
 * even before the client counter reaches MAX_FAILED_ATTEMPTS (tolerant
 * fallback for the spec gap above).
 */
export const BACKEND_LOCKOUT_STATUS_CODES: readonly number[] = [423, 429];

/**
 * Formats a retry-time hint from a cooldown end timestamp — e.g. "14:32".
 * Used in the lockout message so the user knows roughly when they can retry.
 */
export function formatRetryTime(retryAtMs: number): string {
  return new Date(retryAtMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Builds the user-facing lockout message. Communicates the locked state, the
 * 15-minute cooldown duration (from the shared constant), and a retry-time
 * hint so the user knows when sign-in can be attempted again.
 */
export function buildLockoutMessage(retryAtMs: number): string {
  return (
    `Too many failed sign-in attempts. Your account is temporarily locked. ` +
    `Please wait ${LOCKOUT_COOLDOWN_MINUTES} min and try again at ` +
    `${formatRetryTime(retryAtMs)}.`
  );
}
