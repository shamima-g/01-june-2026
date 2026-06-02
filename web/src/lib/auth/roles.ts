/**
 * Role → landing-route resolution for post-sign-in routing (R1).
 *
 * After a successful `POST /api/auth/login` the session cookie is set, but the
 * login `DefaultResponse` (`{ Messages: [...] }`) carries NO role — so the
 * authenticated user's role must be resolved from a SEPARATE source before we
 * can route to the role-specific landing surface.
 *
 * SPEC GAP (project-brief §13-E): `GET /v1/auth/userinfo` is declared in the
 * auth spec but UNCONFIRMED on the running backend. The role source is therefore
 * intentionally SWAPPABLE and isolated in `fetchSignedInRole()`:
 *   1. best-effort `GET /api/auth/userinfo` (the documented-but-unconfirmed
 *      endpoint),
 *   2. fall back to `GET /api/transactions/v1/users` (the verified transactions
 *      backend) and match the record to the signed-in username.
 * A `userinfo` 404 / 401 must NOT hard-fail the flow — we fall through to the
 * documented alternative. When the endpoint is confirmed in a later story, only
 * this module changes; callers keep using `resolveLandingRoute`.
 */

import { get } from '@/lib/api/client';

/**
 * Same-origin role-source paths. Both ride through the Next.js proxy
 * (web/src/app/api/[...proxy]/route.ts): `/api/auth/*` → auth backend,
 * `/api/transactions/*` → transactions backend.
 */
const USERINFO_PATH = '/api/auth/userinfo';
const USERS_PATH = '/api/transactions/v1/users';

/**
 * The known custom roles for this system (project-brief §2). New roles surface
 * as new stories; additions land here.
 */
export type KnownRole = 'Importer' | 'Approver';

/**
 * Stable per-role landing surfaces. Epic 2 (file import) and Epic 3
 * (transactions) align on THESE constants so the post-login redirect target and
 * the screens that own those routes never drift apart.
 *
 * - Importer → the file-import / upload surface.
 * - Approver → the transactions table.
 */
export const LANDING_ROUTES: Record<KnownRole, string> = {
  Importer: '/files',
  Approver: '/transactions',
} as const;

/**
 * Safe fallback when a role is missing or unrecognised. An unknown role must
 * never crash routing or leave the user stranded on `/login`; we send them to
 * the most read-only, least-privileged surface (transactions is read-only for
 * both personas per §2).
 */
export const FALLBACK_LANDING_ROUTE: string = LANDING_ROUTES.Approver;

/**
 * Maps a resolved role name to its landing route, falling back safely for an
 * unknown / missing role. Pure and source-agnostic — the contract later epics
 * depend on.
 */
export function resolveLandingRoute(role: string | null | undefined): string {
  if (role && role in LANDING_ROUTES) {
    return LANDING_ROUTES[role as KnownRole];
  }
  return FALLBACK_LANDING_ROUTE;
}

/**
 * The minimal user-record shape both role sources expose. `userinfo` returns a
 * single record; `/v1/users` returns a `{ Users: [...] }` envelope the API
 * client unwraps to an array. Either way each record carries the role as a
 * `RolesString` scalar and/or a `Roles[]` array.
 */
interface RoleBearingRecord {
  Email?: string;
  RolesString?: string;
  Roles?: Array<{ Name?: string }>;
}

/** Extracts the role name from a record, preferring the scalar `RolesString`. */
function readRole(record: RoleBearingRecord | null | undefined): string | null {
  if (!record) return null;
  if (record.RolesString) return record.RolesString;
  const first = record.Roles?.[0]?.Name;
  return first ?? null;
}

/**
 * Resolves the signed-in user's role from the swappable source described above.
 *
 * @param username the email the user signed in with — used to match the right
 *                 record when falling back to the `/v1/users` collection.
 * @returns the role name, or `null` if no source yielded one (caller applies
 *          the safe fallback route).
 */
export async function fetchSignedInRole(
  username: string,
): Promise<string | null> {
  // Source 1 — best-effort userinfo. A 404/401 here is expected per §13-E; we
  // swallow it and fall through rather than hard-failing the sign-in.
  try {
    const info = await get<RoleBearingRecord>(USERINFO_PATH);
    const role = readRole(info);
    if (role) return role;
  } catch {
    // userinfo unconfirmed on the live backend — fall through to /v1/users.
  }

  // Source 2 — the verified transactions backend's user list, matched by email.
  try {
    const users = await get<RoleBearingRecord[]>(USERS_PATH);
    if (Array.isArray(users)) {
      const match =
        users.find((u) => u.Email?.toLowerCase() === username.toLowerCase()) ??
        users[0];
      const role = readRole(match);
      if (role) return role;
    } else {
      // Defensive: if the client ever hands back a single record, read it too.
      const role = readRole(users as RoleBearingRecord);
      if (role) return role;
    }
  } catch {
    // No usable role source — caller routes to the safe fallback.
  }

  return null;
}
