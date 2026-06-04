/**
 * Story Metadata:
 * - Epic 4, Story 5: POPIA audit-trail surfacing on transaction detail
 * - Route: /transactions
 * - Target File: web/src/app/transactions/page.tsx (modify_existing)
 * - Page Action: modify_existing (EXTENDS the shipped Epic-3/4 Transactions
 *   surface at this path with a status-keyed audit trail — CLAUDE.md §7: extend
 *   the existing inline row trail, don't nest a second surface)
 *
 * Requirements: R15 (POPIA audit trail — surface who changed a transaction and
 * when, read-only). BR8 (a Rejected/Approved row surfaces its
 * LastChangedUser/LastChangedDate read-only).
 *
 * Failing-first (TDD red) tests for the VITEST-tagged acceptance criteria. Each
 * behaviour lives in the React render and is jsdom-observable (testing-policy
 * §"test at the layer where the behaviour lives"):
 *
 *   - AC-2 (VITEST): a Rejected transaction shows the "rejected by … on …" trail
 *           KEYED ON its Rejected status — the who/when is visible EVEN WHEN the
 *           rejection note is empty, and the note sub-line ("Rejection note: …")
 *           appears ONLY when a note exists. This is the resolution of the
 *           Epic-3 Story-3 [review]: the trail is gated on `isRejected` alone, not
 *           on `isRejected && UserNote`. Today the page gates the WHOLE trail on
 *           `isRejected && tx.UserNote`, so an empty-note Rejected row shows
 *           NOTHING — these assertions fail meaningfully (TDD red).
 *   - AC-3 (VITEST): when a rejection note exists it is displayed READ-ONLY
 *           (rendered text, no editable textarea / input) alongside the who/when.
 *
 * Each AC-2 assertion pins the CONTRAST (empty-note Rejected vs. noted Rejected)
 * so it cannot pass vacuously: the empty-note row proves the trail is keyed on
 * status (who/when present, note sub-line absent) and the noted row proves the
 * note sub-line appears only when content exists. An always-rendered or
 * never-rendered trail fails one half of the contrast.
 *
 * The Approved who/when trail (AC-1) is primarily PLAYWRIGHT-tagged (sibling
 * spec), but the approved-side audit line is jsdom-observable, so one supporting
 * test asserts an Approved row surfaces its who/when audit line — proving the new
 * trail is not Rejected-only. The full AC-1 (both Approved + Rejected on the
 * routed page) is driven by the sibling Playwright spec.
 *
 * AC-1 (who/when shown on Approved + Rejected detail on the live page) is
 * PLAYWRIGHT-tagged and covered by the sibling spec — it is not re-driven here.
 *
 * Surface: the audit trail renders INLINE within the row (the desktop <table>
 * row's Description cell, beneath the description) — matching the Epic-3 Story-3
 * read-only trail. The tests bind to the table row (`closest('tr')`), the same
 * surface the shipped trail uses, so they assert against the real render rather
 * than a hypothetical detail panel.
 *
 * Mocking (testing-policy §Mocking strategy): only the HTTP client
 * (@/lib/api/client) and the Next.js navigation boundary are mocked. The page,
 * its row rendering, the status-keyed audit-trail logic and the role gating
 * (fetchCurrentRole + asKnownRole) are the REAL code under test. The page is
 * wrapped in the existing RequireSession guard, so each test seeds the
 * client-side session marker through the real session-client helper rather than
 * mocking the guard. Rendered inside the REAL ToastProvider/ToastContainer to
 * mirror the layout (no toast fires on this read-only surface).
 *
 * Shape source: no api-shape-report.md exists for this build, so the spec + the
 * shared MockTransaction shape are authoritative. The Transaction collection
 * arrives under the SINGULAR `Transactions` envelope, which the API client
 * unwraps to a bare array before the page sees it — so the mocked get() resolves
 * the UNWRAPPED MockTransaction[]. MockTransaction carries Status, UserNote,
 * LastChangedUser and LastChangedDate (the audit-trail fields).
 *
 * The axe matcher is registered globally by web/vitest.setup.ts.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Production imports — the shipped page gates the rejected trail on
// `isRejected && tx.UserNote` and renders NO approved who/when line, so the
// status-keyed assertions below fail meaningfully against the current page (TDD
// red).
import TransactionsPage from '@/app/transactions/page';
import { get } from '@/lib/api/client';
import { ToastProvider } from '@/contexts/ToastContext';
import { ToastContainer } from '@/components/toast/ToastContainer';
import { markSessionStart, clearSession } from '@/lib/session/session-client';
import {
  createMockTransaction,
  type MockTransaction,
} from '../helpers/epic-2-mock-data';

// HTTP client — mocked per testing-policy. `get` feeds the transactions list AND
// the role source behind fetchCurrentRole. This is a read-only surface, so no
// `post` sink is exercised.
vi.mock('@/lib/api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
}));
const mockGet = get as ReturnType<typeof vi.fn>;

// Navigation boundary — RequireSession touches the router on its mount path.
const pushMock = vi.fn();
const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, refresh: vi.fn() }),
  usePathname: () => '/transactions',
  useSearchParams: () => new URLSearchParams(),
}));

/** An Approver user record as the role source emits it (route owner, R1). */
const approverUserRecord = {
  Email: 'approver@example.com',
  RolesString: 'Approver',
  Roles: [{ Name: 'Approver' }],
};

/** The acting user + timestamp the audit trail surfaces (LastChangedUser/Date). */
const AUDIT_USER = 'reviewer@example.com';
const AUDIT_DATE = '2026-05-20T11:30:00Z';
/** The formatted (UTC yyyy-mm-dd) date the page renders LastChangedDate as. */
const AUDIT_DATE_DISPLAY = '2026-05-20';

/** A Rejected transaction with an EMPTY rejection note (audit fields set). */
const REJECTED_NO_NOTE_REF = 'TXN-REJ-NONOTE';
function rejectedNoNoteRow(
  overrides: Partial<MockTransaction> = {},
): MockTransaction {
  return createMockTransaction({
    Id: 9501,
    Reference: REJECTED_NO_NOTE_REF,
    AccountNumber: '7000000001',
    Status: 'Rejected',
    UserNote: '',
    LastChangedUser: AUDIT_USER,
    LastChangedDate: AUDIT_DATE,
    ...overrides,
  });
}

/** A Rejected transaction WITH a rejection note (audit fields set). */
const REJECTED_WITH_NOTE_REF = 'TXN-REJ-NOTED';
const REJECTION_NOTE = 'Amount does not match the source statement.';
function rejectedWithNoteRow(
  overrides: Partial<MockTransaction> = {},
): MockTransaction {
  return createMockTransaction({
    Id: 9502,
    Reference: REJECTED_WITH_NOTE_REF,
    AccountNumber: '7000000002',
    Status: 'Rejected',
    UserNote: REJECTION_NOTE,
    LastChangedUser: AUDIT_USER,
    LastChangedDate: AUDIT_DATE,
    ...overrides,
  });
}

/** An Approved transaction with its audit fields set (who/when on approval). */
const APPROVED_REF = 'TXN-APPROVED';
function approvedRow(
  overrides: Partial<MockTransaction> = {},
): MockTransaction {
  return createMockTransaction({
    Id: 9503,
    Reference: APPROVED_REF,
    AccountNumber: '7000000003',
    Status: 'Approved',
    UserNote: '',
    LastChangedUser: AUDIT_USER,
    LastChangedDate: AUDIT_DATE,
    ...overrides,
  });
}

/**
 * Drives get() so the transactions list resolves to `rows` while the role source
 * resolves an Approver (the route owner). Mirrors the Epic-3 path-based mock so
 * fetchCurrentRole resolves consistently.
 */
function seed(rows: MockTransaction[]) {
  mockGet.mockImplementation((path: string) => {
    if (path.includes('/v1/transactions')) {
      return Promise.resolve(rows);
    }
    if (path.includes('/userinfo')) {
      return Promise.resolve(approverUserRecord);
    }
    if (path.includes('/v1/users')) {
      return Promise.resolve([approverUserRecord]);
    }
    return Promise.resolve([]);
  });
}

/**
 * Renders the Transactions page inside the real ToastProvider/ToastContainer with
 * an authenticated client-side session so RequireSession yields its protected
 * content, then waits for the initial reads to settle (loading gone, table shown).
 */
async function renderTransactionsPage() {
  markSessionStart();
  const utils = render(
    <ToastProvider>
      <TransactionsPage />
      <ToastContainer />
    </ToastProvider>,
  );
  await waitFor(() =>
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument(),
  );
  await screen.findByRole('table');
  return utils;
}

/** The table row whose Reference cell matches `reference`. */
function rowFor(reference: string): HTMLElement {
  return screen.getByText(reference).closest('tr') as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  clearSession();
});

describe('Epic 4, Story 5 — Rejected audit trail keyed on status (AC-2, R15, BR8)', () => {
  // AC-2 (the key behaviour): a Rejected transaction with an EMPTY note still
  // shows WHO rejected it and WHEN — the who/when trail is keyed on the Rejected
  // STATUS, not on note-presence. The note sub-line is ABSENT (no empty
  // "Rejection note:" label) because there is no note. This fails on the shipped
  // page, which gates the whole trail on `isRejected && tx.UserNote` (an
  // empty-note Rejected row therefore renders nothing) — TDD red.
  it('shows who/when on a Rejected row even when the rejection note is empty', async () => {
    seed([rejectedNoNoteRow()]);
    await renderTransactionsPage();

    const row = rowFor(REJECTED_NO_NOTE_REF);

    // WHO + WHEN are surfaced (keyed on Rejected status).
    expect(within(row).getByText(/rejected by/i)).toHaveTextContent(
      new RegExp(AUDIT_USER),
    );
    expect(within(row).getByText(/rejected by/i)).toHaveTextContent(
      new RegExp(AUDIT_DATE_DISPLAY),
    );

    // The note sub-line is ABSENT — there is no note, so no "Rejection note:"
    // label appears (it must not show an empty note line).
    expect(within(row).queryByText(/rejection note:/i)).not.toBeInTheDocument();
  });

  // AC-2 contrast: a Rejected transaction WITH a note shows BOTH the who/when
  // trail AND the note sub-line. Paired with the empty-note case above this
  // proves the WHO/WHEN is keyed on status (present in both) while the note
  // sub-line is keyed on note-presence (present only here).
  it('shows BOTH the who/when trail and the note sub-line on a noted Rejected row', async () => {
    seed([rejectedWithNoteRow()]);
    await renderTransactionsPage();

    const row = rowFor(REJECTED_WITH_NOTE_REF);

    // WHO + WHEN — same status-keyed trail as the empty-note row.
    expect(within(row).getByText(/rejected by/i)).toHaveTextContent(
      new RegExp(AUDIT_USER),
    );
    expect(within(row).getByText(/rejected by/i)).toHaveTextContent(
      new RegExp(AUDIT_DATE_DISPLAY),
    );

    // The note sub-line IS present (note-keyed) and carries the note text.
    expect(within(row).getByText(/rejection note:/i)).toBeInTheDocument();
    expect(
      within(row).getByText(new RegExp(REJECTION_NOTE)),
    ).toBeInTheDocument();
  });

  // AC-1 supporting (Approved side is jsdom-observable; full AC-1 is the sibling
  // Playwright spec): an Approved transaction surfaces its who/when audit line,
  // proving the new trail is NOT Rejected-only (the shipped page renders no
  // approved audit line at all) — TDD red.
  it('shows who/when on an Approved row', async () => {
    seed([approvedRow()]);
    await renderTransactionsPage();

    const row = rowFor(APPROVED_REF);

    // The acting user + date are surfaced on the Approved row (R15 / BR8).
    expect(within(row).getByText(new RegExp(AUDIT_USER))).toBeInTheDocument();
    expect(
      within(row).getByText(new RegExp(AUDIT_DATE_DISPLAY)),
    ).toBeInTheDocument();
    // The Rejected-only "rejected by" phrasing must NOT appear on an Approved row.
    expect(within(row).queryByText(/rejected by/i)).not.toBeInTheDocument();
  });
});

describe('Epic 4, Story 5 — rejection note is read-only (AC-3, R15)', () => {
  // AC-3: when a rejection note exists it is shown READ-ONLY alongside the
  // who/when — rendered as text, NOT inside an editable control. The row must
  // expose the note text but no <textarea>/editable <input> bound to it (this is
  // a read-only audit surface — no re-edit affordance).
  it('renders the rejection note as read-only text (no editable control)', async () => {
    seed([rejectedWithNoteRow()]);
    await renderTransactionsPage();

    const row = rowFor(REJECTED_WITH_NOTE_REF);

    // The note text is present alongside the who/when trail ...
    expect(within(row).getByText(/rejection note:/i)).toBeInTheDocument();
    expect(
      within(row).getByText(new RegExp(REJECTION_NOTE)),
    ).toBeInTheDocument();
    expect(within(row).getByText(/rejected by/i)).toHaveTextContent(
      new RegExp(AUDIT_USER),
    );

    // ... but there is NO editable control (textbox) within the row — the note is
    // surfaced read-only, not in an editable textarea/input.
    expect(within(row).queryByRole('textbox')).not.toBeInTheDocument();
  });
});

describe('Epic 4, Story 5 — accessibility (audit-trail baseline)', () => {
  // The audit-trail surface (an empty-note Rejected row + a noted Rejected row +
  // an Approved row) has no axe violations. We assert the who/when trail rendered
  // first so this breaks on a missing/placeholder trail rather than vacuously
  // passing on a page that never renders it.
  it('has no accessibility violations with audit trails rendered', async () => {
    seed([rejectedNoNoteRow(), rejectedWithNoteRow(), approvedRow()]);

    const { container } = await renderTransactionsPage();

    // The status-keyed trail is present (anchor so axe isn't run on an empty DOM).
    expect(
      within(rowFor(REJECTED_NO_NOTE_REF)).getByText(/rejected by/i),
    ).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });
});
