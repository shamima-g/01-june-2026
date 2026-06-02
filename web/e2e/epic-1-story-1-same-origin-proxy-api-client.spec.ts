import { test, expect } from '@playwright/test';

// Non-routable: infrastructure-only story — the same-origin proxy and dual-backend
// API-client wiring has no page/screen. It is exercised by the Vitest suite and by
// downstream routable stories that issue API calls through the proxy.
test.fixme('Epic 1, Story 1: Same-origin proxy and dual-backend API client wiring (deferred to consumer stories)', () => {
  // Intentionally empty — playwright-runner detects test.fixme( and auto-skips.
  expect(true).toBe(true);
});
