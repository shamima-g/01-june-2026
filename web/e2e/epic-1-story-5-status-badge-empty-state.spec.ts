/**
 * Story Metadata:
 * - Route: null (StatusBadge and EmptyState are pure presentational primitives with
 *   NO routable page of their own; they are consumed by the file and transaction
 *   screens in Epics 2-4)
 * - Target File: web/src/components/status-badge/StatusBadge.tsx
 * - Page Action: create
 *
 * E2E spec for Epic 1, Story 5: Shared status badge and empty-state building blocks
 * (R16, NFR5).
 *
 * NON-ROUTABLE STORY: StatusBadge and EmptyState are shared presentational primitives
 * with no dedicated screen. All acceptance criteria are VITEST-tagged (AC-1 colour
 * mapping, AC-2 colour+icon+text, AC-3 empty-state variants, AC-4 toast UX) and are
 * fully covered by the Vitest unit suite for this story; these primitives will be
 * visually exercised end-to-end when Epics 2-4 render them on real pages. Per
 * CLAUDE.md Rule 10 and the testing policy, the suite is wrapped in test.fixme() with
 * no live test() — there is no user-reachable route to drive in a browser here.
 */
import { test, expect } from '@playwright/test';

test.fixme('Epic 1, Story 5: Shared status badge and empty-state building blocks', () => {
  // Non-routable shared-primitive story: StatusBadge/EmptyState have no route of
  // their own and all ACs are covered by the Vitest unit suite; verified visually
  // when Epics 2-4 consume them on real pages.
  test('placeholder so the suite parses while non-routable', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/.*/);
  });
});
