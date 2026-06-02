/**
 * Session-lifecycle thresholds (R17 / NFR6, project-brief §10 NFR6 + §7 R17).
 *
 * Single source of truth shared by the SessionManager implementation and its
 * tests so the two never drift. Values are expressed in milliseconds because
 * the SessionManager drives them through timers.
 *
 *   - Idle timeout: 15 minutes of no user activity before sign-out begins.
 *   - Warning countdown: a 60-second grace window, surfaced as a countdown
 *     dialog, during which any activity cancels the impending sign-out.
 *   - Absolute session: 8 hours from sign-in, after which the session ends
 *     regardless of recent activity.
 *
 * Source: requirements-2c.md §6.6.1 → project-brief §7 (R17) / §10 (NFR6).
 */

/** Idle timeout — 15 minutes in milliseconds. */
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

/** Warning countdown — 60 seconds in milliseconds. */
export const WARNING_COUNTDOWN_MS = 60 * 1000;

/** Absolute session cap — 8 hours in milliseconds. */
export const ABSOLUTE_SESSION_MS = 8 * 60 * 60 * 1000;

/**
 * The same-origin proxy path the explicit sign-out and every timeout-driven
 * sign-out POST through (project-brief §3: `POST /v1/auth/logout`, reached via
 * the `/api/auth/*` proxy so the SameSite=Strict session cookie is attached).
 */
export const LOGOUT_PATH = '/api/auth/logout';

/**
 * Where a cleared session returns the user — the sign-in screen owned by
 * Story 2's `/login` route (web/src/lib/auth/roles.ts redirects here too).
 */
export const SIGNED_OUT_ROUTE = '/login';
