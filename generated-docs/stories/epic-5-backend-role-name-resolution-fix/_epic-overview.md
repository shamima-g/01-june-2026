# Epic 5 — Backend Role-Name Resolution Fix *(extension)*

> Map the live backend's role display-names ("File Importer", "Approver") to the app's canonical roles so Importers land on /files and regain their Upload/Retry/Cancel controls — a tolerant, extensible aliasing layer plus updated mocks and a regression test, no backend change.

**Requirements:** R1, BR9, BR10, BR11 (restored, not new)
**Depends on:** Epic 1 (owns `web/src/lib/auth/roles.ts`)
**epicIntroducesSharedSurface:** false
**Manual-test status:** pending

## Background
Manual testing against the live backend revealed the backend returns role display-names `"File Importer"` / `"Approver"` (via `GET /v1/auth/userinfo`, now confirmed live, and `GET /v1/users`), but the app matches only the exact canonical strings `"Importer"` / `"Approver"`. So an Importer is unrecognised → lands on `/transactions` and all Importer-only controls are hidden.

## Stories (build order)

### 1. Recognise the live backend's role display-names ("File Importer" / "Approver")
- **Route:** `/login` · **Target:** `web/src/lib/auth/roles.ts` · **modify_existing** · Roles: Importer, Approver
- **Requirements:** R1, BR9, BR10, BR11
- Add a tolerant (case-insensitive/trim) display-name → canonical-role alias (`"File Importer"`→Importer, `"Approver"`→Approver), applied across `readRole`/`resolveLandingRoute`/`asKnownRole`/`fetchSignedInRole`/`fetchCurrentRole`. Update the Vitest + Playwright role mocks to the **real** backend names and add a regression test. Contained to `roles.ts` — no caller changes.
- **ACs:** AC-1 alias resolves File Importer→Importer / Approver→Approver (vitest) · AC-2 resolveLandingRoute → /files for File Importer, /transactions for Approver, safe fallback (vitest) · AC-3 asKnownRole narrows both → RBAC gating on (vitest) · AC-4 Importer with backend role "File Importer" signs in → lands /files with Upload visible (playwright)

## Non-goals
- No backend change — the API keeps returning "File Importer" / "Approver"; the fix is entirely frontend.
- No new roles — canonical set stays Importer / Approver; the app just learns the backend's names for them.
- No change to the resolution sources/endpoints (userinfo → /v1/users) — only the name→role mapping changes.
- No role/user-management screens; no redesign of the role module.

## Critical test note
The existing Vitest helper (`epic-1-mock-data.ts`) and the per-spec Playwright `userRecord()` mocks return the **assumed** shorthand `"Importer"` — which is exactly why this bug slipped through. The story updates the Importer mock identity to emit the real `"File Importer"` name (Approver already matches) and adds a regression assertion, so the suite reflects production and the alias can't silently regress.
