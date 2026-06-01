#!/usr/bin/env node

/**
 * Quality Gates Runner
 *
 * Runs all automated quality gates and outputs a JSON or text report.
 * Used by the code-reviewer agent during BUILD and by the /quality-check command.
 *
 * Gates run in PARALLEL by default for speed. Use --sequential to run one at a time.
 * Within Gate 3, tsc/lint/build also run concurrently.
 *
 * Run with --help for usage information.
 *
 * Note: Gate 1 (Functional/Manual) is handled by the agent, not this script.
 */

const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Constants
const TIMEOUTS = {
  COMMAND: 300000, // 5 minutes
  FULL_RUN: 600000, // 10 minutes
};
const OUTPUT_TRUNCATE_LENGTH = 500;
const ANSI_ESCAPE_PATTERN = /\x1b\[[0-9;]*m/g;

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

// Help text
const HELP_TEXT = `
Quality Gates Runner

Usage: node .claude/scripts/quality-gates.js [options]

Options:
  --auto-fix      Run auto-fixes before checks (format, lint:fix, audit fix)
  --json          Output results as JSON (for agent parsing)
  --include-perf  Include performance gate (Gate 5) - skipped by default locally
  --fail-fast     Stop on first gate failure
  --sequential    Run gates sequentially instead of in parallel
  --help          Show this help message

Gates checked (in parallel by default):
  Gate 2: Security - npm audit, security-validator.js
  Gate 3: Code Quality - Prettier, TypeScript, ESLint, Build (also parallel internally)
  Gate 4: Testing - Vitest, test-quality-validator.js
  Gate 5: Performance - Lighthouse (skipped locally by default)

Exit codes:
  0 - All gates pass
  1 - One or more gates fail
  2 - Script error
`;

// CLI options
const options = {
  autoFix: false,
  json: false,
  includePerf: false,
  failFast: false,
  sequential: false,
  help: false,
};

// Parse CLI arguments
for (const arg of process.argv.slice(2)) {
  if (arg === '--auto-fix') options.autoFix = true;
  else if (arg === '--json') options.json = true;
  else if (arg === '--include-perf') options.includePerf = true;
  else if (arg === '--fail-fast') options.failFast = true;
  else if (arg === '--sequential') options.sequential = true;
  else if (arg === '--help' || arg === '-h') options.help = true;
}

if (options.help) {
  console.log(HELP_TEXT);
  process.exit(0);
}

// Results structure
const results = {
  timestamp: new Date().toISOString(),
  autoFixesApplied: false,
  autoFixResults: {},
  gates: {
    gate2_security: { status: 'pending', checks: {} },
    gate3_codeQuality: { status: 'pending', checks: {} },
    gate4_testing: { status: 'pending', checks: {} },
    gate5_performance: { status: 'pending', checks: {} },
  },
  overallStatus: 'pending',
  failedGates: [],
  summary: {},
};

// Find web directory and project root
function findDirectories() {
  const cwd = process.cwd();
  let webDir = null;
  let projectRoot = cwd;

  // Check if we're already in the web directory
  if (fs.existsSync(path.join(cwd, 'package.json'))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'));
      if (pkg.name && pkg.dependencies?.next) {
        webDir = cwd;
        // We're in web/, so project root is the parent
        const parent = path.dirname(cwd);
        if (fs.existsSync(path.join(parent, '.claude')) || fs.existsSync(path.join(parent, '.github'))) {
          projectRoot = parent;
        }
      }
    } catch {
      // Invalid package.json, continue checking
    }
  }

  // Check if web/ subdirectory exists
  if (!webDir) {
    const webSubdir = path.join(cwd, 'web');
    if (fs.existsSync(path.join(webSubdir, 'package.json'))) {
      webDir = webSubdir;
      projectRoot = cwd;
    }
  }

  return { webDir, projectRoot };
}

// Validate that the web directory has required npm scripts
function validateWebDir(webDir) {
  const pkgPath = path.join(webDir, 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const requiredScripts = ['lint', 'build', 'test'];
    const missing = requiredScripts.filter((s) => !pkg.scripts?.[s]);
    if (missing.length > 0) {
      return { valid: false, error: `Missing required npm scripts: ${missing.join(', ')}` };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, error: `Cannot read package.json: ${err.message}` };
  }
}

// =============================================================================
// ASYNC COMMAND RUNNER
// =============================================================================

/**
 * Run a command asynchronously and capture result.
 * Supports AbortSignal for fail-fast cancellation.
 */
function runCommandAsync(cmd, cwd, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ success: false, output: 'Aborted (fail-fast)', exitCode: -1, aborted: true });
      return;
    }

    let onAbort;

    const child = exec(cmd, {
      cwd,
      encoding: 'utf-8',
      timeout: TIMEOUTS.COMMAND,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      env: { ...process.env, CI: 'true' },
    }, (error, stdout, stderr) => {
      if (onAbort) signal.removeEventListener('abort', onAbort);
      if (error) {
        const output = [stdout, stderr, error.message]
          .filter(Boolean)
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .join('\n');
        resolve({ success: false, output, exitCode: typeof error.code === 'number' ? error.code : 1 });
      } else {
        resolve({ success: true, output: (stdout || '').trim(), exitCode: 0 });
      }
    });

    if (signal) {
      onAbort = () => child.kill('SIGTERM');
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

// Synchronous runCommand for auto-fixes (must complete before gates)
function runCommand(cmd, cwd) {
  try {
    const output = execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: TIMEOUTS.COMMAND,
      env: { ...process.env, CI: 'true' },
    });
    return { success: true, output: output.trim(), exitCode: 0 };
  } catch (error) {
    const output = [error.stdout, error.stderr, error.message]
      .filter(Boolean)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .join('\n');
    return {
      success: false,
      output,
      exitCode: error.status || 1,
    };
  }
}

// =============================================================================
// LOG BUFFER — prevents interleaving during parallel execution
// =============================================================================

class LogBuffer {
  constructor() {
    this.lines = [];
  }

  log(msg) {
    if (!options.json) this.lines.push(msg);
  }

  section(title) {
    if (!options.json) {
      this.lines.push('');
      this.lines.push(`${colors.cyan}═══ ${title} ═══${colors.reset}`);
    }
  }

  check(name, passed, details = '') {
    if (!options.json) {
      const icon = passed ? `${colors.green}✓${colors.reset}` : `${colors.red}✗${colors.reset}`;
      const detailStr = details ? ` ${colors.dim}(${details})${colors.reset}` : '';
      this.lines.push(`  ${icon} ${name}${detailStr}`);
    }
  }

  flush() {
    for (const line of this.lines) {
      console.log(line);
    }
    this.lines = [];
  }
}

// Direct log functions (for sequential sections like auto-fix and summary)
function log(msg) {
  if (!options.json) console.log(msg);
}

function logSection(title) {
  if (!options.json) {
    console.log('');
    console.log(`${colors.cyan}═══ ${title} ═══${colors.reset}`);
  }
}

function logCheck(name, passed, details = '') {
  if (!options.json) {
    const icon = passed ? `${colors.green}✓${colors.reset}` : `${colors.red}✗${colors.reset}`;
    const detailStr = details ? ` ${colors.dim}(${details})${colors.reset}` : '';
    console.log(`  ${icon} ${name}${detailStr}`);
  }
}

// Run a validator script asynchronously
async function runValidatorScriptAsync(scriptPath, cwd, signal) {
  if (!fs.existsSync(scriptPath)) {
    return { status: 'skip', reason: 'Script not found', passed: true };
  }
  const result = await runCommandAsync(`node "${scriptPath}"`, cwd, signal);
  if (result.aborted) return { status: 'skip', reason: 'Aborted', passed: false, aborted: true };
  return {
    status: result.success ? 'pass' : 'fail',
    output: result.output?.substring(0, OUTPUT_TRUNCATE_LENGTH),
    passed: result.success,
  };
}

// =============================================================================
// AUTO-FIX STEP (synchronous — must complete before gates)
// =============================================================================

function runAutoFixes(webDir) {
  logSection('Auto-Fix Step');

  results.autoFixesApplied = true;
  results.autoFixResults = {
    format: { ran: false, success: false },
    lintFix: { ran: false, success: false },
    auditFix: { ran: false, success: false },
  };

  // npm run format
  log('  Running npm run format...');
  const formatResult = runCommand('npm run format', webDir);
  results.autoFixResults.format = { ran: true, success: formatResult.success };
  logCheck('Prettier format', formatResult.success);

  // npm run lint:fix
  log('  Running npm run lint:fix...');
  const lintFixResult = runCommand('npm run lint:fix', webDir);
  results.autoFixResults.lintFix = { ran: true, success: lintFixResult.success };
  logCheck('ESLint auto-fix', lintFixResult.success);

  // npm audit fix (non-breaking only)
  log('  Running npm audit fix...');
  const auditFixResult = runCommand('npm audit fix', webDir);
  results.autoFixResults.auditFix = { ran: true, success: auditFixResult.success };
  logCheck('npm audit fix', auditFixResult.success);
}

// =============================================================================
// GATE 2: SECURITY (async)
// =============================================================================

async function runGate2Security(webDir, projectRoot, signal) {
  const buf = new LogBuffer();
  buf.section('Gate 2: Security');

  const gate = results.gates.gate2_security;
  gate.checks = {
    npmAudit: { status: 'pending', vulnerabilities: {} },
    securityValidator: { status: 'pending' },
  };

  // npm audit and security-validator run in parallel within this gate
  const [auditResult, securityValidatorResult] = await Promise.all([
    runCommandAsync('npm audit --omit=dev --audit-level=high --json', webDir, signal),
    runValidatorScriptAsync(
      path.join(projectRoot, '.github/scripts/security-validator.js'),
      projectRoot,
      signal
    ),
  ]);

  // Parse audit result
  let auditPassed = auditResult.success;
  let vulnCount = { high: 0, critical: 0 };

  if (!auditResult.success && auditResult.output) {
    try {
      const auditJson = JSON.parse(auditResult.output);
      vulnCount = {
        high: auditJson.metadata?.vulnerabilities?.high || 0,
        critical: auditJson.metadata?.vulnerabilities?.critical || 0,
      };
      auditPassed = vulnCount.high === 0 && vulnCount.critical === 0;
    } catch {
      auditPassed = false;
    }
  }

  gate.checks.npmAudit = {
    status: auditPassed ? 'pass' : 'fail',
    vulnerabilities: vulnCount,
  };
  buf.check('npm audit', auditPassed, `high: ${vulnCount.high}, critical: ${vulnCount.critical}`);

  gate.checks.securityValidator = {
    status: securityValidatorResult.status,
    ...(securityValidatorResult.reason && { reason: securityValidatorResult.reason }),
    ...(securityValidatorResult.output && { output: securityValidatorResult.output }),
  };
  buf.check('security-validator', securityValidatorResult.passed);

  gate.status = auditPassed && securityValidatorResult.passed ? 'pass' : 'fail';
  if (gate.status === 'fail') results.failedGates.push('gate2_security');

  return buf;
}

// =============================================================================
// GATE 3: CODE QUALITY (async — tsc, lint, build run concurrently)
// =============================================================================

async function runGate3CodeQuality(webDir, signal) {
  const buf = new LogBuffer();
  buf.section('Gate 3: Code Quality');

  const gate = results.gates.gate3_codeQuality;
  gate.checks = {
    prettier: { status: 'pending' },
    typescript: { status: 'pending', errorCount: 0 },
    eslint: { status: 'pending', errorCount: 0, warningCount: 0 },
    build: { status: 'pending' },
  };

  // Run prettier, tsc, lint, and build concurrently
  const [prettierResult, tscResult, eslintResult, buildResult] = await Promise.all([
    runCommandAsync('npm run format:check', webDir, signal),
    runCommandAsync('npx tsc --noEmit', webDir, signal),
    runCommandAsync('npm run lint', webDir, signal),
    runCommandAsync('npm run build', webDir, signal),
  ]);

  // Prettier
  const prettierPassed = prettierResult.success;
  gate.checks.prettier = {
    status: prettierPassed ? 'pass' : 'fail',
    ...(prettierResult.output && !prettierPassed && {
      output: prettierResult.output.substring(0, OUTPUT_TRUNCATE_LENGTH),
    }),
  };
  buf.check('Prettier', prettierPassed);

  // TypeScript
  const tscPassed = tscResult.success;
  let tsErrorCount = 0;
  if (!tscPassed && tscResult.output) {
    const errorMatches = tscResult.output.match(/error TS\d+/g);
    tsErrorCount = errorMatches ? errorMatches.length : 1;
  }
  gate.checks.typescript = {
    status: tscPassed ? 'pass' : 'fail',
    errorCount: tsErrorCount,
  };
  buf.check('TypeScript', tscPassed, `${tsErrorCount} errors`);

  // ESLint
  const eslintPassed = eslintResult.success;
  let eslintErrorCount = 0;
  let eslintWarningCount = 0;
  if (eslintResult.output) {
    const errorMatch = eslintResult.output.match(/(\d+)\s+error/);
    const warningMatch = eslintResult.output.match(/(\d+)\s+warning/);
    eslintErrorCount = errorMatch ? parseInt(errorMatch[1]) : 0;
    eslintWarningCount = warningMatch ? parseInt(warningMatch[1]) : 0;
  }
  gate.checks.eslint = {
    status: eslintPassed ? 'pass' : 'fail',
    errorCount: eslintErrorCount,
    warningCount: eslintWarningCount,
  };
  buf.check('ESLint', eslintPassed, `${eslintErrorCount} errors, ${eslintWarningCount} warnings`);

  // Build
  const buildPassed = buildResult.success;
  gate.checks.build = {
    status: buildPassed ? 'pass' : 'fail',
  };
  buf.check('Build', buildPassed);

  gate.status = prettierPassed && tscPassed && eslintPassed && buildPassed ? 'pass' : 'fail';
  if (gate.status === 'fail') results.failedGates.push('gate3_codeQuality');

  return buf;
}

// =============================================================================
// GATE 4: TESTING (async)
// =============================================================================

async function runGate4Testing(webDir, projectRoot, signal) {
  const buf = new LogBuffer();
  buf.section('Gate 4: Testing');

  const gate = results.gates.gate4_testing;
  gate.checks = {
    vitest: { status: 'pending', passed: 0, failed: 0, total: 0 },
    testQuality: { status: 'pending' },
  };

  // Run vitest and test-quality-validator concurrently
  const [testResult, testQualityResult] = await Promise.all([
    runCommandAsync('npm test', webDir, signal),
    runValidatorScriptAsync(
      path.join(projectRoot, '.github/scripts/test-quality-validator.js'),
      projectRoot,
      signal
    ),
  ]);

  // Parse Vitest output
  let testPassed = testResult.success;
  let testStats = { passed: 0, failed: 0, total: 0 };

  if (testResult.output) {
    const plainOutput = testResult.output.replace(ANSI_ESCAPE_PATTERN, '');
    const passedMatch = plainOutput.match(/Tests\s+.*?(\d+)\s+passed/);
    const failedMatch = plainOutput.match(/Tests\s+.*?(\d+)\s+failed/);
    if (passedMatch || failedMatch) {
      testStats.passed = passedMatch ? parseInt(passedMatch[1]) : 0;
      testStats.failed = failedMatch ? parseInt(failedMatch[1]) : 0;
      testStats.total = testStats.passed + testStats.failed;
      testPassed = testStats.failed === 0;
    }
  }

  gate.checks.vitest = {
    status: testPassed ? 'pass' : 'fail',
    ...testStats,
  };
  buf.check('Vitest', testPassed, `${testStats.passed} passed, ${testStats.failed} failed`);

  gate.checks.testQuality = {
    status: testQualityResult.status,
    ...(testQualityResult.reason && { reason: testQualityResult.reason }),
  };
  buf.check('test-quality-validator', testQualityResult.passed);

  gate.status = testPassed && testQualityResult.passed ? 'pass' : 'fail';
  if (gate.status === 'fail') results.failedGates.push('gate4_testing');

  return buf;
}

// =============================================================================
// GATE 5: PERFORMANCE (async)
// =============================================================================

async function runGate5Performance(webDir, signal) {
  const buf = new LogBuffer();
  buf.section('Gate 5: Performance');

  const gate = results.gates.gate5_performance;

  if (!options.includePerf) {
    gate.status = 'skip';
    gate.reason = 'Skipped by default locally (use --include-perf to run)';
    buf.log('  Skipped by default (use --include-perf to run)');
    return buf;
  }

  // Check if Lighthouse CI is configured
  const lhciConfigPath = path.join(webDir, 'lighthouserc.js');
  const lhciConfigPath2 = path.join(webDir, '.lighthouserc.js');
  const hasLhci = fs.existsSync(lhciConfigPath) || fs.existsSync(lhciConfigPath2);

  if (!hasLhci) {
    gate.status = 'skip';
    gate.reason = 'Lighthouse CI not configured (no lighthouserc.js)';
    buf.log('  Skipped (Lighthouse CI not configured)');
    return buf;
  }

  buf.log('  Running Lighthouse CI...');
  const lhciResult = await runCommandAsync('npx lhci autorun', webDir, signal);

  gate.checks = {
    lighthouse: {
      status: lhciResult.success ? 'pass' : 'fail',
    },
  };
  gate.status = lhciResult.success ? 'pass' : 'fail';

  buf.check('Lighthouse CI', lhciResult.success);

  if (gate.status === 'fail') results.failedGates.push('gate5_performance');

  return buf;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const { webDir, projectRoot } = findDirectories();

  if (!webDir) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'Could not find web directory with package.json' }));
    } else {
      console.error('Error: Could not find web directory with package.json');
      console.error('Run this script from the project root or web/ directory.');
    }
    process.exit(2);
  }

  // Validate npm scripts exist
  const validation = validateWebDir(webDir);
  if (!validation.valid) {
    if (options.json) {
      console.log(JSON.stringify({ error: validation.error }));
    } else {
      console.error(`Error: ${validation.error}`);
    }
    process.exit(2);
  }

  // WORKAROUND: Vitest has issues when Node.js is started from a different directory
  // than the web/ directory, even with cwd option. The vitest setup file fails to load.
  // Solution: If we're not in the web directory, re-execute this script from there.
  const currentDir = process.cwd();
  const isInWebDir = path.resolve(currentDir) === path.resolve(webDir);

  if (!isInWebDir && !process.env._QUALITY_GATES_REEXEC) {
    const scriptPath = path.resolve(__filename);
    const args = process.argv
      .slice(2)
      .map((a) => `'${a.replace(/'/g, "'\\''")}'`)
      .join(' ');

    const shellCmd = `cd "${webDir}" && node "${scriptPath}" ${args}`;

    const shell =
      process.platform === 'win32' ? process.env.SHELL || 'bash' : true;

    try {
      const output = execSync(shellCmd, {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: TIMEOUTS.FULL_RUN,
        shell,
        env: { ...process.env, _QUALITY_GATES_REEXEC: '1', CI: 'true' },
      });
      process.stdout.write(output);
      process.exit(0);
    } catch (error) {
      if (error.stdout) process.stdout.write(error.stdout);
      if (error.stderr) process.stderr.write(error.stderr);
      process.exit(error.status || 1);
    }
  }

  // --fail-fast implies sequential (can't short-circuit gates that already started)
  if (options.failFast) options.sequential = true;

  if (!options.json) {
    console.log(`${colors.blue}╔════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.blue}║       Quality Gates Runner             ║${colors.reset}`);
    console.log(`${colors.blue}╚════════════════════════════════════════╝${colors.reset}`);
    console.log(`${colors.dim}Working directory: ${webDir}${colors.reset}`);
    if (!options.sequential) {
      console.log(`${colors.dim}Mode: parallel (use --sequential to run one at a time)${colors.reset}`);
    }
  }

  // Run auto-fixes if requested (synchronous — must complete before gates)
  if (options.autoFix) {
    runAutoFixes(webDir);
  }

  // Set up AbortController for fail-fast
  const abortController = new AbortController();
  const signal = options.failFast ? abortController.signal : null;

  if (options.sequential) {
    // Sequential mode: run gates one at a time (original behavior)
    const shouldStop = () => options.failFast && results.failedGates.length > 0;

    let buf;
    buf = await runGate2Security(webDir, projectRoot, signal);
    buf.flush();
    if (shouldStop()) abortController.abort();

    if (!shouldStop()) {
      buf = await runGate3CodeQuality(webDir, signal);
      buf.flush();
      if (shouldStop()) abortController.abort();
    }

    if (!shouldStop()) {
      buf = await runGate4Testing(webDir, projectRoot, signal);
      buf.flush();
      if (shouldStop()) abortController.abort();
    }

    if (!shouldStop()) {
      buf = await runGate5Performance(webDir, signal);
      buf.flush();
    }
  } else {
    // Parallel mode (default): run all gates concurrently
    const gateTasks = [
      runGate2Security(webDir, projectRoot, signal),
      runGate3CodeQuality(webDir, signal),
      runGate4Testing(webDir, projectRoot, signal),
      runGate5Performance(webDir, signal),
    ];

    const buffers = await Promise.all(gateTasks);

    // Flush logs in gate order for consistent output
    for (const buf of buffers) {
      buf.flush();
    }
  }

  // Mark skipped gates due to fail-fast
  if (options.failFast && results.failedGates.length > 0) {
    for (const gate of Object.values(results.gates)) {
      if (gate.status === 'pending') {
        gate.status = 'skip';
        gate.reason = 'Skipped due to --fail-fast';
      }
    }
  }

  // Calculate overall status
  const passedGates = Object.values(results.gates).filter(
    (g) => g.status === 'pass' || g.status === 'skip'
  ).length;
  const totalGates = Object.keys(results.gates).length;

  results.overallStatus = results.failedGates.length === 0 ? 'pass' : 'fail';
  results.summary = {
    passed: passedGates,
    failed: results.failedGates.length,
    total: totalGates,
  };

  // Output results
  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    logSection('Summary');
    console.log('');

    for (const [gateName, gate] of Object.entries(results.gates)) {
      const displayName = gateName
        .replace(/^gate(\d+)_/, 'Gate $1: ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\b\w/g, (c) => c.toUpperCase());
      const icon =
        gate.status === 'pass'
          ? `${colors.green}✓ PASS${colors.reset}`
          : gate.status === 'skip'
            ? `${colors.yellow}○ SKIP${colors.reset}`
            : `${colors.red}✗ FAIL${colors.reset}`;
      console.log(`  ${displayName}: ${icon}`);
    }

    console.log('');
    if (results.overallStatus === 'pass') {
      console.log(`${colors.green}═══ ALL GATES PASSED ═══${colors.reset}`);
    } else {
      console.log(`${colors.red}═══ GATES FAILED: ${results.failedGates.join(', ')} ═══${colors.reset}`);
    }
    console.log('');
  }

  // Exit with appropriate code
  process.exit(results.overallStatus === 'pass' ? 0 : 1);
}

main();
