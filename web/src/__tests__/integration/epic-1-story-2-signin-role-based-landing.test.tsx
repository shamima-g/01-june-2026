/**
 * Story Metadata:
 * - Epic 1, Story 2: Sign-in with role-based landing
 * - Route: /login
 * - Target Files:
 *     web/src/app/login/page.tsx   (new login page — email + password form)
 *     web/src/lib/auth/roles.ts    (new role → landing-route resolver + route constants)
 * - Page Action: create_new
 *
 * Failing-first (TDD red) tests for the sign-in form's NON-UI logic, which lives
 * in the React render and is therefore the Vitest layer (testing-policy §"Test at
 * the layer where the behaviour lives"):
 *   - the submitted-credential payload shape {Username, Password}      (AC-5)
 *   - the role-resolution → landing-route contract (role X → surface Y) (AC-5; AC-2/AC-3 logic)
 *   - 401 credential failure vs network/connectivity failure messaging  (R18)
 *
 * Requirements: R1 (login + role-specific landing), R18 (credential vs connectivity error).
 *
 * SPEC GAP (project-brief §13-E): `GET /v1/auth/userinfo` is UNCONFIRMED on the
 * running backend, so the role source is intentionally SWAPPABLE (userinfo, or a
 * `GET /v1/users` record matched to the signed-in username). These tests pin the
 * role-resolution CONTRACT — "resolved role X lands on surface Y" — WITHOUT
 * hard-coding which endpoint supplied the role: the role-source `get()` call is
 * stubbed by behaviour, not by path. AC-1–AC-4 (the live browser redirect chain,
 * real cookies, real form rendering across the round-trip) are covered by the
 * sibling Playwright spec; this file does not re-drive those E2E flows.
 *
 * Per testing-policy mocking strategy: only the HTTP client (@/lib/api/client)
 * and the Next.js navigation + toast boundaries are mocked. The login page and
 * the role resolver are the REAL code under test.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Production imports — these WILL FAIL until implemented (TDD red).
import LoginPage from '@/app/login/page';
import { LANDING_ROUTES, resolveLandingRoute } from '@/lib/auth/roles';
import { get, post } from '@/lib/api/client';
import type { APIError } from '@/types/api';
import {
  createLoginSuccessResponse,
  createMockUserInfo,
} from '../helpers/epic-1-mock-data';

// HTTP client — mocked per testing-policy (client.ts is never exercised here).
vi.mock('@/lib/api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
}));

// Navigation boundary — assert client-side push targets (jsdom-observable).
const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: pushMock, refresh: vi.fn() }),
  usePathname: () => '/login',
  useSearchParams: () => new URLSearchParams(),
}));

// Toast boundary — error surfacing reuses the shared toast system.
const showToastMock = vi.fn();
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({
    showToast: showToastMock,
    toasts: [],
    dismissToast: vi.fn(),
    clearAllToasts: vi.fn(),
  }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const mockGet = get as ReturnType<typeof vi.fn>;
const mockPost = post as ReturnType<typeof vi.fn>;

/** Builds a typed APIError as the client throws it (see client.ts handleErrorResponse). */
function apiError(statusCode: number, message: string): APIError {
  return {
    message,
    statusCode,
    details: [message],
    endpoint: '/api/auth/login',
  };
}

/** Fills the sign-in form and submits it. */
async function signIn(
  user: ReturnType<typeof userEvent.setup>,
  email: string,
  password: string,
) {
  await user.type(screen.getByLabelText(/email/i), email);
  await user.type(screen.getByLabelText(/password/i), password);
  await user.click(screen.getByRole('button', { name: /sign in/i }));
}

describe('Epic 1 Story 2: sign-in with role-based landing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // AC-5 — submitted credentials use the brief's field shape {Username, Password}
  // posted to the auth login path. The form's email/password inputs map onto the
  // PascalCase Username/Password keys the backend requires (project-brief §3/§9).
  it('posts credentials as {Username, Password} to the auth login endpoint', async () => {
    const user = userEvent.setup();
    mockPost.mockResolvedValue(createLoginSuccessResponse());
    mockGet.mockResolvedValue(createMockUserInfo('Approver'));

    render(<LoginPage />);
    await signIn(user, 'approver@example.com', 's3cret-pw');

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        expect.stringContaining('/api/auth/'),
        { Username: 'approver@example.com', Password: 's3cret-pw' },
      );
    });
  });

  // AC-5, AC-2 (logic) — after a successful login the role is resolved from the
  // available source and an Importer is routed to the file-import surface. The
  // role-source get() is stubbed by behaviour (returns an Importer), NOT pinned
  // to a specific endpoint — honouring the swappable-source spec gap (§13-E).
  it('routes a resolved Importer to the file-import surface after sign-in', async () => {
    const user = userEvent.setup();
    mockPost.mockResolvedValue(createLoginSuccessResponse());
    mockGet.mockResolvedValue(createMockUserInfo('Importer'));

    render(<LoginPage />);
    await signIn(user, 'importer@example.com', 'pw');

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith(LANDING_ROUTES.Importer);
    });
  });

  // AC-5, AC-3 (logic) — a resolved Approver is routed to the transactions surface.
  it('routes a resolved Approver to the transactions surface after sign-in', async () => {
    const user = userEvent.setup();
    mockPost.mockResolvedValue(createLoginSuccessResponse());
    mockGet.mockResolvedValue(createMockUserInfo('Approver'));

    render(<LoginPage />);
    await signIn(user, 'approver@example.com', 'pw');

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith(LANDING_ROUTES.Approver);
    });
  });

  // R18 — a 401 from the login endpoint surfaces a CREDENTIAL-failure message,
  // and the user is NOT navigated anywhere. The message must read as a bad
  // username/password, distinct from the connectivity wording asserted below.
  it('shows a credential-failure message (not connectivity) on a 401', async () => {
    const user = userEvent.setup();
    mockPost.mockRejectedValue(apiError(401, 'Unauthorized'));

    render(<LoginPage />);
    await signIn(user, 'wrong@example.com', 'bad-pw');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      /incorrect|invalid|credential|email or password/i,
    );
    expect(alert).not.toHaveTextContent(
      /connect|network|unreachable|try again later/i,
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  // R18 — a network/connectivity failure (client throws statusCode 0, /network/i)
  // surfaces a CONNECTIVITY-failure message distinct from the credential wording,
  // with no navigation. This is the other half of the §9 exception-path split.
  it('shows a connectivity-failure message (not credential) on a network error', async () => {
    const user = userEvent.setup();
    mockPost.mockRejectedValue(
      apiError(0, 'Network error: Unable to connect to the API server'),
    );

    render(<LoginPage />);
    await signIn(user, 'approver@example.com', 'pw');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/connect|network|unreachable|try again/i);
    expect(alert).not.toHaveTextContent(
      /incorrect password|invalid credential/i,
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  // AC-5 (resolver contract, source-agnostic) — the pure role → landing-route
  // resolver maps each known role to its stable surface constant and falls back
  // safely (never undefined) for an unknown/missing role. Pinning the contract
  // as a pure function keeps later epics (file-import in Epic 2, transactions in
  // Epic 3) aligned on the same route constants without an unconfirmed endpoint.
  it('resolves each role to its landing route with a safe fallback for unknown roles', () => {
    expect(resolveLandingRoute('Importer')).toBe(LANDING_ROUTES.Importer);
    expect(resolveLandingRoute('Approver')).toBe(LANDING_ROUTES.Approver);

    // Distinct surfaces per persona.
    expect(LANDING_ROUTES.Importer).not.toBe(LANDING_ROUTES.Approver);

    // Unknown / missing role must not crash routing — a defined fallback route.
    const fallback = resolveLandingRoute('SomeUnmappedRole');
    expect(typeof fallback).toBe('string');
    expect(fallback.startsWith('/')).toBe(true);
  });

  // NFR1 / WCAG 2.2 AA — the sign-in form has no axe violations on first paint.
  it('has no accessibility violations', async () => {
    render(<LoginPage />);
    // Form is present before any submit; assert the accessible labels exist.
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
