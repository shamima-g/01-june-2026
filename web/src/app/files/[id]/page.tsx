'use client';

/**
 * Navigation-target PLACEHOLDER for the file-detail surface.
 *
 * Story 1 (the File Logs dashboard) makes each row click-through to `/files/<id>`.
 * Without a route here, that navigation never commits and AC-4 cannot pass. This
 * file exists only so the route resolves and the URL becomes `/files/<id>`; it is
 * NOT the real detail surface (transactions slice, status banner, approval
 * actions). Epic 2, Story 2 (File detail) replaces this with the production view.
 *
 * Wrapped in RequireSession to match the rest of the protected surface — a
 * signed-out user is bounced to `/login`.
 */

import { use } from 'react';

import { RequireSession } from '@/components/session/RequireSession';

export default function FileDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <RequireSession>
      <main className="container mx-auto px-4 py-8">
        <h1 className="text-2xl font-semibold">File {id}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          File detail loads here.
        </p>
      </main>
    </RequireSession>
  );
}
