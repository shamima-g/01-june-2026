/**
 * Story Metadata:
 * - Epic 4, Story 2: Accessibility pass — keyboard navigation, focus, labels, and
 *   AT-exposed help
 * - Route: /transactions
 * - Target File: web/src/app/transactions/page.tsx (modify_existing)
 * - Page Action: modify_existing (HARDENS the existing Epic-3 Transactions surface
 *   in place — CLAUDE.md §7: harden the shipped surface, don't nest a parallel one)
 *
 * Requirements: NFR1 (Accessibility — WCAG 2.2 Level AA; status badges pair colour
 * with icon + text, icon-only / ambiguous controls carry an accessible name and
 * tooltip, keyboard-first operation across all primary flows), NFR4 (browser
 * support — latest two versions of Chrome/Edge/Firefox/Safari; verified manually
 * per AC-5, not by an automated test).
 *
 * Failing-first (TDD red) tests for the VITEST-tagged acceptance criteria — each
 * behaviour lives in the React render and is jsdom-observable (testing-policy
 * §"test at the layer where the behaviour lives"):
 *   - AC-3 (VITEST): icon-only / ambiguous controls carry accessible names, and
 *           form fields are PROGRAMMATICALLY labelled. Each assertion pins the
 *           CONTRAST so it cannot pass vacuously:
 *             * the column-header SORT controls must expose that they SORT (and by
 *               which column) in their accessible NAME — today the button's name is
 *               the bare column label ("Reference"), conveying nothing about the
 *               sort affordance to a screen-reader user, so the "sort"-naming
 *               assertion FAILS NOW and PASSES once the controls are named (e.g.
 *               aria-label "Sort by Reference").
 *             * the icon-bearing Export control is reachable by an accessible name
 *               (the visible label, not the decorative icon).
 *             * the filter form fields (Status / File / search / date / amount) and
 *               the rows-per-page select resolve via getByLabelText — proving
 *               programmatic label association, not a visual-only caption.
 *   - AC-4 (VITEST): the hardened Transactions surface, rendered in a representative
 *           populated Approver state, reports NO WCAG 2.2 AA violations under the
 *           axe matcher. The axe run is gated behind a real render assertion (the
 *           data table is present) so it is never a vacuous pass on a placeholder.
 *
 * AC-1 (all primary flows keyboard-operable with visible focus) and AC-2 (the
 * disabled Export control's "no rows match" explanation is exposed to AT, not
 * title-only) are PLAYWRIGHT-tagged and covered by the sibling spec for the
 * keyboard/focus halves — but AC-2's PROGRAMMATIC ASSOCIATION (the disabled Export
 * button has an AT-reachable description, not a hover-only `title`) is a render-time
 * DOM relationship that is best pinned in jsdom too, so it is additionally driven
 * here as the "ambiguous control" exemplar the story summary calls out (the Epic-3
 * Story-4 deferral). See the AC-2 describe block below.
 *
 * Mocking (testing-policy §Mocking strategy): only the HTTP client
 * (@/lib/api/client) and the Next.js navigation boundary are mocked. The page, the
 * shared StatusBadge / EmptyState, the filter form, the sort headers, the Export
 * control and the role gating (fetchCurrentRole + asKnownRole) are the REAL code
 * under test. The page is wrapped in the existing RequireSession guard (reads the
 * client-side session marker via useSyncExternalStore), so each test seeds the
 * marker through the real session-client helper rather than mocking the guard. An
 * Approver is resolved so the FULL control set (incl. Export) renders — the widest
 * a11y surface.
 *
 * Shape source: documentation/transactions-api.yaml (TransactionRead /
 * TransactionReadList) + project-brief §6 / §13. No api-shape-report.md exists for
 * this build (verified absent), so the spec + the shared MockTransaction shape are
 * authoritative. The Transaction collection arrives under the SINGULAR
 * `Transactions` envelope key, which the API client unwraps to a bare array before
 * the page sees it — so the mocked get() resolves the UNWRAPPED MockTransaction[].
 * The role source is driven the same path-routed way as Epic-3 Story 1/2/3.
 *
 * The axe matcher is registered globally by web/vitest.setup.ts.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Production import — the hardening lives in this same page; the assertions below
// fail against the CURRENT (Epic-3) render until the a11y pass lands (TDD red).
import TransactionsPage from '@/app/transactions/page';
import { get } from '@/lib/api/client';
import { markSessionStart, clearSession } from '@/lib/session/session-client';
import {
  createMockTransactionList,
  createMockTransaction,
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
 * Drives get() so the transactions list resolves to `rows` while the role source
 * resolves an Approver. Mirrors the Epic-3 Story-1/2/3 path-based mock so
 * fetchCurrentRole resolves the full (Export-bearing) Approver surface.
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
 * Renders the Transactions page with an authenticated client-side session so the
 * RequireSession guard yields its protected content, waits for the initial reads
 * to settle (loading gone), and waits for the Approver Export control to render so
 * the role has resolved before assertions run.
 */
async function renderTransactionsPage() {
  markSessionStart();
  const utils = render(<TransactionsPage />);
  await waitFor(() =>
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument(),
  );
  await screen.findByRole('button', { name: /export/i });
  return utils;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  clearSession();
});

describe('Epic 4, Story 2 — Accessible names + label associations (AC-3, NFR1)', () => {
  // AC-3 (form-label association): every filter control resolves by its
  // programmatic label — getByLabelText returns the actual <input>/<select>, which
  // only holds when the visible caption is associated (htmlFor/id), not merely
  // adjacent. This guards against the hardening pass accidentally breaking an
  // existing association.
  it('exposes every filter field via its programmatic label', async () => {
    seed(createMockTransactionList());
    await renderTransactionsPage();

    // Each resolves to a control element (an <input>/<select> tag) — proving the
    // label is associated, not just visually near the field.
    const tagNames = [
      screen.getByLabelText(/^status$/i),
      screen.getByLabelText(/^file$/i),
      screen.getByLabelText(/search reference or account number/i),
      screen.getByLabelText(/from date/i),
      screen.getByLabelText(/to date/i),
      screen.getByLabelText(/minimum amount/i),
      screen.getByLabelText(/maximum amount/i),
      screen.getByLabelText(/rows per page/i),
    ].map((el) => el.tagName);

    for (const tag of tagNames) {
      expect(['INPUT', 'SELECT']).toContain(tag);
    }
  });

  // AC-3 (icon-bearing control accessible name): the Export control pairs a
  // decorative (aria-hidden) Download icon with a visible label; its accessible
  // name must be the LABEL, not empty. Reaching it by name proves the icon does not
  // swallow the name and the label is exposed to AT.
  it('exposes the icon-bearing Export control by an accessible name', async () => {
    seed(createMockTransactionList());
    await renderTransactionsPage();

    const exportButton = screen.getByRole('button', { name: /export/i });
    expect(exportButton).toBeInTheDocument();
    // The accessible name is non-empty and human-meaningful (not just the icon).
    expect(exportButton).toHaveAccessibleName(/export/i);
  });

  // AC-3 (ambiguous SORT control — CONTRAST that FAILS NOW): the column-header sort
  // buttons today expose only the bare column label as their accessible name
  // ("Reference"), so a screen-reader user cannot tell the control SORTS or by
  // which column. The hardening must give each a sort-communicating accessible name
  // (e.g. aria-label "Sort by Reference"). We anchor the contrast: the control is
  // reachable by a /sort by reference/i name (FAILS NOW → PASSES once named).
  it('names the column-header sort controls as sort affordances', async () => {
    seed(createMockTransactionList());
    await renderTransactionsPage();

    const table = await screen.findByRole('table');
    // The Reference column header cell holds the sort trigger.
    const referenceHeader = within(table).getByRole('columnheader', {
      name: /reference/i,
    });

    // The interactive sort control inside the header must communicate "sort" in its
    // accessible name — the current bare-label name ("Reference") is insufficient
    // for AT, so this assertion is RED until the control is named.
    const sortControl = within(referenceHeader).getByRole('button', {
      name: /sort.*reference/i,
    });
    expect(sortControl).toBeInTheDocument();
  });

  // AC-4 (no accessibility violations): an axe pass over the populated, Approver
  // surface catches an unlabelled control (axe rules: button-name, label,
  // aria-input-field-name, label-content-name-mismatch) and structural a11y faults.
  // Gated behind a real render assertion so it is not a vacuous pass.
  it('has no WCAG axe violations on the populated Approver surface', async () => {
    seed(createMockTransactionList());
    const { container } = await renderTransactionsPage();

    // Real-render gate: the data grid is present before axe runs.
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Epic 4, Story 2 — Disabled Export explanation exposed to AT (AC-2, NFR1)', () => {
  // AC-2 (the Epic-3 Story-4 deferral): in the zero-filtered-results state the
  // Export control is DISABLED and today conveys its "nothing to export" reason
  // ONLY through the native `title` attribute — invisible to keyboard + screen-
  // reader users who never hover. The hardening must surface that reason via an
  // AT-reachable mechanism: an accessible DESCRIPTION (aria-describedby → visible
  // help text) and/or the reason folded into the accessible NAME.
  //
  // We render an Approver surface, then drive the Status filter to a value that
  // matches NO loaded row so the filtered set is empty and Export becomes disabled,
  // and assert the AT-exposed association. This FAILS NOW (title-only, no
  // accessible description) and PASSES once aria-describedby / visible help lands.
  it('exposes the disabled Export reason to assistive tech, not via title alone', async () => {
    const user = userEvent.setup();

    // A single Imported row — so a Status=Rejected filter yields ZERO matches and
    // the Export control goes disabled while the surface stays populated (the table
    // is still mounted; only the filtered slice is empty).
    seed([
      createMockTransaction({
        Id: 9401,
        Reference: 'TXN-A11Y-1',
        AccountNumber: '7000000001',
        Status: 'Imported',
      }),
    ]);
    await renderTransactionsPage();

    // Narrow to a status no row holds → the filtered set is empty → Export disabled.
    await user.selectOptions(screen.getByLabelText(/^status$/i), 'Rejected');

    const exportButton = screen.getByRole('button', { name: /export/i });
    await waitFor(() => expect(exportButton).toBeDisabled());

    // AT-exposed reason: the control carries an accessible DESCRIPTION conveying the
    // "nothing to export" reason (aria-describedby → visible help text), OR the
    // reason is folded into its accessible NAME. A hover-only `title` does NOT
    // satisfy either — so this is RED on the current (title-only) surface.
    const describedBy = exportButton.getAttribute('aria-describedby');
    const description = describedBy
      ? describedBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ')
      : '';
    const accessibleName = exportButton.getAttribute('aria-label') ?? '';
    const combined = `${description} ${accessibleName}`;

    // The reason must be reachable WITHOUT hover and must actually explain the
    // disabled state (mentions there is nothing / no rows to export under the
    // filter). The native `title` is deliberately NOT consulted here.
    expect(combined).toMatch(/nothing|no.*(match|row|transaction)/i);
    expect(combined.trim().length).toBeGreaterThan(0);
  });

  // AC-2 (contrast — the visible help is actually on the page, not hover-only): the
  // explanation text the disabled Export points at must be rendered as DOM content
  // reachable by AT, distinguishing it from the previous title-tooltip mechanism.
  // Anchored to the disabled state.
  it('renders the disabled-Export explanation as AT-reachable content (not a title tooltip)', async () => {
    const user = userEvent.setup();

    seed([
      createMockTransaction({
        Id: 9402,
        Reference: 'TXN-A11Y-2',
        AccountNumber: '7000000002',
        Status: 'Imported',
      }),
    ]);
    await renderTransactionsPage();

    await user.selectOptions(screen.getByLabelText(/^status$/i), 'Approved');

    const exportButton = screen.getByRole('button', { name: /export/i });
    await waitFor(() => expect(exportButton).toBeDisabled());

    // The describedby target must exist in the DOM as real text content (the seam
    // the developer implements to — an AT-exposed help node), proving the
    // explanation is no longer carried solely by the `title` attribute.
    const describedBy = exportButton.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const helpNode = describedBy
      ? document.getElementById(describedBy.split(/\s+/)[0])
      : null;
    expect(helpNode).not.toBeNull();
    expect(helpNode?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });
});
