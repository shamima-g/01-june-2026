#!/usr/bin/env node
/**
 * PreToolUse hook that blocks Write/Edit/MultiEdit on generated documents
 * whose filenames don't match the conventions in
 * .claude/shared/generated-doc-conventions.json.
 *
 * Classification (see schema.matching.description):
 *   OK        — filename matches a convention's filenamePattern (and its dirGlob).
 *   DRIFT     — filename matches a convention's badPattern but NOT its filenamePattern.
 *   UNGOVERNED — neither pattern matches in any convention; not this hook's concern.
 *
 * Exit codes:
 *   0 without output — fall through to normal permission system (allow).
 *   2 with stderr message — block the tool call.
 *
 * Grandfather clause: existing files on disk are allowed regardless of name —
 * this hook only stops NEW drift, not edits to legacy files. The repo-wide
 * validator (validate-generated-doc-names.js) still flags them.
 *
 * Location: .claude/hooks/enforce-generated-doc-names.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const GATED_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);

function fallThrough() { process.exit(0); }
function block(msg) { process.stderr.write(msg + '\n'); process.exit(2); }
function normalize(p) { return p.replace(/\\/g, '/'); }

function dirGlobToRegex(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  const trimmed = escaped.replace(/\/$/, '');
  return new RegExp('^' + trimmed + '/?$');
}

// --- Read stdin ------------------------------------------------------------
let inputJson;
try {
  inputJson = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  fallThrough();
}

if (!GATED_TOOLS.has(inputJson.tool_name)) fallThrough();

const filePath = inputJson.tool_input?.file_path;
if (!filePath) fallThrough();

const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const absPath = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);
const relPath = normalize(path.relative(projectRoot, absPath));

if (!relPath.startsWith('generated-docs/') && !relPath.startsWith('web/e2e/')) {
  fallThrough();
}

// Grandfather: existing files bypass enforcement.
if (fs.existsSync(absPath)) fallThrough();

// --- Load schema -----------------------------------------------------------
const schemaPath = path.join(projectRoot, '.claude', 'shared', 'generated-doc-conventions.json');
let schema;
try {
  schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
} catch {
  // Fail open — validator will flag schema issues separately.
  fallThrough();
}

const basename = path.basename(relPath);
const parentDir = normalize(path.dirname(relPath)) + '/';

let driftMatches = [];

for (const c of schema.conventions || []) {
  if (!dirGlobToRegex(c.dirGlob).test(parentDir)) continue;

  if (new RegExp(c.filenamePattern).test(basename)) {
    // OK for this convention — allow.
    fallThrough();
  }
  if (c.badPattern && new RegExp(c.badPattern).test(basename)) {
    driftMatches.push(c);
  }
}

if (driftMatches.length === 0) {
  // No convention classes this as drift — ungoverned, allow.
  fallThrough();
}

// --- Block with guidance ---------------------------------------------------
const lines = [
  'Blocked by filename-convention guard: .claude/hooks/enforce-generated-doc-names.js',
  '',
  `  Attempted write: ${relPath}`,
  '',
  'This filename matches a known drift pattern. Expected shape:',
  '',
];
for (const c of driftMatches) {
  lines.push(`  [${c.id}]`);
  lines.push(`    Correct pattern: ${c.filenamePattern}`);
  lines.push(`    Good:  ${c.example}`);
  lines.push(`    Bad:   ${c.counterexample}`);
  lines.push(`    Why:   ${c.rationale}`);
  lines.push('');
}
lines.push(
  'Retry with a filename that matches the correct pattern above.',
  'Full rule table: .claude/shared/naming-conventions.md'
);

block(lines.join('\n'));
