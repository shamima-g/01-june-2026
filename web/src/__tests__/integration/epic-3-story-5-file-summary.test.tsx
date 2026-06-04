/**
 * Story Metadata:
 * - Epic 3, Story 5: Per-file summary with status counts and drill-down
 * - Route: /transactions
 * - Target File: web/src/app/transactions/page.tsx (modify_existing)
 * - Page Action: modify_existing (EXTENDS the Epic-3 Story-1/2/3/4 transactions
 *   surface at this path with a CLIENT-SIDE per-File Summary derived from the
 *   already-loaded transaction set — CLAUDE.md §7: extend the existing surface,
 *   don't nest a second one)
 *
 * Requirement: R10 (the system surfaces a per-File Summary showing Total records,
 * Imported count, Approved count, and Rejected count; clicking a status count
 * drills into the filtered slice of the Transactions table). project-brief §6 /
 * §13.B fix the TransactionStatus set to Imported / Approved / Rejected.
 *
 * Failing-first (TDD red) tests for the VITEST-tagged acceptance criterion — the
 * count-derivation lives in the React render and is jsdom-observable
 * (testing-policy §"test at the layer where the behaviour lives"):
 *   - AC-2 (VITEST): the displayed per-file counts MATCH the actual transaction
 *           statuses in each file's dataset. The fixture seeds a KNOWN, asymmetric
 *           distribution per FileLogId (file 5001: 3 Imported / 2 Approved / 1
 *           Rejected → Total 6; file 5002: 1 Imported / 4 Approved / 0 Rejected →
 *           Total 5) and each test scopes to ONE file's summary block, asserting
 *           the EXACT Total and each status count AND that the four status counts
 *           sum to Total. Two files with DIFFERENT distributions prove the counts
 *           are derived PER FILE (grouped by FileLogId + Status) rather than from
 *           a single global tally — so the assertions cannot pass vacuously.
 *
 * AC-1 (the summary shows Total + Imported/Approved/Rejected counts for the file)
 * and AC-3 (clicking a status count opens the table pre-filtered to that file +
 * status, reusing the Story-2 filter state) are PLAYWRIGHT-tagged and covered by
 * the sibling spec — the drill-down navigation is not re-driven here. This file
 * keeps strictly to the NUMBERS: the counts equal the seeded distribution.
 *
 * Mocking (testing-policy §Mocking strategy): only the HTTP client
 * (@/lib/api/client) and the Next.js navigation boundary are mocked. The page,
 * the per-file count-derivation logic, the shared StatusBadge used for the count
 * labels, and the summary UI are the REAL code under test. The page is wrapped in
 * the existing RequireSession guard (reads the client-side session marker via
 * useSyncExternalStore), so each test seeds the marker through the real
 * session-client helper rather than mocking the guard. An Approver role is
 * resolved through the real fetchCurrentRole (itself calling the mocked client)
 * — but the summary is a read-only aggregation visible to BOTH the Approver and
 * the Importer (roles: Approver, Importer), so its counts do not depend on the
 * resolved role; resolving an Approver simply matches the Story-1/2/3/4 wiring.
 *
 * Shape source: documentation/transactions-api.yaml (TransactionRead /
 * TransactionReadList) + project-brief §6 / §13. No api-shape-report.md exists for
 * this build, so the spec + the shared MockTransaction shape are authoritative.
 * The Transaction collection arrives under the SINGULAR `Transactions` envelope
 * key, which the API client unwraps to a bare array before the page sees it — so
 * the mocked get() resolves the UNWRAPPED MockTransaction[]. The role source is
 * driven the same way as Story-1/2/3/4.
 *
 * The axe matcher is registered globally by web/vitest.setup.ts.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Production import — the Story-1/2/3/4 page renders NO per-file summary surface,
// so every count assertion below fails meaningfully against the current page
// (TDD red): there is no summary block to scope into and no counts to read.
import TransactionsPage from '@/app/transactions/page';
import { get } from '@/lib/api/client';
import { markSessionStart, clearSession } from '@/lib/session/session-client';
import {
  createMockTransaction,
  type MockTransaction,
} from '../helpers/epic-2-mock-data';

// HTTP client — mocked per testing-policy (client.ts is never exercised here).
vi.mock('@/lib/api/client', () => ({
  get: vi.fn(),
}));
const mockGet = get as ReturnType<typeof vi.fn>;

// Navigation boundary — RequireSession touches the router on its mount path, and
// the (Playwright-tested) drill-down reads the router; mocked so a render never
// hits the real Next.js navigation runtime.
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

/**
 * The KNOWN per-file status distribution the summary must reproduce. This object
 * is the SINGLE source both the fixture and the assertions read from, so the two
 * can never silently drift: the fixture below materialises exactly these counts,
 * and each test asserts against these same numbers. The two files carry DIFFERENT
 * distributions (and different totals) so the test proves the counts are grouped
 * PER FileLogId, not tallied globally.
 *
 *   - File 5001: 3 Imported + 2 Approved + 1 Rejected → Total 6.
 *   - File 5002: 1 Imported + 4 Approved + 0 Rejected → Total 5.
 */
const FILE_SUMMARY_DISTRIBUTION = {
  5001: {
    FileName: 'alpha_2026-01.csv',
    Imported: 3,
    Approved: 2,
    Rejected: 1,
    Total: 6,
  },
  5002: {
    FileName: 'bravo_2026-03.csv',
    Imported: 1,
    Approved: 4,
    Rejected: 0,
    Total: 5,
  },
} as const;

type Status = 'Imported' | 'Approved' | 'Rejected';

/**
 * Materialises the distribution above into a flat transaction list, then
 * INTERLEAVES the rows so they are NOT pre-grouped by file or by status — the
 * page's own client-side grouping is the thing under test, so the fixture must
 * not hand it a conveniently pre-sorted set.
 */
function createFileSummaryTransactions(): MockTransaction[] {
  const rows: MockTransaction[] = [];
  let id = 9400;
  for (const [fileLogIdRaw, dist] of Object.entries(
    FILE_SUMMARY_DISTRIBUTION,
  )) {
    const fileLogId = Number(fileLogIdRaw);
    const statuses: Array<[Status, number]> = [
      ['Imported', dist.Imported],
      ['Approved', dist.Approved],
      ['Rejected', dist.Rejected],
    ];
    for (const [status, count] of statuses) {
      for (let i = 0; i < count; i += 1) {
        id += 1;
        rows.push(
          createMockTransaction({
            Id: id,
            FileLogId: fileLogId,
            FileName: dist.FileName,
            Reference: `TXN-${fileLogId}-${status}-${i + 1}`,
            AccountNumber: `ACC-${id}`,
            Status: status,
          }),
        );
      }
    }
  }
  // De-group: interleave odd/even Ids so file 5001's and 5002's rows are
  // intermixed and the statuses are out of order.
  const byId = [...rows].sort((a, b) => a.Id - b.Id);
  return byId
    .filter((_, i) => i % 2 === 0)
    .concat(byId.filter((_, i) => i % 2 === 1));
}

/**
 * Drives get() so the transactions list resolves to `rows` while the role-source
 * calls resolve an Approver (matching the Story-1/2/3/4 wiring). Mirrors the
 * path-based mock the sibling tests use so fetchCurrentRole resolves consistently.
 */
function seedTransactions(rows: MockTransaction[]) {
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
 * Renders the Transactions page with an authenticated client-side session so the
 * RequireSession guard yields its protected content, and waits for the initial
 * fetch to settle (loading indicator gone, data on screen).
 */
async function renderTransactionsPage() {
  markSessionStart();
  const utils = render(<TransactionsPage />);
  await waitFor(() =>
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument(),
  );
  return utils;
}

/**
 * Resolves ONE file's summary block from the rendered per-File Summary. The
 * summary is expected to expose each file's counts within a region/group whose
 * accessible name carries the file name (the FileName is the file's human-facing
 * identity, matching the Story-2 File filter). Scoping with `within(block)` is
 * what makes the per-file assertions independent — file 5001's counts can never
 * be satisfied by file 5002's rows.
 */
async function findFileSummaryBlock(fileName: string): Promise<HTMLElement> {
  // The block is exposed as a labelled REGION named after the file (the per-file
  // summary container role reconciled to region to match the sibling Playwright
  // spec — locator precision only; the count assertions are unchanged). A
  // RegExp on the file name matches whether the summary frames it as
  // "alpha_2026-01.csv" alone or as "File: alpha_2026-01.csv".
  const named = new RegExp(
    fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    'i',
  );
  return (await screen.findByRole('region', { name: named })) as HTMLElement;
}

/**
 * Reads the numeric count a summary block shows for one labelled metric
 * (Total / Imported / Approved / Rejected). The label and its number are tied
 * together by an accessible NAME that pins the metric word to its number, so the
 * lookup pins the number to its metric rather than scraping a bag of digits.
 *
 * The metrics are deliberately NOT `role="status"` (a static count is not an ARIA
 * live-region announcement, and a count `role="status"` would both make screen
 * readers announce every count and collide with the Story-3 toast-surface guard).
 * Instead:
 *   - Each STATUS count (Imported / Approved / Rejected) is the drill-down
 *     `<button>` whose accessible name carries "<Status>: <count>", so it is read
 *     by its button role + metric name.
 *   - The TOTAL is a labelled value (accessible name "Total: <count>"), read via
 *     its label.
 * Either way the number is pinned to its metric — locator precision only; the
 * count assertions below are unchanged.
 */
function readCount(block: HTMLElement, metric: string): number {
  const named = new RegExp(metric, 'i');
  const node =
    metric.toLowerCase() === 'total'
      ? within(block).getByLabelText(named)
      : within(block).getByRole('button', { name: named });
  const accessibleText =
    node.getAttribute('aria-label') ?? node.textContent ?? '';
  const digits = accessibleText.match(/\d+/);
  return digits ? Number(digits[0]) : NaN;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  clearSession();
});

describe('Epic 3, Story 5 — per-file summary counts match the data (AC-2)', () => {
  // AC-2: file 5001's summary shows EXACTLY 6 Total, 3 Imported, 2 Approved,
  // 1 Rejected — and the three status counts sum to Total. Scoped to 5001's block
  // so 5002's rows cannot satisfy it.
  it("file 5001's counts equal its seeded distribution and sum to Total", async () => {
    seedTransactions(createFileSummaryTransactions());
    await renderTransactionsPage();

    const expected = FILE_SUMMARY_DISTRIBUTION[5001];
    const block = await findFileSummaryBlock(expected.FileName);

    const imported = readCount(block, 'imported');
    const approved = readCount(block, 'approved');
    const rejected = readCount(block, 'rejected');
    const total = readCount(block, 'total');

    expect(imported).toBe(expected.Imported); // 3
    expect(approved).toBe(expected.Approved); // 2
    expect(rejected).toBe(expected.Rejected); // 1
    expect(total).toBe(expected.Total); // 6
    // The contrast that defeats a vacuous pass: the parts sum to the whole.
    expect(imported + approved + rejected).toBe(total);
  });

  // AC-2 (per-file independence): file 5002 carries a DIFFERENT distribution
  // (1 / 4 / 0, Total 5). Asserting 5002 independently — with a zero Rejected
  // count and a different Total from 5001 — proves the counts are grouped per
  // FileLogId, not derived from one global tally shared across files.
  it("file 5002's counts equal its own distribution — distinct from file 5001", async () => {
    seedTransactions(createFileSummaryTransactions());
    await renderTransactionsPage();

    const expected = FILE_SUMMARY_DISTRIBUTION[5002];
    const block = await findFileSummaryBlock(expected.FileName);

    const imported = readCount(block, 'imported');
    const approved = readCount(block, 'approved');
    const rejected = readCount(block, 'rejected');
    const total = readCount(block, 'total');

    expect(imported).toBe(expected.Imported); // 1
    expect(approved).toBe(expected.Approved); // 4
    expect(rejected).toBe(expected.Rejected); // 0 — distinct from 5001's 1
    expect(total).toBe(expected.Total); // 5 — distinct from 5001's 6
    expect(imported + approved + rejected).toBe(total);
  });

  // AC-2 (accessibility): the per-file summary surface has no axe violations.
  // We first assert a file's summary block actually rendered with its counts so
  // the axe check is not a vacuous pass on an absent summary (anti-pattern §4).
  it('per-file summary has no accessibility violations', async () => {
    seedTransactions(createFileSummaryTransactions());
    const { container } = await renderTransactionsPage();

    const expected = FILE_SUMMARY_DISTRIBUTION[5001];
    const block = await findFileSummaryBlock(expected.FileName);
    expect(readCount(block, 'total')).toBe(expected.Total);

    expect(await axe(container)).toHaveNoViolations();
  });
});
