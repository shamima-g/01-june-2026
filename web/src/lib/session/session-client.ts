/**
 * Client-side session marker (Epic 1, Story 3 — R17 / NFR6 support).
 *
 * The real session lives in an HttpOnly + SameSite=Strict cookie that JavaScript
 * can neither read nor clear (project-brief §3). That cookie is the source of
 * truth for the BACKEND. The browser, however, needs a small readable signal to:
 *
 *   1. know WHEN the current session started, so the 8-hour absolute cap
 *      (`ABSOLUTE_SESSION_MS`) can be enforced client-side regardless of
 *      activity, and
 *   2. let authenticated surfaces cheaply check "is there a session?" and bounce
 *      an unauthenticated visitor to `/login` (lightweight client-side route
 *      protection consistent with Story 2's routing).
 *
 * This marker is intentionally NON-AUTHORITATIVE — it carries no secret and is
 * not trusted by the backend. Forging it only grants access to placeholder
 * surfaces whose data reads still 401 without the real cookie. It exists purely
 * to drive the timeout lifecycle and the redirect UX. Epics 2-4 build on these
 * three primitives (`markSessionStart`, `getSessionStart`, `clearSession`).
 */

/** localStorage key holding the epoch-ms timestamp the current session began. */
const SESSION_START_KEY = 'session.startedAt';

/** True when running in a browser with a usable localStorage. */
function hasStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

/**
 * Records the moment a session began (called right after a successful sign-in).
 * The absolute-timeout clock is measured from this instant.
 */
export function markSessionStart(at: number = Date.now()): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(SESSION_START_KEY, String(at));
  } catch {
    // Storage may be unavailable (private mode / quota). The SessionManager
    // falls back to its mount time, so a missing marker never breaks the cap.
  }
}

/**
 * Returns the recorded session-start timestamp, or `null` when none is stored
 * (no active session, or storage unavailable).
 */
export function getSessionStart(): number | null {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(SESSION_START_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** True when a session-start marker is present (cheap "are we signed in?" check). */
export function hasSession(): boolean {
  return getSessionStart() !== null;
}

/**
 * Clears the client-side session marker. Called on explicit sign-out and on
 * every timeout-driven sign-out, AFTER the backend logout POST so the two stay
 * in lockstep. The HttpOnly cookie itself is cleared server-side by that POST.
 */
export function clearSession(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(SESSION_START_KEY);
  } catch {
    // Nothing actionable — the cookie clear from the logout POST is what gates
    // real access; this marker is best-effort.
  }
}
