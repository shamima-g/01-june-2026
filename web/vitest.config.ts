import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'src/**/__tests__/**/*.[jt]s?(x)',
      'src/**/?(*.)+(test).[jt]s?(x)',
    ],
    // `__tests__/helpers/**` holds shared mock-data factories and other test
    // support modules that are imported BY tests but contain no test suites of
    // their own — Vitest would otherwise fail them with "No test suite found".
    exclude: [
      'node_modules/',
      '**/*.spec.[jt]s',
      'src/**/__tests__/helpers/**',
    ],
    // Default fake-timer behaviour for the whole project. `shouldAdvanceTime`
    // lets real time bleed into the fake clock at a coarse cadence so that
    // libraries which legitimately need timers to fire (notably axe-core's
    // async result collection) still resolve under `vi.useFakeTimers()`, while
    // explicit `vi.advanceTimersByTime*` jumps remain authoritative for the
    // deterministic session-timeout tests. The large delta keeps the passive
    // drift negligible next to those minute/hour-scale manual advances.
    fakeTimers: {
      shouldAdvanceTime: true,
      advanceTimeDelta: 20,
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx,ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/*.stories.{js,jsx,ts,tsx}',
        'src/**/__tests__/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
