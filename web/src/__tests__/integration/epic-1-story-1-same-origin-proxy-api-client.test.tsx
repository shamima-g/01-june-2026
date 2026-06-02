/**
 * Story Metadata:
 * - Epic 1, Story 1: Same-origin proxy and dual-backend API client wiring
 * - Route: null (infrastructure-only — no page; verified via module contract)
 * - Target Files:
 *     web/src/app/api/[...proxy]/route.ts   (new proxy route handler)
 *     web/src/lib/api/client.ts             (rewired to same-origin /api/* + credentials)
 * - Page Action: create_new (proxy) + modify_existing (client)
 *
 * Failing-first (TDD red) tests defining the executable acceptance criteria for
 * the dual-backend same-origin proxy and the rewired API client.
 *
 * Requirements: NFR7 (same-origin proxy mandatory), R1 (auth foundation).
 *
 * Why these are unit/integration tests rather than Playwright: the behaviour
 * under test is request *forwarding* and *response transformation*, not browser
 * navigation. The route handler's actual runtime interception of browser
 * requests is Runtime-only and is folded into the manual checklist; here we pin
 * the forwarding/transform contract with stubbed fetch so regressions surface in
 * CI. Per testing-policy §"Test at the layer where the behaviour lives", the
 * proxy/client logic lives in Node code, so Vitest is the correct layer.
 *
 * The API client is the code under test, so `global.fetch` is stubbed directly
 * (the "mock @/lib/api/client" convention applies to *consumer* tests, not to
 * the client's own contract tests — mirroring the existing api-client.test.ts).
 */
import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';

// Production imports — these WILL FAIL until implemented (TDD red).
import { GET as proxyGet, POST as proxyPost } from '@/app/api/[...proxy]/route';
import { get, post } from '@/lib/api/client';
import type { APIError } from '@/types/api';
import {
  createTransactionsEnvelope,
  createMockTransaction,
} from '../helpers/epic-1-mock-data';

/**
 * Builds the `{ params }` context Next.js App Router passes to a catch-all
 * route handler. Next 15+ delivers params as a Promise; the handler awaits it.
 */
function proxyContext(segments: string[]) {
  return { params: Promise.resolve({ proxy: segments }) };
}

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** Reads the forwarded target URL out of the first fetch call as a string. */
function forwardedUrl(fetchMock: Mock): string {
  const arg = fetchMock.mock.calls[0]?.[0];
  return typeof arg === 'string' ? arg : (arg as Request).url;
}

/** Reads the forwarded fetch init (headers / credentials) from the first call. */
function forwardedInit(fetchMock: Mock): RequestInit {
  return (fetchMock.mock.calls[0]?.[1] ?? {}) as RequestInit;
}

describe('Epic 1 Story 1: same-origin proxy + dual-backend API client', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    // SERVER-ONLY backend origins (no NEXT_PUBLIC_ prefix — see route.ts /
    // constants.ts: these must never be inlined into the browser bundle).
    vi.stubEnv('AUTH_API_BASE_URL', 'http://localhost:10010');
    vi.stubEnv('API_BASE_URL', 'http://localhost:10005/transactions-api');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // AC-1 — /api/auth/* forwarded to the auth backend with the session cookie attached.
  // Runtime-only: real browser→handler interception verified during manual checklist.
  it('forwards /api/auth/* to the auth backend (10010) carrying the session cookie', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    const request = new Request('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { cookie: 'session=abc123' },
      body: JSON.stringify({ Username: 'u', Password: 'p' }),
    });

    await proxyPost(request, proxyContext(['auth', 'login']));

    expect(forwardedUrl(fetchMock)).toBe(
      'http://localhost:10010/v1/auth/login',
    );
    const headers = new Headers(forwardedInit(fetchMock).headers);
    expect(headers.get('cookie')).toContain('session=abc123');
  });

  // AC-1 (response side) — the upstream login Set-Cookie must reach the proxy
  // response so the session cookie lands in the browser same-origin. The
  // request-side cookie forwarding above only covers one half of the bidirectional
  // relay (project-brief §4 / NFR7); this asserts the outward Set-Cookie too.
  it('relays a single upstream Set-Cookie back on the proxy response', async () => {
    const upstream = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie':
          'session=abc123; HttpOnly; Secure; SameSite=Strict; Path=/',
      },
    });
    fetchMock.mockResolvedValueOnce(upstream);

    const request = new Request('http://localhost:3000/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ Username: 'u', Password: 'p' }),
    });

    const response = await proxyPost(request, proxyContext(['auth', 'login']));

    const relayed = response.headers.getSetCookie();
    expect(relayed.length).toBe(1);
    expect(relayed[0]).toContain('session=abc123');
    expect(relayed[0]).toContain('HttpOnly');
    expect(relayed[0]).toContain('SameSite=Strict');
  });

  // AC-1 (multi-cookie relay) — when the upstream sets MULTIPLE Set-Cookie
  // headers, each must survive as a distinct cookie on the proxy response.
  // WHATWG Headers.get('set-cookie') comma-folds them into one corrupted
  // string; the proxy must use getSetCookie() + append() to preserve them.
  it('preserves multiple upstream Set-Cookie headers as separate cookies', async () => {
    // A raw upstream Response carrying two Set-Cookie headers. Headers is
    // constructed from an entries array so both Set-Cookie values are retained
    // discretely (an object literal would collapse the duplicate key).
    const upstream = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: new Headers([
        ['content-type', 'application/json'],
        ['set-cookie', 'session=abc123; HttpOnly; SameSite=Strict; Path=/'],
        ['set-cookie', 'csrf=tok987; SameSite=Strict; Path=/'],
      ]),
    });
    fetchMock.mockResolvedValueOnce(upstream);

    const request = new Request('http://localhost:3000/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ Username: 'u', Password: 'p' }),
    });

    const response = await proxyPost(request, proxyContext(['auth', 'login']));

    const relayed = response.headers.getSetCookie();
    expect(relayed.length).toBe(2);
    expect(relayed.some((c) => c.includes('session=abc123'))).toBe(true);
    expect(relayed.some((c) => c.includes('csrf=tok987'))).toBe(true);
    // Neither cookie should have been comma-folded into the other.
    expect(relayed.every((c) => !c.includes(', '))).toBe(true);
  });

  // AC-2 — /api/transactions/* forwarded to the transactions backend, /transactions-api prefix preserved.
  // Runtime-only: real browser→handler interception verified during manual checklist.
  it('forwards /api/transactions/* to the transactions backend (10005) preserving the /transactions-api prefix', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(createTransactionsEnvelope()));

    const request = new Request(
      'http://localhost:3000/api/transactions/v1/transactions',
      { method: 'GET', headers: { cookie: 'session=abc123' } },
    );

    await proxyGet(
      request,
      proxyContext(['transactions', 'v1', 'transactions']),
    );

    expect(forwardedUrl(fetchMock)).toBe(
      'http://localhost:10005/transactions-api/v1/transactions',
    );
  });

  // AC-2 (file-logs always-on filter) — proxy forces ?IsActive=Yes on the file-logs endpoint.
  // Runtime-only: real browser→handler interception verified during manual checklist.
  it('always appends ?IsActive=Yes when forwarding the file-logs endpoint', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ FileLog: [] }));

    const request = new Request(
      'http://localhost:3000/api/transactions/v1/file-logs',
      { method: 'GET', headers: { cookie: 'session=abc123' } },
    );

    await proxyGet(request, proxyContext(['transactions', 'v1', 'file-logs']));

    const url = new URL(forwardedUrl(fetchMock));
    expect(url.pathname).toBe('/transactions-api/v1/file-logs');
    expect(url.searchParams.get('IsActive')).toBe('Yes');
  });

  // AC-3 — the API client issues same-origin /api/* calls and sends credentials on every request.
  it('issues GET to a same-origin /api/* path with credentials included', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(createTransactionsEnvelope()));

    await get('/api/transactions/v1/transactions');

    const url = forwardedUrl(fetchMock);
    // Same-origin: a relative/absolute path under /api, never a cross-origin backend host.
    expect(url).toContain('/api/transactions/v1/transactions');
    expect(url).not.toContain('localhost:10005');
    expect(url).not.toContain('localhost:10010');
    expect(forwardedInit(fetchMock).credentials).toBe('include');
  });

  // AC-3 — credentials also accompany mutating (POST) requests.
  it('sends credentials on POST requests as well', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ Id: 1, MessageType: 'SUCCESS', Messages: [] }),
    );

    await post('/api/auth/login', { Username: 'u', Password: 'p' });

    const url = forwardedUrl(fetchMock);
    expect(url).toContain('/api/auth/login');
    expect(url).not.toContain('localhost:10010');
    expect(forwardedInit(fetchMock).credentials).toBe('include');
  });

  // AC-4 — collection responses are unwrapped from their PascalCase single-key envelope.
  it('unwraps a PascalCase single-key collection envelope to a bare array for callers', async () => {
    const items = [
      createMockTransaction({ Id: 1, Reference: 'TXN-20260415-0001' }),
      createMockTransaction({ Id: 2, Reference: 'TXN-20260415-0002' }),
    ];
    fetchMock.mockResolvedValueOnce(
      jsonResponse(createTransactionsEnvelope(items)),
    );

    const result = await get<typeof items>('/api/transactions/v1/transactions');

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0].Reference).toBe('TXN-20260415-0001');
    expect(result[1].Id).toBe(2);
  });

  // AC-5 — a backend error response surfaces as a typed APIError, not a raw Response/throw.
  it('surfaces a backend error response as a typed APIError carrying the status code', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ Messages: ['Session expired'] }, { status: 401 }),
    );

    await expect(get('/api/transactions/v1/transactions')).rejects.toEqual(
      expect.objectContaining({
        statusCode: 401,
        message: expect.any(String),
      } satisfies Partial<APIError>),
    );
  });

  // AC-5 — an unreachable backend (network failure) surfaces as a typed APIError, not a raw TypeError.
  it('surfaces an unreachable backend as a typed APIError rather than a raw network throw', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    let caught: unknown;
    try {
      await get('/api/transactions/v1/transactions');
    } catch (error) {
      caught = error;
    }

    expect(caught).not.toBeInstanceOf(TypeError);
    const apiError = caught as APIError;
    expect(apiError.statusCode).toBe(0);
    expect(apiError.message).toMatch(/network/i);
  });
});
