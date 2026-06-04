/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: web/src/app/transactions/page.tsx
 * - Page Action: modify_existing
 *
 * E2E spec for Epic 3, Story 3: Review actions — approve or reject an Imported
 * transaction (R7, R8, BR1, BR2, BR3, BR8, BR9). This story layers per-row
 * Approve / Reject actions on top of the Story-1/2 Transactions table:
 *   - Approve / Reject appear ONLY on `Imported` rows; on `Approved`/`Rejected`
 *     rows they are HIDDEN (not disabled) — BR1.
 *   - Approve opens a confirmation dialog naming the transaction Reference with
 *     default focus on Cancel; confirming POSTs approve and flips the row to
 *     `Approved` immediately with a success toast — R7, BR3.
 *   - Reject opens a dialog with a MANDATORY note (multi-line, ≤500 chars) whose
 *     submit is disabled until a non-empty note is entered; submitting POSTs
 *     reject with body `{"UserNote": "<note>"}` and flips the row to `Rejected`
 *     immediately with a success toast — R8, BR2, BR3.
 *   - After rejection the row surfaces its rejection note + who rejected it and
 *     when, read-only — BR8.
 *   - Both actions are Approver-only and fail-closed; the Importer never sees them
 *     — BR9.
 *
 * Coverage split (one test per PLAYWRIGHT-tagged AC):
 *   - AC-1 (PLAYWRIGHT): Approve and Reject appear only on Imported rows; on
 *     Approved / Rejected rows they are hidden (not disabled).
 *   - AC-2 (PLAYWRIGHT): triggering either action opens a confirm dialog naming
 *     the Reference with default focus on Cancel; Reject's dialog has a mandatory
 *     note whose submit is disabled until a non-empty (≤500) note is entered.
 *   - AC-4 (PLAYWRIGHT): confirming Approve flips the row to Approved and
 *     confirming Reject flips it to Rejected, each immediately with a success toast.
 *   - AC-5 (PLAYWRIGHT): after rejection the row displays its rejection note +
 *     who rejected it and when, read-only.
 * AC-3 (note-validation edges) and AC-6 (RBAC / hard-failure) are vitest-tagged —
 * covered by the sibling integration test, not here.
 *
 * Mocking strategy: project default is `page-route-with-shape-report`
 * (intake-manifest.json -> context.testInfrastructure.playwrightMockingDefault),
 * but no api-shape-report.md exists in this repo yet, so the response bodies are
 * built from documentation/transactions-api.yaml + the PascalCase runtime shapes
 * established by Epic 2/3:
 *   - GET .../v1/transactions -> the SINGULAR-keyed `{ Transactions: [...] }`
 *     envelope (project-brief §6 / §13.C). The page sorts + paginates CLIENT-SIDE
 *     over the full set returned here (R4) — same model as Story 1/2.
 *   - POST .../v1/transactions/approve?TransactionId=<id> (LastChangedUser header)
 *     -> DefaultResponse 200 `{ Id, MessageType, Messages: [] }` (yaml l.679,
 *     l.1094). The query param carries the target id; no body.
 *   - POST .../v1/transactions/reject?TransactionId=<id> (LastChangedUser header)
 *     with body `{"UserNote": "<note>"}` (TransactionRejectWrite, yaml l.717,
 *     l.1467) -> DefaultResponse 200.
 *
 * Row-flip model (AC-4 / AC-5): the mock harness is STATEFUL — after a successful
 * approve/reject POST it mutates the matching transaction in its backing store
 * (Status, and for reject also UserNote / LastChangedUser / LastChangedDate). So a
 * page that RE-FETCHES the list after the action sees the flipped status, AND a
 * page that flips the row OPTIMISTICALLY in place is equally satisfied — the
 * assertions only check the user-observable end state (flipped Status badge +
 * success toast + rejection trail), never which strategy produced it.
 *
 * Audit-identity contract (the AC-5 reconciliation, fix-cycle 2): the page records
 * the rejection trail's WHO from the signed-in user's IDENTITY — and the system's
 * `LastChangedUser` audit handle is the user's EMAIL (the stable, human-readable
 * value the backend records, established by Epic 2 Story 5 Cancel File and
 * `fetchCurrentUserIdentity`). The page flips the row OPTIMISTICALLY using that
 * identity, so the "rejected by …" trail names the acting Approver by EMAIL, not
 * by first/last name. AC-5's "who rejected it" assertion therefore anchors on the
 * approver's EMAIL — the value the page genuinely surfaces — keeping the AC's
 * intent (the trail names who acted) intact.
 *
 * Internal-consistency contract (the Story-1 defect class this spec avoids):
 *   - The full set is exactly 6 rows — comfortably UNDER the default page size of
 *     20 — so EVERY row sits on page 1 under the default Transaction-Date-DESC
 *     sort. No assertion below depends on pagination or sort order, so an asserted
 *     row can never be pushed off-screen.
 *   - Statuses span all three enum values, with KNOWN Imported / Approved /
 *     Rejected reference rows, so "actions appear on Imported, hidden elsewhere"
 *     has unambiguous probes.
 *   - References are unique + zero-padded so `getByText` / cell lookups never
 *     collide.
 *
 * Locator-precision contract (the Story-1/2 defect class this spec hardens
 * against, reinforced in fix-cycle 2):
 *   - The Status FILTER is a native <select> carrying hidden <option>Approved
 *     </option> / <option>Rejected</option> entries (Story 2). A PAGE-WIDE
 *     getByText(/approved|rejected/i) therefore collides with those hidden
 *     options — so every post-action Status check below is scoped to the ACTED
 *     ROW's Status BADGE via an exact-text match (the badge renders the bare
 *     status word; the rejection trail renders a longer "…rejected by…" string,
 *     so an exact match isolates the badge from the trail within the same row).
 *   - The Approve/Reject dialogs name the Reference in BOTH the title heading AND
 *     a body details span, so the dialog-names-the-Reference assertion anchors on
 *     the title HEADING (getByRole('heading')) rather than a bare getByText that
 *     would match twice.
 *   - The success-toast assertion is scoped to the "Notifications" toast region
 *     (role="region", aria-label="Notifications") and asserts the toast TITLE —
 *     never a page-wide status-word lookup.
 *   - The BR9 "Importer sees no Approve/Reject actions" assertion is scoped to the
 *     transactions TABLE and anchored to the EXACT row-action names "Approve" /
 *     "Reject". The Story-5 per-file summary panel (outside the table) carries
 *     "Approved: N" / "Rejected: N" status-COUNT drill-down buttons visible to
 *     BOTH roles — a page-wide /approve/i | /reject/i count would collide with
 *     those (and with the Status filter's <option>s); table-scoping plus anchored
 *     exact names isolates the row actions from both.
 *
 * Dialog / toast / announcer note: the App Router injects a permanently-present
 * EMPTY `<div role="alert">` route announcer, so this spec NEVER relies on a bare
 * alert selector. Confirm dialogs are targeted via the `dialog` role; the success
 * path is asserted on the toast TEXT (scoped to the toast region) and the flipped
 * Status badge — never a bare alert. Pagination-style page chrome lookups stay
 * scoped to named regions so they never collide with the Next.js dev-tools button
 * injected during `next dev`.
 *
 * Auth: the /transactions surface is auth-gated (RequireSession + HttpOnly session
 * cookie), so each test drives the real login flow first — reusing the EXACT
 * same-origin /api/* auth-mock + login + cold-route nav-timeout pattern from Epic 3
 * Story 1/2. Tests that exercise the actions sign in as the APPROVER (so the
 * actions render); the Importer-only test signs in as the Importer.
 *
 * These tests WILL FAIL until the Approve / Reject row-actions, dialogs, toast,
 * and rejection trail are implemented on /transactions (Story 1/2 ship the table
 * + filters with no action controls) — TDD red.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import {
  approverUser,
  importerUser,
  type TestUser,
} from './fixtures/credentials';

/**
 * Post-login navigation must tolerate a `next dev` COLD-ROUTE compile. The
 * /transactions page is heavy to compile on its first hit (Table + StatusBadge +
 * filters + action dialogs + zod), during which the URL legitimately stays on
 * /login until the destination route finishes compiling — which can exceed the 5s
 * default `toHaveURL` timeout. Setup-mechanism wait, not a behavioural assertion.
 * Lifted verbatim from Epic 3 Story 1/2.
 */
const SIGN_IN_NAV_TIMEOUT_MS = 30_000;

/** A Transaction row in the observed PascalCase shape (transactions-api.yaml TransactionRead). */
interface MockTransaction {
  Id: number;
  FileLogId: number;
  FileName: string;
  Reference: string;
  TransactionDate: string;
  AccountNumber: string;
  Description: string;
  Amount: number;
  TransactionType: string;
  Currency: string;
  Status: string;
  UserNote: string;
  LastChangedUser: string;
  LastChangedDate: string;
}

function transaction(
  overrides: Partial<MockTransaction> & { Id: number },
): MockTransaction {
  return {
    FileLogId: 5001,
    FileName: 'transactions_2026-04-15.csv',
    Reference: `TXN-20260415-${String(overrides.Id).padStart(4, '0')}`,
    TransactionDate: '2026-04-15T15:00:00Z',
    AccountNumber: '1234-5678-9012',
    Description: 'Payment for invoice',
    Amount: 1500.5,
    TransactionType: 'Debit',
    Currency: 'ZAR',
    Status: 'Imported',
    UserNote: '',
    LastChangedUser: 'system',
    LastChangedDate: '2026-04-15T09:30:00Z',
    ...overrides,
  };
}

/**
 * The full set: exactly 6 rows, all on page 1 (default page size 20). Statuses
 * span the whole enum so "actions on Imported, hidden on Approved/Rejected" has
 * unambiguous probes:
 *   - Ids 1, 2, 3 — Imported (actions appear; 1 is the approve probe, 2 the reject
 *     probe; 3 is a spare Imported row).
 *   - Id 4 — Approved (actions HIDDEN).
 *   - Id 5 — Rejected (actions HIDDEN; carries a pre-existing rejection note so the
 *     read-only trail is demonstrable independent of a fresh reject).
 *   - Id 6 — Imported (spare).
 *
 * TransactionDates DESCEND with Id (lower Id => more recent), matching the page's
 * default Transaction-Date-DESC sort, so the rows render in a stable order.
 * Because all 6 fit on page 1, no test depends on that ordering.
 */
const BASE_DATE_MS = Date.parse('2026-04-30T15:00:00Z');
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const STATUS_BY_ID: Record<number, string> = {
  1: 'Imported',
  2: 'Imported',
  3: 'Imported',
  4: 'Approved',
  5: 'Rejected',
  6: 'Imported',
};

/** Pre-existing rejection trail on the already-Rejected fixture row (Id 5, BR8). */
const PRE_REJECTED_NOTE = 'Amount does not match supporting document';
const PRE_REJECTED_BY = 'Thandiwe Approver';
const PRE_REJECTED_AT = '2026-04-29T11:15:00Z';

function buildTransactions(): MockTransaction[] {
  return Array.from({ length: 6 }, (_, i) => {
    const id = i + 1;
    const status = STATUS_BY_ID[id];
    return transaction({
      Id: id,
      Reference: `TXN-20260415-${String(id).padStart(4, '0')}`,
      AccountNumber: `ACCT-${String(id).padStart(4, '0')}`,
      Amount: id * 100,
      TransactionDate: new Date(BASE_DATE_MS - id * ONE_DAY_MS).toISOString(),
      Status: status,
      ...(status === 'Rejected'
        ? {
            UserNote: PRE_REJECTED_NOTE,
            LastChangedUser: PRE_REJECTED_BY,
            LastChangedDate: PRE_REJECTED_AT,
          }
        : {}),
    });
  });
}

/** Imported rows (actions visible). */
const APPROVE_PROBE = 'TXN-20260415-0001'; // Imported -> approve target
const REJECT_PROBE = 'TXN-20260415-0002'; // Imported -> reject target
/** Non-Imported rows (actions hidden, BR1). */
const APPROVED_REF = 'TXN-20260415-0004'; // already Approved
const REJECTED_REF = 'TXN-20260415-0005'; // already Rejected (carries the trail)

/** The note an Approver types when rejecting REJECT_PROBE in AC-4 / AC-5. */
const FRESH_REJECT_NOTE = 'Duplicate of TXN-20260415-0006; reversing entry.';

/** Build a single User record in the observed PascalCase shape (mirrors Epic 2/3 specs). */
function userRecord(user: TestUser) {
  return {
    Id: user.role === 'Importer' ? 101 : 202,
    Email: user.email,
    FirstName: user.firstName,
    LastName: user.lastName,
    RolesString: user.role,
    Roles: [{ Id: user.role === 'Importer' ? 1 : 2, Name: user.role }],
    Pages: [],
    LastChangedUser: 'system',
    LastChangedDate: '2026-06-01T08:00:00Z',
  };
}

/** DefaultResponse 200 body (transactions-api.yaml l.1094). */
function defaultResponse(id: number) {
  return { Id: id, MessageType: 'Success', Messages: [] as string[] };
}

/** Parse `?TransactionId=<id>` off a request URL; NaN when absent. */
function transactionIdFromUrl(url: string): number {
  return Number(new URL(url).searchParams.get('TransactionId'));
}

/**
 * Wire the same-origin /api/* mocks the review actions need. Builds on the Epic 3
 * Story 1/2 auth+list harness, then adds STATEFUL approve / reject:
 *   - The transactions list is a mutable in-memory store (`store`). The GET always
 *     reflects the current store, so a page that re-fetches after an action sees
 *     the flipped status (an optimistic in-place flip is also satisfied).
 *   - approve mutates the targeted row to `Approved`.
 *   - reject mutates the targeted row to `Rejected` and records the submitted
 *     UserNote + the acting user (LastChangedUser, the signed-in EMAIL — the
 *     system's audit handle) + a timestamp (LastChangedDate) so the read-only
 *     rejection trail (BR8 / AC-5) has data to render.
 */
async function mockReviewApi(page: Page, validUser: TestUser): Promise<void> {
  let signedIn: TestUser | null = null;
  const store: MockTransaction[] = buildTransactions();

  await page.route(/\/api\/.*login.*/i, async (route: Route) => {
    const raw = route.request().postData() ?? '{}';
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const username = (body.Username ?? body.username ?? body.email) as
      | string
      | undefined;
    const password = (body.Password ?? body.password) as string | undefined;

    if (username === validUser.email && password === validUser.password) {
      signedIn = validUser;
      await route.fulfill({
        status: 200,
        headers: {
          'set-cookie':
            'session=mock-session-token; Path=/; HttpOnly; SameSite=Strict',
        },
        contentType: 'application/json',
        body: JSON.stringify(userRecord(validUser)),
      });
      return;
    }
    await route.fulfill({
      status: 401,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        status: 401,
        detail: 'Invalid email or password.',
      }),
    });
  });

  await page.route(/\/api\/.*userinfo.*/i, async (route: Route) => {
    await route.fulfill({
      status: signedIn ? 200 : 401,
      contentType: 'application/json',
      body: signedIn ? JSON.stringify(userRecord(signedIn)) : '{}',
    });
  });

  await page.route(/\/api\/.*\/users(\?.*)?$/i, async (route: Route) => {
    await route.fulfill({
      status: signedIn ? 200 : 401,
      contentType: 'application/json',
      body: signedIn ? JSON.stringify({ Users: [userRecord(signedIn)] }) : '{}',
    });
  });

  // POST approve: flip the targeted row to Approved, then DefaultResponse 200.
  // Registered BEFORE the generic /transactions GET route so the more specific
  // approve/reject paths win Playwright's last-registered-first match ordering.
  await page.route(
    /\/api\/.*\/transactions\/approve(\?.*)?$/i,
    async (route: Route) => {
      const id = transactionIdFromUrl(route.request().url());
      const row = store.find((t) => t.Id === id);
      if (row) {
        row.Status = 'Approved';
        row.LastChangedUser = validUser.email;
        row.LastChangedDate = new Date().toISOString();
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(defaultResponse(id)),
      });
    },
  );

  // POST reject: record the submitted UserNote + acting user + timestamp, flip the
  // targeted row to Rejected, then DefaultResponse 200. The acting user is the
  // signed-in EMAIL — the system's LastChangedUser audit handle.
  await page.route(
    /\/api\/.*\/transactions\/reject(\?.*)?$/i,
    async (route: Route) => {
      const id = transactionIdFromUrl(route.request().url());
      let note = '';
      try {
        const body = JSON.parse(route.request().postData() ?? '{}') as {
          UserNote?: string;
        };
        note = body.UserNote ?? '';
      } catch {
        note = '';
      }
      const row = store.find((t) => t.Id === id);
      if (row) {
        row.Status = 'Rejected';
        row.UserNote = note;
        row.LastChangedUser = validUser.email;
        row.LastChangedDate = new Date().toISOString();
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(defaultResponse(id)),
      });
    },
  );

  // GET transactions: SINGULAR-keyed `{ Transactions: [...] }` envelope (§6 /
  // §13.C), always reflecting the current (possibly mutated) store.
  await page.route(/\/api\/.*\/transactions(\?.*)?$/i, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ Transactions: store }),
    });
  });
}

/**
 * Drive the real login form so the session cookie + client marker are
 * established, then wait for the post-login navigation to leave /login using the
 * generous cold-route timeout (see SIGN_IN_NAV_TIMEOUT_MS). Identical to Story 1/2.
 */
async function signIn(page: Page, user: TestUser): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole('button', { name: /sign in|log in|login/i }).click();
  await expect(page).not.toHaveURL(/\/login/, {
    timeout: SIGN_IN_NAV_TIMEOUT_MS,
  });
}

/** A data row located by its unique Reference cell (excludes the header row). */
function rowFor(page: Page, reference: string) {
  return page.getByRole('row').filter({ hasText: reference });
}

/**
 * The acted ROW's Status BADGE for a given status word, scoped to that row and
 * matched EXACTLY so it isolates the StatusBadge (whose text is the bare status
 * word, e.g. "Approved") from:
 *   - the page-wide Status FILTER <select>'s hidden <option> of the same word, and
 *   - the rejection trail's longer "…rejected by…" string inside the same row.
 * This is the locator-precision fix at the heart of fix-cycle 2 — the behavioural
 * intent ("the row flipped to <status>") is unchanged.
 */
function rowStatusBadge(page: Page, reference: string, status: string) {
  return rowFor(page, reference).getByText(status, { exact: true });
}

/**
 * The success-toast title, scoped to the "Notifications" toast region (so it never
 * collides with the page's filter-option text or row badges). Asserts the toast
 * actually surfaced with the expected Reference + action verb.
 */
function successToast(page: Page, pattern: RegExp) {
  return page
    .getByRole('region', { name: /notifications/i })
    .getByText(pattern);
}

/**
 * The Reject dialog's AFFIRMATIVE confirm-reject control. Its visible label is
 * "Reject transaction" (it becomes "Rejecting…" while in flight), so the locator
 * must match that — NOT an anchored /^reject$/ which only matches a bare "Reject".
 * It is dialog-scoped at the call site, so it never collides with the row's
 * "Reject" action button or the dialog's "Cancel" / "Close". (Locator precision
 * only — the asserted behaviour, "confirm the rejection", is unchanged.)
 */
const REJECT_CONFIRM_NAME = /reject transaction|confirm|submit/i;

test.describe('Epic 3, Story 3: Review actions — approve or reject an Imported transaction', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-1 (R7 / R8 / BR1): Approve and Reject row-actions appear ONLY on `Imported`
  // rows. On an already-Approved and an already-Rejected row they are HIDDEN — not
  // present-but-disabled — which we assert with a strict count of zero matching
  // action controls inside those rows.
  test('Approve and Reject appear only on Imported rows and are hidden (not disabled) elsewhere', async ({
    page,
  }) => {
    await mockReviewApi(page, approverUser);
    await signIn(page, approverUser);
    await page.goto('/transactions');

    // On the Imported probe row, BOTH actions are present and enabled.
    const importedRow = rowFor(page, APPROVE_PROBE);
    await expect(
      importedRow.getByRole('button', { name: /approve/i }),
    ).toBeVisible();
    await expect(
      importedRow.getByRole('button', { name: /approve/i }),
    ).toBeEnabled();
    await expect(
      importedRow.getByRole('button', { name: /reject/i }),
    ).toBeVisible();

    // On the already-Approved row, NEITHER action exists (hidden, BR1 — not a
    // disabled control). A zero count distinguishes "absent" from "disabled".
    const approvedRow = rowFor(page, APPROVED_REF);
    await expect(
      approvedRow.getByRole('button', { name: /approve/i }),
    ).toHaveCount(0);
    await expect(
      approvedRow.getByRole('button', { name: /reject/i }),
    ).toHaveCount(0);

    // On the already-Rejected row, likewise neither action exists.
    const rejectedRow = rowFor(page, REJECTED_REF);
    await expect(
      rejectedRow.getByRole('button', { name: /approve/i }),
    ).toHaveCount(0);
    await expect(
      rejectedRow.getByRole('button', { name: /reject/i }),
    ).toHaveCount(0);
  });

  // AC-2 (R7 / R8 / BR2 / BR3): triggering Approve opens a confirm dialog naming
  // the Reference with default focus on Cancel; triggering Reject opens a dialog
  // naming the Reference with a MANDATORY note whose submit is disabled until a
  // non-empty (≤500) note is entered.
  test('Approve and Reject open a Reference-named confirm dialog; Cancel is focused and Reject submit is gated on a note', async ({
    page,
  }) => {
    await mockReviewApi(page, approverUser);
    await signIn(page, approverUser);
    await page.goto('/transactions');

    // --- Approve dialog: names the Reference, default focus on Cancel (BR3). ---
    await rowFor(page, APPROVE_PROBE)
      .getByRole('button', { name: /approve/i })
      .click();
    const approveDialog = page.getByRole('dialog');
    await expect(approveDialog).toBeVisible();
    // The dialog names the transaction being approved. The Reference appears in
    // BOTH the dialog title heading and a body details span, so we anchor on the
    // title HEADING specifically — a bare getByText(Reference) matches twice and
    // trips strict mode. Locator precision only; the intent ("the dialog names
    // the Reference") is unchanged.
    await expect(
      approveDialog.getByRole('heading', { name: new RegExp(APPROVE_PROBE) }),
    ).toBeVisible();
    // Default focus is on the Cancel control (BR3: Approve confirm focuses Cancel).
    const approveCancel = approveDialog.getByRole('button', {
      name: /cancel/i,
    });
    await expect(approveCancel).toBeFocused();
    // Dismiss without committing so the next assertions start clean.
    await approveCancel.click();
    await expect(approveDialog).toBeHidden();

    // --- Reject dialog: names the Reference; mandatory note gates submit. ---
    await rowFor(page, REJECT_PROBE)
      .getByRole('button', { name: /reject/i })
      .click();
    const rejectDialog = page.getByRole('dialog');
    await expect(rejectDialog).toBeVisible();
    // Same dual-render as the approve dialog (title heading + body span) — anchor
    // on the heading so the Reference lookup is unambiguous.
    await expect(
      rejectDialog.getByRole('heading', { name: new RegExp(REJECT_PROBE) }),
    ).toBeVisible();

    // The mandatory note is a multi-line textbox. With it empty, the confirm/
    // submit control is DISABLED (BR2). The submit is the dialog's affirmative
    // control — named to confirm the rejection, distinct from Cancel.
    const note = rejectDialog.getByRole('textbox', {
      name: /note|reason|rejection/i,
    });
    const rejectSubmit = rejectDialog.getByRole('button', {
      name: REJECT_CONFIRM_NAME,
    });
    await expect(rejectSubmit).toBeDisabled();

    // Typing a non-empty (≤500) note enables submit (BR2).
    await note.fill(FRESH_REJECT_NOTE);
    await expect(rejectSubmit).toBeEnabled();

    // Clearing the note disables submit again — the gate tracks the field live.
    await note.fill('');
    await expect(rejectSubmit).toBeDisabled();
  });

  // AC-4 (R7 / R8): confirming Approve flips the row to Approved, and confirming
  // Reject flips it to Rejected — each immediately, with a success toast. The
  // mock store flips on the POST so a re-fetch reflects the new status; an
  // optimistic in-place flip satisfies the same assertions.
  test('confirming Approve flips the row to Approved and confirming Reject flips it to Rejected, each with a success toast', async ({
    page,
  }) => {
    await mockReviewApi(page, approverUser);
    await signIn(page, approverUser);
    await page.goto('/transactions');

    // --- Approve flow ---
    const approveRow = rowFor(page, APPROVE_PROBE);
    await approveRow.getByRole('button', { name: /approve/i }).click();
    const approveDialog = page.getByRole('dialog');
    // Confirm via the dialog's affirmative control (not Cancel).
    await approveDialog
      .getByRole('button', { name: /^approve$|confirm/i })
      .click();

    // The row flips to Approved — asserted on the acted row's Status BADGE (exact
    // match), so it never collides with the Status filter's hidden <option>
    // Approved</option>. A success toast appears — asserted on its TITLE within
    // the Notifications toast region, never a page-wide status-word lookup.
    await expect(rowStatusBadge(page, APPROVE_PROBE, 'Approved')).toBeVisible();
    await expect(
      successToast(page, new RegExp(`${APPROVE_PROBE}.*approved`, 'i')),
    ).toBeVisible();

    // --- Reject flow ---
    const rejectRow = rowFor(page, REJECT_PROBE);
    await rejectRow.getByRole('button', { name: /reject/i }).click();
    const rejectDialog = page.getByRole('dialog');
    await rejectDialog
      .getByRole('textbox', { name: /note|reason|rejection/i })
      .fill(FRESH_REJECT_NOTE);
    await rejectDialog
      .getByRole('button', { name: REJECT_CONFIRM_NAME })
      .click();

    // The row flips to Rejected (Status badge, exact match) and a success toast
    // appears (title scoped to the toast region).
    await expect(rowStatusBadge(page, REJECT_PROBE, 'Rejected')).toBeVisible();
    await expect(
      successToast(page, new RegExp(`${REJECT_PROBE}.*rejected`, 'i')),
    ).toBeVisible();
  });

  // AC-5 (BR8): after rejection the row surfaces its rejection note + who rejected
  // it and when, read-only. We reject the Imported probe with a known note and
  // then assert the note text and an actioned-by/at indicator are visible — and
  // that there is NO editable note control left in the row (read-only).
  test('after rejection the row shows the rejection note plus who rejected it and when, read-only', async ({
    page,
  }) => {
    await mockReviewApi(page, approverUser);
    await signIn(page, approverUser);
    await page.goto('/transactions');

    // Reject the Imported probe with a known note (the mock records note + acting
    // user + timestamp on the store, so a re-fetch carries the full trail).
    const rejectRow = rowFor(page, REJECT_PROBE);
    await rejectRow.getByRole('button', { name: /reject/i }).click();
    const rejectDialog = page.getByRole('dialog');
    await rejectDialog
      .getByRole('textbox', { name: /note|reason|rejection/i })
      .fill(FRESH_REJECT_NOTE);
    await rejectDialog
      .getByRole('button', { name: REJECT_CONFIRM_NAME })
      .click();

    // The row is now Rejected — asserted on the acted row's Status BADGE (exact
    // match), isolating it from both the Status filter's hidden <option>Rejected
    // </option> AND the row's own "…rejected by…" trail string (which would make a
    // loose /rejected/i match twice within the row).
    await expect(rowStatusBadge(page, REJECT_PROBE, 'Rejected')).toBeVisible();

    // ... and surfaces the submitted note read-only.
    const rejectedRow = rowFor(page, REJECT_PROBE);
    await expect(rejectedRow.getByText(FRESH_REJECT_NOTE)).toBeVisible();

    // The trail names WHO rejected it — the acting Approver's audit identity. The
    // system records LastChangedUser as the signed-in user's EMAIL (the stable,
    // human-readable audit handle, established by Epic 2 Story 5 / the shared
    // `fetchCurrentUserIdentity`), and the optimistic flip surfaces exactly that
    // identity in the "rejected by …" trail — so the WHO assertion anchors on the
    // approver's EMAIL, the value the page genuinely renders. (AC-5's intent — the
    // trail names who acted — is unchanged; only the identity field it reads is
    // reconciled to the implementation, fix-cycle 2.)
    await expect(
      rejectedRow.getByText(new RegExp(approverUser.email, 'i')),
    ).toBeVisible();

    // The note is now READ-ONLY in the row — there is no editable note textbox
    // left behind in the rejected row (the editing affordance lived only in the
    // dialog, which has closed).
    await expect(
      rejectedRow.getByRole('textbox', { name: /note|reason|rejection/i }),
    ).toHaveCount(0);
  });

  // AC-1 / BR9 (fail-closed RBAC, persona slice exercised in E2E): the Importer
  // shares the read-only Transactions table but NEVER sees the Approve / Reject
  // actions — even on Imported rows where the Approver would. (The hard-failure
  // 403 path is vitest-tagged AC-6; here we prove the controls are simply absent
  // from the Importer's UI, BR9 — not hidden behind a disabled state.)
  test('the Importer never sees Approve or Reject actions, even on Imported rows', async ({
    page,
  }) => {
    await mockReviewApi(page, importerUser);
    await signIn(page, importerUser);
    await page.goto('/transactions');

    // The shared read-only table renders for the Importer (an Imported row shows).
    await expect(page.getByText(APPROVE_PROBE)).toBeVisible();

    // The row-level Approve / Reject ACTION controls are ABSENT for the Importer
    // (BR9) — zero anywhere in the transactions TABLE, including on Imported rows.
    // The lookup is scoped to the table AND anchored to the EXACT row-action names
    // "Approve" / "Reject": the Story-5 per-file summary panel (rendered OUTSIDE
    // the table) carries "Approved: N" / "Rejected: N" status-COUNT drill-down
    // buttons that are visible to BOTH roles and merely filter the table — they
    // are NOT approve/reject actions; and the Story-2 Status filter carries hidden
    // <option>Approved/Rejected</option> entries. A page-wide /approve/i |
    // /reject/i count would collide with both. Table-scoping plus the anchored
    // exact names isolates the row ACTIONS from the summary counts and the filter
    // options. (Locator precision only — the asserted intent, "the Importer sees
    // no row-level Approve/Reject action controls", is unchanged.)
    const table = page.getByRole('table');
    await expect(table.getByRole('button', { name: /^approve$/i })).toHaveCount(
      0,
    );
    await expect(table.getByRole('button', { name: /^reject$/i })).toHaveCount(
      0,
    );
  });
});
