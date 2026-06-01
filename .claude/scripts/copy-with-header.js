#!/usr/bin/env node
/**
 * copy-with-header.js
 * Copies a file to a destination, prepending a source-traceability header line.
 *
 * Usage:
 *   node .claude/scripts/copy-with-header.js --from <source> --to <dest>
 *   node .claude/scripts/copy-with-header.js --from <source> --to <dest> --header "Custom header"
 *   node .claude/scripts/copy-with-header.js --help
 *
 * Purpose:
 *   When on-demand BUILD agents bake user-provided artifacts (API specs, design tokens, etc.)
 *   into the project, this script copies them from documentation/ to generated-docs/specs/
 *   with a traceability header.
 *   This script replaces raw bash commands (which require manual permission approval)
 *   and is auto-approved by the bash-permission-checker hook.
 *
 * Behavior:
 *   - Reads the source file
 *   - Prepends "# Source: <from-path>" (or custom --header text) as the first line
 *   - Creates destination directories if needed
 *   - Writes to the destination path
 *   - Outputs JSON result
 *
 * Security:
 *   - Destination must be under generated-docs/ (enforced)
 *   - Source must exist and be a file (not a directory)
 */

const fs = require('fs');
const path = require('path');

// Binary file types that should be copied without a header
const BINARY_EXTENSIONS = new Set(['.pen', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf']);

function showHelp() {
  console.log(`
copy-with-header.js — Copy a file with a source-traceability header

Usage:
  node .claude/scripts/copy-with-header.js --from <source> --to <dest>
  node .claude/scripts/copy-with-header.js --from <source> --to <dest> --header "Custom header"

Options:
  --from <path>     Source file path (required)
  --to <path>       Destination file path (required, must be under generated-docs/)
  --header <text>   Custom header line (default: "# Source: <from-path>")
  --help            Show this help message

Examples:
  node .claude/scripts/copy-with-header.js --from "documentation/Api Definition.yaml" --to "generated-docs/specs/api-spec.yaml"
  node .claude/scripts/copy-with-header.js --from "documentation/design-tokens.css" --to "generated-docs/specs/design-tokens.css" --header "/* Source: documentation/design-tokens.css */"
`);
  process.exit(0);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let fromPath = null;
  let toPath = null;
  let header = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') {
      showHelp();
    } else if (args[i] === '--from' && args[i + 1]) {
      fromPath = args[i + 1];
      i++;
    } else if (args[i] === '--to' && args[i + 1]) {
      toPath = args[i + 1];
      i++;
    } else if (args[i] === '--header' && args[i + 1]) {
      header = args[i + 1];
      i++;
    }
  }

  return { fromPath, toPath, header };
}

function fail(message, suggestion) {
  console.log(JSON.stringify({
    status: 'error',
    message,
    suggestion: suggestion || null
  }, null, 2));
  process.exit(1);
}

function main() {
  const { fromPath, toPath, header } = parseArgs();

  if (!fromPath) {
    fail(
      'Missing required --from argument.',
      'Usage: node .claude/scripts/copy-with-header.js --from <source> --to <dest>'
    );
  }

  if (!toPath) {
    fail(
      'Missing required --to argument.',
      'Usage: node .claude/scripts/copy-with-header.js --from <source> --to <dest>'
    );
  }

  // Resolve paths
  const resolvedFrom = path.resolve(fromPath);
  const resolvedTo = path.resolve(toPath);
  const projectRoot = path.resolve('.');

  // Security: destination must be under generated-docs/
  const generatedDocsDir = path.join(projectRoot, 'generated-docs');
  if (!resolvedTo.startsWith(generatedDocsDir + path.sep) && resolvedTo !== generatedDocsDir) {
    fail(
      `Destination must be under generated-docs/. Got: ${toPath}`,
      'The --to path must point to a location inside the generated-docs/ directory.'
    );
  }

  // Validate source exists and is a file
  let stat;
  try {
    stat = fs.statSync(resolvedFrom);
  } catch (err) {
    if (err.code === 'ENOENT') {
      fail(
        `Source file not found: ${fromPath}`,
        'Check the path and try again.'
      );
    }
    throw err;
  }

  if (!stat.isFile()) {
    fail(
      `Source is not a file: ${fromPath}`,
      'The --from path must point to a file, not a directory.'
    );
  }

  // Determine file type by extension for format-appropriate handling
  const ext = path.extname(fromPath).toLowerCase();
  const isBinary = BINARY_EXTENSIONS.has(ext);

  let headerLine = null;

  fs.mkdirSync(path.dirname(resolvedTo), { recursive: true });

  if (isBinary) {
    // Binary files: copy as-is, no header
    fs.copyFileSync(resolvedFrom, resolvedTo);
  } else if (ext === '.json') {
    // JSON doesn't support comments — copy as-is, no header
    fs.copyFileSync(resolvedFrom, resolvedTo);
  } else {
    // Text files: prepend format-appropriate header
    if (header) {
      headerLine = header;
    } else if (ext === '.css') {
      headerLine = `/* Source: ${fromPath} */`;
    } else if (ext === '.yaml' || ext === '.yml') {
      headerLine = `# Source: ${fromPath}`;
    } else {
      // Default: markdown/text comment style
      headerLine = `# Source: ${fromPath}`;
    }

    const content = fs.readFileSync(resolvedFrom, 'utf-8');
    const output = headerLine + '\n' + content;
    fs.writeFileSync(resolvedTo, output, 'utf-8');
  }

  const sizeKB = Math.round(stat.size / 1024);
  const noHeader = isBinary || ext === '.json';
  const label = noHeader
    ? `Copied ${fromPath} → ${toPath} (${isBinary ? 'binary' : 'JSON'} — no header)`
    : `Copied ${fromPath} → ${toPath} with source header`;

  console.log(JSON.stringify({
    status: 'ok',
    message: label,
    from: fromPath,
    to: toPath,
    header: headerLine,
    sizeKB
  }, null, 2));
}

try {
  main();
} catch (error) {
  if (error.code === 'EACCES' || error.code === 'EPERM') {
    fail(
      `Permission denied: ${error.path || error.message}`,
      'Check file permissions on the source and destination.'
    );
  } else if (error.code === 'ENOSPC') {
    fail('Disk space full.', 'Free up disk space and try again.');
  } else {
    fail(`Unexpected error: ${error.message}`);
  }
}
