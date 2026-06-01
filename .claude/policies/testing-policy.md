# Testing Policy

Canonical operational checklist for testing, referenced by [`test-generator`](../agents/test-generator.md), [`code-reviewer`](../agents/code-reviewer.md), and [`developer`](../agents/developer.md). CLAUDE.md covers rationale.

---

## Test at the layer where the behaviour lives

Every acceptance criterion gets exactly one coverage tag from the closed set below. The feature-planner assigns the tag at PLAN time (see [feature-planner.md](../agents/feature-planner.md)) and the orchestrator validates the set before handing it to `test-generator`. The tags are agent-internal — the user sees plain-language summaries at Gate 2b, not the tags themselves.

| Behaviour lives in… | Tag | Examples |
|---|---|---|
| The **React render** (jsdom-observable) | `vitest` | Role-gating, conditional UI, form-state, loading/empty/error UI, hook behaviour, axe |
| The **browser + backend round-trip** | `playwright` | Drag/drop, downloads, file picker, navigation, real cookies, redirect chains, real auth, filter/sort/pagination against the API |
| **Visual / assistive-tech / OS / absorbed-by-sibling** | `none` | Contrast, screen-reader announcements, OS theme, cross-browser parity, or "another AC's test already proves this" |

**`none` is a first-class choice.** It covers both manual-checklist absorption (e.g., contrast verified by eye) AND absorbed-by-sibling (e.g., "page has heading X" when another AC's render assertion proves the heading exists). Manual-only ACs are surfaced via `manualOnlyACs` for the checklist; absorbed-by-sibling ACs produce no test at all.

**Anti-pattern: sibling tests across layers for the same AC.** If an AC's behaviour lives in the browser, `vitest` is the wrong tag — don't write a Vitest sibling "for completeness." The Playwright spec *is* the test. A sign-in redirect belongs in Playwright — the Vitest version would have to mock `signIn()` and recreate the exact blind spot the pipeline exists to close.

---

## Test organization

| Directory | Contents |
|---|---|
| `web/src/__tests__/integration/` | Integration tests (primary focus) |
| `web/src/__tests__/scripts/` | Template tooling and script tests |
| `web/src/__tests__/api/` | API endpoint tests (if needed) |
| `web/e2e/` | Playwright specs |

File naming: `.test.ts` for non-React code, `.test.tsx` for React components/pages. Use descriptive names tied to the behaviour under test.

---

## Per-epic baseline

Cross-story invariants live in **one file per epic**, not duplicated across every story's test file.

**File:** `web/src/__tests__/integration/epic-N-baseline.test.tsx`

**Created or extended by Story 1's `test-generator`** when the epic introduces a new shared surface (the planner's `epicIntroducesSharedSurface: true` flag — set when Story 1 creates a `layout.tsx`, a `(group)/` folder, or a `Provider` component used by later stories).

**Covers:**

- Role-gating that spans the epic's pages
- Axe baseline on the epic's main flows
- Common navigation present in the shared shell
- Shared layout invariants

**Subsequent stories in the same epic do NOT redo these checks.** Their test files cover only the story's *delta*. If a later story genuinely introduces a new shared surface (e.g., a sub-shell), the agent raises a `briefDriftNotes` entry and the orchestrator runs a follow-up extension cycle on the baseline file — not the parallel test-gen path.

**Idempotency:** when invoked on Story 1 of a shared-surface epic, the agent first checks whether the baseline file already exists (e.g., from a prior interrupted run). If yes, it extends — never recreates. The file's presence is authoritative.

---

## Test budget

**Tests = coverage tags.** The feature-planner assigns one coverage tag per AC (see [feature-planner.md](../agents/feature-planner.md)); `test-generator` writes one test per tag. The test count is whatever the tag set produces — there is no separate budget to hit.

**Hard ceiling — 12 `it()` blocks per Vitest file, 12 `test()` blocks per Playwright spec.** If exceeded, the planner over-tagged or the story is too large. Send it back to the planner for consolidation rather than letting the file grow.

**`it.each` discipline.** Use sparingly — only for genuinely distinct edge cases (number vs date vs string formatting), never for data variations of the same behaviour. Keep `it.each` tables ≤5 rows. If you find yourself enumerating data values, the AC should have been consolidated at PLAN time per the Change 2 rules in [feature-planner.md](../agents/feature-planner.md).

---

## Query priority (accessibility-first)

| Priority | Query | When to use |
|---|---|---|
| 1 | `getByRole` | Buttons, links, headings, forms — **preferred for most elements** |
| 2 | `getByLabelText` | Form inputs with labels |
| 3 | `getByPlaceholderText` | Inputs without visible labels |
| 4 | `getByText` | Non-interactive content |
| 5 | `getByDisplayValue` | Filled form inputs |
| Last resort | `getByTestId` | Only when no semantic query works |

**`getByTestId` is an anti-pattern in most cases.** If you find yourself adding `data-testid` attributes, first ask: "Is there a semantic HTML element or ARIA role I should use instead?" The answer is usually yes.

---

## AC traceability

Every `it()` / `test()` block carries a `// AC-N` comment on the line above it. Multiple ACs can be comma-separated:

```typescript
// AC-1, AC-3
it('displays payment list and handles API errors', () => { ... });
```

---

## Anti-patterns (forbidden)

Tests must fail before implementation, import real production code (never mock the code under test), assert user-observable behavior, and follow CLAUDE.md §5 on suppressions. The patterns below are the recurring ways those principles get violated:

### 1. No placeholder components inside test files

Every `import` must point to production code. If the component doesn't exist, that's the expected TDD failure — don't define a placeholder.

```typescript
// WRONG — tests zero production code
const ExamplePage = () => <div>Example</div>;

// CORRECT — import will fail until implemented
import { ExamplePage } from '@/app/example/page';
```

### 2. No `||` query fallbacks

`getBy*` throws on no match, so the `||` branch never executes.

```typescript
// WRONG
screen.getByLabelText(/date/i) || screen.getByPlaceholderText(/date/i)

// CORRECT — use queryBy for conditional checks
screen.queryByLabelText(/date/i) ?? screen.getByPlaceholderText(/date/i)
```

### 3. No speculative normalization tests

Don't test multiple casings of the same enum value unless the spec documents mixed casing.

### 4. Every `it()` must have a meaningful assertion

Rendering a component and asserting only that a hardcoded input value appears verifies nothing. Either add an assertion that would fail if the feature broke, or don't generate the test.

### 5. No library-internal assertions

No assertions on third-party library internals (Recharts SVG, Zod schemas, mock call counts). Assert user-observable outcomes.

```typescript
// WRONG
expect(container.querySelector('.recharts-bar-rectangle')).toHaveAttribute('fill', '#8884d8');
expect(mockFn).toHaveBeenCalledTimes(3);
expect(button).toHaveClass('btn-primary');

// CORRECT
expect(screen.getByText('Sales: $1,234')).toBeInTheDocument();
expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
```

**Charts and visualizations specifically:** jsdom cannot render SVG/Canvas, so any test querying internal `<rect>` / `<path>` elements is meaningless. Test that the component renders without crashing, that data transformation/formatting functions work (test those separately), that loading/error/empty states render, and use accessibility features (aria-labels, sr-only text) to verify data display. Defer visual correctness to E2E or manual QA.

### 6. No placeholder-removal-only tests

Don't test that template placeholder text is absent. Real content rendering implicitly proves it.

### 7. No fragile index-based row selection

Use `within()` to scope queries to a row, not array indices.

```typescript
// WRONG — assumes API ordering
const links = screen.getAllByRole('link', { name: /view/i });
const firstRowLink = links[0];

// CORRECT — scoped to the row containing the expected text
const row = screen.getByText('ABC Realty').closest('tr')!;
const link = within(row).getByRole('link', { name: /view/i });
```

### 8. No loose range comparisons on count assertions

`toBeLessThanOrEqual(20)` passes when the component renders zero rows. When the fixture has N items and you expect N visible, pin the count.

```typescript
// WRONG — passes when nothing renders
expect(rows.length).toBeLessThanOrEqual(20);

// CORRECT — N items in the fixture, N rows expected
expect(rows).toHaveLength(mockData.length);
```

### 9. No unscoped numeric or short-string `getByText`

`screen.getByText('6')` matches any "6" in the DOM — a status badge count, a column index, a page number. For text shorter than ~4 characters or any text that could appear in multiple places, scope the query with `within()`.

```typescript
// WRONG — matches any "6" anywhere on the page
expect(screen.getByText('6')).toBeInTheDocument();

// CORRECT — scoped to the cell or section that owns the value
const summary = screen.getByRole('region', { name: /summary/i });
expect(within(summary).getByText('6')).toBeInTheDocument();
```

### 10. No conditional assertions that pass under either implementation

`if (button) expect(button).toBeDisabled(); else expect(button).not.toBeInTheDocument();` does not pin a contract — both code paths pass. Pick the expected behaviour and write the test for that.

```typescript
// WRONG — passes whether the button exists or not
const button = screen.queryByRole('button', { name: /submit/i });
if (button) expect(button).toBeDisabled();
else expect(button).not.toBeInTheDocument();

// CORRECT — assert the actual expected state
expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled();
```

---

## Forbidden test files

- `constants.test.ts`, `types.test.ts`, `*-schemas.test.ts` — tests for things TypeScript already proves

---

## Mocking strategy

| Scenario | Mock? | How |
|---|---|---|
| API client | Yes | `vi.mock('@/lib/api/client', () => ({ get: vi.fn() }))` |
| External services | Yes | `vi.mock` the service module |
| Child components | No | Test the real component |
| React hooks | No | Test through behavior |
| Date/time | Yes | `vi.useFakeTimers()` |

The convention `vi.mock('@/lib/api/client', () => ({ get: vi.fn() }))` is fixed for Vitest consumer tests — `client.ts` is mocked, never exercised directly.

### Playwright mocking — project-level default, not per-spec

The Playwright mocking strategy is chosen once at INTAKE and recorded in `intake-manifest.json` → `context.testInfrastructure.playwrightMockingDefault`. `test-generator` reads it and emits specs that follow the default. Per-spec `Mocking strategy:` headers stay only when a spec deliberately deviates from the default.

| Project shape | Default Playwright mocking |
|---|---|
| `mockHandlers: true` (no live backend) | MSW (already wired by `mock-setup-agent`) |
| Live backend, INTAKE probe succeeded | `page.route()` with shapes from `generated-docs/context/api-shape-report.md` |
| Live backend, probe declined or failed | `page.route()` with shapes inferred from the OpenAPI spec |

`page.route()` only intercepts browser-side fetches — it cannot intercept Server Actions, which forces a client-side fetch implementation for those endpoints. MSW intercepts both browser and Node fetches but needs `web/src/mocks/` wired.

### Common mock pitfalls

**Multiple API calls** — `mockResolvedValue` returns the same value for all calls. Use `mockResolvedValueOnce` for different sequential responses:

```typescript
mockGet
  .mockResolvedValueOnce(firstResponse)
  .mockResolvedValueOnce(secondResponse);
```

**Context providers** — mock both the hook and the Provider:

```typescript
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));
```

**Navigation hooks** — mock all the Next.js navigation imports the component uses:

```typescript
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/current-path',
  useSearchParams: () => new URLSearchParams(),
}));
```

**Async state updates** — wrap assertions in `waitFor`:

```typescript
await waitFor(() => {
  expect(screen.getByText('Expected')).toBeInTheDocument();
});
```

---

## Shared mock data factories

Mock data factories live in `web/src/__tests__/helpers/epic-N-mock-data.ts` — never duplicated per test file.

**First story in an epic:** create the helper file. Check whether `web/src/types/api-generated.ts` exists; if so, import entity types from it instead of redefining shapes.

```typescript
// web/src/__tests__/helpers/epic-1-mock-data.ts
import type { Dashboard, AgencySummary } from '@/types/api-generated';

export const createMockDashboardData = (overrides: Partial<Dashboard> = {}): Dashboard => ({
  totalPayments: 42,
  totalValue: 125430.50,
  agencies: [],
  ...overrides,
});
```

**Subsequent stories in the same epic:** import from and extend the existing helper. Never duplicate — when schemas change, only one file moves.

---

## Mock data accuracy

Before creating mocks, check for OpenAPI specs at `generated-docs/specs/api-spec.yaml` (canonical) or `documentation/*.yaml` (user-provided). Specs don't always reflect reality (string enums, unexpected nulls, extra fields), so when sample data exists, use it as the basis. Type your factories so TypeScript catches obvious mismatches.

When a quirk is discovered (spec says enum, API returns string), document it in the type definition so both tests and implementation benefit:

```typescript
export interface Portfolio {
  /** API returns 'ACTIVE' | 'INACTIVE' as string, not a typed enum */
  status: string;
}
```

---

## Render scope — component vs full page

Default to the narrowest scope that covers the ACs. Full-page renders cascade failures across every suite when one component breaks; component-level renders isolate them.

| Story type | Render |
|---|---|
| Targets a specific component (chart, grid, form) | That component directly |
| Covers page layout / cross-component interactions | Full page |
| Story 1 (page setup) with many sections | Full page (first story establishes the page) |

---

## Testability classification (inline tags)

When an AC describes behaviour that can't be fully verified in jsdom:

- **Runtime-only** (middleware, server components, layout composition) — generate the test for component-level regression coverage, add `// Runtime-only: verified during manual checklist` above it
- **Manual-only** (screen-reader announcements, OS theme, human-eye contrast) — do NOT generate a test; surface in `manualOnlyACs` so the orchestrator folds it into the manual checklist

The former `Data-contract` classification has been retired. Data-contract drift (field casing, response shape, query-param contracts) is caught upstream by the INTAKE auth + endpoint probe; what isn't catchable there is caught by the endpoint-invention HALT in [agent-autonomy.md](../shared/agent-autonomy.md). Vitest tests no longer carry the `Data-contract:` inline comment.

---

## Mock boundary blindness

Vitest + RTL runs in jsdom, which cannot exercise certain Next.js integration layers. Tests that mock each boundary independently will pass even when the boundaries aren't connected at runtime — this is why the [Testability classification](#testability-classification-inline-tags) `Runtime-only` tag exists.

**jsdom CAN verify (unit-testable):**

- Component rendering and conditional content
- Form interactions and validation feedback
- Hook behavior and state changes
- Error message display
- Client-side navigation calls (`router.push` was called with correct args)

**jsdom CANNOT verify (runtime-only):**

- Middleware actually intercepts requests and redirects
- Server-component auth (`requireAuth()`) actually blocks rendering
- Layout composition (a page inside `(protected)/` inherits the protected layout)
- Multi-layer redirects (middleware → login → return-to-original-page)
- `"use client"` boundaries (server-side auth in a client component is silently skipped)

**How the workflow handles it:** `developer` and `code-reviewer` perform integration-wiring checks and synthesise runtime verification items from the story's ACs — so the manual checklist always surfaces runtime-only concerns. Data-contract concerns (response shape, query-param wiring, header requirements, dataset realism) are caught upstream by the INTAKE auth + endpoint probe before any test is written; what slips past the probe is caught at BUILD by the endpoint-invention HALT in [agent-autonomy.md](../shared/agent-autonomy.md).

---

## Non-routable Playwright stubs

Stories with `route === null` still get a Playwright spec file (so the file structure exists for later promotion), but the suite is wrapped in `test.fixme()` with a one-line reason comment.

```ts
import { test, expect } from '@playwright/test';

// Non-routable: <one-line reason from the story's summary>
test.fixme('Epic N, Story M: <title> (deferred to consumer stories)', () => {
  // Intentionally empty — playwright-runner detects test.fixme( and auto-skips.
});
```

`test.fixme()` is **only** permitted for explicitly non-routable stories. Never as a tool to avoid failing tests.
