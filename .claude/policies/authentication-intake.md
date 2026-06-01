# Authentication Intake Policy

## Core Principle

Authentication is a critical architectural decision. **Never simplify, fold, or skip authentication questions during INTAKE.** Always present the full set of options explicitly, even when the answer seems obvious from existing documentation.

There are **two distinct auth concerns** in INTAKE — keep them separate:

1. **User-facing auth** (how end users sign in) — covered by the rules below.
2. **Backend API auth** (how the frontend authenticates to a backend service) — covered by the "Backend API Auth" section at the end of this file. This concern is owned by the `api-connectivity-agent` (spec-analysis Call A in `/start` Step 4 + smoke-test Call B in `/start` Step 6 of `/start`), but the policy lives here so reviewers see both halves of the auth picture in one place.

---

## Mandatory Rules

1. **Always ask the explicit authentication question** with all three options:
   - "Backend For Frontend (BFF)" — with description of what it means
   - "Frontend-only (next-auth)" — with description and trade-off warning
   - "Custom" — with open-ended follow-up

2. **Never infer the auth method** from API specs, documentation, or other context. The user must explicitly choose.

3. **Never fold auth into a simpler question.** Do not combine it with other questions or rephrase it as "How will authentication work?" — use the exact options above.

4. **If BFF is selected**, always ask the three follow-up sub-questions (login URL, userinfo URL, logout URL), display the backend requirements note, and surface the **CI implication**: CI cannot reach the BFF, so the Performance quality gate runs Lighthouse against mocks (`NEXT_PUBLIC_USE_MOCK_API=true` in `.github/workflows/pr-checks.yml`). Accessibility and Best Practices are meaningful; Performance numbers are not. For real-backend audits, point Lighthouse at a reachable staging URL via `LIGHTHOUSE_TARGET_URL` (see `web/lighthouserc.js`).

5. **If frontend-only is selected**, always display the trade-off warning about backend API calls not carrying session context.

6. **If Custom is selected**, always ask the open-ended follow-up for full details.

## Rationale

Authentication architecture affects every layer of the application — routing, middleware, API client configuration, session management, and security. Skimming over it leads to incorrect assumptions that are expensive to fix later. Even when documentation hints at an answer, the user must confirm explicitly.

---

## Backend API Auth (`/start` Step 6 — `api-connectivity-agent` smoke test)

This section governs how the *frontend* authenticates to the *backend API* — a separate concern from how end users sign in. Even when user-facing auth is handled by a BFF (so end users never see backend tokens), the dev environment usually still needs a way to call the backend during local development and integration testing. Skipping this question is the single most common cause of "first API call fails" later in the workflow.

### Mandatory rules

1. **Always run the connectivity check at `/start` Step 6** (Call B smoke test), except when `dataSource` is `mock-only` or `new-api`. Do not let the user opt out of the *check itself* — they can opt out of supplying credentials (which captures Shape 3 in the manifest), but the agent must still parse the spec and persist what it found.

2. **Source `securitySchemes` from the OpenAPI spec** when one exists. Don't ask the user to repeat what the spec already declares. Surface what was found and confirm.

3. **Never accept credential VALUES via chat.** Per [CLAUDE.md §1](../../CLAUDE.md), session logs are committed to git. Credentials must move through `web/.env.local` (gitignored) only. The agent reads env var presence, never values.

4. **Capture env var NAMES in the manifest, never values.** `context.backendConnectivity.credentialEnvVars` is an array of names like `["API_TOKEN"]`. Values are read at runtime by the API client via `process.env`.

5. **Run a real curl smoke test when the backend is reachable.** Don't accept "looks fine in the spec" as proof. A 2xx round-trip is the proof.

6. **Distinguish failure categories.** A 401 means something different than a connection refused. The agent's `category` field maps to a specific remediation question — never use a generic "API call failed" message.

7. **Cap retries at 3 attempts.** After three failures, persist Shape 3 (unverified) and let the user proceed to PLAN. Do not block the workflow on a backend that genuinely isn't ready yet — that's what the warning and the `api-smoke-test.sh` artifact are for.

8. **Save the artifact even on failure.** `generated-docs/context/api-smoke-test.sh` is a useful starting point for the user to debug independently, regardless of outcome.

9. **Curl-fallback secret handling.** When the user pastes an example curl as a fallback (`/start` Step 6 — see "Curl-fallback usage" below), literal credentials in the pasted curl ARE accepted but MUST be moved to `web/.env.local` and replaced with `${VAR_NAME}` placeholders before any agent output, manifest write, or artifact generation. The agent must set `redactedLiteralsDetected: true` in its return so the orchestrator surfaces a rotation warning to the user — the original message containing the literal is in `.claude/logs/*.md`, which is committed to git per [CLAUDE.md §1](../../CLAUDE.md). This is the ONLY pathway by which a literal credential is ever moved through the agent; bare credential pastes (without curl context) are still refused per Rule 3.

### What "captured but unverified" means

When the user hits the 3-attempt cap and proceeds anyway, the manifest gets Shape 3 (`smokeTest.verifiedStatus: null`, `warning: "..."`). Downstream agents must treat this as a real signal:

- The `developer` agent should not assume the backend is reachable. If a story implementation needs a real backend call, surface the warning to the user before writing code that depends on it.
- `/api-status` displays the warning prominently when Shape 3 is present.
- `/api-go-live` re-runs the captured smoke test against the URL the user is going live with **before** flipping `NEXT_PUBLIC_USE_MOCK_API` off. A non-2xx blocks the flip by default; the user can override with "Flip anyway," which persists a warning to `backendConnectivity.warning` so `/api-status` continues to surface it.

### Curl-fallback usage

When the spec-driven smoke test cannot run cleanly, the orchestrator offers the user the option to paste a working curl. This is a **remediation path**, not a first-class entry point — the spec remains the primary source of truth when present and usable.

**Triggers (per Step 6 in `start.md`):**

- `curlFallbackRecommended: true` from Call A — set by the agent when `specStatus: missing`, when no safe-to-probe `GET` endpoint exists, or when the spec is so partial that auth + base URL are both unresolvable.
- `result: credentials_missing` — env vars not set; the user can paste a curl with literals as an alternative to manually populating `.env.local`.
- `result: failure` with `shouldRetry: true` — for any category (`dns`, `connection_refused`, `auth_invalid`, `forbidden`, `not_found`, `curl_parse_error`). "Paste a working curl instead" is always one of the AskUserQuestion options alongside the category-specific remediation.
- `result: skipped` — after a deferred Shape 1 or Shape 3 write, the user can verify connectivity by pasting a curl. The agent overwrites the existing shape based on the curl-driven smoke-test result.

**User behaviour:**

- **Recommended:** Replace credential values with `$ENV_VAR_NAME` placeholders before pasting (e.g., `Authorization: Bearer $API_TOKEN`). The agent records the env var names; the user fills `web/.env.local` themselves. Nothing sensitive enters the chat transcript.
- **Fallback (per Rule 9):** Paste the real curl as-is. The agent auto-redacts each literal credential to `web/.env.local`, rewrites the curl with placeholders for all subsequent persistence, and flags the rotation requirement to the orchestrator.

**Persistence:** The curl-fallback path always persists `sourceMethod: "user_curl"` and the redacted `userCurlExample` in `context.backendConnectivity` (Shape 2 or Shape 3). Downstream agents — particularly `developer`, `/api-status`, `/api-go-live`, and `/api-mock-refresh` — can re-run the smoke test from the captured curl without re-prompting the user.

---

## Auth + Endpoint Probe (optional sub-step, INTAKE Step 6)

After the connectivity smoke test, optionally run an authenticated probe that captures real response shapes per `GET` endpoint. Catches bugs like missing `credentials: 'include'`, field-casing drift, and spec-vs-reality type mismatches before any code is written.

**Gating:** `dataSource: existing-api` AND `authMethod ∈ {bff, custom-session-based}` only. Skipped for `mock-only` and `new-api`.

**AUQ (appended to Step 6 question set):**

> *"Do you have a test user we can use to verify the auth chain and capture real API response shapes? If yes, put `TEST_USERNAME` and `TEST_PASSWORD` in `web/.env.local` (gitignored). The probe logs in once, makes a few read-only calls, never stores the password. Skip if no test account, MFA-required, or prefer manual verification."*

Options: **Yes, probe** / **Skip — verify manually** / **Paste a session cookie instead** (routes to existing curl-fallback).

**Operational rules:**

1. Credentials follow Rules 3–4 above (env var names in manifest, never values). Probe reads env var presence; `run-auth-probe.js` substitutes in-memory and forgets.
2. **1 attempt per INTAKE session** — account-lockout risk. Re-run requires explicit user action via `/api-status` or `/api-mock-refresh`.
3. **`GET`-only beyond login.** No `POST`/`PUT`/`DELETE`. Safe-to-probe filter excludes endpoints needing path params or required-no-default query params.
4. **2-minute wallclock cap.** On cap → mark `incomplete`, write partial report, continue.
5. **MFA / SSO challenge** → route to curl-fallback (Rule 9 above). Probe re-runs with captured cookie, skipping login.
6. **Side-effect honesty in the AUQ text:** *"This will log in once. Logs that login like any other; read-only beyond login."*

**Persistence:**

- Structural summary → `generated-docs/context/api-shape-report.md` (committed, no PII). Always at this path — no manifest field needed.
- Raw response bodies → `generated-docs/fixtures/` (gitignored by the project's `.gitignore` rule — contain real data).
- Manifest fields: `context.backendConnectivity.authProbe { reason, credentialEnvVars, sessionEstablished, endpointsProbed, driftCount, probedAt }`, `fixturesCaptured`, and `context.testInfrastructure.playwrightMockingDefault` (one of `msw | page-route-with-shape-report | page-route-with-spec`, derived from `mockHandlers` + probe outcome). `authProbe.reason` carries the performed/skipped signal — `user-declined` means not performed, `success` means performed.

**Failure categories (each gets a distinct remediation):** login 401 → bad creds; login 200 without `Set-Cookie` → architectural mismatch (Tier 4 HALT); protected GET 401 → bug-1 surface, report clearly; protected GET 403 → record `requires_other_role`, continue; protected GET 404 → record `endpoint_not_found`.
