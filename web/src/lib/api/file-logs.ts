/**
 * File Logs endpoint + File Status derivation (Epic 2, Story 1 — R3, R14).
 *
 * Wraps the verified `GET /v1/file-logs?IsActive=Yes` read behind the shared
 * API client (CLAUDE.md §3 — never `fetch()` directly). The same-origin proxy
 * forces `IsActive=Yes` regardless (web/src/app/api/[...proxy]/route.ts), but we
 * pass it explicitly here too so the call is self-describing and matches the
 * OpenAPI contract (`IsActive` is a required query param — a missing param 400s,
 * project-brief §13.B).
 *
 * The client unwraps the singular `{ FileLog: [...] }` envelope to a bare array
 * before this function returns (project-brief §6 / §13.C).
 */

import { get } from '@/lib/api/client';
import { FileStatus, type FileLog, type FileStatusValue } from '@/types/api';

/** Same-origin file-logs path — proxied to `${TX_BASE}/v1/file-logs`. */
const FILE_LOGS_PATH = '/api/transactions/v1/file-logs';

/**
 * Fetches the active file logs. Returns the unwrapped `FileLog[]`; on a backend
 * envelope the client has already stripped the single `FileLog` key.
 */
export async function getActiveFileLogs(): Promise<FileLog[]> {
  return get<FileLog[]>(FILE_LOGS_PATH, { IsActive: 'Yes' });
}

/**
 * Maps a raw activity / status string onto the canonical FileStatus lifecycle
 * the StatusBadge renders. Matching is case-insensitive and tolerant of the
 * backend's longer activity names (e.g. "Processing Started" → Processing,
 * "Validation Failed" → Failed), since File Status is DERIVED rather than a
 * dedicated field (project-brief §6 / §13.F). Falls back to `Uploaded` (the
 * neutral, earliest lifecycle state) when nothing matches, so a badge always
 * renders.
 */
function classify(raw: string | null | undefined): FileStatusValue | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (v.includes('fail') || v.includes('error') || v.includes('reject')) {
    return FileStatus.Failed;
  }
  if (v.includes('complete') || v.includes('success') || v.includes('done')) {
    return FileStatus.Completed;
  }
  if (
    v.includes('process') ||
    v.includes('validat') ||
    v.includes('running') ||
    v.includes('progress')
  ) {
    return FileStatus.Processing;
  }
  if (v.includes('upload') || v.includes('received') || v.includes('queued')) {
    return FileStatus.Uploaded;
  }
  return null;
}

/**
 * Derives the File Status from a FileLog, preferring `LastExecutedActivityName`
 * (the most specific signal) and falling back to `CurrentStatus`, then to the
 * neutral `Uploaded` state. The two raw fields are treated as equivalent for
 * display (project-brief §13.F).
 */
export function deriveFileStatus(log: FileLog): FileStatusValue {
  return (
    classify(log.LastExecutedActivityName) ??
    classify(log.CurrentStatus) ??
    FileStatus.Uploaded
  );
}
