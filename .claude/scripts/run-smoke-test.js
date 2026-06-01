#!/usr/bin/env node
/**
 * run-smoke-test.js
 * Executes a single HTTP smoke test for api-connectivity-agent.
 *
 * Lives under .claude/scripts/ so `node .claude/scripts/*.js` is auto-approved by the
 * bash-permission-checker hook — the agent can run a smoke test in one call instead
 * of several permission-gated bash steps.
 *
 * Usage:
 *   node .claude/scripts/run-smoke-test.js --config <path-to-config.json>
 *
 * Config JSON shape:
 *   {
 *     "attempt": 1,
 *     "baseUrl": "http://localhost:4423",
 *     "method": "GET",
 *     "path": "/v1/health",
 *     "headers": [
 *       { "name": "Authorization", "valueTemplate": "Bearer ${API_TOKEN}" },
 *       { "name": "Cookie",        "valueTemplate": "session=${API_SESSION_COOKIE}" }
 *     ],
 *     "body": null,                                              // null, or string
 *     "envFile": "web/.env.local",                               // file to source for ${VAR} expansion
 *     "timeoutMs": 10000,
 *     "writeShellArtifact": "generated-docs/context/api-smoke-test.sh",  // null disables
 *     "bodyExcerptLimit": 500
 *   }
 *
 * Security invariants:
 *   - Credential VALUES never appear in stdout, the `.sh` artifact, or returned JSON.
 *     The script reads env values from envFile in-memory, substitutes them into header
 *     values for the HTTP call, and then forgets them.
 *   - The `.sh` artifact contains env var REFERENCES (`${API_TOKEN}`), not values.
 *   - If a required env var is unset, the script returns `result: "credentials_missing"`
 *     listing the unset names — without ever printing the (absent) values.
 *
 * Output (single-line JSON to stdout — agent parses this):
 *   {
 *     "status": "completed" | "error",
 *     "result": "success" | "failure" | "warning" | "credentials_missing",
 *     "category": "none" | "dns" | "connection_refused" | "timeout"
 *                | "auth_invalid" | "forbidden" | "not_found"
 *                | "shape_mismatch" | "tls" | "other",
 *     "httpStatus": <number|null>,
 *     "bodyExcerpt": "<first N chars, never includes credentials>",
 *     "bodyTruncated": <boolean — true if response exceeded the in-memory cap>,
 *     "elapsedMs": <number>,
 *     "missingCredentials": ["API_TOKEN", ...],
 *     "errorMessage": "<string|null>",
 *     "shellArtifactPath": "<path|null>",
 *     "corsAccessControlAllowOrigin": "<header value|null>"
 *   }
 *
 * Errors (config invalid, etc.) exit code 1 with `{ status: "error", errorMessage: ... }`.
 */
'use strict';

const fs = require('fs');
const { URL } = require('url');
const {
  bail,
  parseArgs,
  loadEnv,
  findPlaceholders,
  substitute,
  writeFileEnsuringDir,
  httpRequest,
} = require('./lib/http-probe-common');

function help() {
  console.log(`run-smoke-test.js — Execute one HTTP smoke test for api-connectivity-agent

Usage:
  node .claude/scripts/run-smoke-test.js --config <path-to-config.json>

Reads the config JSON, substitutes \${VAR} placeholders from the envFile, executes
the HTTP request, and prints a single-line JSON result to stdout. Optionally writes
a re-runnable bash artifact with env-var references (never values).
`);
  process.exit(0);
}

// Concatenate base.pathname + suffix instead of `new URL(suffix, base)`, which drops
// the base path when the suffix starts with `/` (e.g. base=`http://x/api` + suffix=`/v1/h`
// would resolve to `http://x/v1/h`, dropping `/api`).
function composeUrl(baseUrl, pathSuffix) {
  const parsed = new URL(baseUrl);
  const basePath = parsed.pathname.replace(/\/$/, '');
  const fullPath = (basePath + (pathSuffix || '') + parsed.search) || '/';
  return `${parsed.protocol}//${parsed.host}${fullPath}`;
}

// Categorisation mirrors api-connectivity-agent.md Step 4 — keep in sync.
function categorise(result) {
  if (!result.ok) {
    const code = result.errorCode || '';
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { result: 'failure', category: 'dns' };
    if (code === 'ECONNREFUSED') return { result: 'failure', category: 'connection_refused' };
    if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return { result: 'failure', category: 'timeout' };
    if (code.startsWith('ERR_TLS_') || code === 'CERT_HAS_EXPIRED' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
      return { result: 'failure', category: 'tls' };
    }
    return { result: 'failure', category: 'other' };
  }
  const s = result.httpStatus;
  if (typeof s !== 'number') return { result: 'failure', category: 'other' };
  if (s >= 200 && s < 300) {
    // 2xx with empty body on a status that should carry one (anything but 204/205) is
    // the "shape_mismatch" warning the agent doc calls out — flag for follow-up but
    // don't fail the test outright.
    const hasBody = typeof result.body === 'string' && result.body.trim() !== '';
    if (!hasBody && s !== 204 && s !== 205) return { result: 'warning', category: 'shape_mismatch' };
    return { result: 'success', category: 'none' };
  }
  if (s === 401) return { result: 'failure', category: 'auth_invalid' };
  if (s === 403) return { result: 'failure', category: 'forbidden' };
  if (s === 404) return { result: 'failure', category: 'not_found' };
  return { result: 'failure', category: 'other' };
}

// Shell artifact contains env-var references only — never values.
function buildShellArtifact({ baseUrl, method, pathSuffix, headers, body }) {
  const lines = [
    '#!/usr/bin/env bash',
    '# Re-runnable connectivity smoke test',
    '# Generated by .claude/scripts/run-smoke-test.js. Do not commit credentials.',
    '# Usage: ( set -a; . web/.env.local; set +a; bash generated-docs/context/api-smoke-test.sh )',
    'set -u',
    `BASE_URL="${baseUrl}"`,
  ];
  // Declare any env vars referenced in header templates so the script fails loudly if unset
  const referenced = new Set();
  for (const h of headers || []) {
    for (const name of findPlaceholders(h.valueTemplate)) referenced.add(name);
  }
  for (const name of referenced) {
    lines.push(`: "\${${name}:?${name} must be set in web/.env.local}"`);
  }
  const curlParts = ['curl', '-sS', '-o', '/tmp/smoke-body', '-w', '"%{http_code}\\n"'];
  if (method && method !== 'GET') curlParts.push('-X', method);
  for (const h of headers || []) {
    curlParts.push('-H', `"${h.name}: ${h.valueTemplate}"`);
  }
  if (body) {
    // Body must reach curl as the literal string the live request sent — wrap in
    // single quotes and escape embedded `'` via the standard `'\''` dance.
    const shellEscaped = String(body).replace(/'/g, "'\\''");
    curlParts.push('--data', `'${shellEscaped}'`);
  }
  curlParts.push(`"$BASE_URL${pathSuffix || ''}"`);
  lines.push(curlParts.join(' \\\n  '));
  return lines.join('\n') + '\n';
}

function emitResult(fields) {
  process.stdout.write(
    JSON.stringify({
      status: 'completed',
      result: null,
      category: 'none',
      httpStatus: null,
      bodyExcerpt: null,
      bodyTruncated: false,
      elapsedMs: 0,
      missingCredentials: [],
      errorMessage: null,
      shellArtifactPath: null,
      corsAccessControlAllowOrigin: null,
      ...fields,
    }) + '\n'
  );
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

  const env = loadEnv(config.envFile);

  // Resolve placeholders & track missing credentials
  const referenced = new Set();
  const resolvedHeaders = [];
  for (const h of config.headers || []) {
    for (const name of findPlaceholders(h.valueTemplate)) referenced.add(name);
    resolvedHeaders.push({ name: h.name, value: substitute(h.valueTemplate, env) });
  }
  const missingCredentials = [...referenced].filter((n) => !env[n] || env[n] === '');

  // Always write the shell artifact (re-runnable) — references only, no values
  let shellArtifactPath = null;
  if (config.writeShellArtifact) {
    shellArtifactPath = config.writeShellArtifact;
    try {
      writeFileEnsuringDir(
        shellArtifactPath,
        buildShellArtifact({
          baseUrl: config.baseUrl,
          method: config.method,
          pathSuffix: config.path,
          headers: config.headers,
          body: config.body,
        })
      );
    } catch (err) {
      process.stderr.write(
        `[run-smoke-test] Could not write shell artifact at ${shellArtifactPath}: ${err.message}\n`
      );
      shellArtifactPath = null;
    }
  }

  if (missingCredentials.length > 0) {
    emitResult({ result: 'credentials_missing', missingCredentials, shellArtifactPath });
    return;
  }

  const bodyExcerptLimit = Number.isFinite(config.bodyExcerptLimit) ? config.bodyExcerptLimit : 500;
  // Cap buffered bytes so a huge response can't OOM the runner; we only surface
  // the first bodyExcerptLimit chars anyway, but keep a floor for diagnostics.
  const maxBodyBytes = Math.max(bodyExcerptLimit * 4, 64 * 1024);
  let url;
  try {
    url = composeUrl(config.baseUrl, config.path || '');
  } catch (e) {
    return bail(`Invalid baseUrl: ${config.baseUrl} (${e.message})`);
  }
  const headerMap = {};
  for (const h of resolvedHeaders) headerMap[h.name] = h.value;
  const reqResult = await httpRequest({
    url,
    method: config.method || 'GET',
    headers: headerMap,
    body: config.body || null,
    timeoutMs: Number.isFinite(config.timeoutMs) ? config.timeoutMs : 10000,
    maxBodyBytes,
  });
  const verdict = categorise(reqResult);

  const bodyExcerpt = reqResult.body ? reqResult.body.slice(0, bodyExcerptLimit) : null;
  const corsHeader =
    (reqResult.responseHeaders && reqResult.responseHeaders['access-control-allow-origin']) || null;

  emitResult({
    result: verdict.result,
    category: verdict.category,
    httpStatus: reqResult.httpStatus ?? null,
    bodyExcerpt,
    bodyTruncated: reqResult.bodyTruncated ?? false,
    elapsedMs: reqResult.elapsedMs ?? 0,
    errorMessage: reqResult.ok ? null : reqResult.errorMessage || null,
    shellArtifactPath,
    corsAccessControlAllowOrigin: corsHeader,
  });
})().catch((e) => bail(`Unhandled: ${e.message}`));
