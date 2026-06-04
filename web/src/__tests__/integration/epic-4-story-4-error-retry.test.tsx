/**
 * Story Metadata:
 * - Epic 4, Story 4: Consistent error and retry UX across async actions
 * - Route: /files/[id]
 * - Target File: web/src/app/files/[id]/page.tsx (modify_existing)
 * - Page Action: modify_existing (hardens the Epic 2 Stories 2/4/5 file-detail surface)
 *
 * Requirements: NFR8 (re-scoped by this story as the NFR5-style error-UX
 * CONSISTENCY bar — project-brief §NFR5: "user-visible error states with retry
 * affordance for ALL async operations"). This story resolves the Epic-2 Story-5
 * [review] gap: a failed cancel-DELETE currently CLOSES the confirm dialog with
 * NO user-visible error (see page.tsx handleConfirmCancel's catch block —
 * `setCancelDialogOpen(false)` and nothing else). The fix adds a delete-failure
 * error+retry surface (role="alert" + a retry affordance) and holds every async
 * path on files/[id] to the same visible-error-with-retry pattern.
 *
 * Failing-first (TDD red) tests for the VITEST-tagged acceptance criteria — the
 * behaviour lives in the React render and is jsdom-observable (testing-policy
 * §"Test at the layer where the behaviour lives"):
 *
 *   - AC-2 (VITEST): every async surface on the hardened page presents a visible
 *     error state with a retry affordance on failure, consistent with the app's
 *     existing error pattern. Three async sinks are exercised:
 *       a. the CANCEL-DELETE failure (the Epic-2 Story-5 gap — NEW behaviour,
 *          fails red today),
 *       b. the transactions READ failure (regression guard — already wired),
 *       c. the validation-errors READ failure on a Failed file (regression
 *          guard — already wired).
 *   - AC-1 (the jsdom-observable part): a failed file cancellation shows an
 *     ASSERTIVE error (role="alert") + retry INSTEAD of closing silently, the
 *     user does NOT navigate away, and clicking retry RE-ATTEMPTS the cancel.
 *     The cross-page browser round-trip part of AC-1 is PLAYWRIGHT-tagged and
 *     covered by the sibling spec; only the in-page error/retry seam is driven
 *     here.
 *
 * The cancel-failure error+retry SEAM (assumed, to be implemented by developer):
 *   On a rejected `cancelFile` DELETE the handler must NOT navigate and must NOT
 *   silently close — instead it surfaces a user-visible `role="alert"` error with
 *   a retry affordance (a button matching /retry|try again/i). The dialog may
 *   stay open with the error inline, OR the error may render on the page with a
 *   retry — these tests assert the OBSERVABLE contract (an alert mentioning the
 *   cancellation failed + a retry control + no navigation + retry resolves the
 *   failure by navigating away), not which container holds it. The Epic-2 Story-5
 *   happy path (success → router.push('/files')) and the BR7 approved-guard
 *   banner are left intact and not re-driven here.
 *
 * How the page resolves its data (unchanged from Epic 2 — story summary +
 * project-brief §6/§9/§13):
 *   - The FileLog is resolved from the active file-logs list
 *     (`GET /api/transactions/v1/file-logs?IsActive=Yes`, singular `{ FileLog }`
 *     envelope unwrapped to a bare array, matched by Id).
 *   - `GET /api/transactions/v1/transactions` takes NO FileLogId filter, so the
 *     page fetches ALL transactions and filters CLIENT-SIDE by FileLogId.
 *   - On confirm the cancel DELETEs `/api/transactions/v1/files?LogId=<id>` via
 *     the client's `del` helper (carrying the LastChangedUser audit header).
 *
 * Mocking (testing-policy §Mocking strategy): only the HTTP client
 * (@/lib/api/client — get + del) and the Next.js navigation boundary are mocked.
 * The page, the slice filter, the dialog, the role gating and (once built) the
 * cancel-failure error/retry surface are the REAL code under test. Unlike the
 * Epic-2 Story-5 test (which stubbed useRouter with an inline vi.fn() it could
 * not later assert), navigation is mocked here through a STABLE `push` spy so we
 * can prove the failure path does NOT navigate. The page is wrapped in the real
 * RequireSession guard, so each test seeds the session marker via the real
 * session-client helper.
 *
 * Role-gating note: Cancel is Importer-only (BR10), so fetchCurrentRole is
 * resolved to an Importer by stubbing its swappable GET source (/userinfo then
 * /users), exactly as the Epic-2 Story-5 test.
 *
 * Shape source: documentation/transactions-api.yaml + project-brief §6/§9/§13.
 * No api-shape-report.md exists for this build (confirmed absent), so the shared
 * Epic 2 factories — which already encode the observed envelope/coercion drift —
 * are authoritative. The axe matcher is registered globally by vitest.setup.ts.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Production import — the current page closes the cancel dialog with NO visible
// error on a failed DELETE, so the cancel-failure assertions below fail
// meaningfully against the current page (TDD red). The read-failure regression
// guards already pass — they pin the consistency bar so it can't regress.
import FileDetailPage from '@/app/files/[id]/page';
import { get, del } from '@/lib/api/client';
import { markSessionStart, clearSession } from '@/lib/session/session-client';
import {
  createMockFileLog,
  createMockTransactionsForFile,
  createMockValidationColumns,
  createValidationErrorsResponse,
  type MockFileLog,
  type MockTransaction,
} from '../helpers/epic-2-mock-data';

// HTTP client — `get` feeds the file-logs read, the transactions read, the
// validation-errors reads AND the Importer role source behind fetchCurrentRole.
// `del` is the cancel-file sink (the failure path under test).
vi.mock('@/lib/api/client', () => ({
  get: vi.fn(),
  del: vi.fn(),
}));
const mockGet = get as ReturnType<typeof vi.fn>;
const mockDel = del as ReturnType<typeof vi.fn>;

// Navigation boundary — a STABLE push spy (shared across the module) so a test
// can assert the cancel-FAILURE path does NOT navigate away. Cleared in
// beforeEach alongside the client mocks.
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/files/5001',
  useSearchParams: () => new URLSearchParams(),
}));

/** The file id under view across these tests. */
const FILE_ID = 5001;

/** The file name the confirmation dialog surfaces (BR3-style naming). */
const FILE_NAME = 'transactions_2026-04-15.csv';

/** A healthy, cancellable (Completed) FileLog for this file id. */
function cancellableFileLog(): MockFileLog {
  return createMockFileLog({
    Id: FILE_ID,
    CurrentFileName: FILE_NAME,
    CurrentStatus: 'Completed',
    LastExecutedActivityName: 'Completed',
  });
}

/** A `Failed` FileLog so the validation-errors read (and its error path) fires. */
function failedFileLog(): MockFileLog {
  return createMockFileLog({
    Id: FILE_ID,
    CurrentFileName: FILE_NAME,
    CurrentStatus: 'Failed',
    LastExecutedActivityName: 'Failed',
    HasBulkErrorFile: 'Yes',
    BulkErrorFile: 'errors.csv',
  });
}

/**
 * A path-routed `get()` mock. Resolves an Importer role (so Cancel is shown),
 * the supplied FileLog list, the supplied transaction set, and — for a Failed
 * file — the validation columns + errors. Any data side may be an Error to
 * simulate that read failing.
 */
function wireGet({
  fileLogs,
  transactions,
  validation,
}: {
  fileLogs: MockFileLog[] | Error;
  transactions: MockTransaction[] | Error;
  validation?: 'ok' | Error;
}) {
  mockGet.mockImplementation((endpoint: string) => {
    // Importer role source consumed by fetchCurrentRole (userinfo, then /users
    // fallback) — resolve an Importer so the Cancel control shows.
    if (endpoint.includes('/userinfo')) {
      return Promise.resolve({
        RolesString: 'Importer',
        Email: 'imp@acme.test',
      });
    }
    if (endpoint.includes('/v1/users')) {
      return Promise.resolve([
        { RolesString: 'Importer', Email: 'imp@acme.test' },
      ]);
    }
    // Validation-errors endpoints (only hit for a Failed file). Checked before
    // the bare `/files` / `/transactions` branches since the path contains both.
    if (endpoint.includes('/validation-errors/columns')) {
      return validation instanceof Error
        ? Promise.reject(validation)
        : Promise.resolve(createMockValidationColumns());
    }
    if (endpoint.includes('/validation-errors')) {
      return validation instanceof Error
        ? Promise.reject(validation)
        : Promise.resolve(createValidationErrorsResponse());
    }
    if (endpoint.includes('/file-logs')) {
      return fileLogs instanceof Error
        ? Promise.reject(fileLogs)
        : Promise.resolve(fileLogs);
    }
    if (endpoint.includes('/transactions')) {
      return transactions instanceof Error
        ? Promise.reject(transactions)
        : Promise.resolve(transactions);
    }
    return Promise.reject(new Error(`Unexpected endpoint: ${endpoint}`));
  });
}

/**
 * Renders the file-detail page for `id` with an authenticated session, then
 * waits for the initial reads to settle (the page-level loading indicator gone).
 */
async function renderFileDetail(id: number = FILE_ID) {
  markSessionStart();
  const utils = render(
    <FileDetailPage params={Promise.resolve({ id: String(id) })} />,
  );
  await waitFor(() =>
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument(),
  );
  return utils;
}

/** The Importer-only Cancel control on the file-detail header. */
function cancelButton(): HTMLElement {
  return screen.getByRole('button', { name: /^cancel(?:\s+file)?$/i });
}

/** Opens the cancel confirmation dialog and returns it. */
async function openCancelDialog() {
  const user = userEvent.setup();
  await user.click(cancelButton());
  const dialog = await screen.findByRole('dialog');
  return { user, dialog };
}

/** The destructive confirm action inside the open cancel dialog. */
function confirmButtonIn(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole('button', {
    name: /(cancel file|confirm|yes|delete)/i,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  clearSession();
});

describe('Epic 4, Story 4 — cancel-failure error + retry (AC-1 / AC-2, NFR5/NFR8)', () => {
  // AC-1 / AC-2(a) — THE Epic-2 Story-5 gap. Today a rejected cancel-DELETE runs
  // `setCancelDialogOpen(false)` and nothing else: the dialog closes with NO
  // visible error. The hardened page must instead surface an ASSERTIVE
  // role="alert" error WITH a retry affordance, and must NOT navigate away. This
  // assertion fails red against the current silent-close behaviour.
  it('shows an assertive error + retry (and does NOT navigate) when the cancel DELETE fails', async () => {
    wireGet({
      fileLogs: [cancellableFileLog()],
      transactions: createMockTransactionsForFile(FILE_ID),
    });
    mockDel.mockRejectedValue(new Error('Network error'));

    await renderFileDetail();

    const { user, dialog } = await openCancelDialog();
    await user.click(confirmButtonIn(dialog));

    // The confirm is genuinely wired (not inert): the rejected DELETE surfaces
    // an ASSERTIVE error mentioning the cancel — this alert only renders because
    // the DELETE was attempted and rejected.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/cancel|couldn.?t|failed|try again/i);

    // ... with a retry affordance the user can act on (the consistency bar) ...
    expect(
      screen.getByRole('button', { name: /retry|try again/i }),
    ).toBeInTheDocument();

    // ... and the user is NOT navigated away — they stay on the file detail so
    // they can retry (the silent-close-then-stay bug must not become a
    // silent-navigate bug either).
    expect(mockPush).not.toHaveBeenCalled();
  });

  // AC-1 / AC-2(a) — the retry affordance is WIRED: clicking it RE-ATTEMPTS the
  // cancel DELETE, proving the retry control is functional and not decorative.
  // The second attempt succeeds, so the page then completes the cancellation and
  // navigates to /files — the navigation is the user-observable proof that the
  // retry re-fired the DELETE and resolved the failure (had retry not re-fired,
  // the failure alert would persist and no navigation would occur).
  it('re-attempts the cancel DELETE when the retry affordance is clicked', async () => {
    wireGet({
      fileLogs: [cancellableFileLog()],
      transactions: createMockTransactionsForFile(FILE_ID),
    });
    // First DELETE rejects, the retried DELETE succeeds (204 No Content).
    mockDel
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(undefined);

    await renderFileDetail();

    const { user, dialog } = await openCancelDialog();
    await user.click(confirmButtonIn(dialog));

    // The first attempt failed → the retry affordance is the user's next action.
    const retry = await screen.findByRole('button', {
      name: /retry|try again/i,
    });

    await user.click(retry);

    // On the successful retry the cancellation completes and navigates to the
    // active file-logs list. This navigation is observable proof the retry
    // re-fired the DELETE: a decorative/no-op retry would leave the failure
    // alert up and never navigate.
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/files'));

    // ... and once resolved the failure alert is gone (the error surface is
    // driven by the live DELETE outcome, not stuck on after a successful retry).
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // AC-2 contrast — a SUCCESSFUL cancel must NOT surface the failure alert and
  // MUST navigate. Pinning the happy path proves the error surface is driven by
  // the actual DELETE outcome rather than always-on (anti-pattern §4 — assert
  // the contrast); it also guards the Epic-2 Story-5 success behaviour.
  it('navigates and shows no failure error when the cancel succeeds', async () => {
    wireGet({
      fileLogs: [cancellableFileLog()],
      transactions: createMockTransactionsForFile(FILE_ID),
    });
    mockDel.mockResolvedValue(undefined);

    await renderFileDetail();

    const { user, dialog } = await openCancelDialog();
    await user.click(confirmButtonIn(dialog));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/files'));

    // No failure error / retry affordance was surfaced on the happy path.
    expect(
      screen.queryByRole('button', { name: /retry|try again/i }),
    ).not.toBeInTheDocument();
  });
});

describe('Epic 4, Story 4 — async-read error/retry consistency (AC-2, NFR5/NFR8)', () => {
  // AC-2(b) regression guard — the transactions READ failure already shows a
  // role="alert" + a retry affordance (Epic 2 Story 2). We re-assert the
  // CONSISTENT pattern here (without duplicating Epic 2's exact assertions) so
  // the consistency bar can't silently regress while the cancel path is added.
  it('surfaces an alert with a retry affordance when the transactions read fails', async () => {
    wireGet({
      fileLogs: [cancellableFileLog()],
      transactions: new Error('Network error'),
    });

    await renderFileDetail();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/transaction/i);
    expect(
      within(alert).getByRole('button', { name: /retry|try again/i }),
    ).toBeInTheDocument();
  });

  // AC-2(c) regression guard — on a Failed file the validation-errors READ
  // failure already shows a role="alert" + retry (Epic 2 Story 4). Same
  // consistency bar, asserted via the shared pattern rather than Epic 4's own
  // copy. The transactions read is kept healthy so the ONLY alert is the
  // validation-errors one.
  it('surfaces an alert with a retry affordance when the validation-errors read fails on a Failed file', async () => {
    wireGet({
      fileLogs: [failedFileLog()],
      transactions: createMockTransactionsForFile(FILE_ID),
      validation: new Error('Network error'),
    });

    await renderFileDetail();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/validation error/i);
    expect(
      within(alert).getByRole('button', { name: /retry|try again/i }),
    ).toBeInTheDocument();
  });

  // AC-2 accessibility — the cancel-failure error surface (the NEW state) has no
  // axe violations. We assert the failure alert rendered FIRST so this breaks on
  // a missing/placeholder surface rather than vacuously passing on an empty DOM
  // (anti-pattern §4 — assert the contrast).
  it('has no accessibility violations while the cancel-failure error is shown', async () => {
    wireGet({
      fileLogs: [cancellableFileLog()],
      transactions: createMockTransactionsForFile(FILE_ID),
    });
    mockDel.mockRejectedValue(new Error('Network error'));

    const { container } = await renderFileDetail();

    const { user, dialog } = await openCancelDialog();
    await user.click(confirmButtonIn(dialog));

    await screen.findByRole('alert');
    expect(
      screen.getByRole('button', { name: /retry|try again/i }),
    ).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });
});
