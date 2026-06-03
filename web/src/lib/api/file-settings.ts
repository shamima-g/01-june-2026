/**
 * File Settings read + file-upload mutation (Epic 2, Story 3 — R2).
 *
 * Both calls ride the shared API client (CLAUDE.md §3 — never `fetch()`
 * directly) and the same-origin proxy (web/src/app/api/[...proxy]/route.ts),
 * which relays the HttpOnly session cookie and forwards the raw request body
 * untouched — so the octet-stream binary upload reaches the backend intact.
 */

import { apiClient, get } from '@/lib/api/client';
import { validateTransactionFile } from '@/lib/validation/schemas';
import type { DefaultResponse, FileSetting } from '@/types/api';

/** Same-origin file-settings path — proxied to `${TX_BASE}/v1/file-settings`. */
const FILE_SETTINGS_PATH = '/api/transactions/v1/file-settings';

/** Same-origin file-upload path — proxied to `${TX_BASE}/v1/files/upload`. */
const FILE_UPLOAD_PATH = '/api/transactions/v1/files/upload';

/** Max transaction-file size at the API boundary — 5 MB in bytes (NFR2). */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Accepted upload content-type families at the API boundary (CSV, §9). */
const ACCEPTED_UPLOAD_TYPE_PREFIXES = ['text/', 'application/'] as const;

/**
 * Fetches the File Setting options the upload selector offers
 * (`GET /v1/file-settings`, operation `FileSettingGetList`). Returns the
 * unwrapped `FileSetting[]`; the client has already stripped the PLURAL
 * `{ FileSettings: [...] }` envelope (project-brief §6 / §13.C).
 */
export async function getFileSettings(): Promise<FileSetting[]> {
  return get<FileSetting[]>(FILE_SETTINGS_PATH);
}

/** The fields the upload request derives from the chosen File Setting + file. */
export interface UploadFileArgs {
  file: File;
  fileSettingId: number;
  fileSettingName: string;
}

/**
 * Uploads a file's binary as `application/octet-stream` to
 * `POST /v1/files/upload?FileSettingId=…&FileSettingName=…&FileName=…`
 * (operation `FilesUpload`, project-brief §9 File Upload, R2).
 *
 * We go through the lower `apiClient` rather than the `post()` helper because
 * `post()` JSON-stringifies its body and forces `Content-Type: application/json`
 * — here the body is the raw `File`/`Blob` (a valid `BodyInit`) and the
 * content type must be `application/octet-stream`. The three required
 * attributes ride as query params; `FileName` is taken from the file itself.
 *
 * Defence-in-depth (security boundary): this API helper — not just the page —
 * is the real upload boundary, and a future caller could reach it without
 * going through the page's picker validation. So we validate the picked file's
 * type and size here BEFORE the POST: a fast guard on the file's own `.size`
 * (bytes) and `.type` (the `text/` or `application/` CSV family) rejects an
 * obviously out-of-scope upload, then the shared schema confirms the full
 * CSV + 5 MB contract (NFR2). An invalid file is rejected rather than POSTed.
 *
 * Resolves with the backend `DefaultResponse` on success and rejects with the
 * client's typed `APIError` on any non-2xx — the caller surfaces an explicit
 * success/failure state with a retry affordance (NFR5).
 */
export async function uploadFile({
  file,
  fileSettingId,
  fileSettingName,
}: UploadFileArgs): Promise<DefaultResponse> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      'File is too large. Please upload a CSV file of 5 MB or less.',
    );
  }
  const declaredType = file.type.toLowerCase();
  const hasUnsupportedType =
    declaredType.length > 0 &&
    !ACCEPTED_UPLOAD_TYPE_PREFIXES.some((prefix) =>
      declaredType.startsWith(prefix),
    );
  if (hasUnsupportedType) {
    throw new Error('Unsupported file type. Please upload a CSV file.');
  }
  const validationError = validateTransactionFile(file);
  if (validationError !== null) {
    throw new Error(validationError);
  }

  return apiClient<DefaultResponse>(FILE_UPLOAD_PATH, {
    method: 'POST',
    params: {
      FileSettingId: fileSettingId,
      FileSettingName: fileSettingName,
      FileName: file.name,
    },
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });
}
