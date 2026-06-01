#!/usr/bin/env node
/**
 * run-auth-probe.js
 *
 * Executes the INTAKE auth + endpoint probe — one login, one auth-chain
 * verification, then iterates safe-to-probe GET endpoints with a cookie jar.
 * Captures observed response shapes per endpoint and records drift vs the
 * declared spec shapes.
 *
 * Security invariants (mirror run-smoke-test.js):
 *   - Credential VALUES never appear in stdout, the .sh artifact, the shape
 *     report, the fixtures, or the returned JSON. Values are substituted
 *     in-memory and forgotten.
 *   - Env var REFERENCES (TEST_USERNAME, TEST_PASSWORD, etc.) are captured
 *     in the state file.
 *   - Account-safety: ONE login attempt per script invocation. No retries.
 *   - GET-only beyond login. Never POST/PUT/DELETE during endpoint iteration.
 *   - 2-minute wallclock cap. On cap, mark incomplete, write partial report.
 *
 * Usage:
 *   node .claude/scripts/run-auth-probe.js --config <path-to-config.json>
 *
 * Config JSON shape:
 *   {
 *     "envFile": "web/.env.local",
 *     "login": {
 *       "url": "http://localhost:10010/v1/auth/login",
 *       "method": "POST",
 *       "contentType": "application/json" | "application/x-www-form-urlencoded",
 *       "bodyTemplate": "{\"username\":\"${TEST_USERNAME}\",\"password\":\"${TEST_PASSWORD}\"}",
 *       "credentialEnvVars": ["TEST_USERNAME", "TEST_PASSWORD"]
 *     },
 *     "authChainProbe": {
 *       "url": "http://localhost:10010/v1/auth/userinfo",
 *       "method": "GET"
 *     },
 *     "endpoints": [
 *       {
 *         "baseUrl": "http://localhost:10005/transactions-api",
 *         "path": "/v1/file-logs",
 *         "method": "GET",
 *         "queryParams": { "IsActive": "Yes" },
 *         "specShape": { "FileLog": ["Id", "CurrentFileName", "..."] }
 *       }
 *     ],
 *     "logout": {
 *       "url": "http://localhost:10010/v1/auth/logout",
 *       "method": "POST"
 *     } | null,
 *     "outputs": {
 *       "shapeReport": "generated-docs/context/api-shape-report.md",
 *       "fixturesDir": "generated-docs/fixtures",
 *       "stateFile": "generated-docs/context/api-probe-state.json"
 *     },
 *     "limits": {
 *       "perEndpointTimeoutMs": 10000,
 *       "totalWallclockMs": 120000,
 *       "bodyExcerptLimit": 4096
 *     }
 *   }
 *
 * Output (single-line JSON to stdout):
 *   {
 *     "status": "complete" | "incomplete" | "failed" | "error",
 *     "result": "success" | "login-failed" | "mfa-required" | "sso-redirect"
 *             | "credentials-missing" | "auth-chain-failed" | "wallclock-exceeded"
 *             | "report-write-failed",
 *     "loginHttpStatus": <number|null>,
 *     "sessionEstablished": <bool>,
 *     "protectedEndpointStatus": <number|null>,
 *     "endpointsProbed": <count>,
 *     "endpointsSkipped": <count>,
 *     "driftCount": <count>,
 *     "missingCredentials": ["TEST_USERNAME", ...],
 *     "shapeReportPath": "<path|null>",
 *     "fixturesCaptured": <bool>,
 *     "stateFile": "<path>",
 *     "elapsedMs": <number>,
 *     "errorMessage": "<string|null>"
 *   }
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  bail,
  parseArgs,
  loadEnv,
  substitute,
  writeFileEnsuringDir,
  httpRequest,
} = require('./lib/http-probe-common');

function help() {
  console.log(
    `run-auth-probe.js — INTAKE auth + endpoint probe\n\nUsage:\n  node .claude/scripts/run-auth-probe.js --config <path-to-config.json>\n`,
  );
  process.exit(0);
}

// Minimal cookie jar — request-side only, no domain/path matching.
// Set-Cookie attributes are ignored: Max-Age=0 / Expires-in-past won't remove
// a cookie. Acceptable here because logout is the last call before exit.

function parseSetCookieHeaders(setCookieValues) {
  const cookies = {};
  const list = Array.isArray(setCookieValues) ? setCookieValues : [setCookieValues];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const firstSemi = raw.indexOf(';');
    const nameValue = firstSemi >= 0 ? raw.slice(0, firstSemi) : raw;
    const eq = nameValue.indexOf('=');
    if (eq <= 0) continue;
    const name = nameValue.slice(0, eq).trim();
    const value = nameValue.slice(eq + 1).trim();
    if (name) cookies[name] = value;
  }
  return cookies;
}

function cookieHeader(jar) {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

const MFA_KEYWORDS = ['mfa', 'otp', 'challenge', 'verify', 'totp', 'two-factor'];

function isMfaChallenge(body) {
  if (typeof body !== 'string') return false;
  const lower = body.toLowerCase();
  return MFA_KEYWORDS.some((kw) => lower.includes(kw));
}

function isSsoRedirect(statusCode, locationHeader) {
  if (statusCode < 300 || statusCode >= 400) return false;
  if (typeof locationHeader !== 'string') return false;
  // Any 3xx with a Location that is not same-origin is likely SSO.
  return /^https?:\/\//i.test(locationHeader);
}

function setCookiesOf(res) {
  return (res.responseHeaders && res.responseHeaders['set-cookie']) || [];
}

// Extract a flat structural summary: top-level field names + their leaf types,
// plus observed enum values for short string fields. List endpoints typically
// return { Wrapper: [...] }; we look one level deeper into the first element of
// any array-valued field so the shape report captures the row schema, not just
// the wrapper. Anything deeper than that is recorded as type-only.
function extractShape(value) {
  if (value === null || typeof value !== 'object') {
    return { type: value === null ? 'null' : typeof value, fields: {} };
  }
  if (Array.isArray(value)) {
    // Top-level array — describe the first row.
    const sample = value[0];
    if (sample && typeof sample === 'object' && !Array.isArray(sample)) {
      return { type: 'array', fields: summariseRowFields(sample) };
    }
    return { type: 'array', fields: {} };
  }
  // Object — record each top-level key, recursing one step into arrays of objects.
  const fields = {};
  for (const k of Object.keys(value).sort()) {
    const v = value[k];
    if (Array.isArray(v) && v[0] && typeof v[0] === 'object' && !Array.isArray(v[0])) {
      fields[k] = { type: 'array<object>', fields: summariseRowFields(v[0]) };
    } else {
      fields[k] = { type: leafType(v) };
    }
  }
  return { type: 'object', fields };
}

function summariseRowFields(row) {
  const out = {};
  for (const k of Object.keys(row).sort()) out[k] = { type: leafType(row[k]) };
  return out;
}

function leafType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

// Drift detection: compare observed top-level field names against the declared
// spec shape. Spec format: { "FieldName": "type" } or { "Wrapper": ["RowField1", "RowField2"] }.
function compareShapeToSpec(observed, spec) {
  if (!spec || typeof spec !== 'object') return [];
  const drift = [];
  const observedKeys = Object.keys(observed.fields || {});
  const specKeys = Object.keys(spec);
  for (const k of observedKeys) {
    if (!specKeys.includes(k)) {
      drift.push({ field: k, observed: observed.fields[k].type, spec: '(not in spec)', note: 'extra field returned by API' });
    }
  }
  for (const k of specKeys) {
    if (!observedKeys.includes(k)) {
      drift.push({ field: k, observed: '(missing)', spec: 'declared', note: 'spec declares field but response omits it' });
    }
  }
  return drift;
}

// Observed enum values for short string fields — captures things like
// status enums where the API returns values not in the spec.
function extractObservedEnums(value, maxValuesPerField = 5) {
  const seen = {};
  function walk(v) {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    for (const [k, val] of Object.entries(v)) {
      if (typeof val === 'string' && val.length > 0 && val.length <= 40) {
        if (!seen[k]) seen[k] = new Set();
        if (seen[k].size < maxValuesPerField) seen[k].add(val);
      } else if (val && typeof val === 'object') {
        walk(val);
      }
    }
  }
  walk(value);
  // Only return fields with multiple observed values (single-value strings aren't enums)
  // OR fields whose name suggests enum-ness (Status, Type, State).
  const out = {};
  for (const [k, vs] of Object.entries(seen)) {
    if (vs.size >= 2 || /(Status|Type|State|Direction)$/i.test(k)) {
      out[k] = vs;
    }
  }
  return out;
}

function sanitisePathForFilename(method, urlPath, queryParams) {
  // /v1/file-logs + ?IsActive=Yes -> get__v1_file-logs__IsActive-Yes.json
  const cleanedPath = urlPath.replace(/[^a-zA-Z0-9-]+/g, '_').replace(/^_+|_+$/g, '');
  const qpStr = queryParams
    ? Object.entries(queryParams)
        .map(([k, v]) => `${k}-${String(v).replace(/[^a-zA-Z0-9]+/g, '')}`)
        .join('_')
    : '';
  return [
    method.toLowerCase(),
    cleanedPath,
    qpStr,
  ]
    .filter(Boolean)
    .join('__') + '.json';
}

// Shape report is markdown — committed, no PII.
function renderShapeReport({ generatedAt, login, authChain, results, driftSummary }) {
  const lines = [];
  lines.push('# API Shape Report');
  lines.push('');
  lines.push(`Generated at: ${generatedAt}`);
  lines.push('');
  lines.push('Captured by the INTAKE auth + endpoint probe (`run-auth-probe.js`).');
  lines.push('No real values, no PII — only structural summaries (top-level keys, leaf types, observed enums).');
  lines.push('');
  lines.push('## Auth chain');
  lines.push('');
  lines.push(`- Login: ${login.method} ${login.url} → HTTP ${login.httpStatus} (${login.sessionEstablished ? 'session established' : 'no session'})`);
  lines.push(`- Protected probe: ${authChain.method} ${authChain.url} → HTTP ${authChain.httpStatus}`);
  lines.push('');
  lines.push('## Endpoints probed');
  lines.push('');
  if (results.length === 0) {
    lines.push('_(none — probe did not reach the endpoint-iteration step)_');
  }
  for (const r of results) {
    lines.push(`### ${r.method} ${r.path}${r.queryString || ''}`);
    lines.push('');
    lines.push(`- Status: ${r.outcome}${r.httpStatus ? ` (HTTP ${r.httpStatus})` : ''}`);
    if (r.outcome === 'success' || r.outcome === 'drift') {
      lines.push(`- Top-level keys: ${r.topLevelKeys.length ? r.topLevelKeys.map((k) => '`' + k + '`').join(', ') : '_(scalar / empty)_'}`);
      if (r.observedEnums && Object.keys(r.observedEnums).length > 0) {
        lines.push('- Observed enums:');
        for (const [field, values] of Object.entries(r.observedEnums)) {
          lines.push(`  - \`${field}\`: ${[...values].map((v) => '`' + v + '`').join(', ')}`);
        }
      }
    }
    if (r.drift && r.drift.length > 0) {
      lines.push('- **Drift vs spec:**');
      for (const d of r.drift) {
        lines.push(`  - \`${d.field}\` — ${d.note} (observed: ${d.observed}; spec: ${d.spec})`);
      }
    }
    if (r.fixturePath) {
      lines.push(`- Fixture (gitignored): \`${r.fixturePath}\``);
    }
    lines.push('');
  }
  if (driftSummary.length > 0) {
    lines.push('## Drift summary');
    lines.push('');
    for (const d of driftSummary) {
      lines.push(`- ${d}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

(async function main() {
  const args = parseArgs(process.argv);
  if (args.help) return help();
  if (!args.config) bail('Missing --config <path-to-config.json>');

  let config;
  try {
    config = JSON.parse(fs.readFileSync(args.config, 'utf8'));
  } catch (e) {
    return bail(`Cannot read config: ${e.message}`);
  }

  const startedAt = Date.now();
  const {
    stateFile = 'generated-docs/context/api-probe-state.json',
    shapeReport: shapeReportPath = 'generated-docs/context/api-shape-report.md',
    fixturesDir = 'generated-docs/fixtures',
  } = config.outputs || {};
  const isPos = (n) => Number.isFinite(n) && n > 0;
  const limits = config.limits || {};
  const perEndpointTimeoutMs = isPos(limits.perEndpointTimeoutMs) ? limits.perEndpointTimeoutMs : 10000;
  const totalWallclockMs = isPos(limits.totalWallclockMs) ? limits.totalWallclockMs : 120000;
  const bodyExcerptLimit = isPos(limits.bodyExcerptLimit) ? limits.bodyExcerptLimit : 4096;

  // Body-buffer caps per probe type. Login/auth-chain can return modest payloads
  // (tokens, userinfo); endpoint responses are the ones we actually shape-analyse.
  const LOGIN_BODY_CAP = bodyExcerptLimit * 2;
  const AUTH_CHAIN_BODY_CAP = bodyExcerptLimit * 2;
  const ENDPOINT_BODY_CAP = bodyExcerptLimit * 4;
  const LOGOUT_BODY_CAP = 1024;

  // Create the state-file directory once up front, then writeState() does a plain
  // writeFileSync each call. Avoids a stat+mkdir syscall per endpoint iteration.
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  } catch {
    // State file is progress reporting — failures don't change the probe outcome.
  }
  function writeState(state) {
    try {
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
    } catch {
      // State file is progress reporting — failures don't change the probe outcome.
    }
  }

  function emitFinal(fields) {
    const out = Object.assign(
      {
        status: 'complete',
        result: 'success',
        loginHttpStatus: null,
        sessionEstablished: false,
        protectedEndpointStatus: null,
        endpointsProbed: 0,
        endpointsSkipped: 0,
        driftCount: 0,
        missingCredentials: [],
        shapeReportPath: null,
        fixturesCaptured: false,
        stateFile,
        elapsedMs: Date.now() - startedAt,
        errorMessage: null,
      },
      fields,
    );
    writeState(Object.assign({}, out, { phase: out.status }));
    process.stdout.write(JSON.stringify(out) + '\n');
  }

  // ---- Load env, check credentials ----
  const env = loadEnv(config.envFile);
  const credNames = (config.login && config.login.credentialEnvVars) || [];
  const missingCredentials = credNames.filter((n) => !env[n] || env[n] === '');
  if (missingCredentials.length > 0) {
    return emitFinal({
      status: 'failed',
      result: 'credentials-missing',
      missingCredentials,
      errorMessage: `Set the following in ${config.envFile}: ${missingCredentials.join(', ')}`,
    });
  }

  writeState({
    phase: 'logging-in',
    startedAt: new Date(startedAt).toISOString(),
    endpointsTotal: (config.endpoints || []).length,
    endpointsCompleted: 0,
  });

  // ---- Login ----
  const loginBody = substitute(config.login.bodyTemplate || '', env);
  const loginHeaders = {
    'Content-Type': config.login.contentType || 'application/json',
  };
  const loginRes = await httpRequest({
    url: config.login.url,
    method: config.login.method || 'POST',
    headers: loginHeaders,
    body: loginBody,
    timeoutMs: perEndpointTimeoutMs,
    maxBodyBytes: LOGIN_BODY_CAP,
  });

  if (!loginRes.ok) {
    return emitFinal({
      status: 'failed',
      result: 'login-failed',
      errorMessage: `Login transport error: ${loginRes.errorMessage}`,
    });
  }

  // MFA / SSO detection
  if (isMfaChallenge(loginRes.body)) {
    return emitFinal({
      status: 'failed',
      result: 'mfa-required',
      loginHttpStatus: loginRes.httpStatus,
      errorMessage:
        'Login response suggests MFA is required. Use the cookie-paste fallback (curl-fallback path).',
    });
  }
  if (isSsoRedirect(loginRes.httpStatus || 0, loginRes.responseHeaders && loginRes.responseHeaders.location)) {
    return emitFinal({
      status: 'failed',
      result: 'sso-redirect',
      loginHttpStatus: loginRes.httpStatus,
      errorMessage: `Login redirected to ${loginRes.responseHeaders.location} — looks like SSO. Use the cookie-paste fallback.`,
    });
  }

  const cookieJar = parseSetCookieHeaders(setCookiesOf(loginRes));
  const sessionEstablished =
    loginRes.httpStatus >= 200 && loginRes.httpStatus < 300 && Object.keys(cookieJar).length > 0;

  if (!sessionEstablished) {
    if (loginRes.httpStatus === 401) {
      return emitFinal({
        status: 'failed',
        result: 'login-failed',
        loginHttpStatus: 401,
        errorMessage:
          'Login returned 401 — bad credentials. Verify env var values in ' + config.envFile,
      });
    }
    return emitFinal({
      status: 'failed',
      result: 'login-failed',
      loginHttpStatus: loginRes.httpStatus,
      sessionEstablished: false,
      errorMessage:
        loginRes.httpStatus >= 200 && loginRes.httpStatus < 300
          ? 'Login returned 2xx but no Set-Cookie — BFF may not be cookie-based (architectural mismatch).'
          : `Login returned HTTP ${loginRes.httpStatus}.`,
    });
  }

  writeState({
    phase: 'auth-chain-verify',
    sessionEstablished: true,
    endpointsTotal: (config.endpoints || []).length,
    endpointsCompleted: 0,
  });

  // ---- Auth-chain verification ----
  const authChainRes = await httpRequest({
    url: config.authChainProbe.url,
    method: config.authChainProbe.method || 'GET',
    headers: { Cookie: cookieHeader(cookieJar) },
    timeoutMs: perEndpointTimeoutMs,
    maxBodyBytes: AUTH_CHAIN_BODY_CAP,
  });
  // Some BFFs rotate the session on each request (sliding sessions, CSRF
  // double-submit). Merge any fresh Set-Cookie so subsequent probes don't 401.
  if (authChainRes.ok) {
    Object.assign(cookieJar, parseSetCookieHeaders(setCookiesOf(authChainRes)));
  }

  if (!authChainRes.ok || authChainRes.httpStatus !== 200) {
    // The 401-after-login case is the bug-1 surface — report explicitly.
    const isBug1 = authChainRes.ok && authChainRes.httpStatus === 401;
    return emitFinal({
      status: 'failed',
      result: 'auth-chain-failed',
      loginHttpStatus: loginRes.httpStatus,
      sessionEstablished: true,
      protectedEndpointStatus: authChainRes.httpStatus || null,
      errorMessage: isBug1
        ? 'Protected GET returned 401 even though login succeeded. The API client may be missing `credentials: \'include\'` or equivalent. Verify the fetch wrapper handles cross-origin cookies before BUILD.'
        : `Protected GET to ${config.authChainProbe.url} returned ${authChainRes.httpStatus || authChainRes.errorMessage}.`,
    });
  }

  // ---- Endpoint iteration ----
  const endpoints = config.endpoints || [];
  const results = [];
  let endpointsProbed = 0;
  let endpointsSkipped = 0;
  let driftCount = 0;
  let fixturesCaptured = false;
  const driftSummary = [];

  for (let i = 0; i < endpoints.length; i++) {
    // Worst-case overrun is one perEndpointTimeoutMs past the cap, since the
    // check happens before kicking off each request — accepted slack.
    if (Date.now() - startedAt >= totalWallclockMs) {
      const partialReport = renderShapeReport({
        generatedAt: new Date().toISOString(),
        login: { method: config.login.method, url: config.login.url, httpStatus: loginRes.httpStatus, sessionEstablished: true },
        authChain: { method: config.authChainProbe.method, url: config.authChainProbe.url, httpStatus: authChainRes.httpStatus },
        results,
        driftSummary,
      });
      try {
        writeFileEnsuringDir(shapeReportPath, partialReport);
      } catch (err) {
        process.stderr.write(
          `[run-auth-probe] Could not write partial shape report at ${shapeReportPath}: ${err.message}\n`,
        );
      }
      return emitFinal({
        status: 'incomplete',
        result: 'wallclock-exceeded',
        loginHttpStatus: loginRes.httpStatus,
        sessionEstablished: true,
        protectedEndpointStatus: authChainRes.httpStatus,
        endpointsProbed,
        endpointsSkipped: endpoints.length - i,
        driftCount,
        shapeReportPath,
        fixturesCaptured,
        errorMessage: `Total wallclock cap (${totalWallclockMs}ms) hit after ${endpointsProbed} endpoints.`,
      });
    }

    const ep = endpoints[i];
    const qs = ep.queryParams ? new URLSearchParams(ep.queryParams).toString() : '';
    const qpStr = qs ? '?' + qs : '';
    const fullUrl = ep.baseUrl + ep.path + qpStr;

    writeState({
      phase: 'probing-endpoints',
      sessionEstablished: true,
      endpointsTotal: endpoints.length,
      endpointsCompleted: i,
      currentEndpoint: `${ep.method} ${ep.path}${qpStr}`,
    });

    const epRes = await httpRequest({
      url: fullUrl,
      method: ep.method || 'GET',
      headers: { Cookie: cookieHeader(cookieJar) },
      timeoutMs: perEndpointTimeoutMs,
      maxBodyBytes: ENDPOINT_BODY_CAP,
    });
    if (epRes.ok) {
      Object.assign(cookieJar, parseSetCookieHeaders(setCookiesOf(epRes)));
    }

    const result = {
      method: ep.method || 'GET',
      path: ep.path,
      queryString: qpStr,
      outcome: 'unknown',
      httpStatus: epRes.ok ? epRes.httpStatus : null,
      topLevelKeys: [],
      observedEnums: {},
      drift: [],
      fixturePath: null,
    };

    if (!epRes.ok) {
      result.outcome = 'error';
      endpointsSkipped++;
    } else if (epRes.httpStatus === 403) {
      result.outcome = 'requires_other_role';
      endpointsSkipped++;
    } else if (epRes.httpStatus === 404) {
      result.outcome = 'endpoint_not_found';
      endpointsSkipped++;
    } else if (epRes.httpStatus >= 200 && epRes.httpStatus < 300) {
      endpointsProbed++;
      let parsed = null;
      try {
        parsed = JSON.parse(epRes.body || '{}');
      } catch {
        // Non-JSON response — keep top-level info only.
      }
      if (parsed && typeof parsed === 'object') {
        const shape = extractShape(parsed);
        result.topLevelKeys = shape.type === 'object' ? Object.keys(shape.fields).sort() : [];
        result.observedEnums = extractObservedEnums(parsed);
        // Drift vs spec
        const driftEntries = compareShapeToSpec(shape, ep.specShape || null);
        if (driftEntries.length > 0) {
          result.drift = driftEntries;
          result.outcome = 'drift';
          driftCount += driftEntries.length;
          for (const d of driftEntries) {
            driftSummary.push(`${ep.method} ${ep.path}: \`${d.field}\` — ${d.note}`);
          }
        } else {
          result.outcome = 'success';
        }
        // Write fixture (raw body, gitignored).
        try {
          const fname = sanitisePathForFilename(ep.method || 'GET', ep.path, ep.queryParams);
          const fpath = fixturesDir.replace(/[\\/]+$/, '') + '/' + fname;
          writeFileEnsuringDir(fpath, JSON.stringify(parsed, null, 2));
          result.fixturePath = fpath;
          fixturesCaptured = true;
        } catch (err) {
          process.stderr.write(
            `[run-auth-probe] Could not write fixture for ${ep.method} ${ep.path}: ${err.message}\n`,
          );
        }
      } else {
        result.outcome = 'success';
      }
    } else {
      result.outcome = `http_${epRes.httpStatus}`;
      endpointsSkipped++;
    }

    results.push(result);
  }

  // ---- Optional logout ----
  if (config.logout && config.logout.url) {
    await httpRequest({
      url: config.logout.url,
      method: config.logout.method || 'POST',
      headers: { Cookie: cookieHeader(cookieJar) },
      timeoutMs: perEndpointTimeoutMs,
      maxBodyBytes: LOGOUT_BODY_CAP,
    });
  }

  // ---- Write final shape report ----
  const report = renderShapeReport({
    generatedAt: new Date().toISOString(),
    login: { method: config.login.method, url: config.login.url, httpStatus: loginRes.httpStatus, sessionEstablished: true },
    authChain: { method: config.authChainProbe.method, url: config.authChainProbe.url, httpStatus: authChainRes.httpStatus },
    results,
    driftSummary,
  });
  try {
    writeFileEnsuringDir(shapeReportPath, report);
  } catch (err) {
    return emitFinal({
      status: 'failed',
      result: 'report-write-failed',
      loginHttpStatus: loginRes.httpStatus,
      sessionEstablished: true,
      protectedEndpointStatus: authChainRes.httpStatus,
      endpointsProbed,
      endpointsSkipped,
      driftCount,
      fixturesCaptured,
      errorMessage: `Could not write shape report at ${shapeReportPath}: ${err.message}`,
    });
  }

  emitFinal({
    status: 'complete',
    result: 'success',
    loginHttpStatus: loginRes.httpStatus,
    sessionEstablished: true,
    protectedEndpointStatus: authChainRes.httpStatus,
    endpointsProbed,
    endpointsSkipped,
    driftCount,
    shapeReportPath,
    fixturesCaptured,
  });
})().catch((e) => bail(`Unhandled: ${e && e.stack ? e.stack : e}`));
