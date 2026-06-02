/**
 * Story Metadata:
 * - Epic 2, Story 1: File Logs dashboard with status, sorting, and pagination
 * - Route: /files
 * - Target File: web/src/app/files/page.tsx (modify_existing)
 * - Page Action: modify_existing
 *
 * Requirements: R3 (File Logs table — File Name, Process Date, Record Count,
 * File Status; row click-through), R6 (File Logs filtering surface), R14 (sortable
 * + paginated 5/10/20/50 default 20, controls always rendered, disabled when the
 * dataset is smaller than the page size), BR12 (Importer-only Upload CTA on the
 * zero-data empty state).
 *
 * Failing-first (TDD red) tests for the VITEST-tagged acceptance criteria — the
 * behaviour lives in the React render and is jsdom-observable (testing-policy
 * §"Test at the layer where the behaviour lives"):
 *   - AC-2: each row renders a File Status badge pairing colour + icon + text,
 *           with File Status DERIVED from LastExecutedActivityName / CurrentStatus.
 *   - AC-3: single-column sort (ascending then descending) and page-size control
 *           (5/10/20/50, default 20); pagination controls are ALWAYS rendered and
 *           disabled when the dataset is smaller than the current page size.
 *   - AC-6: a failed file-logs fetch shows a user-visible error state with a retry
 *           affordance — not a blank or broken page.
 *
 * AC-1 (live table populated from the active file logs across the browser round-
 * trip), AC-4 (row click navigates to the file detail) and AC-5 (zero-data empty
 * state + Importer-only Upload CTA, which depends on the signed-in role resolved
 * against the live backend) are PLAYWRIGHT-tagged and covered by the sibling spec
 * — they are not re-driven here.
 *
 * Mocking (testing-policy §Mocking strategy): only the HTTP client
 * (@/lib/api/client) and the Next.js navigation boundary are mocked. The page,
 * the shared StatusBadge, and the table/sort/pagination logic are the REAL code
 * under test. The page is wrapped in the existing RequireSession guard, which
 * reads the client-side session marker via useSyncExternalStore — so each test
 * seeds the marker through the real session-client helper to render the protected
 * surface (rather than mocking the guard, which would skip a real boundary).
 *
 * Shape source: documentation/transactions-api.yaml (FileLog/FileLogList) +
 * project-brief §6/§13. No api-shape-report.md exists for this build. RecordCount
 * is a STRING per the spec; the File Log collection arrives under the SINGULAR
 * `FileLog` envelope key, which the API client unwraps to a bare array before the
 * page sees it — so the mocked get() resolves the UNWRAPPED MockFileLog[].
 *
 * The axe matcher is registered globally by web/vitest.setup.ts, so only `axe`
 * is imported here.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Production import — WILL FAIL until the live File Logs page is implemented (TDD red).
import FilesPage from '@/app/files/page';
import { get } from '@/lib/api/client';
import { markSessionStart, clearSession } from '@/lib/session/session-client';
import {
  createMockFileLog,
  createMockFileLogList,
  createMockFileLogPage,
  type MockFileLog,
} from '../helpers/epic-2-mock-data';

// HTTP client — mocked per testing-policy (client.ts is never exercised here).
vi.mock('@/lib/api/client', () => ({
  get: vi.fn(),
}));
const mockGet = get as ReturnType<typeof vi.fn>;

// Navigation boundary — RequireSession + the row click-through both touch the
// router; we assert client-side navigation targets where relevant.
const pushMock = vi.fn();
const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, refresh: vi.fn() }),
  usePathname: () => '/files',
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * Renders the File Logs page with an authenticated client-side session so the
 * RequireSession guard yields its protected content, and waits for the initial
 * file-logs fetch to settle (loading indicator gone).
 */
async function renderFilesPage() {
  markSessionStart();
  const utils = render(<FilesPage />);
  await waitFor(() =>
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument(),
  );
  return utils;
}

/** Returns the table body data rows (excludes the header row). */
function getDataRows(): HTMLElement[] {
  return screen
    .getAllByRole('row')
    .filter((row) => within(row).queryAllByRole('columnheader').length === 0);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  clearSession();
});

describe('Epic 2, Story 1 — File Logs dashboard: status badges (AC-2)', () => {
  // AC-2: File Status is DERIVED from LastExecutedActivityName / CurrentStatus and
  // each row renders the shared StatusBadge pairing colour (token-backed
  // data-status) with an icon AND a visible text label. We assert per-row, scoped
  // with within(), so the assertion is row-accurate rather than matching any
  // status text anywhere on the page.
  it('renders a status badge per row with text + icon, derived from the activity name', async () => {
    mockGet.mockResolvedValue(createMockFileLogList());
    await renderFilesPage();

    // The Failed row — locate the row by its unique file name, then assert the
    // derived File Status badge inside it.
    const failedRow = (await screen.findByText('alpha_2026-04-12.csv')).closest(
      'tr',
    )!;
    const failedBadge = within(failedRow)
      .getByText('Failed')
      .closest('[data-status]');
    expect(failedBadge).not.toBeNull();
    expect(failedBadge).toHaveAttribute('data-status', 'Failed');
    expect(failedBadge!.querySelector('svg')).not.toBeNull();

    // A second, distinct status group (Processing → info) proves the derivation
    // is per-row and not a single hard-coded value.
    const processingRow = screen
      .getByText('bravo_2026-04-11.csv')
      .closest('tr')!;
    const processingBadge = within(processingRow)
      .getByText('Processing')
      .closest('[data-status]');
    expect(processingBadge).not.toBeNull();
    expect(processingBadge).toHaveAttribute('data-status', 'Processing');
    expect(processingBadge!.querySelector('svg')).not.toBeNull();
  });

  // AC-2 (accessibility baseline): the POPULATED table — badges included — has no
  // axe violations, confirming colour is exposed accessibly (paired with text).
  // We first assert the table actually rendered with its File Status column so
  // this test fails on a placeholder page (anti-pattern §4 — a real assertion
  // that breaks if the feature is absent), not just a vacuous axe pass.
  it('has no accessibility violations when populated', async () => {
    mockGet.mockResolvedValue(createMockFileLogList());
    const { container } = await renderFilesPage();

    // Table + the brief's File Status column must be present before axe is
    // meaningful.
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: /file status/i }),
    ).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Epic 2, Story 1 — File Logs dashboard: sort + pagination (AC-3)', () => {
  // AC-3 (sort): clicking a sortable column header sorts ascending on first click
  // and descending on the second (single-column toggle). We sort by File Name and
  // assert the rendered row ORDER flips between clicks — user-observable ordering,
  // not an internal sort-state flag.
  it('sorts by a column ascending then descending on repeated header clicks', async () => {
    const user = userEvent.setup();
    // Three names whose ascending order (alpha, bravo, charlie) differs from the
    // fixture's array order, so a working sort visibly reorders the rows.
    mockGet.mockResolvedValue(createMockFileLogList());
    await renderFilesPage();

    const fileNameHeader = screen.getByRole('columnheader', {
      name: /file name/i,
    });
    const sortControl =
      within(fileNameHeader).queryByRole('button') ?? fileNameHeader;

    // Ascending.
    await user.click(sortControl);
    await waitFor(() => {
      const names = getDataRows().map(
        (row) => within(row).getAllByRole('cell')[0].textContent,
      );
      expect(names).toEqual([
        'alpha_2026-04-12.csv',
        'bravo_2026-04-11.csv',
        'charlie_2026-04-10.csv',
      ]);
    });

    // Descending.
    await user.click(sortControl);
    await waitFor(() => {
      const names = getDataRows().map(
        (row) => within(row).getAllByRole('cell')[0].textContent,
      );
      expect(names).toEqual([
        'charlie_2026-04-10.csv',
        'bravo_2026-04-11.csv',
        'alpha_2026-04-12.csv',
      ]);
    });
  });

  // AC-3 (default page size): with more rows than the default page size of 20, the
  // first page shows exactly 20 rows. Pins the default explicitly (anti-pattern §8
  // — no loose range comparison).
  it('defaults to a page size of 20 and renders exactly 20 rows of a larger dataset', async () => {
    mockGet.mockResolvedValue(createMockFileLogPage(25));
    await renderFilesPage();
    expect(getDataRows()).toHaveLength(20);
  });

  // AC-3 (page size control): the user can change the page size to one of
  // 5 / 10 / 20 / 50. Selecting 5 narrows the visible rows to 5.
  it('lets the user change the page size, narrowing the visible rows', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue(createMockFileLogPage(25));
    await renderFilesPage();

    // The page-size control is a labelled select offering the documented options.
    const pageSize = screen.getByRole('combobox', {
      name: /(rows|page size)/i,
    });
    expect(
      within(pageSize).getByRole('option', { name: '5' }),
    ).toBeInTheDocument();
    expect(
      within(pageSize).getByRole('option', { name: '10' }),
    ).toBeInTheDocument();
    expect(
      within(pageSize).getByRole('option', { name: '20' }),
    ).toBeInTheDocument();
    expect(
      within(pageSize).getByRole('option', { name: '50' }),
    ).toBeInTheDocument();

    await user.selectOptions(pageSize, '5');
    await waitFor(() => {
      expect(getDataRows()).toHaveLength(5);
    });
  });

  // AC-3 (pagination always rendered, disabled when dataset < page size): with
  // only 3 rows under the default 20-row page size, the Next-page control is
  // present (always rendered) but disabled (anti-pattern §10 — pin the actual
  // expected disabled state, not an either/or).
  it('always renders pagination controls and disables Next when the dataset is smaller than the page size', async () => {
    mockGet.mockResolvedValue(createMockFileLogList()); // 3 rows < default 20
    await renderFilesPage();

    const nextButton = screen.getByRole('button', { name: /next/i });
    expect(nextButton).toBeInTheDocument();
    expect(nextButton).toBeDisabled();
  });
});

describe('Epic 2, Story 1 — File Logs dashboard: error state (AC-6)', () => {
  // AC-6: a failed file-logs fetch surfaces a user-visible error state with a
  // retry affordance — never a blank/broken page. Assert the alert role and a
  // retry control are present.
  it('shows an error state with a retry affordance when the fetch fails', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    markSessionStart();
    render(<FilesPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /(retry|try again)/i }),
    ).toBeInTheDocument();
  });

  // AC-6: clicking Retry re-attempts the fetch and, on success, replaces the error
  // state with the populated table — proving the retry affordance is wired, not
  // decorative.
  it('re-fetches and renders the table when the user clicks retry', async () => {
    const user = userEvent.setup();
    const recovered: MockFileLog[] = [
      createMockFileLog({ CurrentFileName: 'recovered_after_retry.csv' }),
    ];
    mockGet
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(recovered);

    markSessionStart();
    render(<FilesPage />);

    const retryButton = await screen.findByRole('button', {
      name: /(retry|try again)/i,
    });
    await user.click(retryButton);

    await waitFor(() => {
      expect(screen.getByText('recovered_after_retry.csv')).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
