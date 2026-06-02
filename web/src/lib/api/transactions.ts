/**
 * Transactions endpoint + client-side file-slice filter (Epic 2, Story 2 — R3).
 *
 * Wraps the verified `GET /v1/transactions` read behind the shared API client
 * (CLAUDE.md §3 — never `fetch()` directly). The client unwraps the singular
 * `{ Transactions: [...] }` envelope to a bare array before this function
 * returns (project-brief §6 / §13.C).
 *
 * IMPORTANT: the transactions endpoint exposes NO `FileLogId` filter param
 * (project-brief §9 Transaction Review + story summary). To obtain a single
 * file's slice, callers fetch the full set and filter CLIENT-SIDE on the
 * `FileLogId` carried by each Transaction — see `transactionsForFile`.
 */

import { get } from '@/lib/api/client';
import type { Transaction } from '@/types/api';

/** Same-origin transactions path — proxied to `${TX_BASE}/v1/transactions`. */
const TRANSACTIONS_PATH = '/api/transactions/v1/transactions';

/**
 * Fetches all transactions. Returns the unwrapped `Transaction[]`; on a backend
 * envelope the client has already stripped the single `Transactions` key.
 */
export async function getTransactions(): Promise<Transaction[]> {
  return get<Transaction[]>(TRANSACTIONS_PATH);
}

/**
 * Filters a transaction set down to the slice belonging to `fileLogId`. The
 * comparison is value-equal after numeric coercion so a string-coerced id (the
 * spec examples coerce integer ids to strings — §13.C) still matches a numeric
 * FileLogId, and vice-versa.
 */
export function transactionsForFile(
  transactions: Transaction[],
  fileLogId: number,
): Transaction[] {
  return transactions.filter(
    (tx) => Number(tx.FileLogId) === Number(fileLogId),
  );
}
