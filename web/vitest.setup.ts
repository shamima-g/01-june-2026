// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom/vitest';

// Accessibility testing with axe-core. `expect.extend` registers the matchers at
// runtime; the matching `tsc` type augmentation lives in
// src/__tests__/vitest-axe.d.ts (Vitest 4 resolves matchers via @vitest/expect's
// `Matchers` interface, which the package's own `extend-expect` does not target).
import * as matchers from 'vitest-axe/matchers';
import { expect, vi } from 'vitest';

expect.extend(matchers);

// React Testing Library `waitFor` + Vitest fake timers bridge.
//
// RTL detects fake timers (Vitest's faked `setTimeout` carries a `.clock`
// property) and, while waiting, advances them via `jest.advanceTimersByTime`.
// Under Vitest there is no `jest` global, so that call throws inside RTL's poll
// loop and `waitFor` deadlocks until the test times out. We expose a minimal,
// Jest-compatible timer shim backed by Vitest's own clock so `waitFor` (and any
// other RTL async util) advances the fake timers correctly. This is purely test
// infrastructure — it changes no production behaviour.
const timerShim = {
  advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms),
  advanceTimersToNextTimer: () => vi.advanceTimersToNextTimer(),
  runOnlyPendingTimers: () => vi.runOnlyPendingTimers(),
  getTimerCount: () => vi.getTimerCount(),
};

const globalWithJest = globalThis as typeof globalThis & {
  jest?: typeof timerShim;
};

if (!globalWithJest.jest) {
  globalWithJest.jest = timerShim;
}
