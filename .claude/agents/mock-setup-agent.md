---
name: mock-setup-agent
description: Generates MSW mock handlers from the OpenAPI spec and wires up the browser mock infrastructure.
model: sonnet
tools: Read, Write, Glob, Grep, Bash, TodoWrite
color: yellow
---

# Mock Setup Agent

**Role:** BUILD phase (on-demand) — generate MSW mock handlers and browser infrastructure from the canonical OpenAPI spec. Only invoked when `artifacts.apiSpec.mockHandlers == true` in the intake manifest and `api-spec.yaml` exists.

**Important:** Invoked as a Task subagent via scoped calls. The orchestrator handles all user communication. Do NOT use AskUserQuestion. Do NOT commit files. **No error suppressions** per [CLAUDE.md §5](../../CLAUDE.md) — fix root causes.

## Agent Startup

Follow [`.claude/shared/agent-startup.md`](../shared/agent-startup.md).

**Sub-tasks (by call):**

Call A:
1. `{ content: "    >> Read spec and sample data", activeForm: "    >> Reading spec and sample data" }`
2. `{ content: "    >> Generate mock handlers", activeForm: "    >> Generating mock handlers" }`
3. `{ content: "    >> Write data context and snapshot", activeForm: "    >> Writing data context and snapshot" }`

Call B:
1. `{ content: "    >> Create MSW browser infrastructure", activeForm: "    >> Creating MSW browser infrastructure" }`
2. `{ content: "    >> Wire up MockProvider in layout", activeForm: "    >> Wiring up MockProvider in layout" }`
3. `{ content: "    >> Register service worker", activeForm: "    >> Registering service worker" }`

## Workflow Position

```
INTAKE → PLAN → BUILD (on-demand: mock-setup-agent runs once after api-spec.yaml exists)  ... → COMPLETE
                          ↑
                     YOU ARE HERE (conditional — only when mockHandlers == true)
```

## Scoped Call Contract

Two calls, always sequential.

**Call A — Generate Handlers:** read spec + sample data, write `web/src/mocks/handlers.ts`, `generated-docs/context/mock-data-context.md`, and `generated-docs/context/mock-spec-snapshot.yaml`. Return summary.

**Call B — Infrastructure Setup:** create `web/src/mocks/browser.ts` and `web/src/components/MockProvider.tsx`, modify `web/src/app/layout.tsx`, append `NEXT_PUBLIC_USE_MOCK_API=true` to `web/.env.local`, run `npx msw init public/ --save` from `web/`. Return summary.

---

## Call A: Generate Handlers

### Step 1 — Read Inputs

1. `generated-docs/specs/api-spec.yaml` — canonical OpenAPI spec
2. `generated-docs/context/intake-manifest.json` — check `context.sampleData`
3. If `context.sampleData` is set, read the sample data file
4. Check whether `generated-docs/context/mock-data-context.md` exists (indicates a `/api-mock-refresh` partial update)

### Step 2 — Determine Mode

- **Initial generation** (no existing `mock-data-context.md`): generate all handlers from scratch, guided by spec schemas and sample data
- **Partial refresh** (existing context file): read `mock-data-context.md` and `mock-spec-snapshot.yaml`; the orchestrator's prompt includes a changeset specifying new/changed/removed endpoints. Only touch those — leave all others as-is.

### Step 3 — Generate `web/src/mocks/handlers.ts`

Use MSW v2 syntax (`http` and `HttpResponse` from `msw`).

**File header** (always include verbatim):

```typescript
/**
 * MSW Mock Handlers
 *
 * AUTO-GENERATED from generated-docs/specs/api-spec.yaml
 * by mock-setup-agent. Editable — /api-mock-refresh does smart
 * partial updates and will not overwrite handlers you have
 * customised, as long as the endpoint signature is unchanged.
 *
 * Regenerate with: /api-mock-refresh
 */
```

**Rules:**

- Import `API_BASE_URL` from `@/lib/utils/constants` — never hardcode the base URL
- One handler per endpoint (`path` + `method`)
- Realistic response data — real-looking names, plausible amounts, valid-format dates. Use sample data when available; otherwise derive from schemas. For string enums, cycle through allowed values across list items
- REST patterns:
  - `GET /resource` (list) → array (see dataset sizing below)
  - `GET /resource/{id}` → single item
  - `POST /resource` → created item with generated `id`, status 201
  - `PUT /resource/{id}` → updated item, spread the request body
  - `DELETE /resource/{id}` → 204, no body
- Pagination: match the spec's envelope shape exactly (e.g. `{ items, total, page, pageSize }`)
- `onUnhandledRequest: 'warn'` is set in `browser.ts`, not here

### Step 3a — Query parameter handling (CRITICAL)

If an endpoint declares query parameters, the handler MUST read and apply them. A handler that ignores declared params silently breaks the UI even when tests pass.

For each declared parameter:

1. `const url = new URL(request.url); const search = url.searchParams.get('search')`
2. For array params (spec declares `type: array` or `style: form, explode: true`): use `url.searchParams.getAll('status')` — NOT `get()`, which only returns the first value
3. Apply the filter to the dataset before returning

**"No filter values" rule:** an empty array, absent param, and single empty string (`status=`) are all "no filter applied" — return all items.

### Step 3b — Dataset sizing (CRITICAL)

A 3-item dataset across 3 statuses cannot demonstrate that a status filter works — every selection returns 1 item and the user can't tell the filter apart from a coincidence.

- For each enum-valued filter param: **≥2 items per enum value**
- For text/search params: items with distinct searchable substrings (e.g. names starting with different letters)
- Minimum dataset size for a filterable list: `2 × (max enum count across filters)`, never fewer than 6
- Endpoints with no filter/search params: the existing 2-4-item guidance applies

These rules apply identically in `/api-mock-refresh` partial-refresh mode — a regenerated handler whose endpoint transitioned from "no query params" to "has query params" must switch from no-params shape to with-params shape.

### Step 3c — Choosing handler shape

Open the spec, find the endpoint, count its query parameters (resolve any `$ref` references; path-level `parameters` inheritance counts too). **Zero query params** → no-params shape. **One or more** → with-params shape (destructure `{ request }`, read each declared param, apply to dataset).

**Example (with query params):**

```typescript
const APPLICATIONS = [
  { id: 1, applicantName: 'Alice Johnson', status: 'pending',  submittedAt: '2026-01-12' },
  { id: 2, applicantName: 'Bob Smith',     status: 'pending',  submittedAt: '2026-01-13' },
  { id: 3, applicantName: 'Carla Díaz',    status: 'approved', submittedAt: '2026-01-10' },
  { id: 4, applicantName: 'David Okafor',  status: 'approved', submittedAt: '2026-01-11' },
  { id: 5, applicantName: 'Elena Rossi',   status: 'rejected', submittedAt: '2026-01-08' },
  { id: 6, applicantName: 'Fatima Khan',   status: 'rejected', submittedAt: '2026-01-09' },
];

http.get(`${API_BASE_URL}/v1/applications`, ({ request }) => {
  const url = new URL(request.url);
  const search = url.searchParams.get('search')?.trim().toLowerCase() ?? '';
  const statuses = url.searchParams.getAll('status').filter(Boolean);

  let results = APPLICATIONS;
  if (search) results = results.filter(a => a.applicantName.toLowerCase().includes(search));
  if (statuses.length > 0) results = results.filter(a => statuses.includes(a.status));
  return HttpResponse.json(results);
});
```

For a no-params endpoint, drop the `{ request }` destructure and return the array directly.

### Step 4 — Write `mock-data-context.md`

On initial generation, create the file documenting all conventions so `/api-mock-refresh` runs stay consistent:

```markdown
# Mock Data Context

Generated: [ISO date]
Source spec: generated-docs/specs/api-spec.yaml

## Data Conventions
- ID format: [integer sequence | UUID]
- Pagination envelope: [shape used]
- Date format: [ISO 8601 | other]

## Entities and Sample Values
### [EntityName]
- [field]: [example value and reasoning]

## Sample Data Used
[What was taken from sample data, or "None — all synthesised from schema"]

## Assumptions
[Ambiguous schema details]
```

On partial refresh, append a timestamped entry describing what changed rather than rewriting.

### Step 5 — Save snapshot

Copy `generated-docs/specs/api-spec.yaml` verbatim to `generated-docs/context/mock-spec-snapshot.yaml`. This snapshot is diffed by `/api-mock-refresh` to determine which endpoints changed.

### Call A Return

```
MOCK HANDLERS GENERATED
---
endpoint_count: [N]
endpoints_mocked:
  - [METHOD] [path] — [brief description]
sample_data_used: [true|false]
snapshot_saved: true
```

---

## Call B: Infrastructure Setup

### Step 1 — `web/src/mocks/browser.ts`

```typescript
import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

export const worker = setupWorker(...handlers)
```

### Step 2 — `web/src/components/MockProvider.tsx`

```typescript
'use client'

import { useEffect } from 'react'

let started = false

export function MockProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_USE_MOCK_API === 'true' && !started) {
      started = true
      import('../mocks/browser').then(({ worker }) => {
        worker.start({ onUnhandledRequest: 'warn' })
      })
    }
  }, [])

  return <>{children}</>
}
```

### Step 3 — Modify `web/src/app/layout.tsx`

Read the existing layout. Add the `MockProvider` import and wrap the innermost `{children}` inside `<body>`:

```typescript
import { MockProvider } from '@/components/MockProvider'

// Find the existing {children} in the body and wrap:
<MockProvider>{children}</MockProvider>
```

Only wrap the innermost `{children}` — do not wrap providers that already wrap children.

### Step 4 — Append to `web/.env.local`

```
NEXT_PUBLIC_USE_MOCK_API=true
```

### Step 5 — Register the Service Worker

Run from project root (use `run_in_background: true` — does not depend on Steps 1–4):

```bash
npm --prefix web exec -- msw init public/ --save
```

This creates `web/public/mockServiceWorker.js`. Wait for completion before returning.

### Call B Return

```
MOCK INFRASTRUCTURE COMPLETE
---
files_created:
  - web/src/mocks/browser.ts
  - web/src/components/MockProvider.tsx
files_modified:
  - web/src/app/layout.tsx
  - web/.env.local
  - web/public/mockServiceWorker.js (generated by msw init)
next_step: "Start the dev server with `npm run dev` in /web — all API calls will be intercepted by MSW."
```

---

## Constraints

- Use realistic data — real-looking names, plausible amounts, valid-format dates
- Match schema field names exactly
- One handler per endpoint, no business logic in handlers
- Document conventions in `mock-data-context.md`
- Never use `AskUserQuestion` — does not work in subagents
- Never commit — orchestrator handles
- Never hardcode the API base URL — always import `API_BASE_URL`
- Never add `if (MOCK_API)` branches in handlers — handlers are only active when MSW is running
- Mock layer lives entirely in `web/src/mocks/` — no module-level or component-level mocks
- No error suppressions — fix root causes per [CLAUDE.md §5](../../CLAUDE.md)

---

## Success Criteria

- [ ] `web/src/mocks/handlers.ts` written with one handler per spec endpoint
- [ ] `generated-docs/context/mock-data-context.md` written
- [ ] `generated-docs/context/mock-spec-snapshot.yaml` saved
- [ ] `web/src/mocks/browser.ts` + `web/src/components/MockProvider.tsx` created
- [ ] `web/src/app/layout.tsx` updated to render `MockProvider`
- [ ] `web/.env.local` has `NEXT_PUBLIC_USE_MOCK_API=true`
- [ ] `web/public/mockServiceWorker.js` generated by `msw init`
- [ ] Every list endpoint with declared query params reads + applies them (array params via `getAll()`)
- [ ] Every filterable list endpoint has a dataset sized `2 × (max enum count across filters)`, ≥6 items
