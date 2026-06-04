/**
 * Story Metadata:
 * - Epic 3, Story 3: Review actions — approve or reject an Imported transaction
 * - Route: /transactions
 * - Target File: web/src/app/transactions/page.tsx (modify_existing)
 * - Page Action: modify_existing (EXTENDS the Epic-3 Story-1/2 transactions table
 *   at this path with Approver-only Approve / Reject row-actions — CLAUDE.md §7:
 *   extend the existing surface, don't nest a second table)
 *
 * Requirements: R7 (Approver approves an `Imported` transaction via a confirm
 * modal naming the reference; status → `Approved`, row updates immediately with a
 * toast), R8 (Approver rejects an `Imported` transaction by submitting a non-empty
 * Rejection Note [multi-line, max 500], submit disabled until a note is entered;
 * status → `Rejected`, row updates with a toast), BR1 (Approve/Reject hidden — not
 * disabled — unless Status is `Imported`), BR2 (mandatory Rejection Note, validate
 * on blur AND on submit), BR3 (confirm modal names the reference; Approve's primary
 * is destructive-styled with default focus on Cancel), BR8 (a Rejected row shows
 * its note + LastChangedUser/LastChangedDate read-only), BR9 (the Importer/unknown
 * persona has NO Approve/Reject — absent from the UI, fail-closed).
 *
 * Failing-first (TDD red) tests for the VITEST-tagged acceptance criteria — each
 * behaviour lives in the React render and is jsdom-observable (testing-policy
 * §"test at the layer where the behaviour lives"):
 *   - AC-3 (VITEST): the Rejection Note is validated on blur AND on submit — an
 *           empty note blocks submit (the submit control is disabled and a
 *           validation message appears), a non-empty note enables submit, and the
 *           500-char ceiling is enforced (over-500 prevented or flagged). Each
 *           assertion pins the CONTRAST (empty vs. valid) so it cannot pass
 *           vacuously on a control that is always-enabled or always-disabled.
 *   - AC-6 (VITEST): for an Importer/unknown role neither row-action renders
 *           (fail-closed — BR9), AND for an Approver a hard backend failure on the
 *           mutation surfaces an ASSERTIVE inline error (role="alert") while
 *           leaving the row's Status badge unchanged (still `Imported`) and NOT
 *           firing the success toast. The inline alert is distinguished from the
 *           toast by role: the toast surface is role="status" (web/src/components/
 *           toast/Toast.tsx — Epic-1 journal), the canonical error is role="alert".
 *           The role-gating tests anchor each negative (Importer / unresolved) to
 *           the Approver POSITIVE baseline in the same test, so they cannot pass
 *           vacuously on a page that simply never renders the actions.
 *
 * AC-1 (actions appear only on Imported rows / hidden on Approved+Rejected),
 * AC-2 (the confirm dialog names the Reference + Cancel-focus; Reject submit
 * disabled until non-empty), AC-4 (confirm Approve→Approved / Reject→Rejected with
 * a success toast each) and AC-5 (a rejected row shows its note + who/when
 * read-only) are PLAYWRIGHT-tagged and covered by the sibling spec — they are not
 * re-driven here.
 *
 * Mocking (testing-policy §Mocking strategy): only the HTTP client
 * (@/lib/api/client) and the Next.js navigation boundary are mocked. The page, the
 * Shadcn confirm/reject dialog, the Rejection-Note validation, the role gating
 * (fetchCurrentRole + asKnownRole), the optimistic row-flip and the inline
 * mutation-error surface are the REAL code under test. The page is wrapped in the
 * existing RequireSession guard (reads the client-side session marker via
 * useSyncExternalStore), so each test seeds the marker through the real
 * session-client helper rather than mocking the guard. Because the success path
 * raises a toast via useToast(), the page is rendered inside the REAL ToastProvider
 * + ToastContainer (layout.tsx) so a fired toast is jsdom-observable — AC-6 then
 * asserts that surface stays EMPTY on a failed mutation.
 *
 * Shape source: documentation/transactions-api.yaml (TransactionRead /
 * TransactionReadList) + project-brief §6 / §9 (Approve/Reject flows) / §13-B
 * (`POST /v1/transactions/approve?TransactionId=<id>` and
 * `POST /v1/transactions/reject?TransactionId=<id>` with body `{"UserNote":...}`,
 * both carrying the `LastChangedUser` header). No api-shape-report.md exists for
 * this build, so the spec + the shared MockTransaction shape are authoritative.
 * The Transaction collection arrives under the SINGULAR `Transactions` envelope
 * key, which the API client unwraps to a bare array before the page sees it — so
 * the mocked get() resolves the UNWRAPPED MockTransaction[]. The role source is
 * driven the same way as Story-1/2.
 *
 * The axe matcher is registered globally by web/vitest.setup.ts.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Production imports — the Story-1/2 page renders NO Approve/Reject controls, NO
// reject dialog, NO note validation and NO per-row mutation error surface, so
// every assertion below fails meaningfully against the current page (TDD red).
import TransactionsPage from '@/app/transactions/page';
import { get, post } from '@/lib/api/client';
import { ToastProvider } from '@/contexts/ToastContext';
import { ToastContainer } from '@/components/toast/ToastContainer';
import { markSessionStart, clearSession } from '@/lib/session/session-client';
import {
  createMockTransaction,
  type MockTransaction,
} from '../helpers/epic-2-mock-data';

// HTTP client — mocked per testing-policy. `get` feeds the transactions list AND
// the role source behind fetchCurrentRole; `post` is the approve/reject sink
// (POST /v1/transactions/{approve,reject}?TransactionId=<id>).
vi.mock('@/lib/api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
}));
const mockGet = get as ReturnType<typeof vi.fn>;
const mockPost = post as ReturnType<typeof vi.fn>;

// Navigation boundary — RequireSession touches the router on its mount path.
const pushMock = vi.fn();
const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, refresh: vi.fn() }),
  usePathname: () => '/transactions',
  useSearchParams: () => new URLSearchParams(),
}));

/** An Approver user record as the role source (`/userinfo` / `/v1/users`) emits it. */
const approverUserRecord = {
  Email: 'approver@example.com',
  RolesString: 'Approver',
  Roles: [{ Name: 'Approver' }],
};

/** An Importer user record — the persona that must see NO Approve/Reject (BR9). */
const importerUserRecord = {
  Email: 'importer@example.com',
  RolesString: 'Importer',
  Roles: [{ Name: 'Importer' }],
};

/** The single Imported transaction the action-driving tests operate on. */
const IMPORTED_REFERENCE = 'TXN-REVIEW-1';
function importedRow(
  overrides: Partial<MockTransaction> = {},
): MockTransaction {
  return createMockTransaction({
    Id: 9301,
    Reference: IMPORTED_REFERENCE,
    AccountNumber: '5000000001',
    Status: 'Imported',
    UserNote: '',
    ...overrides,
  });
}

/**
 * Drives get() so the transactions list resolves to `rows` while the role source
 * resolves the supplied persona record (Approver by default). Mirrors the
 * Story-1/2 path-based mock so fetchCurrentRole resolves consistently.
 */
function seed({
  rows,
  role = approverUserRecord,
}: {
  rows: MockTransaction[];
  role?: typeof approverUserRecord;
}) {
  mockGet.mockImplementation((path: string) => {
    if (path.includes('/v1/transactions')) {
      return Promise.resolve(rows);
    }
    if (path.includes('/userinfo')) {
      return Promise.resolve(role);
    }
    if (path.includes('/v1/users')) {
      return Promise.resolve([role]);
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

/**
 * Opens the Reject dialog for the (single) Imported row and returns it. The role
 * resolves to an Approver before this, so the Reject action is present.
 */
async function openRejectDialog(user: ReturnType<typeof userEvent.setup>) {
  const row = rowFor(IMPORTED_REFERENCE);
  await user.click(within(row).getByRole('button', { name: /^reject$/i }));
  return screen.findByRole('dialog');
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  clearSession();
});

describe('Epic 3, Story 3 — Rejection-Note validation (AC-3, R8, BR2)', () => {
  // AC-3 / BR2: with an EMPTY note the submit control is disabled (the note is
  // mandatory) — the contrast (enabled-on-valid) is asserted in the next test, so
  // together they prove the gate reads the note rather than being permanently
  // disabled.
  it('disables the reject submit while the Rejection Note is empty', async () => {
    const user = userEvent.setup();
    seed({ rows: [importedRow()] });
    await renderTransactionsPage();

    const dialog = await openRejectDialog(user);

    // The submit (confirm-reject) control is present but disabled with no note.
    const submit = within(dialog).getByRole('button', {
      name: /(reject|confirm|submit)/i,
    });
    expect(submit).toBeDisabled();

    // No mutation can be fired from a disabled gate.
    expect(mockPost).not.toHaveBeenCalled();
  });

  // AC-3 / BR2: entering a non-empty note ENABLES submit — the contrast to the
  // empty case above. Proves the gate is driven by the note's content.
  it('enables the reject submit once a non-empty note is entered', async () => {
    const user = userEvent.setup();
    seed({ rows: [importedRow()] });
    await renderTransactionsPage();

    const dialog = await openRejectDialog(user);

    const note = within(dialog).getByRole('textbox', {
      name: /(rejection note|note|reason)/i,
    });
    await user.type(note, 'Duplicate of an earlier transaction.');

    const submit = within(dialog).getByRole('button', {
      name: /(reject|confirm|submit)/i,
    });
    await waitFor(() => expect(submit).toBeEnabled());
  });

  // AC-3 / BR2: validation fires on BLUR — leaving an empty note surfaces a
  // validation message (not only on submit). The message is gone once a valid
  // note is supplied, pinning the contrast so it cannot pass on an always-present
  // hint.
  it('surfaces a validation message when the note is left empty on blur', async () => {
    const user = userEvent.setup();
    seed({ rows: [importedRow()] });
    await renderTransactionsPage();

    const dialog = await openRejectDialog(user);

    const note = within(dialog).getByRole('textbox', {
      name: /(rejection note|note|reason)/i,
    });
    // Focus then blur the empty note (Tab moves focus away → blur).
    await user.click(note);
    await user.tab();

    expect(
      await within(dialog).findByText(
        /(required|enter|cannot be empty|provide)/i,
      ),
    ).toBeInTheDocument();

    // Supplying a valid note clears the validation message (contrast).
    await user.type(note, 'Amount does not match the source statement.');
    await waitFor(() =>
      expect(
        within(dialog).queryByText(
          /(required|cannot be empty|must enter a note)/i,
        ),
      ).not.toBeInTheDocument(),
    );
  });

  // AC-3 / BR2: the 500-char ceiling is enforced — a note longer than 500 chars
  // is either prevented (the field never holds more than 500) OR flagged with an
  // over-limit message while submit stays blocked. We accept either enforcement
  // shape but require ONE of them, so an unbounded textarea fails.
  //
  // The 520-char input is delivered in ONE shot via user.paste (after focusing
  // the field) rather than char-by-char user.type: jsdom charges ~14ms/keystroke,
  // so typing 520 chars overran the 5s default timeout while telling us nothing
  // extra. paste() still honours the field's maxLength, so the cap is exercised
  // identically — just fast and deterministically. The assertion intent is
  // unchanged.
  it('enforces the 500-character ceiling on the Rejection Note', async () => {
    const user = userEvent.setup();
    seed({ rows: [importedRow()] });
    await renderTransactionsPage();

    const dialog = await openRejectDialog(user);

    const note = within(dialog).getByRole('textbox', {
      name: /(rejection note|note|reason)/i,
    }) as HTMLTextAreaElement;

    const overLimit = 'x'.repeat(520);
    await user.click(note);
    await user.paste(overLimit);

    const submit = within(dialog).getByRole('button', {
      name: /(reject|confirm|submit)/i,
    });

    // Either the field hard-caps at 500 chars, OR an over-limit message is shown
    // and the submit is blocked — but an unbounded, freely-submittable 520-char
    // note is not acceptable.
    const capped = note.value.length <= 500;
    const flagged =
      within(dialog).queryByText(/(500|too long|maximum|max)/i) !== null;
    expect(capped || flagged).toBe(true);
    if (!capped) {
      expect(submit).toBeDisabled();
    }
  });
});

describe('Epic 3, Story 3 — fail-closed role gating (AC-6, BR9)', () => {
  // AC-6 / BR9: the actions are role-gated to the Approver. This test pins the
  // CONTRAST so it cannot pass vacuously on a page that simply never renders the
  // actions (e.g. the current Story-1/2 read-only table): an APPROVER on an
  // Imported row DOES get Approve + Reject, while an IMPORTER on the SAME row gets
  // NEITHER (absent, not disabled — fail-closed). Both halves render in the same
  // test so the positive baseline (which fails during red) anchors the negative.
  it('shows Approve/Reject for an Approver but NOT for an Importer on the same Imported row', async () => {
    // Approver — the actions are present on the Imported row.
    seed({ rows: [importedRow()], role: approverUserRecord });
    const approverView = await renderTransactionsPage();
    const approverRow = rowFor(IMPORTED_REFERENCE);
    expect(
      within(approverRow).getByRole('button', { name: /^approve$/i }),
    ).toBeInTheDocument();
    expect(
      within(approverRow).getByRole('button', { name: /^reject$/i }),
    ).toBeInTheDocument();
    approverView.unmount();
    clearSession();
    vi.clearAllMocks();

    // Importer — the SAME Imported row carries NEITHER action (fail-closed, BR9).
    seed({ rows: [importedRow()], role: importerUserRecord });
    await renderTransactionsPage();
    const importerRow = rowFor(IMPORTED_REFERENCE);
    expect(
      within(importerRow).queryByRole('button', { name: /^approve$/i }),
    ).not.toBeInTheDocument();
    expect(
      within(importerRow).queryByRole('button', { name: /^reject$/i }),
    ).not.toBeInTheDocument();
  });

  // AC-6 / BR9 (fail-closed default): when the role source yields NOTHING (no
  // userinfo, empty /v1/users) the role is unresolved → the actions stay hidden.
  // Anchored against the Approver baseline (present) so the test proves the gate
  // fails CLOSED on an unresolved role rather than passing on a page that never
  // renders the actions at all.
  it('hides Approve/Reject when the role cannot be resolved, but shows them for a resolved Approver', async () => {
    // Resolved Approver — actions present (the anchoring positive case).
    seed({ rows: [importedRow()], role: approverUserRecord });
    const approverView = await renderTransactionsPage();
    expect(
      within(rowFor(IMPORTED_REFERENCE)).getByRole('button', {
        name: /^reject$/i,
      }),
    ).toBeInTheDocument();
    approverView.unmount();
    clearSession();
    vi.clearAllMocks();

    // Unresolved role — userinfo + /v1/users both yield nothing usable.
    mockGet.mockImplementation((path: string) => {
      if (path.includes('/v1/transactions')) {
        return Promise.resolve([importedRow()]);
      }
      return Promise.resolve([]);
    });
    await renderTransactionsPage();

    const row = rowFor(IMPORTED_REFERENCE);
    expect(
      within(row).queryByRole('button', { name: /^approve$/i }),
    ).not.toBeInTheDocument();
    expect(
      within(row).queryByRole('button', { name: /^reject$/i }),
    ).not.toBeInTheDocument();
  });
});

describe('Epic 3, Story 3 — hard mutation failure (AC-6, NFR5)', () => {
  // AC-6 / NFR5: a hard backend failure on Approve surfaces an ASSERTIVE inline
  // error (role="alert"), leaves the row's Status badge UNCHANGED (still
  // `Imported`), and does NOT fire the success toast. The inline alert is
  // distinguished from the toast by role — the toast surface is role="status"
  // (Toast.tsx), so a role="status" success notification must NOT appear.
  it('shows an inline alert and leaves the row Imported when Approve fails', async () => {
    const user = userEvent.setup();
    seed({ rows: [importedRow()] });
    mockPost.mockRejectedValue(new Error('Internal Server Error'));

    await renderTransactionsPage();

    const row = rowFor(IMPORTED_REFERENCE);
    await user.click(within(row).getByRole('button', { name: /^approve$/i }));

    // Confirm in the dialog (Approve's destructive confirm).
    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', { name: /(approve|confirm|yes)/i }),
    );

    // An assertive inline error surfaces ...
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/(fail|could not|unable|error)/i);

    // ... the row's Status stays Imported (no optimistic flip survived) ...
    const settledRow = rowFor(IMPORTED_REFERENCE);
    expect(within(settledRow).getByText(/imported/i)).toBeInTheDocument();
    expect(within(settledRow).queryByText(/approved/i)).not.toBeInTheDocument();

    // ... and NO success toast fired (toasts are role="status", not role="alert").
    expect(
      screen.queryByRole('status', { name: /(approved|success)/i }),
    ).not.toBeInTheDocument();
  });

  // AC-6 contrast / NFR5: a hard failure on Reject likewise surfaces an inline
  // alert and leaves the row Imported, with no success toast — proving the
  // failure handling is symmetric across both mutations rather than approve-only.
  it('shows an inline alert and leaves the row Imported when Reject fails', async () => {
    const user = userEvent.setup();
    seed({ rows: [importedRow()] });
    mockPost.mockRejectedValue(new Error('Internal Server Error'));

    await renderTransactionsPage();

    const dialog = await openRejectDialog(user);
    const note = within(dialog).getByRole('textbox', {
      name: /(rejection note|note|reason)/i,
    });
    await user.type(note, 'Rejecting — fails on the backend.');
    await user.click(
      within(dialog).getByRole('button', { name: /(reject|confirm|submit)/i }),
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/(fail|could not|unable|error)/i);

    const settledRow = rowFor(IMPORTED_REFERENCE);
    expect(within(settledRow).getByText(/imported/i)).toBeInTheDocument();
    expect(within(settledRow).queryByText(/rejected/i)).not.toBeInTheDocument();

    expect(
      screen.queryByRole('status', { name: /(rejected|success)/i }),
    ).not.toBeInTheDocument();
  });
});

describe('Epic 3, Story 3 — accessibility (AC-3 baseline)', () => {
  // The open Reject dialog (mandatory note, disabled submit) has no axe
  // violations. We assert the note field rendered first so this breaks on a
  // missing/placeholder dialog rather than vacuously passing on an empty DOM.
  it('has no accessibility violations with the reject dialog open', async () => {
    const user = userEvent.setup();
    seed({ rows: [importedRow()] });

    const { container } = await renderTransactionsPage();

    const dialog = await openRejectDialog(user);
    expect(
      within(dialog).getByRole('textbox', {
        name: /(rejection note|note|reason)/i,
      }),
    ).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });
});
