/**
 * File-lifecycle mutations (Epic 2, Story 5 — R12, BR7). Currently the
 * Cancel-File action: an Importer deactivates a File Log that has no `Approved`
 * Transactions.
 *
 * The call rides the shared API client (CLAUDE.md §3 — never `fetch()`
 * directly) and the same-origin proxy (web/src/app/api/[...proxy]/route.ts),
 * which relays the HttpOnly session cookie AND forwards the `LastChangedUser`
 * audit header to the transactions backend (project-brief §9 Cancel File, R12).
 *
 * The BR7 guard ("blocked when any Transaction in the file is `Approved`") is
 * NOT enforced here — the spec exposes no server-side guard, so it is derived
 * CLIENT-SIDE from the already-loaded per-file transaction slice on the
 * file-detail surface before this is ever called.
 */

import { del } from '@/lib/api/client';
import type { DefaultResponse } from '@/types/api';

/** Same-origin files path — proxied to `${TX_BASE}/v1/files`. */
const FILES_PATH = '/api/transactions/v1/files';

/**
 * Cancels (deactivates) a File Log
 * (`DELETE /api/transactions/v1/files?LogId=<logId>`) with the `LastChangedUser`
 * audit header. The `LogId` rides as a query param baked onto the endpoint (the
 * `del()` helper has no params slot). On success the backend deactivates the
 * file, so it drops out of the `?IsActive=Yes` file-logs list (project-brief §9
 * Cancel File step 5).
 *
 * Resolves with the backend `DefaultResponse` (`{ Id, MessageType, Messages }`,
 * a multi-key object the client leaves untouched) or `void` on a 204, and
 * rejects with the client's typed `APIError` on a non-2xx.
 */
export async function cancelFile(
  logId: number,
  lastChangedUser: string,
): Promise<DefaultResponse | void> {
  const endpoint = `${FILES_PATH}?LogId=${encodeURIComponent(String(logId))}`;
  return del<DefaultResponse | void>(endpoint, lastChangedUser);
}
