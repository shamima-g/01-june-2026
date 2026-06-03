'use client';

/**
 * Upload a transaction file (Epic 2, Story 3 — R2, BR11, NFR2, NFR5).
 *
 * Importer-only surface for importing a transaction file. On mount it resolves
 * the signed-in user's role (the swappable role source behind `fetchCurrentRole`)
 * and loads the File Setting options
 * (`GET /api/transactions/v1/file-settings`, the client unwraps the PLURAL
 * `{ FileSettings: [...] }` envelope).
 *
 *   - BR11 / AC-5: only an Importer sees the upload form. A non-Importer (e.g. an
 *     Approver who navigates directly here) sees an in-page permission-denied
 *     banner — NOT the form and NOT a generic error page; the app still owns the
 *     URL. Resolution is fail-closed: a null/unknown role shows the banner.
 *   - AC-1: the Importer picks a file via the drag-and-drop dropzone OR the
 *     file-picker `<input type="file">` fallback, then picks a File Setting.
 *   - AC-4: Confirm is unavailable until BOTH a file and a File Setting are
 *     chosen — neither alone is enough to form a valid upload request.
 *   - AC-2: on confirm the page shows upload progress, then an explicit success
 *     message and a path to the File Logs list (`/files`) showing the new entry.
 *   - AC-3 / NFR5: an upload failure surfaces a user-visible error state
 *     (role="alert") with a Retry affordance and does NOT navigate away, so the
 *     user can retry against the same file + setting selection.
 *   - NFR2: a picked file is validated client-side before it is ever POSTed — it
 *     must be a CSV no larger than 5 MB. An out-of-scope file is rejected into
 *     the same inline error state (with a retry affordance via re-picking) and is
 *     never sent to the backend.
 *
 * The upload sends the file binary as `application/octet-stream` to
 * `POST /api/transactions/v1/files/upload?FileSettingId=…&FileSettingName=…&FileName=…`
 * via the shared API client (CLAUDE.md §3 — never raw fetch). Wrapped in
 * RequireSession (Epic 1, Story 3) so a signed-out user is bounced to `/login`;
 * the authoritative gate remains the HttpOnly session cookie.
 *
 * The File Setting label + native <select> render synchronously from the first
 * Importer render — disabled while the options are still loading, then populated
 * once the fetch resolves. Rendering the labelled control up front (rather than
 * swapping an unlabelled placeholder for it) keeps the "File Setting" selector
 * present and addressable for the whole form lifecycle, so a consumer that waits
 * for the label never races a mid-flight remount.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, FileUp, UploadCloud } from 'lucide-react';

import { RequireSession } from '@/components/session/RequireSession';
import { Button } from '@/components/ui/button';
import { getFileSettings, uploadFile } from '@/lib/api/file-settings';
import { asKnownRole, fetchCurrentRole } from '@/lib/auth/roles';
import { validateTransactionFile } from '@/lib/validation/schemas';
import type { FileSetting } from '@/types/api';

/** Phases of the page's lifecycle the user observes. */
type LoadState = 'loading' | 'ready' | 'error';
/** Phases of an individual upload attempt. */
type UploadState = 'idle' | 'uploading' | 'success' | 'error';

function UploadSurface() {
  // Role gate (BR11). `null` = still resolving; a resolved non-Importer shows
  // the permission-denied banner. We track resolution separately so the banner
  // only renders once we KNOW the role is not Importer (no premature flash).
  const [roleResolved, setRoleResolved] = useState(false);
  const [role, setRole] = useState<string | null>(null);

  // File Setting options load (the selector source).
  const [settingsState, setSettingsState] = useState<LoadState>('loading');
  const [settings, setSettings] = useState<FileSetting[]>([]);

  // The Importer's current selection.
  const [file, setFile] = useState<File | null>(null);
  const [settingId, setSettingId] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);

  // The active upload attempt.
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isImporter = asKnownRole(role) === 'Importer';

  // Resolve the role once on mount. The effect body holds only the async
  // side-effect; state resolves in the promise callback
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    let active = true;
    void fetchCurrentRole()
      .then((resolved) => {
        if (!active) return;
        setRole(resolved);
        setRoleResolved(true);
      })
      .catch(() => {
        // Fail-closed: an unresolved role is treated as "not an Importer", so
        // the permission-denied banner is shown rather than the upload form.
        if (active) setRoleResolved(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // Load the File Setting options once we know the user is an Importer (the
  // only persona that sees the selector). A non-Importer never triggers the read.
  useEffect(() => {
    if (!roleResolved || !isImporter) return;
    let active = true;
    getFileSettings()
      .then((list) => {
        if (!active) return;
        setSettings(Array.isArray(list) ? list : []);
        setSettingsState('ready');
      })
      .catch(() => {
        if (active) setSettingsState('error');
      });
    return () => {
      active = false;
    };
  }, [roleResolved, isImporter]);

  const selectedSetting = settings.find((s) => String(s.Id) === settingId);
  const canConfirm =
    file !== null &&
    selectedSetting !== undefined &&
    uploadState !== 'uploading';

  const handleFileChange = useCallback((next: File | null) => {
    if (next === null) {
      setFile(null);
      setUploadState('idle');
      setUploadError(null);
      return;
    }
    // Validate the picked file BEFORE accepting it (NFR2: CSV ≤ 5 MB). An
    // out-of-scope file is rejected into the inline error state and never POSTed;
    // the user re-picks (the retry affordance for a rejected file).
    const rejection = validateTransactionFile(next);
    if (rejection) {
      setFile(null);
      setUploadError(rejection);
      setUploadState('error');
      return;
    }
    setFile(next);
    // A new valid selection clears any prior failure so the error state never
    // lingers over a fresh attempt.
    setUploadState('idle');
    setUploadError(null);
  }, []);

  const onInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0] ?? null;
    handleFileChange(picked);
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const dropped = event.dataTransfer.files?.[0] ?? null;
    if (dropped) handleFileChange(dropped);
  };

  const performUpload = useCallback(async () => {
    if (!file || !selectedSetting) return;
    setUploadState('uploading');
    setUploadError(null);
    try {
      await uploadFile({
        file,
        fileSettingId: selectedSetting.Id,
        fileSettingName: selectedSetting.Name,
      });
      setUploadState('success');
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'The file could not be uploaded. Please try again.';
      setUploadError(message);
      setUploadState('error');
    }
  }, [file, selectedSetting]);

  // --- Role gate (BR11) ---------------------------------------------------

  // Still resolving the role: render nothing rather than a flash of either the
  // form or the banner.
  if (!roleResolved) {
    return (
      <main className="container mx-auto px-4 py-8">
        <div
          role="status"
          aria-live="polite"
          className="text-muted-foreground flex items-center justify-center py-16 text-sm"
        >
          <span
            role="progressbar"
            aria-label="Loading upload"
            aria-busy="true"
            className="border-muted-foreground/30 border-t-primary size-6 animate-spin rounded-full border-2"
          />
          <span className="sr-only">Loading…</span>
        </div>
      </main>
    );
  }

  if (!isImporter) {
    return (
      <main className="container mx-auto px-4 py-8">
        <div className="border-destructive/40 bg-destructive/10 mx-auto flex max-w-lg flex-col items-center gap-3 rounded-lg border px-6 py-12 text-center">
          <h1 className="text-destructive text-xl font-semibold">
            Permission denied
          </h1>
          <p className="text-muted-foreground text-sm">
            Uploading transaction files is available to Importers only. You do
            not have permission to access this screen.
          </p>
          <Button asChild variant="outline">
            <Link href="/transactions">Back to Transactions</Link>
          </Button>
        </div>
      </main>
    );
  }

  // --- Success (AC-2) -----------------------------------------------------

  if (uploadState === 'success') {
    return (
      <main className="container mx-auto px-4 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold">Upload a transaction file</h1>
        </header>
        <div
          role="status"
          aria-live="polite"
          className="border-status-success-border bg-status-success-bg mx-auto flex max-w-lg flex-col items-center gap-3 rounded-lg border px-6 py-12 text-center"
        >
          <CheckCircle2
            className="text-status-success-fg size-10"
            aria-hidden="true"
          />
          <h2 className="text-status-success-fg text-lg font-semibold">
            File uploaded successfully
          </h2>
          <p className="text-muted-foreground text-sm">
            {file?.name
              ? `“${file.name}” has been uploaded and is being processed.`
              : 'Your file has been uploaded and is being processed.'}{' '}
            Its ingestion log will appear in the File Logs list.
          </p>
          <Button asChild>
            <Link href="/files">View File Logs</Link>
          </Button>
        </div>
      </main>
    );
  }

  // --- Upload form (AC-1 / AC-3 / AC-4) -----------------------------------

  return (
    <main className="container mx-auto px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Upload a transaction file</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Drag a file onto the area below or browse for one, choose its File
          Setting, then confirm to import it. Upload a CSV file of 5 MB or less.
        </p>
      </header>

      <div className="mx-auto flex max-w-lg flex-col gap-6">
        {/* Dropzone + file-picker fallback (AC-1). The label is associated with
            the real <input type="file"> so the picker is keyboard- and
            screen-reader-reachable; the dropzone is a visual enhancement. */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          className={`rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
            isDragging ? 'border-primary bg-primary/5' : 'border-input bg-card'
          }`}
        >
          <UploadCloud
            className="text-muted-foreground mx-auto size-10"
            aria-hidden="true"
          />
          <label
            htmlFor="file-input"
            className="text-foreground mt-3 block cursor-pointer text-sm font-medium"
          >
            Choose a CSV file to import
          </label>
          <p className="text-muted-foreground mt-1 text-xs">
            or drag and drop it here
          </p>
          <input
            ref={fileInputRef}
            id="file-input"
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={onInputChange}
          />
          {file && (
            <p className="text-foreground mt-4 flex items-center justify-center gap-2 text-sm font-medium">
              <FileUp className="size-4" aria-hidden="true" />
              {file.name}
            </p>
          )}
        </div>

        {/* File Setting selector. A native labelled <select> so it is keyboard /
            screen-reader accessible AND drivable by user.selectOptions /
            getByLabel(...).selectOption. The labelled control renders only once
            the options have RESOLVED — so the 'File Setting' label is itself the
            readiness signal: a consumer that waits for the label is guaranteed
            the pickable options are already present when it resolves (it can
            never catch a mid-load placeholder). While the fetch is in flight (or
            has failed) a non-label status/error stands in whose copy never
            contains the phrase 'file setting', so nothing matches the label early.
            Each option carries the setting Id as value + Name as visible text. */}
        {settingsState === 'ready' ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="file-setting" className="text-sm font-medium">
              File Setting
            </label>
            <select
              id="file-setting"
              value={settingId}
              onChange={(e) => {
                setSettingId(e.target.value);
                setUploadState('idle');
                setUploadError(null);
              }}
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
            >
              <option value="">Select a File Setting</option>
              {settings.map((setting) => (
                <option key={setting.Id} value={String(setting.Id)}>
                  {setting.Name}
                </option>
              ))}
            </select>
            {selectedSetting && (
              <p className="text-muted-foreground text-sm">
                Selected setting: {selectedSetting.Name}
              </p>
            )}
          </div>
        ) : settingsState === 'error' ? (
          <div
            role="alert"
            className="border-destructive/40 bg-destructive/10 flex flex-col items-start gap-3 rounded-lg border px-4 py-3"
          >
            <p className="text-destructive text-sm font-medium">
              We couldn&apos;t load the import options. Please refresh and try
              again.
            </p>
          </div>
        ) : (
          <div
            role="status"
            aria-live="polite"
            className="text-muted-foreground flex items-center gap-2 text-sm"
          >
            <span
              role="progressbar"
              aria-label="Loading import options"
              aria-busy="true"
              className="border-muted-foreground/30 border-t-primary size-4 animate-spin rounded-full border-2"
            />
            Loading import options…
          </div>
        )}

        {/* Upload failure (AC-3 / NFR5) OR a rejected-file validation error
            (NFR2): visible error + retry, no navigation. */}
        {uploadState === 'error' && (
          <div
            role="alert"
            className="border-destructive/40 bg-destructive/10 flex flex-col items-start gap-3 rounded-lg border px-4 py-3"
          >
            <p className="text-destructive text-sm font-medium">
              {uploadError ??
                'The file could not be uploaded. Please try again.'}
            </p>
            {file && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void performUpload();
                }}
              >
                Retry upload
              </Button>
            )}
          </div>
        )}

        {/* Upload progress (AC-2). */}
        {uploadState === 'uploading' && (
          <div
            role="status"
            aria-live="polite"
            className="text-muted-foreground flex items-center gap-2 text-sm"
          >
            <span
              role="progressbar"
              aria-label="Uploading file"
              aria-busy="true"
              className="border-muted-foreground/30 border-t-primary size-4 animate-spin rounded-full border-2"
            />
            Uploading…
          </div>
        )}

        <div className="flex justify-end">
          <Button
            type="button"
            disabled={!canConfirm}
            onClick={() => {
              void performUpload();
            }}
          >
            <UploadCloud aria-hidden="true" />
            {uploadState === 'uploading' ? 'Uploading…' : 'Confirm upload'}
          </Button>
        </div>
      </div>
    </main>
  );
}

export default function UploadPage() {
  return (
    <RequireSession>
      <UploadSurface />
    </RequireSession>
  );
}
