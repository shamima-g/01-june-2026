# Project Brief: [name]

<!--
This document is the single Gate 1 artifact for INTAKE — the user approves it and BUILD proceeds.
The brief is the single source of truth for PLAN and BUILD.

Conventions:
- Roles, permissions, auth, data source, and compliance are recorded as facts (not stratified by confidence)
- Requirements are testable statements numbered continuously: R1..Rn, BR1..BRn, NFR1..NFRn
- Compliance obligations are bulleted by domain
- Hex literals appear here directly (Tailwind v4 oklch approximations are unreliable for brand fidelity)

Filename contract: this file lives at `generated-docs/specs/project-brief.md`.
It is committed at the end of INTAKE before EPICS.
The orchestrator presents this file to the user for Gate 1 approval.
BUILD agents update this file inline for factual additions; halt for changed requirements.
-->

| Field | Value |
|---|---|
| Project name | [name] |
| Intake source | [docs / prototype / guided-qa] |
| Backend connectivity | [verified / deferred / mock-only / no-backend] |
| Generated | [ISO 8601 timestamp] |

---

## 1. Goal

[2–3 sentences: what this project does and for whom. Sourced from the user's project description, BRD, or genesis.md. Avoid implementation detail — the rest of the brief covers that.]

---

## 2. Roles & Permissions

**Template:** `[saas-standard | internal-tool | marketplace | editorial | custom]`

[For non-custom templates: emit the full permissions matrix from `.claude/shared/roles-snippets.md` for the selected template. For custom: emit a minimal matrix with the user's role list and a single "View main dashboard" row — BUILD agents extend per-story.]

| Permission | [Role 1] | [Role 2] | [Role 3] | [Role 4] |
|---|---|---|---|---|
| [permission] | ✓ | ✓ | | |
| ... | | | | |

> Permissions can be extended during BUILD as new stories surface new actions — see [agent-autonomy.md](../shared/agent-autonomy.md). Permission additions land here inline; permission removals or role-set changes halt for user review.

---

## 3. Authentication

| Field | Value |
|---|---|
| Method | `[bff / frontend-only / custom]` |
| BFF login endpoint (if BFF) | [URL] |
| BFF userinfo endpoint (if BFF) | [URL] |
| BFF logout endpoint (if BFF) | [URL] |
| Custom auth notes (if custom) | [free-text description] |

> Auth method is never inferred — the user must confirm explicitly per [authentication-intake.md](../policies/authentication-intake.md).

---

## 4. Data Source & Backend Integration

| Field | Value |
|---|---|
| `dataSource` | `[existing-api / new-api / api-in-development / mock-only]` |
| Backend status | `[running / in-development / N/A]` |
| Mock layer required | [yes / no] |

### Backend connectivity (when applicable)

<!-- Mirror of `context.backendConnectivity` from the intake manifest. Populated when api-connectivity-agent ran and returned Shape 2 (verified) or Shape 3 (captured but unverified). Omit this subsection when dataSource is `mock-only` or `new-api`. -->

| Aspect | Value |
|---|---|
| Base URL | [from manifest `backendConnectivity.baseUrl`] |
| Auth scheme | [bearer / apiKey / basic / oauth2-client-creds / cookie / none / custom] |
| Auth header | [e.g. `Authorization`] |
| Auth value format | [e.g. `Bearer {token}`] |
| Credential env vars | [e.g. `API_TOKEN` — names only, never values] |
| Smoke-test endpoint | [e.g. `GET /v1/users/me`] |
| Smoke-test status | [verified / null-deferred] |
| CORS / proxy notes | [e.g. "Backend host differs from localhost — Next.js rewrite proxy needed"] |

---

## 5. Compliance

**Applicable domains:** `[list, e.g., ["pci-dss", "gdpr"]]` (or "None" if empty)
**Region (if Personal data applies):** [ZA / UK / EU / US / CA / AU / IE / multiple]

### Compliance Requirements

<!-- One bullet per applicable-domain obligation, expanded from compliance-intake.md §"Per-Domain `[INFERRED]` Assumptions". If `complianceDomains` is empty, this section reads: "No compliance domains were identified during intake screening." Bullets carry the obligation; downstream agents reference by domain. -->

- [Compliance obligation — e.g., "Payment handling MUST use third-party hosted fields (Stripe / Adyen / PayFast pattern); no raw card data on our servers (PCI-DSS)"]
- [...]

---

## 6. Data Model

<!-- Derive from OpenAPI `components.schemas`, genesis.md §Data Structures, or prototype data files. Format as a compact entity → fields → relationships summary. Cap at ~10 entries here; emit `+N additional entries — see <source file> for full detail` if more exist. -->

| Entity | Key Fields | Relationships |
|---|---|---|
| [entity] | [field1, field2, ...] | [belongs to X, has many Y] |

---

## 7. Functional Requirements

<!-- Each R is a testable statement. Number continuously (R1..Rn). Source for each row recorded in §13 Source Traceability. -->

- **R1:** [Testable requirement statement — e.g., "When an API call fails, the user sees an error message and a 'Retry' button"]
- **R2:** [...]

---

## 8. Business Rules

<!-- Each BR is an explicit condition + outcome. Number continuously (BR1..BRn). -->

- **BR1:** [Explicit condition and outcome — e.g., "Only users with role `admin` can access `/settings`; viewers are redirected to `/`"]
- **BR2:** [...]

---

## 9. Key Workflows

<!-- Primary user journeys + error/edge paths. Each workflow is a numbered list of steps. Derive from prototype task flows, genesis.md §Task Flows, or BRD use cases. -->

### [Workflow Name]

1. User does X
2. System responds with Y
3. ...

### [Workflow Name — error path]

1. User does X with invalid input
2. System shows error Z

---

## 10. Non-Functional Requirements

<!-- Industry-baseline NFRs always emitted; connectivity-derived NFRs added when relevant. -->

- **NFR1:** Accessibility — WCAG 2.1 Level AA baseline
- **NFR2:** Performance — First Contentful Paint < 2.5s on a mid-tier mobile network
- **NFR3:** Responsive design — mobile (≥360px) / tablet (≥768px) / desktop (≥1280px) breakpoints
- **NFR4:** Browser support — latest two versions of Chrome / Edge / Firefox / Safari
- **NFR5:** Error UX — user-visible error states with retry affordance for all async operations

<!-- Add connectivity-derived NFRs when present:
- NFR6: Next.js rewrite proxy required (CORS headers absent on backend)
- NFR7: Dev environment requires VPN / internal-network access
-->

---

## 11. Styling & Branding

| Field | Value |
|---|---|
| Primary brand color | `#XXXXXX` <!-- Raw hex — Tailwind v4 oklch approximation drifts from brand --> |
| Accent / secondary | `#XXXXXX` |
| Background (light) | `#XXXXXX` |
| Background (dark, if applicable) | `#XXXXXX` |
| Font family (headings) | [e.g., Inter] |
| Font family (body) | [e.g., system stack] |
| Theme | [light only / dark only / both] |
| Source | [prototype tokens.css / BRD branding section / defaulted] |

> Component-specific styling (button radii, card shadows, etc.) emerges during BUILD. This section captures only palette intent and typography per [styling-centralisation.md](../policies/styling-centralisation.md).

---

## 12. Out of Scope

<!-- Explicit list of what this project does NOT include. Reduces churn during BUILD when the agent surfaces "should I add X?" -->

- [Explicit exclusion 1]
- [Explicit exclusion 2]

---

## 13. Notes & Caveats

<!--
Optional. Present only when the intake-agent has flagged items the user should review carefully:
- Prototype assumptions that may not apply in production (mock APIs, localStorage, simplified auth)
- Data structure mismatches between sources (genesis vs OpenAPI)
- Unrecognized headings in genesis.md the agent couldn't categorize
- Multi-prototype detection (user picked one; the others are listed here for awareness)
- Any other "you might want to look at this" item

If no notes apply, omit this section entirely.
-->

- [Item the user should review]
