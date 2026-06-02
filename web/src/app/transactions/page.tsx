/**
 * Approver landing placeholder (Epic 1, Story 2 — R1).
 *
 * This is the Transactions surface the Approver lands on after sign-in. It is
 * intentionally MINIMAL — the full sortable/filterable transactions table, plus
 * Approve / Reject / Export, is owned by Epic 3. The route (`/transactions`) is
 * bound to `LANDING_ROUTES.Approver` so the post-login redirect and Epic 3's
 * screens stay aligned on the same path.
 *
 * Wrapped in `RequireSession` (Epic 1, Story 3) so a signed-out user — including
 * one who just signed out or timed out — is bounced to `/login` rather than
 * shown the protected surface.
 */

import { RequireSession } from '@/components/session/RequireSession';

export default function TransactionsLandingPage() {
  return (
    <RequireSession>
      <main className="container mx-auto px-4 py-8">
        <h1 className="text-2xl font-semibold">Transactions</h1>
        <p className="text-muted-foreground mt-2">
          Review, approve, reject, and export transactions here. This surface is
          under construction — the full transactions table arrives in a later
          release.
        </p>
      </main>
    </RequireSession>
  );
}
