/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: web/src/app/transactions/page.tsx
 * - Page Action: modify_existing
 *
 * E2E spec for Epic 4, Story 5 (the epic's final story): POPIA audit-trail
 * surfacing on the transaction detail (R15 — project-brief §5 POPIA "Audit trail";
 * BR8). The POPIA obligation (project-brief §5, l.108) is: "every Approve and
 * Reject action must be traceable to the acting user and timestamp. The
 * `LastChangedUser` / `LastChangedDate` fields on Transaction records carry this
 * trail. The UI must surface the rejection note and last-changed metadata on the
 * Transaction detail view." This story extends that surfacing to BOTH terminal
 * states:
 *   - APPROVED transactions now also surface who last changed the row and when
 *     (LastChangedUser / LastChangedDate) — read-only. Until this story the page
 *     rendered an audit trail ONLY on Rejected rows that carried a non-empty
 *     UserNote, so an Approved row had NO who/when trail at all — this is the
 *     behaviour that makes the test red.
 *   - REJECTED transactions surface the same who/when, keyed on the Rejected
 *     STATUS rather than on the presence of a note — so the "rejected by … on …"
 *     trail shows even when the rejection note is empty.
 *
 * Coverage split (one test per PLAYWRIGHT-tagged AC):
 *   - AC-1 (PLAYWRIGHT): for an Approved OR Rejected transaction, the detail
 *     surface shows who last changed it (LastChangedUser) and when
 *     (LastChangedDate), read-only.
 *
 * Mocking strategy: project default is `page-route-with-shape-report`
 * (intake-manifest.json -> context.testInfrastructure.playwrightMockingDefault),
 * but no api-shape-report.md exists in this repo yet, so the GET response body is
 * built from documentation/transactions-api.yaml (TransactionReadList /
 * TransactionRead) + the PascalCase runtime shapes established by Epic 2/3:
 *   - GET .../v1/transactions -> the SINGULAR-keyed `{ Transactions: [...] }`
 *     envelope (project-brief §6 / §13.C). The page sorts + paginates CLIENT-SIDE
 *     over the full set returned here — same model as Epic 3 Story 1/2/3.
 * This story surfaces ALREADY-PERSISTED audit metadata; it issues no approve/reject
 * POST, so the read-only GET is the only data route exercised (no stateful mutate
 * harness is needed — distinct from the Story-3 review-actions spec).
 *
 * Audit-identity contract (mirrors Epic 3 Story 3, fix-cycle 2): the system's
 * `LastChangedUser` audit handle is the acting user's EMAIL (the stable,
 * human-readable value the backend records — established by Epic 2 Story 5 Cancel
 * File and the shared `fetchCurrentUserIdentity`). So both the Approved and the
 * Rejected fixture rows below carry an EMAIL in LastChangedUser, and the WHO
 * assertion anchors on that email — the value the page genuinely surfaces.
 *
 * Internal-consistency contract (the Story-1 defect class this spec avoids):
 *   - The full set is exactly 5 rows — comfortably UNDER the default page size of
 *     20 — so EVERY row sits on page 1 under the default Transaction-Date-DESC
 *     sort. No assertion below depends on pagination or sort order, so an asserted
 *     row can never be pushed off-screen.
 *   - References are unique + zero-padded so row lookups never collide.
 *   - There is exactly ONE Approved probe row and ONE Rejected probe row, each with
 *     a DISTINCT LastChangedUser email and a DISTINCT LastChangedDate, so the
 *     who/when assertions for one state can never be satisfied by the other's trail.
 *
 * Locator-precision contract (the Story-1/2/3 defect class this spec hardens
 * against):
 *   - The Status FILTER is a native <select> carrying hidden <option>Approved
 *     </option> / <option>Rejected</option> entries (Story 2). A PAGE-WIDE
 *     getByText(/approved|rejected/i) would collide with those hidden options AND
 *     with the per-File Summary panel's "Approved: N / Rejected: N" drill-down
 *     buttons (Story 5/R10). So every audit-trail assertion below is scoped to the
 *     ACTED ROW (located by its unique Reference) — never page-wide.
 *   - The audit trail renders INLINE in the row's Description cell as a "<verb> by
 *     <LastChangedUser> on <date>" string. The WHO assertion anchors on the
 *     LastChangedUser EMAIL within that row; the WHEN assertion anchors on the
 *     formatted date (the page renders LastChangedDate via the same YYYY-MM-DD
 *     `formatTransactionDate` helper the Transaction Date column uses), so the spec
 *     asserts the date in that display form rather than the raw ISO string.
 *
 * Dialog / toast / announcer note: the App Router injects a permanently-present
 * EMPTY `<div role="alert">` route announcer, so this spec NEVER relies on a bare
 * alert selector — every assertion targets the acted ROW (getByRole('row') filtered
 * by Reference) and its cell text. No success-toast / dialog is involved (this is a
 * read-only surfacing of persisted metadata).
 *
 * Read-only contract: the audit trail is purely informational — the asserted rows
 * are terminal (Approved / Rejected), on which the Approver's Approve/Reject row
 * actions are HIDDEN (BR1), and the trail itself carries no editable control. The
 * spec asserts there is NO editable note textbox in the acted row.
 *
 * Auth: the /transactions surface is auth-gated (RequireSession + HttpOnly session
 * cookie), so the test drives the real login flow first — reusing the EXACT
 * same-origin /api/* auth-mock + login + cold-route nav-timeout pattern from Epic 3
 * Story 1/2/3. It signs in as the APPROVER (the audit trail is visible to both
 * roles, but the Approver is the §2 persona whose actions the trail records).
 *
 * These tests WILL FAIL until the Approved-row who/when trail is surfaced AND the
 * Rejected-row trail is re-keyed on Status (not on a non-empty note) on
 * /transactions — today only Rejected rows with a non-empty UserNote show a trail
 * (page.tsx l.1778 `isRejected && tx.UserNote`) and Approved rows show none — TDD
 * red.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { approverUser, type TestUser } from './fixtures/credentials';

/**
 * Post-login navigation must tolerate a `next dev` COLD-ROUTE compile. The
 * /transactions page is heavy to compile on its first hit (Table + StatusBadge +
 * filters + summary + dialogs + zod), during which the URL legitimately stays on
 * /login until the destination route finishes compiling — which can exceed the 5s
 * default `toHaveURL` timeout. Setup-mechanism wait, not a behavioural assertion.
 * Lifted verbatim from Epic 3 Story 1/2/3.
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
 * The Approved + Rejected probe rows carry a DISTINCT acting-user EMAIL and a
 * DISTINCT last-changed DATE so the who/when assertions for one state can never be
 * satisfied by the other's trail (the system's LastChangedUser audit handle is the
 * acting user's email — see the audit-identity contract above).
 *
 * Date de-collision: the audit LastChangedDate display for each terminal row MUST
 * NOT equal ANY row's TransactionDate display, otherwise the row-scoped WHEN
 * assertion (`row.getByText(DISPLAY)`) resolves to TWO elements — the Transaction
 * Date cell AND the audit "on <date>" line — a strict-mode violation. Every
 * TransactionDate display is `BASE_DATE_MS − id·day` for id 1..5, i.e. the five
 * April days 2026-04-25 … 2026-04-29. So the audit dates below are pinned to MAY
 * 2026 — a different month, guaranteed disjoint from every TransactionDate and from
 * each other — making each audit-line date a UNIQUE match within its row.
 */
const APPROVED_REF = 'TXN-20260415-0002';
const APPROVED_BY = 'thandiwe.approver@example.co.za';
const APPROVED_AT_ISO = '2026-05-12T11:15:00Z';
const APPROVED_AT_DISPLAY = '2026-05-12'; // the page's YYYY-MM-DD render of LastChangedDate

const REJECTED_REF = 'TXN-20260415-0004';
const REJECTED_BY = 'lerato.reviewer@example.co.za';
const REJECTED_AT_ISO = '2026-05-11T09:40:00Z';
const REJECTED_AT_DISPLAY = '2026-05-11';

/**
 * The full set: exactly 5 rows, all on page 1 (default page size 20). Statuses
 * cover the terminal Approved / Rejected probes plus spare Imported rows:
 *   - Id 1, 3, 5 — Imported (system audit metadata; no trail expected).
 *   - Id 2 — Approved by APPROVED_BY at APPROVED_AT_ISO (who/when probe).
 *   - Id 4 — Rejected by REJECTED_BY at REJECTED_AT_ISO, with an EMPTY UserNote
 *     (so the test proves the rejected trail keys on STATUS, not on a note).
 *
 * TransactionDates DESCEND with Id (lower Id => more recent), matching the page's
 * default Transaction-Date-DESC sort; because all 5 fit on page 1, no assertion
 * depends on that ordering.
 */
const BASE_DATE_MS = Date.parse('2026-04-30T15:00:00Z');
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function buildTransactions(): MockTransaction[] {
  return [1, 2, 3, 4, 5].map((id) => {
    const base = transaction({
      Id: id,
      Reference: `TXN-20260415-${String(id).padStart(4, '0')}`,
      AccountNumber: `ACCT-${String(id).padStart(4, '0')}`,
      Amount: id * 100,
      TransactionDate: new Date(BASE_DATE_MS - id * ONE_DAY_MS).toISOString(),
    });
    if (id === 2) {
      return {
        ...base,
        Status: 'Approved',
        UserNote: '',
        LastChangedUser: APPROVED_BY,
        LastChangedDate: APPROVED_AT_ISO,
      };
    }
    if (id === 4) {
      return {
        ...base,
        Status: 'Rejected',
        // Deliberately EMPTY: the rejected trail must surface on STATUS alone (the
        // "rejected by … on …" who/when shows even with no note) — BR8 / R15.
        UserNote: '',
        LastChangedUser: REJECTED_BY,
        LastChangedDate: REJECTED_AT_ISO,
      };
    }
    return base; // Imported spares
  });
}

/** Build a single User record in the observed PascalCase shape (mirrors Epic 2/3 specs). */
function userRecord(user: TestUser) {
  return {
    Id: user.role === 'Importer' ? 101 : 202,
    Email: user.email,
    FirstName: user.firstName,
    LastName: user.lastName,
    // Emit the PRODUCTION role NAME on the wire: the live backend returns the
    // Importer as 'File Importer' (the Approver as 'Approver'). The bare
    // TestUser.role stays the test-logic discriminator; only the emitted name is
    // mapped here (Epic 5 Story 1 — role-name realism).
    RolesString: user.role === 'Importer' ? 'File Importer' : 'Approver',
    Roles: [
      {
        Id: user.role === 'Importer' ? 1 : 2,
        Name: user.role === 'Importer' ? 'File Importer' : 'Approver',
      },
    ],
    Pages: [],
    LastChangedUser: 'system',
    LastChangedDate: '2026-06-01T08:00:00Z',
  };
}

/**
 * Wire the same-origin /api/* mocks the audit-trail surfacing needs — the Epic 3
 * Story 1/2 auth + read-only list harness, unchanged. No stateful approve/reject
 * mutate route is needed: this story surfaces ALREADY-persisted audit metadata, so
 * the GET returns the fixed set carrying the terminal-state trails.
 */
async function mockTransactionsApi(
  page: Page,
  validUser: TestUser,
): Promise<void> {
  let signedIn: TestUser | null = null;
  const transactions = buildTransactions();

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

  // GET transactions: SINGULAR-keyed `{ Transactions: [...] }` envelope (§6 /
  // §13.C), returning the fixed set carrying the terminal-state audit trails.
  await page.route(/\/api\/.*\/transactions(\?.*)?$/i, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ Transactions: transactions }),
    });
  });
}

/**
 * Drive the real login form so the session cookie + client marker are
 * established, then wait for the post-login navigation to leave /login using the
 * generous cold-route timeout (see SIGN_IN_NAV_TIMEOUT_MS). Identical to Story 1/2/3.
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

test.describe('Epic 4, Story 5: POPIA audit-trail surfacing on transaction detail', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-1 (R15 / POPIA §5 audit-trail / BR8): for an Approved transaction AND for a
  // Rejected transaction the detail surface shows WHO last changed it
  // (LastChangedUser — the acting user's audit-handle email) and WHEN
  // (LastChangedDate, rendered YYYY-MM-DD), read-only. The Approved trail is the
  // genuinely-new surfacing (no Approved trail existed before this story); the
  // Rejected trail proves it keys on the Rejected STATUS, surfacing even though the
  // probe row's UserNote is empty.
  test('Approved and Rejected rows surface who last changed them and when, read-only', async ({
    page,
  }) => {
    await mockTransactionsApi(page, approverUser);
    await signIn(page, approverUser);
    await page.goto('/transactions');

    // The data is loaded — the Approved probe row is on screen (page 1, default sort).
    const approvedRow = rowFor(page, APPROVED_REF);
    await expect(approvedRow).toBeVisible();

    // --- Approved row: who + when, scoped to the acted row. ---
    // WHO: the acting user's LastChangedUser audit handle (the email) appears in
    // the row's audit trail. Scoped to the row so it never collides with the
    // signed-in approver's own identity rendered elsewhere on the page.
    await expect(
      approvedRow.getByText(new RegExp(APPROVED_BY, 'i')),
    ).toBeVisible();
    // WHEN: the LastChangedDate, in the page's YYYY-MM-DD display form, appears in
    // the same row's trail. The audit date (May) is disjoint from every row's
    // April TransactionDate display, so this resolves to the single audit-line
    // match (no strict-mode collision with the Transaction Date cell).
    await expect(approvedRow.getByText(APPROVED_AT_DISPLAY)).toBeVisible();
    // Read-only: no editable note/reason control lives in the trail (the audit
    // metadata is purely informational on a terminal row).
    await expect(
      approvedRow.getByRole('textbox', { name: /note|reason|rejection/i }),
    ).toHaveCount(0);

    // --- Rejected row: who + when, surfaced on Status alone (empty note). ---
    const rejectedRow = rowFor(page, REJECTED_REF);
    await expect(rejectedRow).toBeVisible();
    // WHO: the rejecting user's audit-handle email — distinct from the Approved
    // probe's, so this assertion can only be satisfied by the Rejected row's trail.
    await expect(
      rejectedRow.getByText(new RegExp(REJECTED_BY, 'i')),
    ).toBeVisible();
    // WHEN: the rejected row's LastChangedDate, in display form. Likewise pinned to
    // May so it is the only match within the row (disjoint from the April
    // TransactionDate cell) — no strict-mode collision.
    await expect(rejectedRow.getByText(REJECTED_AT_DISPLAY)).toBeVisible();
    // The trail is read-only here too — no editable control remains.
    await expect(
      rejectedRow.getByRole('textbox', { name: /note|reason|rejection/i }),
    ).toHaveCount(0);
  });
});
