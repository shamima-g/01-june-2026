/**
 * Transaction review mutations (Epic 3, Story 3 — R7, R8, BR8). The Approver's
 * Approve / Reject actions on an `Imported` Transaction.
 *
 * Both calls ride the shared API client (CLAUDE.md §3 — never `fetch()`
 * directly) and the same-origin proxy (web/src/app/api/[...proxy]/route.ts),
 * which relays the HttpOnly session cookie AND forwards the `LastChangedUser`
 * audit header to the transactions backend (project-brief §9 Approve / Reject
 * Transaction, R7 / R8; the POPIA audit-trail obligation in §compliance).
 *
 * The target Transaction id rides as a `?TransactionId=<id>` QUERY PARAM baked
 * onto the endpoint — the `post()` helper has no params slot, so we bake it onto
 * the path exactly as Epic-2 Story-4 retry-validation and Story-5 cancel-file
 * did. Approve carries NO body; Reject carries `{"UserNote": "<note>"}`
 * (TransactionRejectWrite, project-brief §13-B).
 *
 * Both resolve with the backend `DefaultResponse` (`{ Id, MessageType,
 * Messages }`, a multi-key object the client leaves untouched) and reject with
 * the client's typed `APIError` on a non-2xx — the caller then surfaces the
 * inline error and leaves the row's Status unchanged (NFR5).
 */

import { post } from '@/lib/api/client';
import type { DefaultResponse } from '@/types/api';

/** Same-origin approve path — proxied to `${TX_BASE}/v1/transactions/approve`. */
const APPROVE_PATH = '/api/transactions/v1/transactions/approve';

/** Same-origin reject path — proxied to `${TX_BASE}/v1/transactions/reject`. */
const REJECT_PATH = '/api/transactions/v1/transactions/reject';

/**
 * Approves an `Imported` Transaction
 * (`POST /api/transactions/v1/transactions/approve?TransactionId=<id>`) with the
 * `LastChangedUser` audit header and no body. On success the backend flips the
 * row to `Approved`.
 */
export async function approveTransaction(
  transactionId: number,
  lastChangedUser: string,
): Promise<DefaultResponse> {
  const endpoint = `${APPROVE_PATH}?TransactionId=${encodeURIComponent(
    String(transactionId),
  )}`;
  return post<DefaultResponse>(endpoint, undefined, lastChangedUser);
}

/**
 * Rejects an `Imported` Transaction
 * (`POST /api/transactions/v1/transactions/reject?TransactionId=<id>`) with the
 * `LastChangedUser` audit header and a body of `{"UserNote": "<note>"}`
 * (TransactionRejectWrite). The note is mandatory and validated at the call
 * site before this fires (BR2). On success the backend flips the row to
 * `Rejected` and records the note + acting user + timestamp (BR8).
 */
export async function rejectTransaction(
  transactionId: number,
  note: string,
  lastChangedUser: string,
): Promise<DefaultResponse> {
  const endpoint = `${REJECT_PATH}?TransactionId=${encodeURIComponent(
    String(transactionId),
  )}`;
  return post<DefaultResponse>(endpoint, { UserNote: note }, lastChangedUser);
}
