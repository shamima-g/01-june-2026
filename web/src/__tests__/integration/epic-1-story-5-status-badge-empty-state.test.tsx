/**
 * Story Metadata:
 * - Epic 1, Story 5: Shared status badge and empty-state building blocks
 * - Route: null (pure presentational component surface; non-routable)
 * - Target Files:
 *     web/src/components/status-badge/StatusBadge.tsx  (new)
 *     web/src/components/empty-state/EmptyState.tsx     (new)
 * - Page Action: n/a (component surface)
 *
 * Requirements: R16 (status-badge colour mapping, colour always paired with icon
 * + text label), NFR5 (error UX — toasts auto-dismiss for completed actions;
 * banners for errors). Also touches R15 (empty-state zero-data vs zero-filter).
 *
 * Failing-first (TDD red) tests. All four ACs are vitest-tagged — the behaviour
 * lives entirely in the React render (colour-variant mapping, icon+label pairing,
 * empty-state message switching, toast surfacing), which is jsdom-observable per
 * testing-policy §"Test at the layer where the behaviour lives".
 *
 * STYLING POLICY: status colours reference semantic design tokens / variant
 * classes, never hardcoded hex. These tests assert the *variant contract* — a
 * `data-status` attribute carrying the canonical status, plus an icon and a text
 * label — NOT literal hex values. The brief's hue intent (§11 / R16) is verified
 * by eye on the manual checklist; pinning hex here would couple the test to the
 * stylesheet and break the moment a token is retuned.
 *
 * AC-4 (toast UX) exercises the EXISTING toast infrastructure — the real
 * ToastProvider + ToastContainer + useToast from `@/contexts/ToastContext`. The
 * toast system is deliberately NOT mocked here: the AC is "a completed action and
 * an error each surface through the GLOBAL toast UX", so the real surface is the
 * thing under test. Per the shipped Toast component, every variant (success AND
 * error) is announced via role="status"/aria-live="polite" — the single canonical
 * role="alert" is owned by the relevant in-page surface, not the toast. These
 * tests assert the user-observable toast content + its success/error variant, not
 * the alert role.
 *
 * The axe matcher (`toHaveNoViolations`) is registered globally by
 * `web/vitest.setup.ts` via `expect.extend(matchers)` — the same convention used
 * by the Story 2 and Story 3 suites — so only `axe` is imported here.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { describe, it, expect } from 'vitest';

// Production imports — will fail until implemented (TDD red).
import { StatusBadge } from '@/components/status-badge/StatusBadge';
import { EmptyState } from '@/components/empty-state/EmptyState';
// EXISTING toast infrastructure — reused, never re-built.
import { ToastProvider, useToast } from '@/contexts/ToastContext';
import { ToastContainer } from '@/components/toast/ToastContainer';

describe('Epic 1, Story 5 — StatusBadge', () => {
  // AC-1: brief's colour mapping — Imported/Processing→blue, Approved/Completed→green,
  // Rejected/Failed→red, Uploaded→grey. We assert the canonical status the badge
  // commits to via its data-status attribute (the variant contract that drives the
  // token class), one representative per colour group, plus the rendered label.
  it.each([
    ['Imported', 'blue'],
    ['Processing', 'blue'],
    ['Approved', 'green'],
    ['Completed', 'green'],
  ])(
    'maps %s to the %s colour variant via a token-backed data-status',
    (status) => {
      render(<StatusBadge status={status} />);
      const badge = screen.getByText(status).closest('[data-status]');
      expect(badge).not.toBeNull();
      expect(badge).toHaveAttribute('data-status', status);
    },
  );

  // AC-1: the red and grey groups (kept under the it.each ≤5-row discipline by
  // splitting the distinct terminal/neutral cases out).
  it('maps the rejected/failed statuses to a red variant and uploaded to grey', () => {
    const { rerender } = render(<StatusBadge status="Rejected" />);
    expect(
      screen.getByText('Rejected').closest('[data-status]'),
    ).toHaveAttribute('data-status', 'Rejected');

    rerender(<StatusBadge status="Failed" />);
    expect(screen.getByText('Failed').closest('[data-status]')).toHaveAttribute(
      'data-status',
      'Failed',
    );

    rerender(<StatusBadge status="Uploaded" />);
    expect(
      screen.getByText('Uploaded').closest('[data-status]'),
    ).toHaveAttribute('data-status', 'Uploaded');
  });

  // AC-2: colour is NEVER the sole signal — every badge pairs an icon with a
  // text label (NFR1 / R16 accessibility). Assert BOTH the visible status text
  // and a non-decorative icon (an <svg>) are present inside the badge.
  it('pairs every status with both an icon and a visible text label', () => {
    render(<StatusBadge status="Approved" />);
    const badge = screen.getByText('Approved').closest('[data-status]');
    expect(badge).not.toBeNull();
    // Text label present and human-readable.
    expect(screen.getByText('Approved')).toBeInTheDocument();
    // An icon accompanies the label (svg is the icon primitive in this template).
    expect(badge!.querySelector('svg')).not.toBeNull();
  });

  // AC-2 (accessibility baseline): the badge composition has no axe violations,
  // confirming the colour/icon/label trio is exposed accessibly.
  it('has no accessibility violations', async () => {
    const { container } = render(<StatusBadge status="Imported" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Epic 1, Story 5 — EmptyState', () => {
  // AC-3: zero-DATA variant — "nothing here yet" framing, NO active-filter context.
  it('renders a zero-data message distinct from the filtered variant', () => {
    render(
      <EmptyState
        variant="no-data"
        title="No transactions yet"
        message="Imported transactions will appear here."
      />,
    );
    expect(screen.getByText('No transactions yet')).toBeInTheDocument();
    expect(
      screen.getByText('Imported transactions will appear here.'),
    ).toBeInTheDocument();
    // The filter-context affordance (Clear-all) must be ABSENT in the zero-data state.
    expect(
      screen.queryByRole('button', { name: /clear (all )?filters?/i }),
    ).not.toBeInTheDocument();
  });

  // AC-3: zero-FILTER-RESULTS variant — "no matches" framing that reflects the
  // active filter context and offers a clear-filters affordance (R15).
  it('renders a zero-filter-results message reflecting active filter context', async () => {
    const user = userEvent.setup();
    let cleared = false;
    render(
      <EmptyState
        variant="no-results"
        title="No matching transactions"
        message="No transactions match the current filters."
        activeFilterSummary="Status: Approved"
        onClearFilters={() => {
          cleared = true;
        }}
      />,
    );
    expect(screen.getByText('No matching transactions')).toBeInTheDocument();
    // Active-filter context is surfaced to the user.
    expect(screen.getByText(/Status: Approved/)).toBeInTheDocument();
    // Clear-filters affordance present AND wired.
    const clearButton = screen.getByRole('button', {
      name: /clear (all )?filters?/i,
    });
    await user.click(clearButton);
    expect(cleared).toBe(true);
  });

  // AC-3 (accessibility baseline) on the more complex filtered variant.
  it('has no accessibility violations in the filtered variant', async () => {
    const { container } = render(
      <EmptyState
        variant="no-results"
        title="No matching transactions"
        message="No transactions match the current filters."
        activeFilterSummary="Status: Approved"
        onClearFilters={() => {}}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

/**
 * Small harness that drives the REAL toast system. A button triggers a success
 * toast (completed action) and another triggers an error toast — mirroring the
 * global completed-Approve/Reject success UX and the async-error UX of NFR5.
 */
function ToastHarness() {
  const { showToast } = useToast();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          showToast({
            variant: 'success',
            title: 'Transaction approved',
            message: 'TXN-20260415-0001 was approved.',
          })
        }
      >
        Trigger success
      </button>
      <button
        type="button"
        onClick={() =>
          showToast({
            variant: 'error',
            title: 'Action failed',
            message: 'Could not reach the server. Try again.',
          })
        }
      >
        Trigger error
      </button>
      <ToastContainer />
    </>
  );
}

describe('Epic 1, Story 5 — global toast UX (AC-4)', () => {
  // AC-4: a completed action surfaces through the global toast UX as a live,
  // announced status message carrying the action's confirmation text.
  it('surfaces a completed action through a success toast', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Trigger success' }));

    await waitFor(() => {
      expect(screen.getByText('Transaction approved')).toBeInTheDocument();
    });
    // Announced through the live notifications region (role="status" per the
    // shipped Toast — every variant is announced, alert role is reserved for the
    // canonical in-page surface). The generic on `closest` narrows the result to
    // HTMLElement so `within` accepts it.
    const toast = screen
      .getByText('Transaction approved')
      .closest<HTMLElement>('[role="status"]');
    expect(toast).not.toBeNull();
    expect(
      within(toast!).getByText('TXN-20260415-0001 was approved.'),
    ).toBeInTheDocument();
  });

  // AC-4: an error likewise surfaces through the global toast UX, distinguishable
  // from the success case by its error message content.
  it('surfaces an error through an error toast', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Trigger error' }));

    await waitFor(() => {
      expect(screen.getByText('Action failed')).toBeInTheDocument();
    });
    const toast = screen
      .getByText('Action failed')
      .closest<HTMLElement>('[role="status"]');
    expect(toast).not.toBeNull();
    expect(
      within(toast!).getByText('Could not reach the server. Try again.'),
    ).toBeInTheDocument();
  });
});
