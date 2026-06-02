# Epic 2 — File Import & Lifecycle (Importer)

**Slug:** `epic-2-file-import-lifecycle`
**Depends on:** Epic 1 (Authentication & Application Foundation)
**Requirements:** R2, R3, R6, R11, R12, R13, R14, BR4, BR5, BR7, BR11, BR12

The Importer's surface — upload a transaction file, see all active file logs with their status, drill into a file, retry validation on a failed file, review validation errors, and cancel a file (guarded when any transaction is already approved).

`epicIntroducesSharedSurface`: false

## Stories

### 1. File Logs dashboard with status, sorting, and pagination
- **Slug:** `story-1-file-logs-dashboard`
- **Route:** `/files` · **Target:** `web/src/app/files/page.tsx` (modify_existing)
- **Roles:** Importer, Approver · **Requirements:** R3, R6, R14, BR12
- Replaces the placeholder /files page with the live File Logs surface (sortable, paginated, StatusBadge, click-through, Importer-only Upload CTA on empty state).

### 2. File detail with its transactions and processing banners
- **Slug:** `story-2-file-detail`
- **Route:** `/files/[id]` · **Target:** `web/src/app/files/[id]/page.tsx` (create_new)
- **Roles:** Importer, Approver · **Requirements:** R3, BR4
- Shared detail shell: FileLog metadata + read-only per-file transaction slice (client-side filtered by FileLogId), work-in-progress banner for Uploaded/Processing.
- **Spec gaps:** no single-FileLog fetch; no FileLogId filter on GET /v1/transactions (filter client-side).

### 3. Upload a transaction file
- **Slug:** `story-3-upload-file`
- **Route:** `/files/upload` · **Target:** `web/src/app/files/upload/page.tsx` (create_new)
- **Roles:** Importer · **Requirements:** R2, BR11
- Drag-and-drop + picker, File Setting selector, octet-stream upload with query params, progress + explicit success/failure, Approver permission-denied banner.
- **Spec gap:** binary-body upload contract to be confirmed against live backend during BUILD.

### 4. Retry validation and review validation errors on a failed file
- **Slug:** `story-4-retry-validation-errors`
- **Route:** `/files/[id]` · **Target:** `web/src/app/files/[id]/page.tsx` (modify_existing)
- **Roles:** Importer, Approver · **Requirements:** R11, R13, BR5
- Validation-error rows + backend column metadata; Importer-only Retry Validation; Approver read-only.

### 5. Cancel a file with the approved-transaction guard
- **Slug:** `story-5-cancel-file`
- **Route:** `/files/[id]` · **Target:** `web/src/app/files/[id]/page.tsx` (modify_existing)
- **Roles:** Importer · **Requirements:** R12, BR7
- Importer-only destructive Cancel with confirmation modal (focus on Cancel); BR7 client-side guard blocks cancel when any transaction is Approved.
- **Spec gap:** no server-side BR7 guard on DELETE /v1/files (derive client-side).

## Non-goals
- No creating, editing, or deleting File Settings — the upload picks from settings that already exist.
- No bulk or multi-file upload — files are uploaded one at a time.
- No virus scanning or content inspection of the uploaded file beyond the backend's own validation.
- No real-time or auto-refreshing status — a file's progress updates when the user refreshes or navigates, not on a live feed.
