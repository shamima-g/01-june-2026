/**
 * Importer landing placeholder (Epic 1, Story 2 — R1).
 *
 * This is the file-import / File Log surface the Importer lands on after
 * sign-in. It is intentionally MINIMAL — the full upload + File Log experience
 * is owned by Epic 2. The route (`/files`) is bound to `LANDING_ROUTES.Importer`
 * so the post-login redirect and Epic 2's screens stay aligned on the same path.
 *
 * Wrapped in `RequireSession` (Epic 1, Story 3) so a signed-out user — including
 * one who just signed out or timed out — is bounced to `/login` rather than
 * shown the protected surface.
 */

import { RequireSession } from '@/components/session/RequireSession';

export default function FilesLandingPage() {
  return (
    <RequireSession>
      <main className="container mx-auto px-4 py-8">
        <h1 className="text-2xl font-semibold">File Import &amp; File Logs</h1>
        <p className="text-muted-foreground mt-2">
          Upload transaction files and review your File Logs here. This surface
          is under construction — the full upload and File Log experience
          arrives in a later release.
        </p>
      </main>
    </RequireSession>
  );
}
