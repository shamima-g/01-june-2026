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
 * Tolerant alias from the backend's role DISPLAY-NAMES to the canonical
 * `KnownRole` (project-brief "Extension — 2026-06-04"). The live backend returns
 * "File Importer" for importers (not the bare "Importer") via
 * `GET /v1/auth/userinfo` and `GET /v1/users`; "Approver" already matches. Keys
 * are pre-normalised (trimmed + lowercased) so `normalizeRole` resolves with a
 * single lookup. The canonical shorthand maps to itself so existing canonical
 * inputs keep working. New backend spellings are added in ONE place — here.
 */
const ROLE_ALIASES: Record<string, KnownRole> = {
  'file importer': 'Importer',
  importer: 'Importer',
  approver: 'Approver',
};

/**
 * Normalises an arbitrary backend role name to the canonical `KnownRole`, or
 * `null` when unrecognised / missing. Case-insensitive and whitespace-tolerant
 * (the backend payload is not guaranteed to be exactly cased or untrimmed) and
 * never throws. This is the single boundary where backend display-names are
 * aliased back to canonical roles, so every caller of `asKnownRole` /
 * `resolveLandingRoute` inherits the behaviour without changes.
 */
export function normalizeRole(
  raw: string | null | undefined,
): KnownRole | null {
  if (!raw) return null;
  return ROLE_ALIASES[raw.trim().toLowerCase()] ?? null;
}

/**
 * Maps a resolved role name to its landing route, falling back safely for an
 * unknown / missing role. Tolerant of the backend's display-names via
 * `normalizeRole`. Pure and source-agnostic — the contract later epics depend
 * on.
 */
export function resolveLandingRoute(role: string | null | undefined): string {
  const known = normalizeRole(role);
  return known ? LANDING_ROUTES[known] : FALLBACK_LANDING_ROUTE;
}

/**
 * Narrows an arbitrary string to a known role, or `null` when unrecognised.
 * Lets callers RBAC-gate UI affordances against the canonical role set without
 * re-declaring it (e.g. "show the Upload CTA only for an Importer"). Tolerant of
 * the backend's display-names ("File Importer" → 'Importer') via `normalizeRole`.
 */
export function asKnownRole(role: string | null | undefined): KnownRole | null {
  return normalizeRole(role);
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
 * Resolves the CURRENT signed-in user's role on a protected surface, where the
 * username entered at login is no longer in hand (e.g. the user navigated
 * directly to `/files`). Reuses the same swappable source as `fetchSignedInRole`
 * with an empty username — `userinfo` (when confirmed) returns the single
 * signed-in record, and the `/v1/users` fallback reads the first record (the
 * collection is already scoped to the session cookie). Used to RBAC-gate the
 * Importer-only Upload CTA (BR12); on `null` the caller hides the affordance
 * rather than risk exposing it.
 */
export async function fetchCurrentRole(): Promise<string | null> {
  return fetchSignedInRole('');
}

/**
 * Resolves the CURRENT signed-in user's identity for the `LastChangedUser`
 * audit header on mutations (project-brief §9 Cancel File / R12). Reuses the
 * same swappable source: best-effort `userinfo`, then the cookie-scoped
 * `/v1/users` first record. Returns the user's `Email` (the stable,
 * human-readable audit handle the backend records), or `null` when no source
 * yields one — the caller then omits the header rather than sending a bogus
 * value.
 */
export async function fetchCurrentUserIdentity(): Promise<string | null> {
  try {
    const info = await get<RoleBearingRecord>(USERINFO_PATH);
    if (info?.Email) return info.Email;
  } catch {
    // userinfo unconfirmed on the live backend — fall through to /v1/users.
  }

  try {
    const users = await get<RoleBearingRecord[]>(USERS_PATH);
    const record = Array.isArray(users)
      ? users[0]
      : (users as RoleBearingRecord | null);
    if (record?.Email) return record.Email;
  } catch {
    // No usable identity source — caller omits the audit header.
  }

  return null;
}

/**
 * Resolves the signed-in user's role from the swappable source described above.
 *
 * @param username the email the user signed in with — used to match the right
 *                 record when falling back to the `/v1/users` collection. Pass
 *                 an empty string on a protected surface where the username is
 *                 not in hand; the first record is then read (the cookie-scoped
 *                 `/v1/users` returns the signed-in user first).
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

  // Source 2 — the verified transactions backend's user list, matched by email
  // when one was provided, else the first (cookie-scoped) record.
  try {
    const users = await get<RoleBearingRecord[]>(USERS_PATH);
    if (Array.isArray(users)) {
      const match = username
        ? (users.find(
            (u) => u.Email?.toLowerCase() === username.toLowerCase(),
          ) ?? users[0])
        : users[0];
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
