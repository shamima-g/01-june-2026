/**
 * Type augmentation registering the `vitest-axe` matcher with Vitest 4.
 *
 * `vitest-axe/extend-expect` augments the legacy `Vi.Assertion` namespace, but
 * Vitest 4 resolves custom matchers through `@vitest/expect`'s `Matchers<T>`
 * interface (which `Assertion<T>` extends). Without this augmentation
 * `expect(await axe(...)).toHaveNoViolations()` fails `tsc --noEmit` even though
 * the matcher IS registered at runtime in `vitest.setup.ts`. This declaration
 * teaches the type-checker about the matcher — it adds no runtime behaviour.
 *
 * The matcher member is declared INLINE on each augmented interface (rather than
 * via an empty `extends AxeMatchers` interface): an empty extending interface
 * trips `@typescript-eslint/no-empty-object-type`, and a generic param left
 * unreferenced trips `@typescript-eslint/no-unused-vars`. Declaring the member
 * directly — and threading the host interface's generic `T` through the chainable
 * return type — keeps both rules satisfied with no suppression directives
 * (CLAUDE.md §5). The generic signatures mirror the upstream Vitest interfaces so
 * declaration merging still applies.
 *
 * Lives under `src/types/` (not `src/__tests__/`) so Vitest's test-file globs
 * do not try to collect this declaration file as a (suite-less) test module.
 */
import 'vitest';

declare module '@vitest/expect' {
  interface Matchers<T = unknown> {
    /** Asserts an axe-core results object contains no accessibility violations. */
    toHaveNoViolations(): Matchers<T>;
  }
}

declare module 'vitest' {
  interface Assertion<T = unknown> {
    /** Asserts an axe-core results object contains no accessibility violations. */
    toHaveNoViolations(): Assertion<T>;
  }
  interface AsymmetricMatchersContaining {
    /** Asserts an axe-core results object contains no accessibility violations. */
    toHaveNoViolations(): void;
  }
}
