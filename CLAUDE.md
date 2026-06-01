# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Template repository** for building frontend applications with:

- Next.js 16 (App Router) + React 19 + TypeScript 5 (strict)
- Tailwind CSS 4 + Shadcn UI
- Vitest + React Testing Library
- Production-ready API client for OpenAPI-defined REST endpoints

Users clone this template and use Claude Code to generate features, components, and API integrations.

## Repository Structure

```
project-root/
├── .claude/          # Claude Code config and logs (logs are TRACKED — see §1)
├── web/              # Next.js frontend
├── documentation/    # Feature specs, OpenAPI specs, and sample datasets
└── generated-docs/   # Auto-generated progress tracking
```

## Architecture Quick Reference

### Directory Structure (`web/`)

- `e2e/` - Playwright specs
- `src/__tests__/` - Vitest integration tests
- `src/app/` - Next.js App Router pages
- `src/components/` - Reusable React components
- `src/lib/api/` - API client and endpoint functions
- `src/lib/validation/` - Zod schemas
- `src/types/` - TypeScript definitions

### Key Patterns

- **Path alias:** Use `@/` for imports (maps to `web/src/`)
- **Server components by default:** Add `"use client"` only when needed
- **App Router:** Pages go in `app/`, not `pages/`

## Development Commands

Invoke npm scripts from the project root with `npm --prefix web run <script>` — do NOT `cd web` since the bash tool's CWD persists across calls.

```bash
npm --prefix web run dev          # Dev server (http://localhost:3000)
npm --prefix web run build        # Production build
npm --prefix web run lint         # Linting
npm --prefix web test             # Vitest (append `-- path/to/file.test.tsx` for one file)
npm --prefix web run test:quality # Test-quality gate (must pass)
npm --prefix web run test:e2e     # Playwright E2E (auto-starts dev server)
```

## Workflow Commands (Claude Code)

```
/start          # Begin workflow — installs deps if needed, runs INTAKE through Gate 1, chains into /continue
/continue       # Drive PLAN and BUILD, or resume from any phase via workflow-state.json
/status         # Show current workflow progress
/dashboard      # Open visual dashboard in browser - auto-refreshes every 10s
/quality-check  # Run all 5 quality gates
```

The workflow has **4 phases** (INTAKE / PLAN / BUILD / COMPLETE) and **1–2 user gates**. See [.claude/WORKFLOWS.md](.claude/WORKFLOWS.md) for the full design.

## Critical Rules

### 1. Session Logs Must Be Committed

The `.claude/logs/*.md` files are intentionally tracked in Git for traceability. Always include them in commits (`git add .claude/logs/`). Do NOT add `.claude/logs/` to `.gitignore`.

### 2. Use Shadcn UI Primitives

For UI primitives (buttons, dialogs, inputs, cards, etc.), use Shadcn components installed via MCP:

```
mcp__shadcn__add_component
```

Build custom components by **composing** Shadcn primitives — don't hand-roll equivalents from raw HTML + Tailwind.

### 3. Use the API Client

All API calls must use `web/src/lib/api/client.ts`. Never call `fetch()` directly in components.

```typescript
import { get, post, put, del } from '@/lib/api/client';
export const getUsers = () => get<User[]>('/v1/users');
export const createUser = (data: CreateUserRequest) =>
  post<User>('/v1/users', data);
```

### 4. API Spec & Backend Errors

**Never assume there's no backend.** OpenAPI specs may live in `documentation/` (user-provided) or `generated-docs/specs/api-spec.yaml` (canonical, produced during BUILD). Prefer the canonical when both exist.

INTAKE captures connectivity config (base URL, auth header, env vars, smoke-test status) in `generated-docs/context/intake-manifest.json` → `context.backendConnectivity`, plus a re-runnable `generated-docs/context/api-smoke-test.sh`. BUILD reads these as authoritative — don't re-derive.

**Never dismiss API errors** (404, 500, connection refused, etc.). Report the actual error, reference the spec, ask the user — don't guess. Likely causes: backend not running, endpoint not implemented, path/method mismatch, or no backend for this project.

### 5. No Error Suppressions

**Never use suppression directives:**

- `// eslint-disable` / `// eslint-disable-next-line`
- `// @ts-expect-error` / `// @ts-ignore` / `// @ts-nocheck`

Fix errors properly. Suppressions hide problems and accumulate technical debt.

### 6. Quality Gates Are Binary

Report actual exit codes truthfully. Never rationalize failures as "expected" or "acceptable." Let the user decide whether to proceed.

### 7. Project Brief Overrides Template Code

The project brief (`generated-docs/specs/project-brief.md`) is the source of truth — not the starter-template code this repo was scaffolded from. When they conflict, **replace** the template code rather than extending or nesting on top of it (e.g., if the brief specifies a different provider stack than the template's root layout, replace the wrapper — don't wrap yours inside).

### 8. Test Quality Counts

`/quality-check` must pass before commit. Its testing gate scans test files for anti-patterns — even in `.skip`'d / `.todo` tests, and during TDD red phases. Tests are code; treat them with the same care as production.

### 9. TDD Workflow Enforcement

**Development work goes through the TDD workflow.** When the user asks you to build, create, add, change, fix, or implement anything — including casual phrasings like "make it look nice" or "tweak the header" — follow the `Action:` line the `workflow-guard.ps1` hook injects at the top of every prompt (typically a redirect to `/start` or `/continue`).

**Not a development request** (don't redirect): questions about how things work; reading or explaining existing code; running `/status` / `/dashboard` / `/quality-check`; git operations; conversation during an active `/start` or `/continue` flow.

**When in doubt, redirect.** Better to enter the workflow and discover the request is small than to write untracked code outside it.

### 10. Every Story Needs a Playwright Spec

Every routable story must have a Playwright spec at `web/e2e/epic-<N>-story-<M>-<slug>.spec.ts` with at least one live `test()` block. Non-routable stories still get a spec file, but the suite is wrapped in `test.fixme()` with a one-line reason comment. `test.fixme()` is forbidden on routable specs — `test-generator` self-validates this before returning, and `run-e2e-verification.js` routes any drift through the existing fix cycle.

### 11. Prefer Dedicated Tools Over Bash

Use `Read` / `Grep` / `Glob` / `Edit` / `Write` for file content — never `cat`, `head`, `tail`, `grep`, `find`, `sed`, `awk`, `python`, `wc`, `cut`. Bash is for running things (`node`, `npm`, `npx`, `git`, `ls`) and for piping their output when it's long. See [.claude/policies/file-operations.md](.claude/policies/file-operations.md).

### 12. Tests Verify User-Observable Behavior

Tests verify **user-observable behavior**, not implementation. Conventions, the Vitest/Playwright/manual split, anti-patterns, budgets, and `test.fixme()` policy live in [.claude/policies/testing-policy.md](.claude/policies/testing-policy.md) — the single source of truth.

## Policies

- [Authentication Intake](.claude/policies/authentication-intake.md) — auth options are presented explicitly during INTAKE; never inferred or skipped
- [BFF Auth Pattern](.claude/policies/bff-auth-pattern.md) — security and Next.js integration shape for BFF auth stories
- [Compliance Intake](.claude/policies/compliance-intake.md) — compliance domains are surfaced as a blocking question during INTAKE
- [Styling Centralisation](.claude/policies/styling-centralisation.md) — all colours/fonts/spacing reference tokens in `globals.css`; no hex literals in components
