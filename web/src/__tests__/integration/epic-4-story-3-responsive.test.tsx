/**
 * Story Metadata:
 * - Epic 4, Story 3: Responsive table-to-card collapse below 768px
 * - Route: /transactions (also applies to /files)
 * - Target File: web/src/app/transactions/page.tsx (and web/src/app/files/page.tsx)
 * - Page Action: modify_existing (EXTENDS the shipped Epic-3 Transactions table +
 *   Epic-2 File Logs dashboard with a responsive layout — CLAUDE.md §7: extend the
 *   existing surface, don't nest a second copy of the data)
 *
 * Requirement: NFR3 — below 768px the File Logs table and the Transactions table
 * collapse to a vertical CARD list (primary identifier + 2–3 key columns + a
 * row-action overflow); the desktop table is NOT horizontally scrolled on mobile.
 * At/above 768px the full table renders. Sort / filter / pagination behaviour is
 * preserved in the card layout. Breakpoints: ≥360px mobile, ≥768px tablet,
 * ≥1280px desktop (project-brief §NFR3 / requirements UF-13).
 *
 * Failing-first (TDD red) tests for the VITEST-tagged acceptance criterion:
 *   - AC-4 (VITEST): sorting, filtering, and pagination remain USABLE in the
 *           mobile card layout — a filter narrows the card list (included refs
 *           present, excluded refs absent), changing page updates which cards
 *           show, and sorting reorders the cards. Each assertion pins the CONTRAST
 *           so it can't pass vacuously on a layout that ignores the controls.
 *
 * AC-1 (below 768px Transactions renders as a card list), AC-2 (at/above 768px the
 * full table renders) and AC-3 (File Logs collapses the same way) are
 * PLAYWRIGHT-tagged and covered by the sibling spec at a REAL viewport — they are
 * not re-driven here.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * RESPONSIVE SEAM (developer: implement to THIS) — a JS matchMedia hook.
 *
 * jsdom performs no layout, so a CSS-only collapse (Tailwind `md:` with both the
 * table and the cards in the DOM, one hidden per breakpoint via a media query)
 * is NOT observable here — jsdom can't see `display:none` coming from a media
 * query, so both copies would appear "present" and AC-4 (controls operate on the
 * mobile cards) could not be genuinely asserted.
 *
 * So the collapse MUST be driven by a JS media-query hook, e.g.
 *     const isMobile = useMediaQuery('(max-width: 767px)');
 * and the page renders EITHER the desktop <table> OR the mobile card list based on
 * `isMobile` — not both at once. Below 768px the card list is the ONLY data
 * surface (no <table> in the DOM); at/above 768px the <table> is the only one.
 * The filter / search / sort / pagination controls render in BOTH layouts and
 * operate on the SAME filtered-sorted-paged set the table reads (the existing
 * `filteredTransactions` → `sorted` → `pageRows` pipeline), so the cards reflect
 * exactly what the table would.
 *
 * These tests mock `window.matchMedia` to report a <768px match, then assert the
 * page (a) renders the CARD layout (no desktop <table>) and (b) honours every
 * control in that layout. The contrast — matchMedia reporting ≥768px renders the
 * <table>, not cards — is asserted too, so neither side passes vacuously.
 *
 * Observable card seam the assertions target (developer: render this shape):
 *   - the mobile card list is a `role="list"` with an accessible name matching
 *     /transactions/i (e.g. `aria-label="Transactions"`), OR a container with
 *     `data-testid="transaction-cards"`;
 *   - each card carries its row's primary identifier (the Reference text) so a
 *     card can be located by Reference and counted, exactly as a table row is.
 * The assertions accept EITHER the role="list" name or the testid seam so the
 * developer has a small amount of latitude, but the Reference-per-card content is
 * required (that is the AC-4 behaviour under test).
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * Mocking (testing-policy §Mocking strategy): only the HTTP client
 * (@/lib/api/client), the Next.js navigation boundary, and `window.matchMedia`
 * (the responsive seam) are mocked. The page, the filter/search/sort/pagination
 * logic, and the card rendering are the REAL code under test. The page is wrapped
 * in the existing RequireSession guard (reads the client-side session marker via
 * useSyncExternalStore), so each test seeds the marker through the real
 * session-client helper rather than mocking the guard. The current page renders
 * NO card layout, so every mobile-layout assertion fails meaningfully (TDD red).
 *
 * Shape source: documentation/transactions-api.yaml (TransactionRead /
 * TransactionReadList) + project-brief §6 / §13. No api-shape-report.md exists for
 * this build, so the spec + the shared MockTransaction shape are authoritative.
 * The Transaction collection arrives under the SINGULAR `Transactions` envelope
 * key, which the API client unwraps to a bare array before the page sees it — so
 * the mocked get() resolves the UNWRAPPED MockTransaction[]. The role source is
 * driven the same way as the Epic-3 suites.
 *
 * The axe matcher is registered globally by web/vitest.setup.ts.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Production import — the shipped page renders a <table> for ALL viewports and has
// NO matchMedia-driven card layout, so every mobile-layout assertion below fails
// meaningfully against the current page (TDD red).
import TransactionsPage from '@/app/transactions/page';
import { get } from '@/lib/api/client';
import { markSessionStart, clearSession } from '@/lib/session/session-client';
import {
  createMockTransaction,
  createMockTransactionPage,
  type MockTransaction,
} from '../helpers/epic-2-mock-data';

// HTTP client — mocked per testing-policy. `get` feeds the transactions list AND
// the role source behind fetchCurrentRole.
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

/**
 * Installs a `window.matchMedia` stub that reports `matches` for a `max-width`
 * (mobile) query and the inverse for a `min-width` query — so a hook asking
 * `'(max-width: 767px)'` resolves to `isMobile` ⇔ `mobile`. The stub also wires
 * addEventListener/removeEventListener (+ the legacy add/removeListener) so a hook
 * subscribing to changes doesn't crash. Returns the installed mock for assertions.
 */
function setViewport(mobile: boolean) {
  const matchMedia = vi.fn().mockImplementation((query: string) => {
    const isMaxWidth = /max-width/i.test(query);
    const matches = isMaxWidth ? mobile : !mobile;
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  });
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: matchMedia,
  });
  return matchMedia;
}

/**
 * Drives get() so the transactions list resolves to `rows` while the role source
 * resolves an Approver. Mirrors the Epic-3 path-based mock so fetchCurrentRole
 * resolves consistently.
 */
function seed(rows: MockTransaction[]) {
  mockGet.mockImplementation((path: string) => {
    if (path.includes('/v1/transactions')) return Promise.resolve(rows);
    if (path.includes('/userinfo')) return Promise.resolve(approverUserRecord);
    if (path.includes('/v1/users'))
      return Promise.resolve([approverUserRecord]);
    return Promise.resolve([]);
  });
}

/**
 * Renders the Transactions page with an authenticated client-side session so
 * RequireSession yields its protected content, then waits for the initial reads
 * to settle (loading indicator gone).
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
 * Locates the mobile card list, accepting EITHER seam: a `role="list"` named for
 * Transactions, or a `data-testid="transaction-cards"` container. Throws (failing
 * the test) when neither is present — which is the TDD-red state today.
 */
function getCardList(): HTMLElement {
  const byRole = screen.queryByRole('list', { name: /transactions/i });
  if (byRole) return byRole;
  const byTestId = screen.queryByTestId('transaction-cards');
  if (byTestId) return byTestId;
  throw new Error(
    'No mobile card list found (expected role="list" name /transactions/i or data-testid="transaction-cards").',
  );
}

/**
 * The transaction References visible in the mobile card list, returned in the
 * order the cards actually appear in the DOM (so `[0]` is the first card). Each
 * card carries its Reference (the `TXN-…` primary identifier) as a discrete text
 * node, so we walk the card list items in DOM order and, per card, identify which
 * of the test's supplied References (`references`) is rendered in that card —
 * matching the Reference text node EXACTLY (via within(item).queryByText), not a
 * substring of the card's concatenated text. A loose regex over the card's whole
 * textContent would also swallow the adjacent date/amount digits (the Reference
 * and date render with no separator between them), so an exact text-node match is
 * what yields the bare Reference.
 *
 * Reading the cards' DOM order — rather than filtering the input array, which
 * would always return the input order regardless of how the cards are laid out —
 * is what makes the sort assertion meaningful: if the cards do NOT reorder on a
 * sort toggle, the first card's Reference does not change and the descending
 * assertion fails.
 */
function visibleCardReferences(references: string[]): string[] {
  const cards = getCardList();
  const items = within(cards).getAllByRole('listitem');
  return items
    .map(
      (item) =>
        references.find((ref) => within(item).queryByText(ref) !== null) ??
        null,
    )
    .filter((ref): ref is string => ref !== null);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  clearSession();
  vi.unstubAllGlobals();
});

describe('Epic 4, Story 3 — responsive table-to-card collapse (NFR3, AC-4)', () => {
  // Seam contrast (the foundation AC-4 builds on): below 768px the page renders
  // the CARD layout and NOT the desktop <table>; at/above 768px it renders the
  // <table> and NOT the card list. Asserting both sides proves the collapse is
  // viewport-driven rather than always-on / always-off (so the remaining AC-4
  // tests, which run in mobile mode, are exercising the genuine card path).
  it('renders the card list (no desktop table) below 768px, and the table (no cards) at/above 768px', async () => {
    // Mobile: cards present, table absent.
    setViewport(true);
    seed([
      createMockTransaction({ Id: 9401, Reference: 'TXN-AAA' }),
      createMockTransaction({ Id: 9402, Reference: 'TXN-BBB' }),
    ]);
    const mobile = await renderTransactionsPage();

    await waitFor(() => {
      expect(getCardList()).toBeInTheDocument();
    });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(visibleCardReferences(['TXN-AAA', 'TXN-BBB'])).toEqual([
      'TXN-AAA',
      'TXN-BBB',
    ]);
    mobile.unmount();

    // Desktop: table present, card list absent. Same data, opposite layout.
    setViewport(false);
    const desktop = await renderTransactionsPage();
    await waitFor(() => {
      expect(screen.getByRole('table')).toBeInTheDocument();
    });
    expect(screen.queryByRole('list', { name: /transactions/i })).toBeNull();
    expect(screen.queryByTestId('transaction-cards')).toBeNull();
    desktop.unmount();
  });

  // AC-4 (filter usable in cards): applying the Status filter in the mobile card
  // layout narrows the card list to matching rows — the Approved card stays, the
  // Imported + Rejected cards disappear. Contrast (all three present before the
  // filter, one after) proves the filter drives the card list, not a no-op.
  it('narrows the mobile card list when a filter is applied', async () => {
    const user = userEvent.setup();
    setViewport(true);
    const refs = ['TXN-IMP', 'TXN-APP', 'TXN-REJ'];
    seed([
      createMockTransaction({
        Id: 9411,
        Reference: 'TXN-IMP',
        Status: 'Imported',
      }),
      createMockTransaction({
        Id: 9412,
        Reference: 'TXN-APP',
        Status: 'Approved',
      }),
      createMockTransaction({
        Id: 9413,
        Reference: 'TXN-REJ',
        Status: 'Rejected',
      }),
    ]);
    await renderTransactionsPage();

    // Before filtering: all three cards are present in the mobile layout.
    await waitFor(() => {
      expect(visibleCardReferences(refs)).toEqual(refs);
    });

    // Apply the Status = Approved filter (the same control the table layout uses).
    await user.selectOptions(screen.getByLabelText(/^status$/i), 'Approved');

    // Only the Approved card remains; the Imported + Rejected cards are gone.
    await waitFor(() => {
      expect(visibleCardReferences(refs)).toEqual(['TXN-APP']);
    });
  });

  // AC-4 (pagination usable in cards): with more rows than the page size, the
  // mobile card list shows only the first page; advancing to the next page shows
  // a DIFFERENT set of cards. Contrast (a page-1 card present then absent, a
  // page-2 card absent then present) proves pagination drives the card list.
  it('changes the visible mobile cards when paginating', async () => {
    const user = userEvent.setup();
    setViewport(true);
    // 12 rows: TXN-001 … TXN-012 (createMockTransactionPage zero-pads References).
    const rows = createMockTransactionPage(12);
    seed(rows);
    await renderTransactionsPage();

    await waitFor(() => {
      expect(getCardList()).toBeInTheDocument();
    });

    // Shrink the page size to 5 so pagination is exercised within 12 rows.
    await user.selectOptions(screen.getByLabelText(/rows per page/i), '5');

    // Default sort is Transaction Date descending; rather than assume which slice
    // lands on which page, capture page 1's references, advance, and assert the
    // visible set CHANGES (page 2 shows cards page 1 did not).
    const allRefs = rows.map((r) => r.Reference);
    await waitFor(() => {
      expect(visibleCardReferences(allRefs).length).toBe(5);
    });
    const page1 = visibleCardReferences(allRefs);

    await user.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => {
      const page2 = visibleCardReferences(allRefs);
      expect(page2.length).toBeGreaterThan(0);
      // No overlap between the two pages — the card list genuinely turned over.
      expect(page2.some((ref) => page1.includes(ref))).toBe(false);
    });
  });

  // AC-4 (sort usable in cards): toggling a column sort reorders the mobile cards.
  // We sort by Reference ascending then descending and assert the first card's
  // Reference flips between the alphabetical min and max — contrast proves the
  // sort control reorders the cards, not just the (absent) table.
  it('reorders the mobile cards when a column sort is toggled', async () => {
    const user = userEvent.setup();
    setViewport(true);
    const refs = ['TXN-AAA', 'TXN-MMM', 'TXN-ZZZ'];
    seed([
      createMockTransaction({ Id: 9421, Reference: 'TXN-MMM' }),
      createMockTransaction({ Id: 9422, Reference: 'TXN-AAA' }),
      createMockTransaction({ Id: 9423, Reference: 'TXN-ZZZ' }),
    ]);
    await renderTransactionsPage();

    await waitFor(() => {
      expect(visibleCardReferences(refs).length).toBe(3);
    });

    // The sort control's accessible name is "Sort by Reference" (Epic 4 Story 2
    // sr-only prefix); the control must be present in the card layout too.
    const sortByReference = screen.getByRole('button', {
      name: /sort by reference/i,
    });

    // First click → ascending: the alphabetical minimum (TXN-AAA) leads.
    await user.click(sortByReference);
    await waitFor(() => {
      expect(visibleCardReferences(refs)[0]).toBe('TXN-AAA');
    });

    // Second click → descending: the maximum (TXN-ZZZ) now leads — the cards
    // reordered in response to the sort toggle.
    await user.click(sortByReference);
    await waitFor(() => {
      expect(visibleCardReferences(refs)[0]).toBe('TXN-ZZZ');
    });
  });
});
