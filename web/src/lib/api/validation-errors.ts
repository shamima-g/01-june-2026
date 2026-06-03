/**
 * Validation-errors read + retry-validation mutation (Epic 2, Story 4 — R11,
 * R13). All three calls ride the shared API client (CLAUDE.md §3 — never
 * `fetch()` directly) and the same-origin proxy
 * (web/src/app/api/[...proxy]/route.ts), which relays the HttpOnly session
 * cookie. The endpoints are documented in project-brief §R13 (validation-errors
 * + columns) and §9 Retry Validation (retry-validation).
 *
 * Two envelope shapes meet here, and they behave DIFFERENTLY under the client's
 * single-key unwrap (which only strips a key whose value is an ARRAY):
 *
 *   - COLUMNS: `{ ColumnList: [...] }` — single key, value IS an array → the
 *     client unwraps it to a bare `ValidationColumn[]` before `getValidationColumns`
 *     returns.
 *   - ERRORS:  `{ ValidationErrors: { JsonArray: "<stringified[]>" } }` — single
 *     key, value is an OBJECT (not an array) → the envelope PASSES THROUGH
 *     untouched. `getValidationErrors` therefore receives the whole object and
 *     reaches into `.ValidationErrors.JsonArray`, JSON.parse-ing that STRING to
 *     recover the invalid-row array (project-brief §13-C).
 */

import { get, post } from '@/lib/api/client';
import type {
  DefaultResponse,
  InvalidRow,
  ValidationColumn,
  ValidationErrorsResponse,
} from '@/types/api';

/** Same-origin column-metadata path — proxied to the transactions backend. */
const VALIDATION_ERROR_COLUMNS_PATH =
  '/api/transactions/v1/files/validation-errors/columns';

/** Same-origin validation-errors path — proxied to the transactions backend. */
const VALIDATION_ERRORS_PATH = '/api/transactions/v1/files/validation-errors';

/** Same-origin retry-validation path — proxied to the transactions backend. */
const RETRY_VALIDATION_PATH = '/api/transactions/v1/files/retry-validation';

/**
 * Fetches the column metadata for a Failed file's validation-errors grid
 * (`GET /v1/files/validation-errors/columns?FileLogId=`). Returns the unwrapped
 * `ValidationColumn[]`; the client has already stripped the SINGULAR
 * `{ ColumnList: [...] }` envelope (its value is an array).
 */
export async function getValidationColumns(
  fileLogId: number,
): Promise<ValidationColumn[]> {
  return get<ValidationColumn[]>(VALIDATION_ERROR_COLUMNS_PATH, {
    FileLogId: fileLogId,
  });
}

/**
 * Fetches the invalid rows for a Failed file
 * (`GET /v1/files/validation-errors?FileLogId=`) and parses them out of the
 * nested `{ ValidationErrors: { JsonArray: "<stringified[]>" } }` envelope.
 *
 * The client does NOT unwrap this envelope (its single key's value is an
 * object, not an array), so we reach into `.ValidationErrors.JsonArray` and
 * `JSON.parse` that STRING (project-brief §13-C). A missing/empty JsonArray
 * yields an empty row set rather than a throw; a malformed (non-array) parse
 * result is likewise treated as no rows so the grid renders safely.
 */
export async function getValidationErrors(
  fileLogId: number,
): Promise<InvalidRow[]> {
  const response = await get<ValidationErrorsResponse>(VALIDATION_ERRORS_PATH, {
    FileLogId: fileLogId,
  });
  const raw = response?.ValidationErrors?.JsonArray;
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed) ? (parsed as InvalidRow[]) : [];
}

/**
 * Re-runs validation for a Failed file
 * (`POST /v1/files/retry-validation?LogId=<logId>`). The `LogId` rides as a
 * query param baked onto the endpoint (the `post()` helper has no params slot
 * and JSON-stringifies its body, so a body-less POST with the param on the path
 * matches the contract). Resolves with the backend `DefaultResponse`
 * (`{ Id, MessageType, Messages }`, a multi-key object the client leaves
 * untouched) and rejects with the client's typed `APIError` on a non-2xx — the
 * caller re-resolves the File Status and refreshes the validation-error rows
 * accordingly (project-brief §9 Retry Validation, R11).
 */
export async function retryValidation(logId: number): Promise<DefaultResponse> {
  const endpoint = `${RETRY_VALIDATION_PATH}?LogId=${encodeURIComponent(
    String(logId),
  )}`;
  return post<DefaultResponse>(endpoint);
}
