# Epic 1 — Authentication & Application Foundation

Sign-in with role-based landing, the dual-backend same-origin proxy and API client wiring, session lifecycle (idle/absolute timeout, lockout), and the shared status-badge and empty-state building blocks the screens reuse.

**Requirements:** R1, R16, R17, R18, NFR5, NFR6, NFR7
**Depends on:** none · **epicIntroducesSharedSurface:** false

## Stories

| # | Title | Route | Target file | Infra-only | Covers |
|---|---|---|---|---|---|
| 1 | Same-origin proxy and dual-backend API client wiring | — | `web/src/app/api/[...proxy]/route.ts` | yes | NFR7, R1 |
| 2 | Sign-in with role-based landing | `/login` | `web/src/app/login/page.tsx` | no | R1, R18 |
| 3 | Sign-out and session timeout lifecycle | — | `web/src/components/session/SessionManager.tsx` | no | R17, NFR6 |
| 4 | Account lockout after repeated failed sign-ins | `/login` | `web/src/app/login/page.tsx` (modify) | no | R18, NFR6 |
| 5 | Shared status badge and empty-state building blocks | — | `web/src/components/status-badge/StatusBadge.tsx` | no | R16, NFR5 |

## Spec gaps to resolve during BUILD

- **Story 2:** role resolution — `GET /v1/auth/userinfo` unconfirmed on running backend; fallback to login response body or `GET /v1/users`.
- **Story 4:** lockout response not documented in the auth spec; confirm whether lockout is backend-enforced (423/429) or client-tracked.

## Infrastructure reuse notes

- Extend the existing API client at `web/src/lib/api/client.ts` (rewire to same-origin `/api/*` proxy paths + `credentials:'include'`; drop header-token auth).
- Replace stale `API_BASE_URL` placeholder (`localhost:8042`) in `web/src/lib/utils/constants.ts`. Real origins live only in the route-handler proxy.
- Reuse the existing toast system (`web/src/contexts/ToastContext.tsx`, `useToast`, `ToastContainer`) for NFR5.
- Compose from existing Shadcn primitives (button, card, input, label); add more via shadcn MCP.
- Implement PascalCase-envelope unwrap and mandatory `?IsActive=Yes` on file-logs once in the client/proxy layer.

_No `documentation/prototype-src/` exists — no prototype-source enforcement for this epic._
