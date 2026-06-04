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

// jsdom Blob.text() / arrayBuffer() polyfill.
//
// jsdom (27.x) implements the `Blob` constructor but NOT the async reader
// methods `text()` / `arrayBuffer()` that the DOM spec defines and every real
// browser ships. Code that generates a client-side download (e.g. the
// Transactions CSV Export — Epic 3 Story 4) hands a Blob to
// URL.createObjectURL; a test that captures that Blob and asserts its content
// reads it back via `blob.text()`, which throws "text is not a function" under
// jsdom. We backfill the spec methods on jsdom's Blob.prototype using the Blob's
// own bytes so tests can read generated Blob content. Purely test
// infrastructure — production runs in a real browser where these already exist.
const BlobProto = globalThis.Blob?.prototype as
  | (Blob & { text?: unknown; arrayBuffer?: unknown })
  | undefined;
if (BlobProto && typeof BlobProto.text !== 'function') {
  // jsdom stores the assembled bytes on a private symbol; the most robust way to
  // read them back is via a FileReader, which jsdom DOES implement. Wrap it in a
  // promise to match the spec's `Blob.text(): Promise<string>` shape.
  Object.defineProperty(BlobProto, 'text', {
    configurable: true,
    writable: true,
    value: function text(this: Blob): Promise<string> {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(this);
      });
    },
  });
}
