/**
 * Story Metadata:
 * - Epic 3, Story 4: Export the current filtered transactions as CSV
 * - Route: /transactions
 * - Target File: web/src/app/transactions/page.tsx (modify_existing)
 * - Page Action: modify_existing (EXTENDS the Epic-3 Story-1/2/3 transactions
 *   surface at this path with an Approver-only Export control in the toolbar —
 *   CLAUDE.md §7: extend the existing surface, don't nest a second table)
 *
 * Requirements: R9 (an Approver may export the currently-filtered set of
 * Transactions as a CSV; the export reflects the active filter EXACTLY; Export is
 * disabled when zero rows match the current filter), BR6 (the exported row-set
 * must EQUAL the currently-applied filter set — the page already exposes the
 * Story-2 `filteredTransactions` memo as the single source Export reads from),
 * BR9 (an Importer cannot access the Export action — it must be ABSENT from the UI
 * for a non-Approver persona, not a disabled control — fail-closed).
 *
 * Failing-first (TDD red) tests for the VITEST-tagged acceptance criteria. The
 * Story-1/2/3 page renders NO Export control and NO CSV-generation seam, so every
 * assertion below fails meaningfully against the current page.
 *   - AC-2 (VITEST): the exported CSV reflects active-filter changes — narrowing
 *           the filter narrows the exported rows correspondingly. With NO filter
 *           every row's Reference appears in the CSV; after applying a Status
 *           filter (Status=Imported) the CSV contains EXACTLY the filtered rows
 *           (the Imported row's Reference present) and EXCLUDES the others (the
 *           Approved + Rejected rows' References absent). The header row carries
 *           the table columns. Each assertion pins the CONTRAST (included vs.
 *           excluded References) so it cannot pass vacuously on an export that
 *           always dumps the full set.
 *   - AC-4 (VITEST): the Export control is NOT rendered for an Importer or an
 *           unknown/unresolved role (fail-closed — BR9). Anchored to the
 *           Approver-POSITIVE baseline (an Approver DOES see Export) in the same
 *           test so the negative cannot pass vacuously on a page that simply never
 *           renders Export at all.
 *
 * AC-1 (clicking Export downloads a CSV whose rows equal the currently-filtered
 * set) and AC-3 (when zero rows match, Export is disabled with a tooltip) are
 * PLAYWRIGHT-tagged and covered by the sibling spec — they are not re-driven here.
 *
 * ── CSV-download observable seam (documented for the developer) ───────────────
 * The actual file download cannot be asserted in jsdom, so this suite tests CSV
 * GENERATION at the cleanest observable seam: clicking Export builds a Blob,
 * passes it to `URL.createObjectURL`, and clicks a transient anchor carrying a
 * `download` filename. We MOCK `URL.createObjectURL` to capture the Blob the page
 * generates, then read its text (`blob.text()`) and assert the CSV CONTENT. The
 * developer must therefore route the export through `URL.createObjectURL(blob)`
 * with a `text/csv` Blob (and a `download`-attributed anchor) so this seam holds.
 * `URL.revokeObjectURL` is stubbed to a no-op so the cleanup call doesn't throw.
 *
 * Mocking (testing-policy §Mocking strategy): only the HTTP client
 * (@/lib/api/client), the Next.js navigation boundary, and the
 * URL.createObjectURL/revokeObjectURL download seam are mocked. The page, the
 * Story-2 `filteredTransactions` memo, the CSV-generation logic, and the role
 * gating (fetchCurrentRole + asKnownRole) are the REAL code under test. The page
 * is wrapped in the existing RequireSession guard (reads the client-side session
 * marker via useSyncExternalStore), so each test seeds the marker through the
 * real session-client helper rather than mocking the guard. An Approver role is
 * resolved through the real fetchCurrentRole (which calls the mocked client) so
 * the surface matches the Story-1/2/3 wiring; AC-4 swaps in an Importer / empty
 * role source to prove the fail-closed absence.
 *
 * Shape source: documentation/transactions-api.yaml (TransactionRead /
 * TransactionReadList) + project-brief §9 (Export Transactions — client-side CSV
 * of the active filtered dataset, R9 / BR6) / §13.B. No api-shape-report.md exists
 * for this build, so the spec + the shared MockTransaction shape are authoritative.
 * The Transaction collection arrives under the SINGULAR `Transactions` envelope
 * key, which the API client unwraps to a bare array before the page sees it — so
 * the mocked get() resolves the UNWRAPPED MockTransaction[]. The filterable
 * fixture (createMockFilterableTransactions) spans Imported / Approved / Rejected
 * with distinct References so the Status filter cleanly includes one and excludes
 * the other two — exactly the contrast Export must honour (BR6).
 *
 * The axe matcher is registered globally by web/vitest.setup.ts.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Production import — the Story-1/2/3 page renders NO Export control and NO CSV
// generation seam, so every assertion below fails meaningfully (TDD red).
import TransactionsPage from '@/app/transactions/page';
import { get } from '@/lib/api/client';
import { markSessionStart, clearSession } from '@/lib/session/session-client';
import {
  createMockFilterableTransactions,
  type MockTransaction,
} from '../helpers/epic-2-mock-data';

// HTTP client — mocked per testing-policy (client.ts is never exercised here).
// `get` feeds the transactions list AND the role source behind fetchCurrentRole.
vi.mock('@/lib/api/client', () => ({
  get: vi.fn(),
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

/** An Approver user record as the role source (`/userinfo` / `/v1/users`) emits it. */
const approverUserRecord = {
  Email: 'approver@example.com',
  RolesString: 'Approver',
  Roles: [{ Name: 'Approver' }],
};

/** An Importer user record — the persona that must see NO Export control (BR9). */
const importerUserRecord = {
  Email: 'importer@example.com',
  RolesString: 'Importer',
  Roles: [{ Name: 'Importer' }],
};

/**
 * Drives get() so the transactions list resolves to `rows` while the role source
 * resolves the supplied persona record (Approver by default). Mirrors the
 * Story-1/2/3 path-based mock so fetchCurrentRole resolves consistently.
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
 * The CSV-download capture seam. `URL.createObjectURL` is the one observable
 * boundary the export crosses in jsdom — the page hands it the generated Blob.
 * We capture that Blob so a test can read its text and assert the CSV content,
 * and stub `revokeObjectURL` to a no-op so the page's cleanup call is harmless.
 * Returns a getter for the most-recently-captured Blob.
 */
function installDownloadCapture() {
  let captured: Blob | null = null;
  const createObjectURL = vi.fn((blob: Blob) => {
    captured = blob;
    return 'blob:mock-csv-url';
  });
  const revokeObjectURL = vi.fn();
  // jsdom does not implement these on URL; define them for the page to call.
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: revokeObjectURL,
  });
  return {
    createObjectURL,
    /** Reads the captured Blob's text — the generated CSV body. */
    async capturedCsv(): Promise<string> {
      if (!captured) {
        throw new Error(
          'Export did not generate a Blob via URL.createObjectURL',
        );
      }
      return captured.text();
    },
  };
}

/**
 * Renders the Transactions page with an authenticated client-side session so the
 * RequireSession guard yields its protected content, then waits for the initial
 * reads to settle (loading gone, table shown) AND — when an Approver is seeded —
 * for the resolved-role-dependent toolbar (the Export control) to appear.
 */
async function renderTransactionsPage() {
  markSessionStart();
  const utils = render(<TransactionsPage />);
  await waitFor(() =>
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument(),
  );
  await screen.findByRole('table');
  return utils;
}

/** Locates the Export control once the resolved Approver role has rendered it. */
async function findExportControl(): Promise<HTMLElement> {
  return screen.findByRole('button', { name: /export/i });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  clearSession();
});

describe('Epic 3, Story 4 — exported CSV reflects the active filter (AC-2, R9, BR6)', () => {
  // AC-2 / BR6: with NO filter applied, every loaded row's Reference appears in
  // the generated CSV — the export covers the full (unfiltered) set, and the
  // header row carries the table columns. This is the un-narrowed baseline the
  // next test contrasts against.
  it('exports every row when no filter is applied, with a header row of columns', async () => {
    const user = userEvent.setup();
    const download = installDownloadCapture();
    seed({ rows: createMockFilterableTransactions() });
    await renderTransactionsPage();

    // Sanity: all three rows are on screen before we export.
    expect(screen.getByText('TXN-JAN-SMALL')).toBeInTheDocument();
    expect(screen.getByText('TXN-MAR-MID')).toBeInTheDocument();
    expect(screen.getByText('TXN-JUN-LARGE')).toBeInTheDocument();

    await user.click(await findExportControl());

    await waitFor(() => expect(download.createObjectURL).toHaveBeenCalled());
    const csv = await download.capturedCsv();

    // The header row names the table columns (Reference + the money/status cols).
    expect(csv).toMatch(/Reference/);
    expect(csv).toMatch(/Amount/);
    expect(csv).toMatch(/Status/);

    // Every loaded row's Reference is present — the unfiltered export is complete.
    expect(csv).toContain('TXN-JAN-SMALL');
    expect(csv).toContain('TXN-MAR-MID');
    expect(csv).toContain('TXN-JUN-LARGE');
  });

  // AC-2 / BR6: after NARROWING the filter (Status=Imported), the generated CSV
  // contains EXACTLY the filtered rows — the Imported row's Reference is present
  // and the Approved + Rejected rows' References are ABSENT. The contrast against
  // the unfiltered export above proves the CSV tracks the active filter set
  // rather than always dumping the full list (BR6: export === filtered set).
  it('narrows the exported rows to match the active filter (Status=Imported)', async () => {
    const user = userEvent.setup();
    const download = installDownloadCapture();
    // The filterable fixture: TXN-JAN-SMALL is Imported, TXN-MAR-MID is Approved,
    // TXN-JUN-LARGE is Rejected — so a Status=Imported filter keeps exactly one.
    seed({ rows: createMockFilterableTransactions() });
    await renderTransactionsPage();

    // Apply the Status filter to Imported (the Story-2 client-side filter).
    const statusFilter = screen.getByRole('combobox', { name: /status/i });
    await user.selectOptions(statusFilter, [
      within(statusFilter).getByRole('option', { name: /^imported$/i }),
    ]);

    // The table now shows only the Imported row before we export.
    await waitFor(() =>
      expect(screen.queryByText('TXN-MAR-MID')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('TXN-JAN-SMALL')).toBeInTheDocument();

    await user.click(await findExportControl());

    await waitFor(() => expect(download.createObjectURL).toHaveBeenCalled());
    const csv = await download.capturedCsv();

    // The in-filter row is exported ...
    expect(csv).toContain('TXN-JAN-SMALL');
    // ... and the out-of-filter rows are EXCLUDED (the BR6 contrast).
    expect(csv).not.toContain('TXN-MAR-MID');
    expect(csv).not.toContain('TXN-JUN-LARGE');
  });
});

describe('Epic 3, Story 4 — fail-closed Export gating (AC-4, BR9)', () => {
  // AC-4 / BR9: the Export control is role-gated to the Approver. This test pins
  // the CONTRAST so it cannot pass vacuously on a page that simply never renders
  // Export (e.g. the current Story-1/2/3 surface): an APPROVER sees an Export
  // control, while an IMPORTER on the SAME loaded data sees NONE (absent, not
  // disabled — fail-closed). Both halves render in one test so the positive
  // baseline (which fails during red) anchors the negative.
  it('shows Export for an Approver but NOT for an Importer on the same dataset', async () => {
    // Approver — the Export control is present in the toolbar.
    seed({
      rows: createMockFilterableTransactions(),
      role: approverUserRecord,
    });
    const approverView = await renderTransactionsPage();
    expect(await findExportControl()).toBeInTheDocument();
    approverView.unmount();
    clearSession();
    vi.clearAllMocks();

    // Importer — the SAME dataset carries NO Export control (fail-closed, BR9).
    seed({
      rows: createMockFilterableTransactions(),
      role: importerUserRecord,
    });
    await renderTransactionsPage();
    // The table renders (the read-only surface is shared), but Export is absent.
    expect(screen.getByText('TXN-JAN-SMALL')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /export/i }),
    ).not.toBeInTheDocument();
  });

  // AC-4 / BR9 (fail-closed default): when the role source yields NOTHING (no
  // userinfo, empty /v1/users) the role is unresolved → Export stays hidden.
  // Anchored against the Approver baseline (present) so the test proves the gate
  // fails CLOSED on an unresolved role rather than passing on a page that never
  // renders Export at all.
  it('hides Export when the role cannot be resolved, but shows it for a resolved Approver', async () => {
    // Resolved Approver — Export present (the anchoring positive case).
    seed({
      rows: createMockFilterableTransactions(),
      role: approverUserRecord,
    });
    const approverView = await renderTransactionsPage();
    expect(await findExportControl()).toBeInTheDocument();
    approverView.unmount();
    clearSession();
    vi.clearAllMocks();

    // Unresolved role — userinfo + /v1/users both yield nothing usable.
    mockGet.mockImplementation((path: string) => {
      if (path.includes('/v1/transactions')) {
        return Promise.resolve(createMockFilterableTransactions());
      }
      return Promise.resolve([]);
    });
    await renderTransactionsPage();

    expect(screen.getByText('TXN-JAN-SMALL')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /export/i }),
    ).not.toBeInTheDocument();
  });
});

describe('Epic 3, Story 4 — accessibility (AC-2 baseline)', () => {
  // The transactions surface WITH the Approver's Export control rendered has no
  // axe violations. We assert the Export control rendered first so this breaks on
  // a missing/placeholder control rather than vacuously passing on a page without
  // it.
  it('has no accessibility violations with the Export control present', async () => {
    seed({
      rows: createMockFilterableTransactions(),
      role: approverUserRecord,
    });
    const { container } = await renderTransactionsPage();

    expect(await findExportControl()).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });
});
