/**
 * Same-origin dual-backend proxy (Epic 1, Story 1 — NFR7).
 *
 * The session cookie is `HttpOnly; Secure; SameSite=Strict`, and the two
 * backends live on separate origins (auth :10010, transactions :10005). A
 * direct cross-origin browser fetch would never attach the cookie, so EVERY
 * browser request must stay same-origin. This catch-all route handler is that
 * single same-origin surface: the browser calls `/api/*`, and we forward
 * server-side to the correct backend, relaying the `session` cookie in both
 * directions (request `Cookie` in, response `Set-Cookie` out).
 *
 * Routing by first path segment:
 *   /api/auth/*         -> ${AUTH_BASE}/v1/auth/<rest>      (auth backend)
 *   /api/transactions/* -> ${TX_BASE}/<rest>               (transactions backend,
 *                                                            /transactions-api
 *                                                            prefix is part of base)
 *
 * `GET /api/transactions/v1/file-logs` always carries `?IsActive=Yes` — the
 * live backend returns 400 without it (see project-brief §13.B). Forcing it
 * here means every Epic 2–4 caller inherits the correct behaviour for free.
 */

// SERVER-ONLY backend origins. These intentionally do NOT carry the
// NEXT_PUBLIC_ prefix: Next.js statically inlines NEXT_PUBLIC_* vars into the
// browser bundle, which would leak the real backend origins client-side and
// contradict the same-origin guarantee (NFR7). This proxy route handler — which
// only ever runs server-side — is the sole consumer of these values; the
// browser API client talks to same-origin '/api' (see lib/utils/constants.ts).
const AUTH_BASE = process.env.AUTH_API_BASE_URL ?? 'http://localhost:10010';
const TX_BASE =
  process.env.API_BASE_URL ?? 'http://localhost:10005/transactions-api';

type ProxyContext = { params: Promise<{ proxy: string[] }> };

/**
 * Builds the absolute backend target URL for a set of incoming `/api/*` path
 * segments, preserving the original query string and forcing `IsActive=Yes`
 * on the file-logs endpoint.
 */
function buildTargetUrl(segments: string[], incomingUrl: string): string {
  const [group, ...rest] = segments;
  const restPath = rest.join('/');

  let target: string;
  if (group === 'auth') {
    // Auth backend exposes everything under /v1/auth/*.
    target = `${AUTH_BASE}/v1/auth/${restPath}`;
  } else if (group === 'transactions') {
    // TX_BASE already includes the /transactions-api prefix — do not strip it.
    target = `${TX_BASE}/${restPath}`;
  } else {
    // Unknown group: forward to the transactions backend as a sensible default
    // so a misconfigured caller fails loudly against a real endpoint rather
    // than silently 404ing inside Next.js.
    target = `${TX_BASE}/${segments.join('/')}`;
  }

  const url = new URL(target);

  // Preserve any query params the caller sent.
  const incoming = new URL(incomingUrl);
  incoming.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  // Mandatory always-on filter for the file-logs endpoint (project-brief §13.B).
  if (group === 'transactions' && rest[rest.length - 1] === 'file-logs') {
    url.searchParams.set('IsActive', 'Yes');
  }

  return url.toString();
}

/**
 * Copies safe request headers to forward upstream. We relay the `Cookie`
 * header (carrying the `session` cookie) and `Content-Type`, but drop hop-by-hop
 * and host-specific headers that would confuse the upstream server.
 */
function buildForwardHeaders(request: Request): Headers {
  const headers = new Headers();
  const cookie = request.headers.get('cookie');
  if (cookie) {
    headers.set('cookie', cookie);
  }
  const contentType = request.headers.get('content-type');
  if (contentType) {
    headers.set('content-type', contentType);
  }
  const accept = request.headers.get('accept');
  if (accept) {
    headers.set('accept', accept);
  }
  const lastChangedUser = request.headers.get('lastchangeduser');
  if (lastChangedUser) {
    headers.set('LastChangedUser', lastChangedUser);
  }
  return headers;
}

/**
 * Forwards an incoming `/api/*` request to the matching backend and relays the
 * upstream response back to the browser, including any `Set-Cookie` (so the
 * login response's `session` cookie reaches the browser same-origin).
 */
async function proxy(
  request: Request,
  context: ProxyContext,
): Promise<Response> {
  const { proxy: segments } = await context.params;
  const target = buildTargetUrl(segments, request.url);

  const method = request.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';

  const upstream = await fetch(target, {
    method,
    headers: buildForwardHeaders(request),
    body: hasBody ? await request.arrayBuffer() : undefined,
  });

  // Relay the upstream response, preserving status, content-type and Set-Cookie.
  const responseHeaders = new Headers();
  const contentType = upstream.headers.get('content-type');
  if (contentType) {
    responseHeaders.set('content-type', contentType);
  }
  // Relay Set-Cookie. WHATWG `Headers.get('set-cookie')` comma-folds multiple
  // Set-Cookie headers into a single string, corrupting multi-cookie responses
  // (a comma is legal inside a cookie's Expires date, so folding is ambiguous).
  // `getSetCookie()` returns each Set-Cookie as a discrete array entry; append
  // them individually so the browser receives them as separate cookies.
  // Forwarding the session cookie outward is the proxy's core responsibility
  // (NFR7), so this path is hardened against multi-cookie folding.
  for (const setCookie of upstream.headers.getSetCookie()) {
    responseHeaders.append('set-cookie', setCookie);
  }

  const responseBody = await upstream.arrayBuffer();
  return new Response(responseBody, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export async function GET(request: Request, context: ProxyContext) {
  return proxy(request, context);
}

export async function POST(request: Request, context: ProxyContext) {
  return proxy(request, context);
}

export async function PUT(request: Request, context: ProxyContext) {
  return proxy(request, context);
}

export async function PATCH(request: Request, context: ProxyContext) {
  return proxy(request, context);
}

export async function DELETE(request: Request, context: ProxyContext) {
  return proxy(request, context);
}
