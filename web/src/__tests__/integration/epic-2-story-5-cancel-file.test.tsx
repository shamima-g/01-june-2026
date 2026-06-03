/**
 * Story Metadata:
 * - Epic 2, Story 5: Cancel a file with the approved-transaction guard
 * - Route: /files/[id]
 * - Target File: web/src/app/files/[id]/page.tsx (modify_existing)
 * - Page Action: modify_existing (extends the Story 2 / Story 4 file-detail surface)
 *
 * Requirements: R12 (an Importer may cancel a File Log via a destructive-action
 * confirmation modal; on confirmation the File Log is deactivated and its
 * Transactions are removed from the Approver's working surface; cancellation is
 * blocked when any Transaction in the file is `Approved`). BR7 (when a File Log
 * has at least one `Approved` Transaction the Cancel-File action must be blocked
 * with an explanatory banner). BR3-style destructive-confirm convention
 * (project-brief §9 Cancel File step 3): the modal names the file, the primary
 * action is destructive-styled, and default focus is on the Cancel/dismiss
 * button. BR10 (the Approver cannot access Cancel File — that persona difference
 * is the PLAYWRIGHT-tagged AC-1, not re-driven here).
 *
 * Failing-first (TDD red) tests for the VITEST-tagged acceptance criteria — each
 * behaviour lives in the React render and is jsdom-observable (testing-policy
 * §"Test at the layer where the behaviour lives"):
 *   - AC-2: triggering Cancel (on a file with NO Approved transactions) opens a
 *           confirmation dialog that NAMES the file, styles the confirm action as
 *           destructive, and defaults focus to the Cancel (dismiss) button;
 *           confirming fires the DELETE.
 *   - AC-4: when the file has at least one Approved transaction, the Cancel action
 *           is BLOCKED with an explanatory banner instead of proceeding — and NO
 *           delete call is made.
 *
 * AC-1 (Importer sees Cancel / Approver does NOT — the persona difference) and
 * AC-3 (confirming deactivates the file so it leaves the active File Logs list —
 * the cross-page browser round-trip) are PLAYWRIGHT-tagged and covered by the
 * sibling spec; they are not re-driven here.
 *
 * How the page resolves its data (story summary + project-brief §9 Cancel File /
 * §6 envelopes / §13-C):
 *   - The FileLog is resolved from the active file-logs list exactly as Story 2
 *     (`GET /api/transactions/v1/file-logs?IsActive=Yes`, singular
 *     `{ FileLog: [...] }` envelope the client unwraps to a bare array, matched by
 *     Id).
 *   - `GET /api/transactions/v1/transactions` takes NO FileLogId filter, so the
 *     page fetches ALL transactions and filters CLIENT-SIDE by FileLogId. The BR7
 *     guard reads the resolved slice's `Status` — if ANY is `Approved`, Cancel is
 *     blocked. There is NO server-side guard in the spec, so the guard is derived
 *     entirely from this already-loaded slice.
 *   - On confirm the cancel DELETEs `DELETE /api/transactions/v1/files?LogId=<id>`
 *     with the `LastChangedUser` header (the client's `del` helper carries the
 *     audit header — web/src/lib/api/client.ts).
 *
 * Mocking (testing-policy §Mocking strategy): only the HTTP client
 * (@/lib/api/client) and the Next.js navigation boundary are mocked. The page,
 * `deriveFileStatus`, the shared StatusBadge, the client-side slice filter, the
 * confirmation dialog (composed from the Shadcn Dialog primitive), the BR7 guard
 * derivation and the role gating are the REAL code under test. The page is
 * wrapped in the existing RequireSession guard (reads the session marker via
 * useSyncExternalStore), so each test seeds the marker through the real
 * session-client helper rather than mocking the guard.
 *
 * Role-gating note: the persona DIFFERENCE for the Cancel control (Importer sees
 * it / Approver does not) is the PLAYWRIGHT-tagged AC-1. To exercise the
 * vitest-tagged cancel behaviour we resolve the role as an Importer (the persona
 * that SEES the control) via the real `fetchCurrentRole`, which reads the role
 * from the swappable source — so we stub that source's GET (`/userinfo` then
 * `/users`) to return an Importer record.
 *
 * Shape source: documentation/transactions-api.yaml (FileLog/FileLogList,
 * TransactionRead/TransactionReadList) + project-brief §6/§9/§13. No
 * api-shape-report.md exists for this build. The unwrapped arrays the mocked
 * get() resolves model exactly what the page sees after the client strips the
 * single-key envelope.
 *
 * The axe matcher is registered globally by web/vitest.setup.ts, so only `axe`
 * is imported here.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Production import — the Story 2 / Story 4 page renders NO Cancel control, NO
// confirmation dialog, and NO approved-transaction guard banner, so every
// assertion below fails meaningfully against the current page (TDD red).
import FileDetailPage from '@/app/files/[id]/page';
import { get, del } from '@/lib/api/client';
import { markSessionStart, clearSession } from '@/lib/session/session-client';
import {
  createMockFileLog,
  createMockTransaction,
  createMockTransactionsForFile,
  type MockFileLog,
  type MockTransaction,
} from '../helpers/epic-2-mock-data';

// HTTP client — mocked per testing-policy. `get` feeds the file-logs read, the
// transactions read AND the Importer role source behind fetchCurrentRole. `del`
// is the cancel-file sink (DELETE /v1/files?LogId= with a LastChangedUser
// header).
vi.mock('@/lib/api/client', () => ({
  get: vi.fn(),
  del: vi.fn(),
}));
const mockGet = get as ReturnType<typeof vi.fn>;
const mockDel = del as ReturnType<typeof vi.fn>;

// Navigation boundary — RequireSession touches the router; the detail page may
// also read params/pathname. We don't assert navigation here, so stub the
// surface so the protected content renders.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/files/5001',
  useSearchParams: () => new URLSearchParams(),
}));

/** The file id under view across these tests. */
const FILE_ID = 5001;

/** The file name the confirmation dialog must surface (BR3-style naming). */
const FILE_NAME = 'transactions_2026-04-15.csv';

/** A healthy, cancellable FileLog for this file id. */
function cancellableFileLog(): MockFileLog {
  return createMockFileLog({
    Id: FILE_ID,
    CurrentFileName: FILE_NAME,
    CurrentStatus: 'Completed',
    LastExecutedActivityName: 'Completed',
  });
}

/**
 * A path-routed `get()` mock. Resolves an Importer role (so the Cancel control
 * is shown), the supplied FileLog list, and the supplied transaction slice. Any
 * side may be an Error to simulate that read failing — though these tests keep
 * the reads healthy and exercise the cancel/guard behaviour.
 *
 * NOTE: the `/file-logs` branch must be tested before `/files` would be (the
 * cancel DELETE goes through `del`, not `get`, so `get` never sees `/files`).
 */
function wireGet({
  fileLogs,
  transactions,
}: {
  fileLogs: MockFileLog[] | Error;
  transactions: MockTransaction[] | Error;
}) {
  mockGet.mockImplementation((endpoint: string) => {
    // Importer role source consumed by fetchCurrentRole (userinfo best-effort,
    // then /users fallback) — resolve an Importer so the Cancel control shows.
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
 * Renders the file-detail page for `id` with an authenticated client-side
 * session so RequireSession yields its protected content, then waits for the
 * initial reads to settle (loading indicator gone).
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

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  clearSession();
});

describe('Epic 2, Story 5 — Cancel confirmation dialog (AC-2, R12, BR3)', () => {
  // AC-2: triggering Cancel on a file with NO Approved transactions opens a
  // confirmation dialog that NAMES the file. We assert a dialog role appears and
  // that it surfaces the file name, so the modal is the thing under test rather
  // than any incidental header text.
  it('opens a confirmation dialog naming the file when Cancel is triggered', async () => {
    const user = userEvent.setup();
    wireGet({
      fileLogs: [cancellableFileLog()],
      // Imported slice — no Approved transaction, so cancellation is allowed.
      transactions: createMockTransactionsForFile(FILE_ID),
    });

    await renderFileDetail();

    await user.click(cancelButton());

    const dialog = await screen.findByRole('dialog');
    // The dialog NAMES the file being cancelled (BR3-style confirmation).
    expect(
      within(dialog).getByText(new RegExp(FILE_NAME, 'i')),
    ).toBeInTheDocument();
  });

  // AC-2: inside the open dialog the primary confirm action is styled as
  // DESTRUCTIVE and default focus rests on the Cancel/dismiss button (BR3
  // convention). The Shadcn destructive button variant applies a class derived
  // from the `--destructive` token, so we assert the confirm control carries a
  // destructive variant class AND that focus is on the dismiss button — proving
  // the safe default rather than a one-keystroke-from-deletion modal.
  it('styles the confirm action destructive and defaults focus to the dismiss button', async () => {
    const user = userEvent.setup();
    wireGet({
      fileLogs: [cancellableFileLog()],
      transactions: createMockTransactionsForFile(FILE_ID),
    });

    await renderFileDetail();

    await user.click(cancelButton());

    const dialog = await screen.findByRole('dialog');

    // The confirm (proceed-with-cancellation) action is destructive-styled.
    const confirm = within(dialog).getByRole('button', {
      name: /(cancel file|confirm|yes|delete)/i,
    });
    expect(confirm.className).toMatch(/destructive/);

    // Default focus is on the dismiss (Keep / Cancel / Dismiss) button — NOT the
    // destructive confirm — so an accidental Enter does not delete the file.
    const dismiss = within(dialog).getByRole('button', {
      name: /(keep|dismiss|go back|cancel)/i,
    });
    await waitFor(() => expect(dismiss).toHaveFocus());
    expect(confirm).not.toHaveFocus();
  });

  // AC-2: confirming the cancel fires the DELETE against
  // `/v1/files?LogId=<id>` — proving the confirm action is wired through the
  // client's `del` helper (which carries the LastChangedUser audit header),
  // rather than being a decorative dialog.
  it('fires the DELETE for this file when the cancel is confirmed', async () => {
    const user = userEvent.setup();
    wireGet({
      fileLogs: [cancellableFileLog()],
      transactions: createMockTransactionsForFile(FILE_ID),
    });
    mockDel.mockResolvedValue(undefined); // 204 No Content

    await renderFileDetail();

    await user.click(cancelButton());

    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', {
      name: /(cancel file|confirm|yes|delete)/i,
    });
    await user.click(confirm);

    await waitFor(() => {
      expect(mockDel).toHaveBeenCalled();
      const [endpoint] = mockDel.mock.calls[0];
      expect(String(endpoint)).toContain('/files');
      expect(String(endpoint)).toContain(String(FILE_ID));
    });
  });
});

describe('Epic 2, Story 5 — approved-transaction guard (AC-4, R12, BR7)', () => {
  // AC-4 / BR7: when the file's transaction slice contains at least one Approved
  // transaction, triggering Cancel must be BLOCKED with an explanatory banner
  // instead of proceeding — and NO delete call is made. We seed a mixed slice
  // (one Imported + one Approved) so the guard is derived from the real status,
  // not a hard-coded gate.
  it('blocks Cancel with an explanatory banner when any transaction is Approved', async () => {
    const user = userEvent.setup();
    const mixedSlice: MockTransaction[] = [
      createMockTransaction({
        Id: 9101,
        FileLogId: FILE_ID,
        Reference: 'TXN-IMPORTED',
        Status: 'Imported',
      }),
      createMockTransaction({
        Id: 9102,
        FileLogId: FILE_ID,
        Reference: 'TXN-APPROVED',
        Status: 'Approved',
      }),
    ];
    wireGet({ fileLogs: [cancellableFileLog()], transactions: mixedSlice });
    mockDel.mockResolvedValue(undefined);

    await renderFileDetail();

    // The slice rendered (page settled into its loaded state) ...
    expect(await screen.findByText('TXN-APPROVED')).toBeInTheDocument();

    // ... triggering Cancel surfaces an explanatory blocked banner ...
    await user.click(cancelButton());

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/approv/i);

    // ... no confirmation dialog is opened (the action was blocked outright) ...
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // ... and crucially NO delete fires, even after the interaction settles.
    expect(mockDel).not.toHaveBeenCalled();
  });

  // AC-4 (contrast / BR7 negative): a slice with NO Approved transaction is NOT
  // blocked — triggering Cancel opens the confirmation dialog and shows no
  // blocked banner. Pinning this contrast proves the guard reads the actual
  // statuses rather than always blocking or always allowing (anti-pattern §4 —
  // assert the contrast).
  it('does NOT block Cancel when the file has no Approved transaction', async () => {
    const user = userEvent.setup();
    const noApproved: MockTransaction[] = [
      createMockTransaction({
        Id: 9201,
        FileLogId: FILE_ID,
        Reference: 'TXN-IMPORTED',
        Status: 'Imported',
      }),
      createMockTransaction({
        Id: 9202,
        FileLogId: FILE_ID,
        Reference: 'TXN-REJECTED',
        Status: 'Rejected',
      }),
    ];
    wireGet({ fileLogs: [cancellableFileLog()], transactions: noApproved });

    await renderFileDetail();

    expect(await screen.findByText('TXN-REJECTED')).toBeInTheDocument();

    await user.click(cancelButton());

    // The confirmation dialog opens (cancellation is allowed) ...
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    // ... and no approved-transaction blocked banner is shown.
    expect(
      screen.queryByText(/blocked|at least one approv/i),
    ).not.toBeInTheDocument();
  });
});

describe('Epic 2, Story 5 — accessibility (AC-2 baseline)', () => {
  // The open cancel-confirmation dialog (naming the file, destructive confirm,
  // safe-focused dismiss) has no axe violations. We assert the dialog rendered
  // first so this breaks on a placeholder/missing modal rather than vacuously
  // passing on an empty DOM (anti-pattern §4 — assert the contrast).
  it('has no accessibility violations with the cancel dialog open', async () => {
    const user = userEvent.setup();
    wireGet({
      fileLogs: [cancellableFileLog()],
      transactions: createMockTransactionsForFile(FILE_ID),
    });

    const { container } = await renderFileDetail();

    await user.click(cancelButton());

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(new RegExp(FILE_NAME, 'i')),
    ).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });
});
