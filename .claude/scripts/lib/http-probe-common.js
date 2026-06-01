/**
 * http-probe-common.js
 *
 * Shared helpers for HTTP probe scripts under `.claude/scripts/`:
 *   - run-smoke-test.js (api-connectivity-agent's one-shot connectivity check)
 *   - run-auth-probe.js (INTAKE auth + endpoint probe)
 *
 * Both scripts read a JSON config, substitute ${VAR} placeholders from an
 * envFile, and emit a single-line JSON result on stdout.
 *
 * httpRequest() is the single HTTP entry point. Both consumers pass a pre-built
 * URL string and a body-byte cap; smoke-test composes its URL from baseUrl +
 * pathSuffix, auth-probe already has a full URL. Cookies are exposed via
 * response.headers['set-cookie'] (Node's array form), so no separate field.
 */
'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { URL } = require('url');

function bail(message) {
  process.stdout.write(
    JSON.stringify({ status: 'error', errorMessage: message }) + '\n',
  );
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--config') args.config = argv[++i];
    else if (flag === '--help' || flag === '-h') args.help = true;
    else bail(`Unknown argument: ${flag}`);
  }
  return args;
}

function parseEnvFile(filePath) {
  if (!filePath) return {};
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    bail(`Cannot read envFile ${filePath}: ${err.message}`);
  }
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const declaration = trimmed.startsWith('export ')
      ? trimmed.slice(7).trimStart()
      : trimmed;
    const eq = declaration.indexOf('=');
    if (eq <= 0) continue;
    const key = declaration.slice(0, eq).trim();
    const rawValue = declaration.slice(eq + 1).trim();
    // Strip surrounding quotes before any inner-whitespace trim, so a quoted
    // value like KEY="  abc  " preserves its interior whitespace.
    let value;
    if (
      rawValue.length >= 2 &&
      ((rawValue.startsWith('"') && rawValue.endsWith('"')) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'")))
    ) {
      value = rawValue.slice(1, -1);
    } else {
      value = rawValue;
    }
    out[key] = value;
  }
  return out;
}

// envFile is authoritative for credentials; process.env fills in only what's
// missing (e.g., a system-wide var). Keeps `.env.local` the single source of truth.
function loadEnv(filePath) {
  const env = parseEnvFile(filePath);
  for (const [k, v] of Object.entries(process.env)) {
    if (!Object.prototype.hasOwnProperty.call(env, k)) env[k] = v;
  }
  return env;
}

const PLACEHOLDER_RE = /\$\{([A-Z_][A-Z0-9_]*)\}|\$([A-Z_][A-Z0-9_]*)/g;

function findPlaceholders(template) {
  const names = new Set();
  if (typeof template !== 'string') return [];
  PLACEHOLDER_RE.lastIndex = 0;
  let match;
  while ((match = PLACEHOLDER_RE.exec(template)) !== null) {
    names.add(match[1] || match[2]);
  }
  return [...names];
}

function substitute(template, env) {
  if (typeof template !== 'string') return template;
  return template.replace(PLACEHOLDER_RE, (_full, a, b) => {
    const name = a || b;
    return Object.prototype.hasOwnProperty.call(env, name) ? env[name] : '';
  });
}

function writeFileEnsuringDir(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

// Single HTTP entry point used by both probe scripts.
// Returns:
//   error  -> { ok: false, errorCode, errorMessage, elapsedMs }
//   success-> { ok: true, httpStatus, responseHeaders, body, bodyTruncated, elapsedMs }
// `responseHeaders['set-cookie']` is Node's array form — callers parse cookies from there.
function httpRequest({ url, method, headers, body, timeoutMs, maxBodyBytes }) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      return resolve({
        ok: false,
        errorCode: 'INVALID_URL',
        errorMessage: `Invalid URL: ${url} (${e.message})`,
      });
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const reqHeaders = Object.assign({}, headers);
    if (body && !reqHeaders['Content-Length']) {
      reqHeaders['Content-Length'] = Buffer.byteLength(body);
    }
    const cap = Number.isFinite(maxBodyBytes) && maxBodyBytes > 0 ? maxBodyBytes : 64 * 1024;
    const startedAt = Date.now();
    let received = 0;
    let truncated = false;
    // Hoisted: error/end handlers reference `timer` before its assignment;
    // `let` in TDZ would ReferenceError on any synchronous-error path.
    let timer = null;

    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        method: method || 'GET',
        path: parsed.pathname + parsed.search,
        headers: reqHeaders,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => {
          if (received >= cap) {
            truncated = true;
            return;
          }
          const remaining = cap - received;
          if (c.length <= remaining) {
            chunks.push(c);
            received += c.length;
          } else {
            // Cap reached: keep the slice we have and drain the rest silently.
            // Calling req.destroy() here can abort with ERR_STREAM_PREMATURE_CLOSE
            // before `end` fires, losing the body and leaking the wallclock timer.
            chunks.push(c.subarray(0, remaining));
            received = cap;
            truncated = true;
          }
        });
        res.on('end', () => {
          clearTimeout(timer);
          resolve({
            ok: true,
            httpStatus: res.statusCode,
            responseHeaders: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
            bodyTruncated: truncated,
            elapsedMs: Date.now() - startedAt,
          });
        });
      },
    );
    req.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        errorCode: err.code || 'REQUEST_ERROR',
        errorMessage: err.message,
        elapsedMs: Date.now() - startedAt,
      });
    });
    // Wall-clock timeout via setTimeout — covers DNS + connect, which
    // req.setTimeout (socket-idle) does not. Without this, a wedged DNS
    // lookup hangs ~75s.
    if (timeoutMs && Number.isFinite(timeoutMs)) {
      timer = setTimeout(() => {
        const err = new Error(`Request timed out after ${timeoutMs}ms`);
        err.code = 'ETIMEDOUT';
        req.destroy(err);
      }, timeoutMs);
    }
    if (body) req.write(body);
    req.end();
  });
}

module.exports = {
  bail,
  parseArgs,
  loadEnv,
  findPlaceholders,
  substitute,
  writeFileEnsuringDir,
  httpRequest,
};
