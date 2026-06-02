'use client';

/**
 * Lightweight client-side route guard for authenticated surfaces (Epic 1,
 * Story 3 — session-cleared route protection, consistent with Story 2 routing).
 *
 * Wraps the content of any page that requires a signed-in user. It reads the
 * client-side session marker and, if no session is present, redirects to
 * `/login` instead of rendering protected content. This is the user-observable
 * proof that sign-out / timeout truly cleared the session: a later direct
 * navigation to a protected route bounces back to the sign-in screen.
 *
 * The session marker lives in localStorage, which is unavailable during SSR, so
 * the marker is read through `useSyncExternalStore` with a server snapshot of
 * `null` (unknown). That cleanly separates the three render states — server /
 * pre-hydration "unknown", client "has session", client "no session" — without
 * a hydration mismatch and without calling setState inside an effect. The effect
 * is reserved for the redirect side-effect alone (an external-system update),
 * which is exactly what effects are for.
 *
 * This guard is intentionally NON-AUTHORITATIVE — the real gate is the HttpOnly
 * session cookie, which the backend enforces by 401-ing data reads. The guard
 * exists for UX and to keep route protection consistent and minimal as Epics
 * 2-4 build on it.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';

import { SIGNED_OUT_ROUTE } from '@/lib/session/constants';
import { hasSession } from '@/lib/session/session-client';

/**
 * Subscribe to session-marker changes so the guard re-evaluates if another tab
 * (or the SessionManager's sign-out) clears the marker via localStorage.
 */
function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

/** Client snapshot — `true`/`false` once we're in the browser. */
function getClientSnapshot(): boolean {
  return hasSession();
}

/** Server / pre-hydration snapshot — session state is unknown until mounted. */
function getServerSnapshot(): null {
  return null;
}

export function RequireSession({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  // `null` = unknown (server / pre-hydration), `true`/`false` = resolved client.
  const sessionPresent = useSyncExternalStore<boolean | null>(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );

  useEffect(() => {
    if (sessionPresent === false) {
      router.replace(SIGNED_OUT_ROUTE);
    }
  }, [sessionPresent, router]);

  // Render protected content only once a session is confirmed; render nothing
  // while unknown or while the redirect is in flight, so a signed-out user never
  // sees a flash of protected content.
  if (sessionPresent !== true) return null;

  return <>{children}</>;
}
