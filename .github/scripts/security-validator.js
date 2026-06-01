#!/usr/bin/env node

/**
 * Security Pattern Validator
 *
 * Validates code against security best practices for:
 * - Role-Based Access Control (RBAC)
 * - Input Validation
 * - XSS Protection
 * - SQL Injection Prevention
 * - Authentication Checks
 *
 * Adapted for stadium-8 structure (web/src/)
 */

const fs = require('fs');
const path = require('path');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

/**
 * Severity levels for security checks
 * - 'error': Blocks PR, must be fixed before merge
 * - 'warning': Displayed but does not block PR
 * - 'off': Check is disabled
 */
const SEVERITY = {
  ERROR: 'error',
  WARNING: 'warning',
  OFF: 'off',
};

/**
 * Configuration for security check severity levels
 * Can be overridden via environment variables:
 * - SECURITY_RBAC_SEVERITY=warning
 * - SECURITY_INPUT_VALIDATION_SEVERITY=error
 * - etc.
 */
const config = {
  rbac: {
    severity: process.env.SECURITY_RBAC_SEVERITY || SEVERITY.ERROR,
    name: 'RBAC',
    description: 'Role-Based Access Control checks',
  },
  inputValidation: {
    severity: process.env.SECURITY_INPUT_VALIDATION_SEVERITY || SEVERITY.ERROR,
    name: 'Input Validation',
    description: 'Input validation and sanitization checks',
  },
  xssProtection: {
    severity: process.env.SECURITY_XSS_SEVERITY || SEVERITY.ERROR,
    name: 'XSS Protection',
    description: 'Cross-Site Scripting protection checks',
  },
  sqlInjection: {
    severity: process.env.SECURITY_SQL_INJECTION_SEVERITY || SEVERITY.ERROR,
    name: 'SQL Injection Prevention',
    description: 'SQL injection prevention checks',
  },
  authentication: {
    severity: process.env.SECURITY_AUTH_SEVERITY || SEVERITY.WARNING,
    name: 'Authentication Checks',
    description: 'Authentication configuration checks',
  },
  popiaLogging: {
    severity: process.env.SECURITY_POPIA_LOGGING_SEVERITY || SEVERITY.WARNING,
    name: 'POPIA: PII Logging',
    description: 'Detects potential logging of personal information (POPIA compliance)',
  },
  popiaFieldHandling: {
    severity: process.env.SECURITY_POPIA_FIELDS_SEVERITY || SEVERITY.WARNING,
    name: 'POPIA: PII Field Handling',
    description: 'Detects unprotected handling of personal information fields (POPIA compliance)',
  },
};

/**
 * Check if a severity level should block the build
 * @param {string} severity - The severity level
 * @returns {boolean}
 */
function isBlockingSeverity(severity) {
  return severity === SEVERITY.ERROR;
}

/**
 * Check if a check is enabled
 * @param {string} checkKey - The check key (e.g., 'rbac', 'xssProtection')
 * @returns {boolean}
 */
function isCheckEnabled(checkKey) {
  return config[checkKey]?.severity !== SEVERITY.OFF;
}

const results = {
  rbac: { pass: true, issues: [] },
  inputValidation: { pass: true, issues: [] },
  xssProtection: { pass: true, issues: [] },
  sqlInjection: { pass: true, issues: [] },
  authentication: { pass: true, issues: [] },
  popiaLogging: { pass: true, issues: [] },
  popiaFieldHandling: { pass: true, issues: [] },
};

/**
 * Documentation links for security patterns
 * These paths are relative to the repository root
 */
const DOCS = {
  // Project documentation
  authentication: '.template-docs/Help/Authentication.md',
  development: '.template-docs/guides/DEVELOPMENT.md',
  apiIntegration: '.template-docs/guides/API_INTEGRATION.md',

  // Source code examples
  authHelpers: 'web/src/lib/auth/auth-helpers.ts',
  validationSchemas: 'web/src/lib/validation/schemas.ts',
  protectedRoute: 'web/src/app/api/example/protected-action/route.ts',
  rolesDefinition: 'web/src/types/roles.ts',

  // External documentation
  nextAuth: 'https://authjs.dev/',
  zod: 'https://zod.dev/',
  domPurify: 'https://github.com/cure53/DOMPurify',
  prisma: 'https://www.prisma.io/docs/concepts/components/prisma-client/raw-database-access',

  // POPIA compliance
  popia: 'https://popia.co.za/',
  popiaGuidelines: 'https://www.justice.gov.za/inforeg/',
};

// Track security-ignore overrides used
const overrides = [];

/**
 * Command-line options
 * Parsed from process.argv
 */
const cliOptions = {
  format: 'text', // 'text' or 'json'
  help: false,
};

/**
 * Quiet console.log wrapper that respects JSON mode
 * Use this for progress messages that should be suppressed in JSON mode
 * @param {...any} args - Arguments to pass to console.log
 */
function log(...args) {
  if (cliOptions.format !== 'json') {
    console.log(...args);
  }
}

/**
 * Parse command-line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--format' || arg === '-f') {
      const format = args[i + 1];
      if (format === 'json' || format === 'text') {
        cliOptions.format = format;
        i++; // Skip next arg
      } else {
        console.error(`Invalid format: ${format}. Use 'json' or 'text'.`);
        process.exit(1);
      }
    } else if (arg === '--json') {
      cliOptions.format = 'json';
    } else if (arg === '--help' || arg === '-h') {
      cliOptions.help = true;
    }
  }
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`
Security Pattern Validator

Validates code against security best practices for:
  - Role-Based Access Control (RBAC)
  - Input Validation
  - XSS Protection
  - SQL Injection Prevention
  - Authentication Checks
  - POPIA Compliance (PII logging, field handling)

Usage:
  node security-validator.js [options]

Options:
  --format, -f <format>  Output format: 'text' (default) or 'json'
  --json                 Shorthand for --format json
  --help, -h             Show this help message

Environment Variables:
  SECURITY_RBAC_SEVERITY             Set RBAC check severity (error|warning|off)
  SECURITY_INPUT_VALIDATION_SEVERITY Set input validation severity
  SECURITY_XSS_SEVERITY              Set XSS check severity
  SECURITY_SQL_INJECTION_SEVERITY    Set SQL injection check severity
  SECURITY_AUTH_SEVERITY             Set authentication check severity
  SECURITY_POPIA_LOGGING_SEVERITY    Set POPIA PII logging check severity
  SECURITY_POPIA_FIELDS_SEVERITY     Set POPIA PII field handling check severity

Examples:
  node security-validator.js                    # Run with text output
  node security-validator.js --format json      # Run with JSON output
  node security-validator.js --json             # Run with JSON output (shorthand)
  node security-validator.js --json > report.json  # Save JSON report to file
`);
}

/**
 * Security ignore pattern: // security-ignore: <reason>
 * Can be placed on the same line as the issue or on the line above
 */
const SECURITY_IGNORE_PATTERN = /\/\/\s*security-ignore:\s*(.+)/i;

/**
 * Check if a specific line in a file has a security-ignore comment
 * @param {string} filePath - Path to the file
 * @param {number} lineNumber - Line number to check (1-based)
 * @param {string} [lineContent] - Optional line content if already available
 * @returns {{ ignored: boolean, reason: string | null }}
 */
function hasSecurityIgnore(filePath, lineNumber, lineContent = null) {
  try {
    if (!fs.existsSync(filePath)) {
      return { ignored: false, reason: null };
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Check current line (same-line comment)
    const currentLine = lineContent || lines[lineNumber - 1] || '';
    const currentMatch = currentLine.match(SECURITY_IGNORE_PATTERN);
    if (currentMatch) {
      return { ignored: true, reason: currentMatch[1].trim() };
    }

    // Check previous line (comment on line above)
    if (lineNumber > 1) {
      const prevLine = lines[lineNumber - 2] || '';
      const prevMatch = prevLine.match(SECURITY_IGNORE_PATTERN);
      if (prevMatch) {
        return { ignored: true, reason: prevMatch[1].trim() };
      }
    }

    return { ignored: false, reason: null };
  } catch (error) {
    return { ignored: false, reason: null };
  }
}

/**
 * Check if a file has a file-level security-ignore comment (at top of file)
 * @param {string} filePath - Path to the file
 * @param {string} checkType - Type of check to ignore (e.g., 'rbac', 'xss', 'all')
 * @returns {{ ignored: boolean, reason: string | null }}
 */
function hasFileLevelSecurityIgnore(filePath, checkType) {
  try {
    if (!fs.existsSync(filePath)) {
      return { ignored: false, reason: null };
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    // Check first 10 lines for file-level ignore
    const firstLines = content.split('\n').slice(0, 10).join('\n');

    // Pattern: // security-ignore-file: <type> <reason>
    // or: // security-ignore-file: all <reason>
    const fileLevelPattern = new RegExp(
      `\\/\\/\\s*security-ignore-file:\\s*(${checkType}|all)\\s+(.+)`,
      'i'
    );
    const match = firstLines.match(fileLevelPattern);

    if (match) {
      return { ignored: true, reason: match[2].trim() };
    }

    return { ignored: false, reason: null };
  } catch (error) {
    return { ignored: false, reason: null };
  }
}

/**
 * Record an override that was used
 * @param {string} file - File path
 * @param {string} checkType - Type of security check
 * @param {string} reason - Reason provided for the override
 */
function recordOverride(file, checkType, reason) {
  overrides.push({ file, checkType, reason });
}

// Base directory for web source (stadium-8 structure)
const WEB_SRC = path.join(process.cwd(), 'web', 'src');
const WEB_ROOT = path.join(process.cwd(), 'web');

// Path to roles definition file
const ROLES_FILE = path.join(WEB_SRC, 'types', 'roles.ts');

/**
 * Extract valid role names from the UserRole enum in roles.ts
 * @returns {{ enumValues: string[], stringValues: string[] }} Object with enum keys and string values
 */
function getValidRoles() {
  try {
    if (!fs.existsSync(ROLES_FILE)) {
      log(`  ${colors.yellow}Warning: roles.ts not found at ${ROLES_FILE}${colors.reset}`);
      return { enumValues: [], stringValues: [] };
    }

    const content = fs.readFileSync(ROLES_FILE, 'utf-8');

    // Extract enum values using regex
    // Matches patterns like: ADMIN = 'admin', POWER_USER = 'power_user'
    const enumPattern = /^\s*(\w+)\s*=\s*['"]([^'"]+)['"]/gm;
    const enumValues = []; // e.g., ['ADMIN', 'POWER_USER']
    const stringValues = []; // e.g., ['admin', 'power_user']

    let match;
    while ((match = enumPattern.exec(content)) !== null) {
      enumValues.push(match[1]);
      stringValues.push(match[2]);
    }

    return { enumValues, stringValues };
  } catch (error) {
    log(`  ${colors.yellow}Warning: Could not parse roles.ts: ${error.message}${colors.reset}`);
    return { enumValues: [], stringValues: [] };
  }
}

/**
 * Recursively get all files in a directory
 * @param {string} dir - Directory to search
 * @param {string[]} [extensions] - Optional file extensions to filter (e.g., ['.ts', '.tsx'])
 * @returns {string[]} Array of file paths
 */
function getAllFiles(dir, extensions = ['.ts', '.tsx', '.js', '.jsx']) {
  const files = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);

    if (item.isDirectory()) {
      // Skip node_modules and hidden directories
      if (item.name !== 'node_modules' && !item.name.startsWith('.')) {
        files.push(...getAllFiles(fullPath, extensions));
      }
    } else if (item.isFile()) {
      const ext = path.extname(item.name).toLowerCase();
      if (extensions.length === 0 || extensions.includes(ext)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

/**
 * Cross-platform grep implementation using Node.js
 * Searches for a pattern in files and returns matches in grep-like format
 *
 * @param {string} pattern - Regex pattern to search for
 * @param {string} searchPath - Path to search (relative to WEB_SRC or absolute if starts with 'web/')
 * @param {string} options - Options string: '-l' for files only, '-i' for case insensitive
 * @returns {string[]} Array of matches in format "filepath:linenum:content" or just "filepath" with -l
 */
function grep(pattern, searchPath, options = '') {
  try {
    const fullPath = searchPath.startsWith('web/')
      ? path.join(process.cwd(), searchPath)
      : path.join(WEB_SRC, searchPath);

    if (!fs.existsSync(fullPath)) {
      return [];
    }

    // Parse options
    const filesOnly = options.includes('-l');
    const caseInsensitive = options.includes('-i');

    // Create regex from pattern
    let regex;
    try {
      regex = new RegExp(pattern, caseInsensitive ? 'i' : '');
    } catch (e) {
      // If pattern is not valid regex, escape it and try again
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      regex = new RegExp(escaped, caseInsensitive ? 'i' : '');
    }

    const results = [];
    const matchedFiles = new Set();

    // Get all files to search
    const files = fs.statSync(fullPath).isDirectory()
      ? getAllFiles(fullPath)
      : [fullPath];

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            if (filesOnly) {
              if (!matchedFiles.has(file)) {
                matchedFiles.add(file);
                results.push(file);
              }
            } else {
              // Format: filepath:linenum:content (linenum is 1-based)
              results.push(`${file}:${i + 1}:${lines[i]}`);
            }
          }
        }
      } catch (readError) {
        // Skip files that can't be read (binary files, etc.)
        continue;
      }
    }

    return results;
  } catch (error) {
    return [];
  }
}

/**
 * Check if a file exists (cross-platform)
 * @param {string} filePath - Path to check
 * @returns {boolean}
 */
function fileExists(filePath) {
  try {
    // Handle both absolute paths (Unix / or Windows C:\) and relative paths
    const isAbsolute = path.isAbsolute(filePath);
    const fullPath = isAbsolute ? filePath : path.join(WEB_SRC, filePath);
    return fs.existsSync(fullPath);
  } catch {
    return false;
  }
}

/**
 * 1. RBAC: Check for API routes without authentication
 */
function checkRBAC() {
  if (!isCheckEnabled('rbac')) {
    log(`\n${colors.yellow}Skipping RBAC check (disabled)${colors.reset}`);
    return;
  }

  // No roles.ts on fresh clones — skip silently rather than warn.
  if (!fs.existsSync(ROLES_FILE)) {
    return;
  }

  log(`\n${colors.blue}Checking RBAC implementation...${colors.reset}`);

  // Find all API route files
  const apiRoutes = grep('export.*GET|POST|PUT|DELETE|PATCH', 'app/api', '-l');

  // Check each API route for authentication
  apiRoutes.forEach((file) => {
    const filePath = file.split(':')[0];
    if (!fs.existsSync(filePath)) return;

    // Check for file-level security ignore
    const fileIgnore = hasFileLevelSecurityIgnore(filePath, 'rbac');
    if (fileIgnore.ignored) {
      recordOverride(filePath, 'rbac', fileIgnore.reason);
      return;
    }

    const content = fs.readFileSync(filePath, 'utf-8');

    // Check for getServerSession or withRoleProtection
    const hasAuth =
      content.includes('getServerSession') ||
      content.includes('withRoleProtection') ||
      content.includes('requireAuth') ||
      content.includes('requireRole') ||
      content.includes('auth(');

    if (!hasAuth && !filePath.includes('[...nextauth]')) {
      // Check for inline security-ignore comment (check first export line)
      const lines = content.split('\n');
      const exportLineIndex = lines.findIndex((line) =>
        /export.*(GET|POST|PUT|DELETE|PATCH)/.test(line)
      );

      // Line number for reporting (1-based)
      const lineNum = exportLineIndex !== -1 ? exportLineIndex + 1 : 1;

      if (exportLineIndex !== -1) {
        const ignoreCheck = hasSecurityIgnore(filePath, lineNum);
        if (ignoreCheck.ignored) {
          recordOverride(filePath, 'rbac', ignoreCheck.reason);
          return;
        }
      }

      results.rbac.pass = false;
      results.rbac.issues.push({
        file: `${filePath}:${lineNum}`,
        message: 'API route missing authorization check',
        remediation:
          `Guard the route with the project's auth helper before returning data — e.g. requireSession() / requireRole() from the auth module the brief specifies, or auth() if NextAuth is in use.

📚 Documentation:
  - Guide: ${DOCS.authentication}`,
      });
    }
  });
}

/**
 * 1a. RBAC: Check for protected pages without proper authorization
 */
function checkProtectedPages() {
  if (!isCheckEnabled('rbac')) {
    return;
  }

  log(`\n${colors.blue}Checking protected pages for authorization...${colors.reset}`);

  // Find all page files under (protected) route groups
  const protectedPagesPath = path.join(WEB_SRC, 'app', '(protected)');

  if (!fs.existsSync(protectedPagesPath)) {
    log(`  ${colors.yellow}No (protected) route group found - skipping protected pages check${colors.reset}`);
    return;
  }

  // Get all page.tsx files under (protected)
  const protectedPages = getAllFiles(protectedPagesPath, ['.tsx', '.ts']).filter(
    (f) => f.endsWith('page.tsx') || f.endsWith('page.ts')
  );

  // Get all layout.tsx files under (protected)
  const protectedLayouts = getAllFiles(protectedPagesPath, ['.tsx', '.ts']).filter(
    (f) => f.endsWith('layout.tsx') || f.endsWith('layout.ts')
  );

  // Check if root (protected) layout has auth check
  const rootProtectedLayout = path.join(protectedPagesPath, 'layout.tsx');
  let rootLayoutHasAuth = false;

  if (fs.existsSync(rootProtectedLayout)) {
    const layoutContent = fs.readFileSync(rootProtectedLayout, 'utf-8');
    rootLayoutHasAuth =
      layoutContent.includes('requireAuth') ||
      layoutContent.includes('requireMinimumRole') ||
      layoutContent.includes('requireExactRole') ||
      layoutContent.includes('requireRole') ||
      layoutContent.includes('requireAnyRole') ||
      layoutContent.includes('getServerSession') ||
      layoutContent.includes('auth(');
  }

  if (!rootLayoutHasAuth) {
    // Check if there's an alt layout path
    const rootProtectedLayoutTs = path.join(protectedPagesPath, 'layout.ts');
    if (fs.existsSync(rootProtectedLayoutTs)) {
      const layoutContent = fs.readFileSync(rootProtectedLayoutTs, 'utf-8');
      rootLayoutHasAuth =
        layoutContent.includes('requireAuth') ||
        layoutContent.includes('requireMinimumRole') ||
        layoutContent.includes('requireExactRole') ||
        layoutContent.includes('requireRole') ||
        layoutContent.includes('requireAnyRole') ||
        layoutContent.includes('getServerSession') ||
        layoutContent.includes('auth(');
    }
  }

  if (!rootLayoutHasAuth) {
    // Find line number of the export default function for better reporting
    let lineNum = 1;
    const layoutFile = fs.existsSync(rootProtectedLayout)
      ? rootProtectedLayout
      : path.join(protectedPagesPath, 'layout.ts');

    if (fs.existsSync(layoutFile)) {
      const layoutContent = fs.readFileSync(layoutFile, 'utf-8');
      const lines = layoutContent.split('\n');
      const exportLineIndex = lines.findIndex((line) =>
        /export\s+(default\s+)?(async\s+)?function/.test(line)
      );
      if (exportLineIndex !== -1) {
        lineNum = exportLineIndex + 1;
      }
    }

    results.rbac.pass = false;
    results.rbac.issues.push({
      file: `${layoutFile}:${lineNum}`,
      message: 'Protected route group layout missing authentication check',
      remediation: `Add requireAuth() or requireMinimumRole() from lib/auth/auth-helpers.ts in the layout. Example:

  import { requireAuth } from '@/lib/auth/auth-helpers';

  export default async function ProtectedLayout({ children }) {
    await requireAuth(); // Throws if not authenticated
    return <>{children}</>;
  }

  // Or with role check:
  import { requireMinimumRole } from '@/lib/auth/auth-helpers';
  import { UserRole } from '@/types/roles';

  export default async function AdminLayout({ children }) {
    await requireMinimumRole(UserRole.ADMIN);
    return <>{children}</>;
  }

📚 Documentation:
  - Auth helpers: ${DOCS.authHelpers}
  - Guide: ${DOCS.authentication}
  - NextAuth.js: ${DOCS.nextAuth}`,
    });
  }

  // Check each protected page for role-based auth if not covered by layout
  protectedPages.forEach((pagePath) => {
    // Check for file-level security ignore
    const fileIgnore = hasFileLevelSecurityIgnore(pagePath, 'rbac');
    if (fileIgnore.ignored) {
      recordOverride(pagePath, 'rbac-protected-page', fileIgnore.reason);
      return;
    }

    const content = fs.readFileSync(pagePath, 'utf-8');

    // Get the directory of this page to check for nested layouts
    const pageDir = path.dirname(pagePath);

    // Check if page has its own role check (for role-specific pages)
    const pageHasRoleCheck =
      content.includes('requireMinimumRole') ||
      content.includes('requireExactRole') ||
      content.includes('requireRole') ||
      content.includes('requireAnyRole');

    // Check if there's a nested layout with role check between root protected and this page
    let nestedLayoutHasRoleCheck = false;
    let currentDir = pageDir;

    while (currentDir !== protectedPagesPath && currentDir.startsWith(protectedPagesPath)) {
      const nestedLayout = path.join(currentDir, 'layout.tsx');
      const nestedLayoutTs = path.join(currentDir, 'layout.ts');

      if (fs.existsSync(nestedLayout)) {
        const layoutContent = fs.readFileSync(nestedLayout, 'utf-8');
        if (
          layoutContent.includes('requireMinimumRole') ||
          layoutContent.includes('requireExactRole') ||
          layoutContent.includes('requireRole') ||
          layoutContent.includes('requireAnyRole')
        ) {
          nestedLayoutHasRoleCheck = true;
          break;
        }
      } else if (fs.existsSync(nestedLayoutTs)) {
        const layoutContent = fs.readFileSync(nestedLayoutTs, 'utf-8');
        if (
          layoutContent.includes('requireMinimumRole') ||
          layoutContent.includes('requireExactRole') ||
          layoutContent.includes('requireRole') ||
          layoutContent.includes('requireAnyRole')
        ) {
          nestedLayoutHasRoleCheck = true;
          break;
        }
      }

      currentDir = path.dirname(currentDir);
    }

    // If page references role-specific content but has no role check
    const mentionsRoleSpecificContent =
      content.includes('UserRole.ADMIN') ||
      content.includes('UserRole.POWER_USER') ||
      content.includes('admin') && (content.includes('dashboard') || content.includes('settings'));

    // Warn if page mentions admin/power_user content but lacks role protection
    if (mentionsRoleSpecificContent && !pageHasRoleCheck && !nestedLayoutHasRoleCheck) {
      // Find the line number where role is mentioned
      const lines = content.split('\n');
      let lineNum = 1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('UserRole.ADMIN') || lines[i].includes('UserRole.POWER_USER')) {
          lineNum = i + 1;
          break;
        }
      }

      // Check for line-level security ignore
      const lineIgnore = hasSecurityIgnore(pagePath, lineNum, lines[lineNum - 1] || '');
      if (lineIgnore.ignored) {
        recordOverride(`${pagePath}:${lineNum}`, 'rbac-protected-page', lineIgnore.reason);
        return;
      }

      results.rbac.pass = false;
      results.rbac.issues.push({
        file: `${pagePath}:${lineNum}`,
        message: 'Protected page references role-specific content without role check',
        remediation: `Add requireMinimumRole() or requireAnyRole() in the page or a parent layout. Example:

  import { requireMinimumRole } from '@/lib/auth/auth-helpers';
  import { UserRole } from '@/types/roles';

  export default async function AdminDashboard() {
    const session = await requireMinimumRole(UserRole.POWER_USER);
    // ADMIN and POWER_USER can access
    return <div>Welcome {session.user.name}</div>;
  }

  // Or for multiple specific roles:
  const session = await requireAnyRole([UserRole.ADMIN, UserRole.POWER_USER]);

📚 Documentation:
  - Auth helpers: ${DOCS.authHelpers}
  - Roles: ${DOCS.rolesDefinition}
  - Guide: ${DOCS.authentication}`,
      });
    }
  });

  // Also check for pages outside (protected) that might need auth
  // Look for pages that use session data or call protected APIs
  const allAppPages = getAllFiles(path.join(WEB_SRC, 'app'), ['.tsx', '.ts']).filter(
    (f) => (f.endsWith('page.tsx') || f.endsWith('page.ts')) && !f.includes('(protected)') && !f.includes('auth')
  );

  allAppPages.forEach((pagePath) => {
    // Skip if under auth routes
    if (pagePath.includes(path.join('app', 'auth'))) return;

    // Check for file-level security ignore
    const fileIgnore = hasFileLevelSecurityIgnore(pagePath, 'rbac');
    if (fileIgnore.ignored) {
      recordOverride(pagePath, 'rbac-unprotected-page', fileIgnore.reason);
      return;
    }

    const content = fs.readFileSync(pagePath, 'utf-8');

    // Check if page uses session data that suggests it should be protected
    const usesProtectedData =
      (content.includes('session.user') || content.includes('session?.user')) &&
      !content.includes('requireAuth') &&
      !content.includes('getSession');

    // Check if it has role checks without auth
    const hasRoleCheckWithoutAuth =
      (content.includes('requireMinimumRole') ||
        content.includes('requireExactRole') ||
        content.includes('requireRole')) &&
      !content.includes('requireAuth');

    if (usesProtectedData) {
      // Find line number
      const lines = content.split('\n');
      let lineNum = 1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('session.user') || lines[i].includes('session?.user')) {
          lineNum = i + 1;
          break;
        }
      }

      // Check for line-level security ignore
      const lineIgnore = hasSecurityIgnore(pagePath, lineNum, lines[lineNum - 1] || '');
      if (lineIgnore.ignored) {
        recordOverride(`${pagePath}:${lineNum}`, 'rbac-unprotected-page', lineIgnore.reason);
        return;
      }

      results.rbac.pass = false;
      results.rbac.issues.push({
        file: `${pagePath}:${lineNum}`,
        message: 'Page uses session data but is not in a protected route group',
        remediation: `Move to app/(protected)/ directory or add requireAuth() check. Example:

  import { requireAuth } from '@/lib/auth/auth-helpers';

  export default async function ProfilePage() {
    const session = await requireAuth();
    return <div>Welcome {session.user.name}</div>;
  }

Or move the page to: web/src/app/(protected)/your-page/page.tsx
The (protected) layout will handle authentication automatically.

📚 Documentation:
  - Auth helpers: ${DOCS.authHelpers}
  - Guide: ${DOCS.authentication}`,
      });
    }
  });
}

/**
 * 1b. RBAC: Check that protected pages have proper session validation
 * Verifies that pages under app/(protected)/ actually validate sessions,
 * not just import auth functions
 */
function checkProtectedPageSessionValidation() {
  if (!isCheckEnabled('rbac')) {
    return;
  }

  log(`\n${colors.blue}Checking protected pages for session validation...${colors.reset}`);

  const protectedPagesPath = path.join(WEB_SRC, 'app', '(protected)');

  if (!fs.existsSync(protectedPagesPath)) {
    return; // Already handled by checkProtectedPages
  }

  // Get all page.tsx/ts files under (protected)
  const protectedPages = getAllFiles(protectedPagesPath, ['.tsx', '.ts']).filter(
    (f) => f.endsWith('page.tsx') || f.endsWith('page.ts')
  );

  // Session validation patterns that actually validate/use the session
  const sessionValidationPatterns = [
    // Direct session retrieval and use
    /await\s+auth\s*\(\s*\)/,
    /await\s+getServerSession\s*\(/,
    /await\s+requireAuth\s*\(\s*\)/,
    /await\s+requireRole\s*\(/,
    /await\s+requireMinimumRole\s*\(/,
    /await\s+requireAnyRole\s*\(/,
    /await\s+requireExactRole\s*\(/,
    // Session variable usage (indicates session was retrieved)
    /const\s+session\s*=\s*await/,
    /const\s+\{\s*user\s*\}\s*=\s*await/,
    // UseSession hook in client components (with proper check)
    /useSession\s*\(\s*\).*(?:status|data|session)/,
  ];

  // Patterns that indicate the page is a Server Component (default in App Router)
  const serverComponentIndicators = [
    /^(?!.*['"]use client['"])/,  // No "use client" directive
    /export\s+(default\s+)?async\s+function/,
    /async\s+function\s+\w+Page/,
  ];

  // Client component with session check pattern
  const clientSessionPatterns = [
    /['"]use client['"]/,
    /useSession/,
    /SessionProvider/,
  ];

  protectedPages.forEach((pagePath) => {
    // Check for file-level security ignore
    const fileIgnore = hasFileLevelSecurityIgnore(pagePath, 'rbac');
    if (fileIgnore.ignored) {
      recordOverride(pagePath, 'session-validation', fileIgnore.reason);
      return;
    }

    const content = fs.readFileSync(pagePath, 'utf-8');
    const lines = content.split('\n');

    // Check if this is a client component
    const isClientComponent = content.includes('"use client"') || content.includes("'use client'");

    // Check if parent layout handles session validation
    // This is acceptable if the layout does the auth check
    const pageDir = path.dirname(pagePath);
    let parentLayoutHasSessionValidation = false;

    // Check all layouts from the page up to the (protected) root
    let currentDir = pageDir;
    while (currentDir.startsWith(protectedPagesPath)) {
      const layoutTsx = path.join(currentDir, 'layout.tsx');
      const layoutTs = path.join(currentDir, 'layout.ts');
      const layoutFile = fs.existsSync(layoutTsx) ? layoutTsx : (fs.existsSync(layoutTs) ? layoutTs : null);

      if (layoutFile) {
        const layoutContent = fs.readFileSync(layoutFile, 'utf-8');
        // Check if layout has actual session validation (not just imports)
        const hasValidation = sessionValidationPatterns.some(pattern => pattern.test(layoutContent));
        if (hasValidation) {
          parentLayoutHasSessionValidation = true;
          break;
        }
      }

      // Move up one directory
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) break; // Reached root
      currentDir = parentDir;
    }

    // If parent layout validates session, the page is protected
    if (parentLayoutHasSessionValidation) {
      return;
    }

    // Check if the page itself has session validation
    const pageHasSessionValidation = sessionValidationPatterns.some(pattern => pattern.test(content));

    // For client components, check for useSession with proper status check
    let clientComponentHasProperSessionCheck = false;
    if (isClientComponent) {
      // Check for useSession usage
      if (content.includes('useSession')) {
        // Look for proper session status checking
        const hasStatusCheck = content.includes('status') &&
          (content.includes('loading') || content.includes('authenticated') || content.includes('unauthenticated'));
        const hasSessionDataCheck = /session\??\./i.test(content) || /data\??\./i.test(content);

        if (hasStatusCheck || hasSessionDataCheck) {
          clientComponentHasProperSessionCheck = true;
        }
      }
    }

    // Determine if page is properly protected
    const isProperlyProtected = pageHasSessionValidation || clientComponentHasProperSessionCheck;

    if (!isProperlyProtected) {
      // Find the best line number for reporting
      let lineNum = 1;

      // Try to find the component function definition
      for (let i = 0; i < lines.length; i++) {
        if (/export\s+(default\s+)?(async\s+)?function/.test(lines[i]) ||
            /^(async\s+)?function\s+\w+Page/.test(lines[i].trim()) ||
            /export\s+default\s+\w+Page/.test(lines[i])) {
          lineNum = i + 1;
          break;
        }
      }

      // Check for line-level security ignore
      const lineIgnore = hasSecurityIgnore(pagePath, lineNum, lines[lineNum - 1] || '');
      if (lineIgnore.ignored) {
        recordOverride(`${pagePath}:${lineNum}`, 'session-validation', lineIgnore.reason);
        return;
      }

      // Determine appropriate remediation based on component type
      let remediation;
      if (isClientComponent) {
        remediation = `Add session validation using useSession() hook with proper status checks. Example:

  'use client';
  import { useSession } from 'next-auth/react';
  import { redirect } from 'next/navigation';

  export default function ProtectedClientComponent() {
    const { data: session, status } = useSession();

    if (status === 'loading') return <div>Loading...</div>;
    if (!session) redirect('/auth/signin');

    return <div>Welcome {session.user.name}</div>;
  }

Or move auth logic to a parent Server Component layout.

📚 Documentation:
  - Guide: ${DOCS.authentication}
  - NextAuth.js: ${DOCS.nextAuth}`;
      } else {
        remediation = `Add session validation using await requireAuth() at the start of the component. Example:

  import { requireAuth } from '@/lib/auth/auth-helpers';

  export default async function ProtectedPage() {
    const session = await requireAuth();
    // session is guaranteed to exist here
    return <div>Welcome {session.user.name}</div>;
  }

📚 Documentation:
  - Auth helpers: ${DOCS.authHelpers}
  - Guide: ${DOCS.authentication}`;
      }

      results.rbac.pass = false;
      results.rbac.issues.push({
        file: `${pagePath}:${lineNum}`,
        message: `Protected page missing session validation${isClientComponent ? ' (client component)' : ''}`,
        remediation,
      });
    }
  });
}

/**
 * 1c. RBAC: Check that role references use valid roles from UserRole enum
 */
function checkRoleReferences() {
  if (!isCheckEnabled('rbac')) {
    return;
  }

  if (!fs.existsSync(ROLES_FILE)) {
    return;
  }

  log(`\n${colors.blue}Checking role references against UserRole enum...${colors.reset}`);

  const { enumValues, stringValues } = getValidRoles();

  if (enumValues.length === 0) {
    log(`  ${colors.yellow}Skipping role reference check - no roles found in roles.ts${colors.reset}`);
    return;
  }

  log(`  Found valid roles: ${enumValues.join(', ')}`);

  // Search for role references in the codebase
  // Pattern 1: UserRole.SOMETHING (TypeScript enum access)
  const enumReferences = grep('UserRole\\.\\w+', 'app', '');
  const enumReferencesLib = grep('UserRole\\.\\w+', 'lib', '');
  const enumReferencesComponents = grep('UserRole\\.\\w+', 'components', '');

  // Pattern 2: role: 'something' or role === 'something' (string literal role checks)
  // We need to be careful to only check actual role assignments/comparisons
  const roleStringPatterns = grep("role['\"]?\\s*[:=]\\s*['\"]\\w+['\"]", 'app', '');
  const roleStringPatternsLib = grep("role['\"]?\\s*[:=]\\s*['\"]\\w+['\"]", 'lib', '');

  // Pattern 3: hasRole(..., 'something') or requireRole('something')
  const roleArgPatterns = grep("(hasRole|requireRole|hasAnyRole|hasMinimumRole|requireMinimumRole|requireAnyRole)\\([^)]*['\"]\\w+['\"]", 'app', '');
  const roleArgPatternsLib = grep("(hasRole|requireRole|hasAnyRole|hasMinimumRole|requireMinimumRole|requireAnyRole)\\([^)]*['\"]\\w+['\"]", 'lib', '');

  // Check UserRole.SOMETHING references
  const allEnumRefs = [...enumReferences, ...enumReferencesLib, ...enumReferencesComponents];
  allEnumRefs.forEach((match) => {
    const { file, lineNum, line } = parseGrepMatch(match);

    // Skip the roles.ts file itself
    if (file.includes('roles.ts')) return;

    // Skip test files
    if (file.includes('.test.') || file.includes('__tests__')) return;

    // Check for file-level security ignore
    const fileIgnore = hasFileLevelSecurityIgnore(file, 'rbac');
    if (fileIgnore.ignored) {
      recordOverride(file, 'rbac-role-reference', fileIgnore.reason);
      return;
    }

    // Check for line-level security ignore
    const lineIgnore = hasSecurityIgnore(file, parseInt(lineNum, 10), line);
    if (lineIgnore.ignored) {
      recordOverride(`${file}:${lineNum}`, 'rbac-role-reference', lineIgnore.reason);
      return;
    }

    // Extract the role name from UserRole.SOMETHING
    const roleMatch = line.match(/UserRole\.(\w+)/g);
    if (roleMatch) {
      roleMatch.forEach((ref) => {
        const roleName = ref.replace('UserRole.', '');
        if (!enumValues.includes(roleName)) {
          results.rbac.pass = false;
          results.rbac.issues.push({
            file: `${file}:${lineNum}`,
            message: `Invalid role reference: UserRole.${roleName}`,
            remediation: `Use a valid role from UserRole enum: ${enumValues.join(', ')}`,
          });
        }
      });
    }
  });

  // Check string literal role references (role: 'admin', role === 'admin', etc.)
  const allStringRefs = [...roleStringPatterns, ...roleStringPatternsLib];
  allStringRefs.forEach((match) => {
    const { file, lineNum, line } = parseGrepMatch(match);

    // Skip the roles.ts file itself
    if (file.includes('roles.ts')) return;

    // Skip test files
    if (file.includes('.test.') || file.includes('__tests__')) return;

    // Skip type definitions (these may define role as a generic string type)
    if (file.includes('.d.ts')) return;

    // Skip HTML/JSX ARIA role attributes (e.g., role="alert", role="button")
    // These are accessibility attributes, not RBAC roles
    const ariaRoles = [
      'alert', 'alertdialog', 'application', 'article', 'banner', 'button',
      'cell', 'checkbox', 'columnheader', 'combobox', 'complementary',
      'contentinfo', 'definition', 'dialog', 'directory', 'document',
      'feed', 'figure', 'form', 'grid', 'gridcell', 'group', 'heading',
      'img', 'link', 'list', 'listbox', 'listitem', 'log', 'main',
      'marquee', 'math', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox',
      'menuitemradio', 'navigation', 'none', 'note', 'option', 'presentation',
      'progressbar', 'radio', 'radiogroup', 'region', 'row', 'rowgroup',
      'rowheader', 'scrollbar', 'search', 'searchbox', 'separator', 'slider',
      'spinbutton', 'status', 'switch', 'tab', 'table', 'tablist', 'tabpanel',
      'term', 'textbox', 'timer', 'toolbar', 'tooltip', 'tree', 'treegrid', 'treeitem'
    ];

    // Check for file-level security ignore
    const fileIgnore = hasFileLevelSecurityIgnore(file, 'rbac');
    if (fileIgnore.ignored) {
      recordOverride(file, 'rbac-role-reference', fileIgnore.reason);
      return;
    }

    // Check for line-level security ignore
    const lineIgnore = hasSecurityIgnore(file, parseInt(lineNum, 10), line);
    if (lineIgnore.ignored) {
      recordOverride(`${file}:${lineNum}`, 'rbac-role-reference', lineIgnore.reason);
      return;
    }

    // Extract string literals after role: or role =
    // Pattern: role: 'admin' or role === 'admin' or role: "admin"
    const stringRoleMatch = line.match(/role['"]?\s*[:=]+\s*['"](\w+)['"]/g);
    if (stringRoleMatch) {
      stringRoleMatch.forEach((ref) => {
        const valueMatch = ref.match(/['"](\w+)['"]/);
        if (valueMatch) {
          const roleValue = valueMatch[1];
          // Skip ARIA role attributes
          if (ariaRoles.includes(roleValue.toLowerCase())) {
            return;
          }
          if (!stringValues.includes(roleValue)) {
            results.rbac.pass = false;
            results.rbac.issues.push({
              file: `${file}:${lineNum}`,
              message: `Invalid role string literal: '${roleValue}'`,
              remediation: `Use a valid role value: ${stringValues.join(', ')}`,
            });
          }
        }
      });
    }
  });

  // Check role function arguments with string literals
  const allArgRefs = [...roleArgPatterns, ...roleArgPatternsLib];
  allArgRefs.forEach((match) => {
    const { file, lineNum, line } = parseGrepMatch(match);

    // Skip the roles.ts file itself
    if (file.includes('roles.ts')) return;

    // Skip test files
    if (file.includes('.test.') || file.includes('__tests__')) return;

    // Check for file-level security ignore
    const fileIgnore = hasFileLevelSecurityIgnore(file, 'rbac');
    if (fileIgnore.ignored) {
      recordOverride(file, 'rbac-role-reference', fileIgnore.reason);
      return;
    }

    // Check for line-level security ignore
    const lineIgnore = hasSecurityIgnore(file, parseInt(lineNum, 10), line);
    if (lineIgnore.ignored) {
      recordOverride(`${file}:${lineNum}`, 'rbac-role-reference', lineIgnore.reason);
      return;
    }

    // Extract string literals from function calls
    // Match patterns like hasRole(user, 'admin') or requireRole('admin')
    const funcMatch = line.match(/(hasRole|requireRole|hasAnyRole|hasMinimumRole|requireMinimumRole|requireAnyRole)\([^)]*['"](\w+)['"]/);
    if (funcMatch) {
      const roleValue = funcMatch[2];
      // String literals should match the string values (e.g., 'admin', not 'ADMIN')
      if (!stringValues.includes(roleValue) && !enumValues.includes(roleValue)) {
        results.rbac.pass = false;
        results.rbac.issues.push({
          file: `${file}:${lineNum}`,
          message: `Invalid role in function call: '${roleValue}'`,
          remediation: `Use UserRole enum instead: UserRole.${enumValues[0]} (or valid role: ${enumValues.join(', ')})`,
        });
      }
    }
  });
}

/**
 * 2. Input Validation: Check for missing Zod schemas in API routes
 */
function checkInputValidation() {
  if (!isCheckEnabled('inputValidation')) {
    log(`\n${colors.yellow}Skipping Input Validation check (disabled)${colors.reset}`);
    return;
  }

  log(`\n${colors.blue}Checking input validation...${colors.reset}`);

  // Find API routes that handle POST/PUT/PATCH (data submission)
  const apiRoutes = grep('export.*(POST|PUT|PATCH)', 'app/api', '-l');

  apiRoutes.forEach((file) => {
    const filePath = file.split(':')[0];
    if (!fs.existsSync(filePath)) return;

    // Check for file-level security ignore
    const fileIgnore = hasFileLevelSecurityIgnore(filePath, 'input-validation');
    if (fileIgnore.ignored) {
      recordOverride(filePath, 'input-validation', fileIgnore.reason);
      return;
    }

    const content = fs.readFileSync(filePath, 'utf-8');

    // Check for Zod validation
    const hasValidation =
      content.includes('z.') ||
      content.includes('zod') ||
      content.includes('schema') ||
      content.includes('validate');

    // Skip NextAuth routes
    if (!hasValidation && !filePath.includes('[...nextauth]')) {
      // Check for inline security-ignore comment (check first export line)
      const lines = content.split('\n');
      const exportLineIndex = lines.findIndex((line) =>
        /export.*(POST|PUT|PATCH)/.test(line)
      );

      if (exportLineIndex !== -1) {
        const ignoreCheck = hasSecurityIgnore(filePath, exportLineIndex + 1);
        if (ignoreCheck.ignored) {
          recordOverride(filePath, 'input-validation', ignoreCheck.reason);
          return;
        }
      }

      results.inputValidation.pass = false;
      results.inputValidation.issues.push({
        file: filePath,
        message: 'API route missing input validation',
        remediation: `Add Zod schema validation for request body. Example:

  import { z } from 'zod';
  import { validateRequest } from '@/lib/validation/schemas';

  const requestSchema = z.object({
    name: z.string().min(1).max(100),
    email: z.string().email(),
  });

  export async function POST(request: NextRequest) {
    const body = await request.json();
    const validation = validateRequest(requestSchema, body);

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.errors },
        { status: 400 }
      );
    }

    const { name, email } = validation.data; // Type-safe!
    // ... process validated data
  }

📚 Documentation:
  - Schemas: ${DOCS.validationSchemas}
  - Example: ${DOCS.protectedRoute}
  - Zod: ${DOCS.zod}`,
      });
    }
  });
}

/**
 * 2a. Input Validation: Check for form components missing validation
 * Detects client components ("use client") with form elements that lack validation
 */
function checkFormValidation() {
  if (!isCheckEnabled('inputValidation')) {
    return;
  }

  log(`\n${colors.blue}Checking form components for validation...${colors.reset}`);

  // Get all TypeScript/JavaScript files in app and components directories
  const appFiles = getAllFiles(path.join(WEB_SRC, 'app'), ['.tsx', '.jsx']);
  const componentFiles = getAllFiles(path.join(WEB_SRC, 'components'), ['.tsx', '.jsx']);
  const allFiles = [...appFiles, ...componentFiles];

  allFiles.forEach((filePath) => {
    // Skip test files
    if (filePath.includes('.test.') || filePath.includes('__tests__')) return;

    if (!fs.existsSync(filePath)) return;

    const content = fs.readFileSync(filePath, 'utf-8');

    // Only check client components (files with "use client" directive)
    if (!content.includes('"use client"') && !content.includes("'use client'")) {
      return;
    }

    // Check for file-level security ignore
    const fileIgnore = hasFileLevelSecurityIgnore(filePath, 'input-validation');
    if (fileIgnore.ignored) {
      recordOverride(filePath, 'form-validation', fileIgnore.reason);
      return;
    }

    // Check if file has form elements
    const hasFormElements =
      content.includes('<form') ||
      content.includes('<Form') ||
      (content.includes('<input') && !content.includes('type="hidden"')) ||
      content.includes('<Input') ||
      content.includes('<textarea') ||
      content.includes('<Textarea') ||
      content.includes('<select') ||
      content.includes('<Select');

    if (!hasFormElements) {
      return;
    }

    // Check for validation patterns
    const hasValidation =
      // Zod validation
      content.includes('z.') ||
      content.includes('from "zod"') ||
      content.includes("from 'zod'") ||
      content.includes('zodResolver') ||
      // React Hook Form
      content.includes('useForm') ||
      content.includes('react-hook-form') ||
      // Formik
      content.includes('useFormik') ||
      content.includes('Formik') ||
      // Custom validation functions
      content.includes('validate') ||
      content.includes('Validate') ||
      content.includes('schema') ||
      content.includes('Schema') ||
      // HTML5 validation attributes
      content.includes('required') ||
      content.includes('pattern=') ||
      content.includes('minLength') ||
      content.includes('maxLength') ||
      content.includes('min=') ||
      content.includes('max=') ||
      // Project validation utilities
      content.includes('validateRequest') ||
      content.includes('sanitize') ||
      content.includes('lib/validation');

    if (!hasValidation) {
      // Find the line number of the first form element for better reporting
      const lines = content.split('\n');
      let lineNum = 1;
      const formPatterns = [/<form/i, /<Form/, /<input/i, /<Input/, /<textarea/i, /<Textarea/, /<select/i, /<Select/];

      for (let i = 0; i < lines.length; i++) {
        if (formPatterns.some((pattern) => pattern.test(lines[i]))) {
          lineNum = i + 1;
          break;
        }
      }

      // Check for line-level security ignore
      const lineIgnore = hasSecurityIgnore(filePath, lineNum, lines[lineNum - 1] || '');
      if (lineIgnore.ignored) {
        recordOverride(`${filePath}:${lineNum}`, 'form-validation', lineIgnore.reason);
        return;
      }

      results.inputValidation.pass = false;
      results.inputValidation.issues.push({
        file: `${filePath}:${lineNum}`,
        message: 'Client form component missing input validation',
        remediation: `Add form validation using Zod schemas with react-hook-form. Example:

  import { z } from 'zod';
  import { useForm } from 'react-hook-form';
  import { zodResolver } from '@hookform/resolvers/zod';

  const formSchema = z.object({
    email: z.string().email('Invalid email'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
  });

  function LoginForm() {
    const { register, handleSubmit, formState: { errors } } = useForm({
      resolver: zodResolver(formSchema),
    });

    return (
      <form onSubmit={handleSubmit(onSubmit)}>
        <input {...register('email')} />
        {errors.email && <span>{errors.email.message}</span>}
      </form>
    );
  }

Or use HTML5 validation: <input required minLength={8} pattern="..." />

📚 Documentation:
  - Schemas: ${DOCS.validationSchemas} (emailSchema, passwordSchema, etc.)
  - Zod: ${DOCS.zod}`,
      });
    }
  });
}

/**
 * 2b. Input Validation: Check for file upload handlers missing validation
 * Detects file upload handling code without proper type/size/content validation
 */
function checkFileUploadValidation() {
  if (!isCheckEnabled('inputValidation')) {
    return;
  }

  log(`\n${colors.blue}Checking file upload handlers for validation...${colors.reset}`);

  // Get all TypeScript/JavaScript files in app, components, and lib directories
  const appFiles = getAllFiles(path.join(WEB_SRC, 'app'), ['.ts', '.tsx', '.js', '.jsx']);
  const componentFiles = getAllFiles(path.join(WEB_SRC, 'components'), ['.ts', '.tsx', '.js', '.jsx']);
  const libFiles = getAllFiles(path.join(WEB_SRC, 'lib'), ['.ts', '.tsx', '.js', '.jsx']);
  const allFiles = [...appFiles, ...componentFiles, ...libFiles];

  allFiles.forEach((filePath) => {
    // Skip test files
    if (filePath.includes('.test.') || filePath.includes('__tests__')) return;
    // Skip validation schema files (they define the validation patterns)
    if (filePath.includes('schemas.ts') || filePath.includes('validation')) return;

    if (!fs.existsSync(filePath)) return;

    const content = fs.readFileSync(filePath, 'utf-8');

    // Check for file-level security ignore
    const fileIgnore = hasFileLevelSecurityIgnore(filePath, 'input-validation');
    if (fileIgnore.ignored) {
      recordOverride(filePath, 'file-upload-validation', fileIgnore.reason);
      return;
    }

    // Check if file handles file uploads
    const hasFileUploadHandling =
      // HTML file input
      content.includes('type="file"') ||
      content.includes("type='file'") ||
      content.includes('type={"file"}') ||
      // FormData file handling
      (content.includes('FormData') && (content.includes('.append') || content.includes('.get'))) ||
      // Multipart form handling
      content.includes('multipart/form-data') ||
      content.includes('multipart') ||
      // File/Blob handling patterns
      (content.includes('File') && (content.includes('.type') || content.includes('.size') || content.includes('.name'))) ||
      // Common upload patterns
      content.includes('uploadFile') ||
      content.includes('handleUpload') ||
      content.includes('onFileChange') ||
      content.includes('fileUpload') ||
      content.includes('FileUpload') ||
      // Next.js file upload API patterns
      content.includes('request.formData') ||
      content.includes('req.formData');

    if (!hasFileUploadHandling) {
      return;
    }

    // Check for file validation patterns
    const hasTypeValidation =
      // MIME type checks
      content.includes('.type') && (
        content.includes('image/') ||
        content.includes('application/') ||
        content.includes('text/') ||
        content.includes('video/') ||
        content.includes('audio/') ||
        content.includes('mime') ||
        content.includes('MIME') ||
        content.includes('contentType') ||
        content.includes('content-type')
      ) ||
      // File extension checks
      content.includes('.endsWith') ||
      content.includes('extension') ||
      content.includes('fileType') ||
      content.includes('allowedTypes') ||
      content.includes('acceptedTypes') ||
      content.includes('accept=');

    const hasSizeValidation =
      // Size property checks
      content.includes('.size') && (
        content.includes('maxSize') ||
        content.includes('MAX_SIZE') ||
        content.includes('limit') ||
        content.includes('1024') || // Common byte calculations
        content.includes('MB') ||
        content.includes('KB') ||
        content.includes('bytes')
      ) ||
      // Size comparison patterns
      content.includes('fileSize') ||
      content.includes('maxFileSize') ||
      content.includes('sizeLimit');

    const hasContentValidation =
      // Magic number/header validation
      content.includes('magic') ||
      content.includes('header') ||
      content.includes('signature') ||
      content.includes('arrayBuffer') ||
      content.includes('ArrayBuffer') ||
      content.includes('Uint8Array') ||
      // File content inspection
      content.includes('readAsArrayBuffer') ||
      content.includes('FileReader');

    const hasSchemaValidation =
      // Zod file upload schema
      content.includes('fileUploadSchema') ||
      content.includes('uploadSchema') ||
      // Generic validation
      content.includes('validateFile') ||
      content.includes('fileValidation') ||
      content.includes('validateUpload');

    // Require at least type AND size validation, OR schema validation
    const hasAdequateValidation =
      hasSchemaValidation ||
      (hasTypeValidation && hasSizeValidation) ||
      (hasTypeValidation && hasContentValidation) ||
      (hasSizeValidation && hasContentValidation);

    if (!hasAdequateValidation) {
      // Find the line number of the file upload indicator for better reporting
      const lines = content.split('\n');
      let lineNum = 1;
      const uploadPatterns = [
        /type=["']?file["']?/i,
        /FormData/,
        /multipart/i,
        /uploadFile/i,
        /handleUpload/i,
        /onFileChange/i,
        /fileUpload/i,
        /request\.formData/,
        /req\.formData/,
      ];

      for (let i = 0; i < lines.length; i++) {
        if (uploadPatterns.some((pattern) => pattern.test(lines[i]))) {
          lineNum = i + 1;
          break;
        }
      }

      // Check for line-level security ignore
      const lineIgnore = hasSecurityIgnore(filePath, lineNum, lines[lineNum - 1] || '');
      if (lineIgnore.ignored) {
        recordOverride(`${filePath}:${lineNum}`, 'file-upload-validation', lineIgnore.reason);
        return;
      }

      // Determine what validation is missing
      const missingValidations = [];
      if (!hasTypeValidation && !hasSchemaValidation) missingValidations.push('file type');
      if (!hasSizeValidation && !hasSchemaValidation) missingValidations.push('file size');

      const missingStr = missingValidations.length > 0
        ? ` (missing: ${missingValidations.join(', ')})`
        : '';

      results.inputValidation.pass = false;
      results.inputValidation.issues.push({
        file: `${filePath}:${lineNum}`,
        message: `File upload handler missing validation${missingStr}`,
        remediation: `Add file type and size validation using fileUploadSchema or manual checks. Example:

  import { fileUploadSchema, validateRequest } from '@/lib/validation/schemas';

  // Using the pre-built schema:
  const validation = validateRequest(fileUploadSchema, {
    name: file.name,
    size: file.size,
    type: file.type,
  });

  // Or manual validation:
  const MAX_SIZE = 5 * 1024 * 1024; // 5MB
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];

  if (file.size > MAX_SIZE) {
    throw new Error('File too large');
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Invalid file type');
  }

📚 Documentation:
  - Schemas: ${DOCS.validationSchemas} (fileUploadSchema)
  - Zod: ${DOCS.zod}`,
      });
    }
  });
}

/**
 * Parse a grep result line into file path, line number, and content
 * Handles both Unix and Windows paths (e.g., C:\path\file.ts:10:content)
 * @param {string} match - The grep result line
 * @returns {{ file: string, lineNum: string, line: string }}
 */
function parseGrepMatch(match) {
  // On Windows, paths start with drive letter like "C:\", so we need special handling
  // Format: filepath:linenum:content
  // Windows: C:\path\file.ts:10:content
  // Unix: /path/file.ts:10:content

  let file, lineNum, line;

  // Check if this looks like a Windows path (has drive letter at start)
  if (/^[a-zA-Z]:/.test(match)) {
    // Windows path - find the colon after the drive letter
    const afterDrive = match.substring(2); // Skip "C:"
    const firstColon = afterDrive.indexOf(':');
    const secondColon = afterDrive.indexOf(':', firstColon + 1);

    if (firstColon !== -1 && secondColon !== -1) {
      file = match.substring(0, 2) + afterDrive.substring(0, firstColon);
      lineNum = afterDrive.substring(firstColon + 1, secondColon);
      line = afterDrive.substring(secondColon + 1);
    } else {
      // Fallback - might be files-only output
      file = match;
      lineNum = '0';
      line = '';
    }
  } else {
    // Unix path - simple split
    const parts = match.split(':');
    file = parts[0];
    lineNum = parts[1] || '0';
    line = parts.slice(2).join(':');
  }

  return { file, lineNum, line };
}

/**
 * 3. XSS Protection: Check for dangerous HTML injection
 */
function checkXSSProtection() {
  if (!isCheckEnabled('xssProtection')) {
    log(`\n${colors.yellow}Skipping XSS Protection check (disabled)${colors.reset}`);
    return;
  }

  log(`\n${colors.blue}Checking XSS protection...${colors.reset}`);

  // Find uses of dangerouslySetInnerHTML
  const dangerousHTML = grep('dangerouslySetInnerHTML', 'app', '');
  const dangerousHTMLComponents = grep('dangerouslySetInnerHTML', 'components', '');

  [...dangerousHTML, ...dangerousHTMLComponents].forEach((match) => {
    const { file, lineNum, line } = parseGrepMatch(match);

    // Check for file-level security ignore
    const fileIgnore = hasFileLevelSecurityIgnore(file, 'xss');
    if (fileIgnore.ignored) {
      recordOverride(file, 'xss', fileIgnore.reason);
      return;
    }

    // Check for line-level security ignore
    const lineIgnore = hasSecurityIgnore(file, parseInt(lineNum, 10), line);
    if (lineIgnore.ignored) {
      recordOverride(`${file}:${lineNum}`, 'xss', lineIgnore.reason);
      return;
    }

    // Verify that sanitization is actually APPLIED, not just mentioned
    const isSanitizationApplied = verifySanitizationApplied(file, parseInt(lineNum, 10), line);

    if (!isSanitizationApplied) {
      results.xssProtection.pass = false;
      results.xssProtection.issues.push({
        file: `${file}:${lineNum}`,
        message: 'dangerouslySetInnerHTML used without verified sanitization',
        remediation: `Sanitize HTML using DOMPurify or sanitizeHtml() before rendering. Example:

  import DOMPurify from 'dompurify';

  // Option 1: DOMPurify (recommended for complex HTML)
  <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userContent) }} />

  // Option 2: Using project's sanitizeHtml utility
  import { sanitizeHtml } from '@/lib/validation/schemas';
  const safeContent = sanitizeHtml(userContent);
  <div dangerouslySetInnerHTML={{ __html: safeContent }} />

  // Option 3: Pre-sanitize and store in variable
  const sanitizedHtml = DOMPurify.sanitize(rawHtml);
  <div dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />

📚 Documentation:
  - Schemas: ${DOCS.validationSchemas} (sanitizeHtml function)
  - DOMPurify: ${DOCS.domPurify}`,
      });
    }
  });
}

/**
 * Verify that sanitization is actually applied to the value passed to dangerouslySetInnerHTML
 * Not just mentioned nearby, but actually wrapping or transforming the value
 *
 * @param {string} filePath - Path to the file
 * @param {number} lineNumber - Line number where dangerouslySetInnerHTML is used
 * @param {string} line - The line content
 * @returns {boolean} True if sanitization is verified to be applied
 */
function verifySanitizationApplied(filePath, lineNumber, line) {
  // Pattern 1: Direct sanitization call in the same line
  // e.g., dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content) }}
  // e.g., dangerouslySetInnerHTML={{ __html: sanitizeHtml(content) }}
  // e.g., dangerouslySetInnerHTML={{ __html: sanitize(content) }}
  const directSanitizationPatterns = [
    /DOMPurify\.sanitize\s*\(/i,
    /sanitizeHtml\s*\(/i,
    /sanitize\s*\(/i,
    /xss\s*\(/i,
    /escapeHtml\s*\(/i,
    /escape\s*\(/i,
    /purify\s*\(/i,
    /cleanHtml\s*\(/i,
  ];

  if (directSanitizationPatterns.some((pattern) => pattern.test(line))) {
    return true;
  }

  // Pattern 2: Check if the value is a variable that was sanitized earlier in the file
  // Extract the variable name from __html: variableName
  const htmlValueMatch = line.match(/__html\s*:\s*([a-zA-Z_$][a-zA-Z0-9_$]*)/);
  if (htmlValueMatch) {
    const variableName = htmlValueMatch[1];

    // Read the file and check if this variable was sanitized
    try {
      if (!fs.existsSync(filePath)) {
        return false;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      // Look for sanitization assignment to this variable in preceding lines
      // Search from the start of the file up to the current line
      for (let i = 0; i < lineNumber - 1 && i < lines.length; i++) {
        const precedingLine = lines[i];

        // Check for patterns like:
        // const sanitizedHtml = DOMPurify.sanitize(...)
        // const variableName = sanitize(...)
        // variableName = DOMPurify.sanitize(...)
        const assignmentPatterns = [
          new RegExp(`(const|let|var)?\\s*${variableName}\\s*=\\s*DOMPurify\\.sanitize\\s*\\(`, 'i'),
          new RegExp(`(const|let|var)?\\s*${variableName}\\s*=\\s*sanitizeHtml\\s*\\(`, 'i'),
          new RegExp(`(const|let|var)?\\s*${variableName}\\s*=\\s*sanitize\\s*\\(`, 'i'),
          new RegExp(`(const|let|var)?\\s*${variableName}\\s*=\\s*xss\\s*\\(`, 'i'),
          new RegExp(`(const|let|var)?\\s*${variableName}\\s*=\\s*escapeHtml\\s*\\(`, 'i'),
          new RegExp(`(const|let|var)?\\s*${variableName}\\s*=\\s*purify\\s*\\(`, 'i'),
        ];

        if (assignmentPatterns.some((pattern) => pattern.test(precedingLine))) {
          return true;
        }
      }

      // Pattern 3: Check if the variable name itself suggests it's sanitized
      // e.g., sanitizedContent, cleanHtml, safeHtml, purifiedContent
      const sanitizedVariablePatterns = [
        /^sanitized/i,
        /^clean/i,
        /^safe/i,
        /^purified/i,
        /^escaped/i,
        /Sanitized$/i,
        /Clean$/i,
        /Safe$/i,
        /Purified$/i,
      ];

      if (sanitizedVariablePatterns.some((pattern) => pattern.test(variableName))) {
        // Variable name suggests sanitization, but verify it's actually sanitized somewhere
        // Look for any sanitization call that results in this variable
        for (let i = 0; i < lines.length; i++) {
          const checkLine = lines[i];
          if (
            checkLine.includes(variableName) &&
            (checkLine.includes('sanitize') ||
              checkLine.includes('DOMPurify') ||
              checkLine.includes('escape') ||
              checkLine.includes('purify') ||
              checkLine.includes('clean'))
          ) {
            return true;
          }
        }
      }

    } catch (error) {
      // If we can't read the file, be conservative and return false
      return false;
    }
  }

  // Pattern 4: Check for sanitization function being called with the spread/object syntax
  // e.g., dangerouslySetInnerHTML={createMarkup(sanitizedContent)}
  // e.g., dangerouslySetInnerHTML={getSanitizedHtml()}
  const functionCallPatterns = [
    /dangerouslySetInnerHTML\s*=\s*\{?\s*[a-zA-Z_$]*[Ss]anitize[a-zA-Z_$]*\s*\(/i,
    /dangerouslySetInnerHTML\s*=\s*\{?\s*[a-zA-Z_$]*[Cc]lean[a-zA-Z_$]*\s*\(/i,
    /dangerouslySetInnerHTML\s*=\s*\{?\s*[a-zA-Z_$]*[Ss]afe[a-zA-Z_$]*\s*\(/i,
    /dangerouslySetInnerHTML\s*=\s*\{?\s*[a-zA-Z_$]*[Pp]urif[a-zA-Z_$]*\s*\(/i,
    /dangerouslySetInnerHTML\s*=\s*\{?\s*[a-zA-Z_$]*[Ee]scape[a-zA-Z_$]*\s*\(/i,
  ];

  if (functionCallPatterns.some((pattern) => pattern.test(line))) {
    return true;
  }

  return false;
}

/**
 * 3a. XSS Protection: Check for user inputs displayed without escaping
 * Detects patterns where user-provided data is rendered without proper escaping
 */
function checkUnescapedUserInput() {
  if (!isCheckEnabled('xssProtection')) {
    return;
  }

  log(`\n${colors.blue}Checking for unescaped user input display...${colors.reset}`);

  // Get all TypeScript/JavaScript files in app and components directories
  const appFiles = getAllFiles(path.join(WEB_SRC, 'app'), ['.tsx', '.jsx']);
  const componentFiles = getAllFiles(path.join(WEB_SRC, 'components'), ['.tsx', '.jsx']);
  const allFiles = [...appFiles, ...componentFiles];

  allFiles.forEach((filePath) => {
    // Skip test files
    if (filePath.includes('.test.') || filePath.includes('__tests__')) return;

    if (!fs.existsSync(filePath)) return;

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Check for file-level security ignore
    const fileIgnore = hasFileLevelSecurityIgnore(filePath, 'xss');
    if (fileIgnore.ignored) {
      recordOverride(filePath, 'xss-unescaped-input', fileIgnore.reason);
      return;
    }

    // Track detected issues to avoid duplicates
    const reportedLines = new Set();

    lines.forEach((line, index) => {
      const lineNum = index + 1;

      // Skip comments
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;

      // Pattern 1: innerHTML assignment (not React's dangerouslySetInnerHTML)
      // e.g., element.innerHTML = userInput
      if (/\.innerHTML\s*=/.test(line) && !line.includes('dangerouslySetInnerHTML')) {
        // Check if value is sanitized
        if (!isSanitizedAssignment(line)) {
          reportXSSIssue(filePath, lineNum, line, reportedLines, 'innerHTML assignment without sanitization');
        }
      }

      // Pattern 2: outerHTML assignment
      // e.g., element.outerHTML = content
      if (/\.outerHTML\s*=/.test(line)) {
        if (!isSanitizedAssignment(line)) {
          reportXSSIssue(filePath, lineNum, line, reportedLines, 'outerHTML assignment without sanitization');
        }
      }

      // Pattern 3: document.write with user input
      // e.g., document.write(userInput)
      if (/document\.write\s*\(/.test(line)) {
        if (!isSanitizedAssignment(line)) {
          reportXSSIssue(filePath, lineNum, line, reportedLines, 'document.write usage (potential XSS vector)');
        }
      }

      // Pattern 4: URL parameters rendered directly in JSX
      // e.g., {searchParams.query} or {params.id} without encoding
      // Look for searchParams or useSearchParams usage rendered directly
      if (/\{.*searchParams\.[a-zA-Z]+.*\}/.test(line) || /\{.*params\.[a-zA-Z]+.*\}/.test(line)) {
        // Check if it's in an href (URL context - needs encoding)
        if (/href\s*=\s*\{.*(?:searchParams|params)\.[a-zA-Z]+/.test(line)) {
          if (!line.includes('encodeURIComponent') && !line.includes('encodeURI')) {
            reportXSSIssue(filePath, lineNum, line, reportedLines, 'URL parameter used in href without encoding');
          }
        }
      }

      // Pattern 5: eval() with any dynamic content
      if (/\beval\s*\(/.test(line)) {
        reportXSSIssue(filePath, lineNum, line, reportedLines, 'eval() usage (critical XSS/injection vector)');
      }

      // Pattern 6: new Function() with dynamic content
      if (/new\s+Function\s*\(/.test(line)) {
        // Check if it contains variables (not just string literals)
        if (/new\s+Function\s*\([^)]*[a-zA-Z_$][a-zA-Z0-9_$]*[^)]*\)/.test(line)) {
          reportXSSIssue(filePath, lineNum, line, reportedLines, 'new Function() with dynamic content (potential code injection)');
        }
      }

      // Pattern 7: setTimeout/setInterval with string argument
      if (/(?:setTimeout|setInterval)\s*\(\s*['"`]/.test(line) ||
          /(?:setTimeout|setInterval)\s*\(\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*,/.test(line)) {
        // Check if first argument is a string variable (not a function reference)
        const match = line.match(/(?:setTimeout|setInterval)\s*\(\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*,/);
        if (match) {
          // It's potentially a string being evaluated - flag for review
          // Skip if it's clearly a function name (lowercase first letter usually indicates function)
          const varName = match[1];
          if (!varName.match(/^(function|fn|callback|handler|cb|func)$/i)) {
            // Could be a string - check surrounding context
            // This is a weaker check, so only flag if we see string-related patterns
            if (content.includes(`${varName} =`) &&
                (content.includes(`${varName} = "`) || content.includes(`${varName} = '`) || content.includes(`${varName} = \``))) {
              reportXSSIssue(filePath, lineNum, line, reportedLines, 'setTimeout/setInterval with string argument (use function reference instead)');
            }
          }
        }
      }

      // Pattern 8: Script injection via createElement
      if (/createElement\s*\(\s*['"`]script['"`]\s*\)/.test(line)) {
        reportXSSIssue(filePath, lineNum, line, reportedLines, 'Dynamic script element creation (review for XSS)');
      }

      // Pattern 9: location.href or window.location assignment with user input
      if (/(?:location\.href|window\.location)\s*=/.test(line)) {
        // Check if assigned value contains user input patterns
        if (/(?:location\.href|window\.location)\s*=\s*[^;]*(?:searchParams|params|query|input|user|data)/i.test(line)) {
          if (!line.includes('encodeURIComponent') && !line.includes('encodeURI')) {
            reportXSSIssue(filePath, lineNum, line, reportedLines, 'location assignment with user input (potential open redirect/XSS)');
          }
        }
      }
    });
  });
}

/**
 * Check if an assignment line has sanitization applied
 * @param {string} line - The line to check
 * @returns {boolean}
 */
function isSanitizedAssignment(line) {
  const sanitizationPatterns = [
    /sanitize/i,
    /escape/i,
    /encode/i,
    /DOMPurify/i,
    /purify/i,
    /xss/i,
    /clean/i,
    /textContent/, // Using textContent instead of innerHTML is safe
  ];
  return sanitizationPatterns.some((pattern) => pattern.test(line));
}

/**
 * Report an XSS issue if not already reported for this line
 * @param {string} filePath - File path
 * @param {number} lineNum - Line number
 * @param {string} line - Line content
 * @param {Set} reportedLines - Set of already reported lines
 * @param {string} message - Issue message
 */
function reportXSSIssue(filePath, lineNum, line, reportedLines, message) {
  const lineKey = `${filePath}:${lineNum}`;

  if (reportedLines.has(lineKey)) return;

  // Check for line-level security ignore
  const lineIgnore = hasSecurityIgnore(filePath, lineNum, line);
  if (lineIgnore.ignored) {
    recordOverride(lineKey, 'xss-unescaped-input', lineIgnore.reason);
    return;
  }

  reportedLines.add(lineKey);
  results.xssProtection.pass = false;
  results.xssProtection.issues.push({
    file: lineKey,
    message: message,
    remediation: `Sanitize user input before rendering. Example:

  // Option 1: React's built-in escaping (safest for text content)
  <p>{userInput}</p>  // Safe - React escapes automatically

  // Option 2: Sanitize HTML content
  import { sanitizeHtml } from '@/lib/validation/schemas';
  const safeText = sanitizeHtml(userInput);

  // Option 3: Encode URLs
  const safeUrl = encodeURIComponent(userSearchQuery);
  window.location.href = \`/search?q=\${safeUrl}\`;

  // Option 4: Use textContent for DOM manipulation
  element.textContent = userInput;  // Safe
  // NOT: element.innerHTML = userInput;  // Dangerous!

📚 Documentation:
  - Schemas: ${DOCS.validationSchemas} (sanitizeHtml function)
  - DOMPurify: ${DOCS.domPurify}`,
  });
}

/**
 * 4. SQL Injection: Check for raw SQL queries
 * Improved to reduce false positives by:
 * - Requiring SQL keywords to appear in query-like contexts (strings, template literals)
 * - Excluding common false positives (HTTP methods, Zod enums, comments, JSDoc)
 * - Focusing on actual database query patterns
 */
function checkSQLInjection() {
  if (!isCheckEnabled('sqlInjection')) {
    log(`\n${colors.yellow}Skipping SQL Injection check (disabled)${colors.reset}`);
    return;
  }

  log(
    `\n${colors.blue}Checking SQL injection prevention...${colors.reset}`,
  );

  // Get all TypeScript/JavaScript files in app and lib directories
  const appFiles = getAllFiles(path.join(WEB_SRC, 'app'), ['.ts', '.tsx', '.js', '.jsx']);
  const libFiles = getAllFiles(path.join(WEB_SRC, 'lib'), ['.ts', '.tsx', '.js', '.jsx']);
  const allFiles = [...appFiles, ...libFiles];

  // Patterns that indicate actual raw SQL query construction
  // These are more specific than just matching SQL keywords
  const rawSQLPatterns = [
    // String literals containing SQL statements with table references
    // e.g., "SELECT * FROM users", 'INSERT INTO table', `DELETE FROM`
    /['"`]\s*SELECT\s+.+\s+FROM\s+/i,
    /['"`]\s*INSERT\s+INTO\s+/i,
    /['"`]\s*UPDATE\s+\w+\s+SET\s+/i,
    /['"`]\s*DELETE\s+FROM\s+/i,
    /['"`]\s*DROP\s+(TABLE|DATABASE|INDEX)\s+/i,
    /['"`]\s*CREATE\s+(TABLE|DATABASE|INDEX)\s+/i,
    /['"`]\s*ALTER\s+TABLE\s+/i,
    /['"`]\s*TRUNCATE\s+TABLE\s+/i,

    // Template literals with SQL (not tagged with sql`)
    /(?<!sql)`\s*SELECT\s+.+\s+FROM\s+/i,
    /(?<!sql)`\s*INSERT\s+INTO\s+/i,
    /(?<!sql)`\s*UPDATE\s+\w+\s+SET\s+/i,
    /(?<!sql)`\s*DELETE\s+FROM\s+/i,

    // Raw query execution patterns
    /\.query\s*\(\s*['"`]\s*(SELECT|INSERT|UPDATE|DELETE)\b/i,
    /\.execute\s*\(\s*['"`]\s*(SELECT|INSERT|UPDATE|DELETE)\b/i,
    /\.raw\s*\(\s*['"`]\s*(SELECT|INSERT|UPDATE|DELETE)\b/i,

    // SQL string variables being constructed
    /(?:const|let|var)\s+\w*(sql|query|stmt|statement)\w*\s*=\s*['"`]\s*(SELECT|INSERT|UPDATE|DELETE)\b/i,
  ];

  // Patterns that indicate SAFE usage (exclude these)
  const safePatterns = [
    // Prisma tagged template literals
    /Prisma\.sql`/i,
    /prisma\.\$queryRaw/i,
    /prisma\.\$executeRaw/i,
    /sql`/,  // Tagged template literal

    // ORM method calls (not raw SQL)
    /\.findMany\s*\(/,
    /\.findUnique\s*\(/,
    /\.findFirst\s*\(/,
    /\.create\s*\(/,
    /\.update\s*\(/,
    /\.delete\s*\(/,
    /\.upsert\s*\(/,

    // Type definitions and interfaces
    /interface\s+\w+/,
    /type\s+\w+\s*=/,

    // Import statements
    /^import\s+/,

    // HTTP methods (common false positive)
    /method:\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]/i,
    /['"`](GET|POST|PUT|DELETE|PATCH)['"`]\s*,/,

    // Zod enum patterns (common false positive)
    /z\.enum\s*\(\s*\[/,
    /\.enum\s*\(\s*\[.*(?:create|update|delete)/i,

    // React/Next.js specific patterns
    /export\s+(const|async|default)/,
  ];

  // Track reported files to avoid duplicate reports
  const reportedIssues = new Set();

  allFiles.forEach((filePath) => {
    // Skip test files
    if (filePath.includes('.test.') || filePath.includes('__tests__')) return;
    // Skip type definition files
    if (filePath.endsWith('.d.ts')) return;

    if (!fs.existsSync(filePath)) return;

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Check for file-level security ignore
    const fileIgnore = hasFileLevelSecurityIgnore(filePath, 'sql');
    if (fileIgnore.ignored) {
      recordOverride(filePath, 'sql-raw-query', fileIgnore.reason);
      return;
    }

    lines.forEach((line, index) => {
      const lineNum = index + 1;
      const trimmedLine = line.trim();

      // Skip empty lines
      if (!trimmedLine) return;

      // Skip comments (single-line, multi-line start, JSDoc)
      if (trimmedLine.startsWith('//') ||
          trimmedLine.startsWith('/*') ||
          trimmedLine.startsWith('*') ||
          trimmedLine.startsWith('/**')) {
        return;
      }

      // Skip lines that match safe patterns
      const isSafePattern = safePatterns.some(pattern => pattern.test(line));
      if (isSafePattern) return;

      // Check if line matches any raw SQL pattern
      const matchesRawSQL = rawSQLPatterns.some(pattern => pattern.test(line));

      if (matchesRawSQL) {
        const issueKey = `${filePath}:${lineNum}`;

        // Avoid duplicate reports
        if (reportedIssues.has(issueKey)) return;

        // Check for line-level security ignore
        const lineIgnore = hasSecurityIgnore(filePath, lineNum, line);
        if (lineIgnore.ignored) {
          recordOverride(issueKey, 'sql-raw-query', lineIgnore.reason);
          return;
        }

        reportedIssues.add(issueKey);
        results.sqlInjection.pass = false;
        results.sqlInjection.issues.push({
          file: issueKey,
          message: 'Potential raw SQL query detected',
          remediation: `Use Prisma ORM or parameterized queries instead of raw SQL. Example:

  // UNSAFE - vulnerable to SQL injection:
  const query = \`SELECT * FROM users WHERE id = '\${userId}'\`;

  // SAFE - Use Prisma ORM methods:
  const user = await prisma.user.findUnique({
    where: { id: userId }
  });

  // SAFE - Use Prisma.sql tagged template for raw queries:
  import { Prisma } from '@prisma/client';
  const users = await prisma.$queryRaw(
    Prisma.sql\`SELECT * FROM users WHERE id = \${userId}\`
  );

  // The Prisma.sql tag automatically parameterizes values

📚 Documentation:
  - Prisma Raw Queries: ${DOCS.prisma}`,
        });
      }
    });
  });
}

/**
 * 4a. SQL Injection: Check for string concatenation in database query patterns
 * Detects patterns like: query + userInput, sql + variable, "SELECT..." + param
 */
function checkQueryStringConcatenation() {
  if (!isCheckEnabled('sqlInjection')) {
    return;
  }

  log(`\n${colors.blue}Checking for string concatenation in database queries...${colors.reset}`);

  // Get all TypeScript/JavaScript files in app and lib directories
  const appFiles = getAllFiles(path.join(WEB_SRC, 'app'), ['.ts', '.tsx', '.js', '.jsx']);
  const libFiles = getAllFiles(path.join(WEB_SRC, 'lib'), ['.ts', '.tsx', '.js', '.jsx']);
  const allFiles = [...appFiles, ...libFiles];

  // SQL keywords that indicate a query context
  const sqlKeywords = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'FROM', 'WHERE', 'JOIN', 'ORDER BY', 'GROUP BY'];

  allFiles.forEach((filePath) => {
    // Skip test files
    if (filePath.includes('.test.') || filePath.includes('__tests__')) return;
    // Skip type definition files
    if (filePath.endsWith('.d.ts')) return;

    if (!fs.existsSync(filePath)) return;

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Check for file-level security ignore
    const fileIgnore = hasFileLevelSecurityIgnore(filePath, 'sql');
    if (fileIgnore.ignored) {
      recordOverride(filePath, 'sql-concatenation', fileIgnore.reason);
      return;
    }

    // Track reported lines to avoid duplicates
    const reportedLines = new Set();

    lines.forEach((line, index) => {
      const lineNum = index + 1;
      const trimmedLine = line.trim();

      // Skip comments
      if (trimmedLine.startsWith('//') || trimmedLine.startsWith('*') || trimmedLine.startsWith('/*')) return;

      // Pattern 1: String concatenation with SQL keywords in string literals
      // e.g., "SELECT * FROM users WHERE id = " + id
      // e.g., 'DELETE FROM ' + tableName + ' WHERE...'
      const sqlStringConcatPattern = new RegExp(
        `(['"\`])\\s*(${sqlKeywords.join('|')})\\b[^'"\`]*\\1\\s*\\+\\s*[a-zA-Z_$][a-zA-Z0-9_$]*`,
        'i'
      );

      // Pattern 2: Variable + SQL keyword string
      // e.g., baseQuery + " WHERE id = " + userId
      const varPlusSqlPattern = /[a-zA-Z_$][a-zA-Z0-9_$]*\s*\+\s*['"`]\s*(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|AND|OR)\b/i;

      // Pattern 3: SQL-related variable names being concatenated
      // e.g., query + userInput, sql + param, sqlQuery + value
      const sqlVarConcatPattern = /\b(query|sql|statement|cmd|command)\s*(\+|=\s*[^=].*\+)\s*[a-zA-Z_$][a-zA-Z0-9_$]*/i;

      // Pattern 4: Template literal with SQL that includes unsafe interpolation
      // e.g., `SELECT * FROM ${table} WHERE id = ${id}`
      // This is risky if variables aren't sanitized
      const templateSqlPattern = /`[^`]*(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\b[^`]*\$\{[^}]+\}[^`]*`/i;

      // Pattern 5: String concatenation ending with user input patterns
      // e.g., "... WHERE id = " + req.body.id, "..." + params.id
      const inputConcatPattern = /['"`][^'"`]*(WHERE|AND|OR|SET|VALUES)\s*[^'"`]*['"`]\s*\+\s*(req\.|params\.|input|user|data|body|query)\b/i;

      // Pattern 6: Direct concatenation in execute/query function calls
      // e.g., db.query("SELECT * FROM " + table)
      // e.g., execute(sql + condition)
      const execConcatPattern = /\.(query|execute|raw|run|all|get)\s*\([^)]*\+[^)]*\)/i;

      let issueFound = false;
      let issueMessage = '';

      if (sqlStringConcatPattern.test(line)) {
        issueFound = true;
        issueMessage = 'SQL string concatenated with variable';
      } else if (varPlusSqlPattern.test(line)) {
        issueFound = true;
        issueMessage = 'Variable concatenated with SQL string';
      } else if (sqlVarConcatPattern.test(line)) {
        // Additional check: make sure it's not just a variable declaration
        // and that it looks like actual concatenation with user input
        const match = line.match(sqlVarConcatPattern);
        if (match && !line.includes('const ') && !line.includes('let ') && !line.includes('var ')) {
          // Check if this looks like concatenation with external input
          if (line.includes('+') && !line.match(/\+\s*['"`]/)) {
            // Concatenation with a variable, not a string literal
            issueFound = true;
            issueMessage = 'SQL query variable concatenated with another variable';
          }
        } else if (match && line.includes('+')) {
          // Even in declarations, flag if concatenating with user-related vars
          if (/\+\s*(user|input|param|req|body|data|id)\w*/i.test(line)) {
            issueFound = true;
            issueMessage = 'SQL query built with user input concatenation';
          }
        }
      }

      if (!issueFound && templateSqlPattern.test(line)) {
        // Check if template literal contains potentially unsafe interpolations
        // Safe: `sql` template tag, parameterized values
        // Unsafe: direct variable interpolation in query
        if (!line.includes('sql`') && !line.includes('Prisma')) {
          // Check if the interpolation looks like user input
          const interpolations = line.match(/\$\{([^}]+)\}/g);
          if (interpolations) {
            const hasUnsafeInterpolation = interpolations.some((interp) => {
              const varName = interp.replace(/\$\{|\}/g, '').trim();
              // Flag if it looks like user input or unparameterized value
              return /^(req|params|query|body|user|input|data|id|name|email|search|filter)/i.test(varName) ||
                     /\.(id|name|email|query|search|filter|param)/i.test(varName);
            });
            if (hasUnsafeInterpolation) {
              issueFound = true;
              issueMessage = 'SQL template literal with potentially unsafe interpolation';
            }
          }
        }
      }

      if (!issueFound && inputConcatPattern.test(line)) {
        issueFound = true;
        issueMessage = 'SQL clause concatenated with user input';
      }

      if (!issueFound && execConcatPattern.test(line)) {
        issueFound = true;
        issueMessage = 'Database query/execute call with string concatenation';
      }

      if (issueFound && !reportedLines.has(lineNum)) {
        // Check for line-level security ignore
        const lineIgnore = hasSecurityIgnore(filePath, lineNum, line);
        if (lineIgnore.ignored) {
          recordOverride(`${filePath}:${lineNum}`, 'sql-concatenation', lineIgnore.reason);
          return;
        }

        reportedLines.add(lineNum);
        results.sqlInjection.pass = false;
        results.sqlInjection.issues.push({
          file: `${filePath}:${lineNum}`,
          message: issueMessage,
          remediation: `Never concatenate user input into SQL strings. Use parameterized queries. Example:

  // UNSAFE - string concatenation:
  const query = "SELECT * FROM users WHERE name = '" + userName + "'";
  db.query(query);

  // SAFE - Prisma ORM:
  const user = await prisma.user.findMany({
    where: { name: userName }
  });

  // SAFE - Prisma.sql for raw queries:
  const result = await prisma.$queryRaw(
    Prisma.sql\`SELECT * FROM users WHERE name = \${userName}\`
  );

  // SAFE - parameterized query (other ORMs):
  db.query('SELECT * FROM users WHERE name = ?', [userName]);

📚 Documentation:
  - Prisma Raw Queries: ${DOCS.prisma}`,
        });
      }
    });
  });
}

/**
 * 5. Authentication: Check for protected route implementation
 */
function checkAuthentication() {
  if (!isCheckEnabled('authentication')) {
    log(`\n${colors.yellow}Skipping Authentication check (disabled)${colors.reset}`);
    return;
  }

  log(
    `\n${colors.blue}Checking authentication configuration...${colors.reset}`,
  );

  // Check for auth configuration (stadium-8 uses lib/auth/)
  const authConfigPath = path.join(WEB_SRC, 'lib', 'auth', 'auth.config.ts');
  const authPath = path.join(WEB_SRC, 'lib', 'auth', 'auth.ts');

  if (!fs.existsSync(authConfigPath) && !fs.existsSync(authPath)) {
    results.authentication.pass = false;
    results.authentication.issues.push({
      file: 'lib/auth/',
      message: 'Authentication configuration not found',
      remediation: `Create authentication configuration files. Expected structure:

  web/src/lib/auth/
  ├── auth.ts          # NextAuth configuration export
  ├── auth.config.ts   # Auth options (providers, callbacks)
  └── auth-helpers.ts  # RBAC helper functions

  Example auth.ts:
  import NextAuth from 'next-auth';
  import { authConfig } from './auth.config';

  export const { auth, handlers, signIn, signOut } = NextAuth(authConfig);

📚 Documentation:
  - Guide: ${DOCS.authentication}
  - Auth helpers: ${DOCS.authHelpers}
  - NextAuth.js: ${DOCS.nextAuth}`,
    });
    return;
  }

  // Check for protected layout (Server Component auth pattern)
  const protectedLayoutPath = path.join(WEB_SRC, 'app', '(protected)', 'layout.tsx');
  if (!fs.existsSync(protectedLayoutPath)) {
    // This is a warning, not a failure - protected routes might use different patterns
    log(`  ${colors.yellow}Note: No (protected) route group layout found${colors.reset}`);
  }
}

// ============================================================================
// POPIA COMPLIANCE CHECKS
// ============================================================================

/**
 * PII (Personal Identifiable Information) field patterns
 * These patterns match common field names that may contain personal data
 * regulated under POPIA (Protection of Personal Information Act)
 */
const PII_FIELD_PATTERNS = {
  // South African specific
  saIdNumber: /\b(sa_?id|id_?number|identity_?number|rsa_?id)\b/i,

  // Contact information
  email: /\b(email|e_?mail|email_?address)\b/i,
  phone: /\b(phone|mobile|cell|telephone|tel_?number|contact_?number)\b/i,
  address: /\b(address|street|postal|physical_?address|home_?address|residential)\b/i,

  // Personal identifiers
  fullName: /\b(full_?name|first_?name|last_?name|surname|given_?name|family_?name)\b/i,
  dateOfBirth: /\b(dob|date_?of_?birth|birth_?date|birthday)\b/i,
  gender: /\b(gender|sex)\b/i,

  // Financial information
  bankAccount: /\b(bank_?account|account_?number|iban|swift|bic)\b/i,
  taxNumber: /\b(tax_?number|tax_?id|vat_?number|tin)\b/i,

  // Sensitive categories (POPIA special personal information)
  race: /\b(race|ethnicity|ethnic_?group)\b/i,
  religion: /\b(religion|religious_?affiliation|faith)\b/i,
  health: /\b(health|medical|diagnosis|condition|disability)\b/i,
  biometric: /\b(biometric|fingerprint|facial_?recognition|retina)\b/i,
  criminal: /\b(criminal|conviction|offense|offence)\b/i,
  union: /\b(trade_?union|union_?membership|union_?member)\b/i,
  political: /\b(political_?affiliation|political_?party|political_?opinion)\b/i,
  sexual: /\b(sexual_?orientation|sexual_?preference)\b/i,
};

/**
 * Logging function patterns that might expose PII
 */
const LOGGING_PATTERNS = [
  /console\s*\.\s*(log|info|debug|warn|error|trace)\s*\(/,
  /logger\s*\.\s*(log|info|debug|warn|error|trace)\s*\(/,
  /log\s*\.\s*(info|debug|warn|error|trace)\s*\(/,
  /winston\s*\.\s*(log|info|debug|warn|error)\s*\(/,
  /pino\s*\.\s*(info|debug|warn|error|trace)\s*\(/,
];

/**
 * 6. POPIA: Check for PII being logged
 * Detects console.log, logger calls that might contain personal information
 */
function checkPIILogging() {
  if (!isCheckEnabled('popiaLogging')) {
    log(`\n${colors.yellow}Skipping POPIA PII Logging check (disabled)${colors.reset}`);
    return;
  }

  log(`\n${colors.blue}Checking for PII in logging statements (POPIA)...${colors.reset}`);

  const allFiles = getAllFiles(WEB_SRC);

  allFiles.forEach((filePath) => {
    // Skip test files and node_modules
    if (filePath.includes('__tests__') ||
        filePath.includes('.test.') ||
        filePath.includes('.spec.') ||
        filePath.includes('node_modules')) {
      return;
    }

    // Check for file-level security ignore
    const fileIgnore = hasFileLevelSecurityIgnore(filePath, 'popia');
    if (fileIgnore.ignored) {
      recordOverride(filePath, 'popia-logging', fileIgnore.reason);
      return;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        const lineNumber = index + 1;

        // Check if this line has a logging statement
        const hasLogging = LOGGING_PATTERNS.some((pattern) => pattern.test(line));
        if (!hasLogging) return;

        // Skip if this is inside a comment block (JSDoc, multiline comment, or code examples)
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('*') ||
            trimmedLine.startsWith('//') ||
            trimmedLine.startsWith('/*') ||
            trimmedLine.startsWith('```')) {
          return;
        }

        // Check if the logging statement contains PII field references
        const piiFieldsFound = [];
        for (const [fieldType, pattern] of Object.entries(PII_FIELD_PATTERNS)) {
          if (pattern.test(line)) {
            piiFieldsFound.push(fieldType);
          }
        }

        if (piiFieldsFound.length > 0) {
          // Check for inline security-ignore
          const ignoreCheck = hasSecurityIgnore(filePath, lineNumber, line);
          if (ignoreCheck.ignored) {
            recordOverride(`${filePath}:${lineNumber}`, 'popia-logging', ignoreCheck.reason);
            return;
          }

          // Check if line contains sanitization indicators
          const hasSanitization = /sanitize|mask|redact|obfuscate|\*{3,}|\.{3,}|xxx/i.test(line);
          if (hasSanitization) return;

          results.popiaLogging.pass = false;
          results.popiaLogging.issues.push({
            file: `${filePath}:${lineNumber}`,
            message: `Potential PII logging detected: ${piiFieldsFound.join(', ')}`,
            remediation: `Avoid logging personal information. POPIA requires protection of personal data.

Options:
1. Remove PII from log statement entirely
2. Mask/redact the data before logging:
   console.log('User email:', maskEmail(user.email));
3. Use structured logging with PII filtering:
   logger.info({ userId: user.id }); // Log ID, not PII
4. Add security-ignore comment if intentional:
   // security-ignore: PII logging required for audit trail (encrypted logs)

📚 POPIA Reference: ${DOCS.popia}`,
          });
        }
      });
    } catch (error) {
      // Skip files that can't be read
    }
  });
}

/**
 * Helper function to mask email for safe logging
 * @param {string} email - Email to mask
 * @returns {string} Masked email (e.g., "j***@example.com")
 */
function maskEmailExample(email) {
  if (!email || !email.includes('@')) return '***';
  const [local, domain] = email.split('@');
  return `${local[0]}***@${domain}`;
}

/**
 * 7. POPIA: Check for unprotected PII field handling
 * Detects PII being stored in localStorage, cookies, or sent without encryption indicators
 */
function checkPIIFieldHandling() {
  if (!isCheckEnabled('popiaFieldHandling')) {
    log(`\n${colors.yellow}Skipping POPIA PII Field Handling check (disabled)${colors.reset}`);
    return;
  }

  log(`\n${colors.blue}Checking for unprotected PII handling (POPIA)...${colors.reset}`);

  const allFiles = getAllFiles(WEB_SRC);

  // Patterns for potentially unsafe PII storage
  const unsafeStoragePatterns = [
    { pattern: /localStorage\s*\.\s*setItem\s*\(/, name: 'localStorage' },
    { pattern: /sessionStorage\s*\.\s*setItem\s*\(/, name: 'sessionStorage' },
    { pattern: /document\s*\.\s*cookie\s*=/, name: 'cookie' },
    { pattern: /setCookie\s*\(/, name: 'setCookie' },
  ];

  allFiles.forEach((filePath) => {
    // Skip test files
    if (filePath.includes('__tests__') ||
        filePath.includes('.test.') ||
        filePath.includes('.spec.') ||
        filePath.includes('node_modules')) {
      return;
    }

    // Check for file-level security ignore
    const fileIgnore = hasFileLevelSecurityIgnore(filePath, 'popia');
    if (fileIgnore.ignored) {
      recordOverride(filePath, 'popia-fields', fileIgnore.reason);
      return;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        const lineNumber = index + 1;

        // Check each unsafe storage pattern
        for (const { pattern, name } of unsafeStoragePatterns) {
          if (!pattern.test(line)) continue;

          // Check if PII fields are being stored
          const piiFieldsFound = [];
          for (const [fieldType, piiPattern] of Object.entries(PII_FIELD_PATTERNS)) {
            if (piiPattern.test(line)) {
              piiFieldsFound.push(fieldType);
            }
          }

          if (piiFieldsFound.length > 0) {
            // Check for inline security-ignore
            const ignoreCheck = hasSecurityIgnore(filePath, lineNumber, line);
            if (ignoreCheck.ignored) {
              recordOverride(`${filePath}:${lineNumber}`, 'popia-fields', ignoreCheck.reason);
              return;
            }

            // Check for encryption indicators
            const hasEncryption = /encrypt|cipher|crypto|hash|bcrypt|argon/i.test(line) ||
                                  /encrypt|cipher|crypto/i.test(content.substring(Math.max(0, index - 500), index));
            if (hasEncryption) return;

            results.popiaFieldHandling.pass = false;
            results.popiaFieldHandling.issues.push({
              file: `${filePath}:${lineNumber}`,
              message: `PII stored in ${name} without encryption: ${piiFieldsFound.join(', ')}`,
              remediation: `POPIA requires appropriate security measures for personal data.

Options:
1. Avoid storing PII in browser storage - use server-side sessions
2. Encrypt data before storing:
   localStorage.setItem('user', encrypt(JSON.stringify(userData)));
3. Store only non-sensitive identifiers (user ID, not email/name)
4. Use httpOnly, secure cookies for sensitive data
5. Add security-ignore if encrypted elsewhere:
   // security-ignore: Data encrypted via encryptUserData() before storage

📚 POPIA Reference: ${DOCS.popia}
📚 Guidelines: ${DOCS.popiaGuidelines}`,
            });
          }
        }
      });
    } catch (error) {
      // Skip files that can't be read
    }
  });

  // Also check for SA ID number patterns being handled without validation
  checkSAIDNumberHandling(allFiles);
}

/**
 * Check for South African ID numbers being handled without proper validation
 * SA ID numbers are 13 digits and contain encoded personal information
 * @param {string[]} allFiles - Array of file paths to check
 */
function checkSAIDNumberHandling(allFiles) {
  // Pattern for SA ID number regex or validation
  const saIdRegexPattern = /\b\d{13}\b|\b\d{6}\s?\d{4}\s?\d{3}\b/;

  allFiles.forEach((filePath) => {
    if (filePath.includes('__tests__') ||
        filePath.includes('.test.') ||
        filePath.includes('node_modules')) {
      return;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');

      // Check if file handles ID numbers
      if (!PII_FIELD_PATTERNS.saIdNumber.test(content)) return;

      // Check if there's proper validation (Luhn algorithm, length check, date validation)
      const hasValidation = /luhn|checksum|validateId|isValidId|id_?validation|length\s*[=!]==?\s*13/i.test(content);
      const hasMasking = /mask|redact|slice\s*\(\s*-?\d+\s*\)|substring|replace\s*\([^)]*\*+/i.test(content);

      if (!hasValidation && !hasMasking) {
        // Only flag if this file processes (not just displays) ID numbers
        const processesId = /\.(save|create|update|post|put|insert|store)\s*\(|fetch\s*\(|axios/i.test(content);

        if (processesId) {
          results.popiaFieldHandling.pass = false;
          results.popiaFieldHandling.issues.push({
            file: filePath,
            message: 'SA ID number handling detected without validation or masking',
            remediation: `SA ID numbers contain encoded personal data (DOB, gender, citizenship).
POPIA requires appropriate safeguards.

Recommendations:
1. Validate ID numbers before storage (Luhn checksum, date validation)
2. Mask ID numbers when displaying: 850101****123
3. Consider storing only a hash if full ID isn't needed
4. Implement access controls for ID number data

Example validation:
function isValidSAID(id) {
  if (!/^\\d{13}$/.test(id)) return false;
  // Validate date portion, checksum, etc.
  return luhnCheck(id);
}

📚 POPIA Reference: ${DOCS.popia}`,
          });
        }
      }
    } catch (error) {
      // Skip files that can't be read
    }
  });
}

/**
 * Check if running in GitHub Actions environment
 * @returns {boolean}
 */
function isGitHubActions() {
  return process.env.GITHUB_ACTIONS === 'true';
}

/**
 * Generate GitHub Actions Job Summary with markdown tables
 * Writes to GITHUB_STEP_SUMMARY environment file
 * @see https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#adding-a-job-summary
 */
function generateGitHubSummary() {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) {
    return; // Not running in GitHub Actions or summary not available
  }

  const categories = Object.keys(config).map((key) => ({
    key,
    name: config[key].name,
    severity: config[key].severity,
  }));

  let markdown = '# 🔒 Security Validation Report\n\n';

  // Summary table
  markdown += '## Summary\n\n';
  markdown += '| Check | Severity | Status | Issues |\n';
  markdown += '|-------|----------|--------|--------|\n';

  let totalIssues = 0;
  let totalErrors = 0;
  let totalWarnings = 0;

  categories.forEach(({ name, key, severity }) => {
    if (severity === SEVERITY.OFF) {
      markdown += `| ${name} | - | ⏭️ Disabled | - |\n`;
      return;
    }

    const result = results[key];
    const issueCount = result.issues.length;
    totalIssues += issueCount;

    const severityLabel = severity === SEVERITY.ERROR ? '🔴 Error' : '🟡 Warning';
    let statusIcon;

    if (result.pass) {
      statusIcon = '✅ Pass';
    } else if (severity === SEVERITY.ERROR) {
      statusIcon = '❌ Failed';
      totalErrors += issueCount;
    } else {
      statusIcon = '⚠️ Warning';
      totalWarnings += issueCount;
    }

    markdown += `| ${name} | ${severityLabel} | ${statusIcon} | ${issueCount} |\n`;
  });

  markdown += '\n';

  // Overall status
  if (totalErrors > 0) {
    markdown += `> **❌ Validation Failed** - ${totalErrors} error(s) must be fixed before merge\n\n`;
  } else if (totalWarnings > 0) {
    markdown += `> **⚠️ Passed with Warnings** - ${totalWarnings} warning(s) should be reviewed\n\n`;
  } else {
    markdown += `> **✅ All Checks Passed**\n\n`;
  }

  // Detailed issues section
  let hasDetailedIssues = false;
  categories.forEach(({ name, key, severity }) => {
    if (severity === SEVERITY.OFF) return;

    const result = results[key];
    if (!result.pass && result.issues.length > 0) {
      if (!hasDetailedIssues) {
        markdown += '## Issues Details\n\n';
        hasDetailedIssues = true;
      }

      const isError = severity === SEVERITY.ERROR;
      const icon = isError ? '❌' : '⚠️';
      markdown += `### ${icon} ${name}\n\n`;

      markdown += '| File | Issue | Remediation |\n';
      markdown += '|------|-------|-------------|\n';

      result.issues.forEach((issue) => {
        const { filePath, lineNumber } = parseIssueFile(issue.file);
        const fileLink = lineNumber
          ? `\`${filePath}:${lineNumber}\``
          : `\`${filePath}\``;

        // Escape pipe characters and truncate long remediation for table
        const escapedMessage = issue.message.replace(/\|/g, '\\|').replace(/\n/g, ' ');
        const remediationPreview = getRemediationPreview(issue.remediation);

        markdown += `| ${fileLink} | ${escapedMessage} | ${remediationPreview} |\n`;
      });

      markdown += '\n';

      // Add full remediation details in collapsible sections
      markdown += '<details>\n<summary>📚 Full Remediation Details</summary>\n\n';
      result.issues.forEach((issue, index) => {
        const { filePath, lineNumber } = parseIssueFile(issue.file);
        const fileRef = lineNumber ? `${filePath}:${lineNumber}` : filePath;
        markdown += `#### Issue ${index + 1}: \`${fileRef}\`\n\n`;
        markdown += '```\n';
        markdown += issue.remediation;
        markdown += '\n```\n\n';
      });
      markdown += '</details>\n\n';
    }
  });

  // Security overrides section
  if (overrides.length > 0) {
    markdown += '## 🔓 Security Overrides Applied\n\n';
    markdown += '| File | Check Type | Reason |\n';
    markdown += '|------|------------|--------|\n';

    overrides.forEach((override) => {
      const escapedReason = override.reason.replace(/\|/g, '\\|').replace(/\n/g, ' ');
      markdown += `| \`${override.file}\` | ${override.checkType} | ${escapedReason} |\n`;
    });

    markdown += '\n';
  }

  // Footer
  markdown += '---\n';
  markdown += `*Generated by Security Pattern Validator*\n`;

  // Write to GitHub Step Summary
  try {
    fs.appendFileSync(summaryFile, markdown);
  } catch (error) {
    console.error(`Failed to write GitHub summary: ${error.message}`);
  }
}

/**
 * Get a short preview of remediation text for the summary table
 * @param {string} remediation - Full remediation text
 * @returns {string} Short preview suitable for table cell
 */
function getRemediationPreview(remediation) {
  // Extract the first sentence or line
  const firstLine = remediation.split('\n')[0].trim();

  // Find the first meaningful instruction (skip "Example:" type headers)
  const cleanedLine = firstLine
    .replace(/^(Example|See|Add|Use|Create|Sanitize|Never):?\s*/i, '')
    .trim();

  // Truncate if needed
  const maxLength = 60;
  if (cleanedLine.length > maxLength) {
    return cleanedLine.substring(0, maxLength - 3) + '...';
  }

  // If the first line is too short, try to get more context
  if (cleanedLine.length < 20) {
    return firstLine.substring(0, maxLength);
  }

  return cleanedLine || firstLine.substring(0, maxLength);
}

/**
 * Generate JSON report for CI integration
 * @param {number} executionTimeMs - Execution time in milliseconds
 * @returns {{ report: object, hasErrors: boolean }}
 */
function generateJSONReport(executionTimeMs) {
  const categories = Object.keys(config).map((key) => ({
    key,
    name: config[key].name,
    severity: config[key].severity,
  }));

  let totalIssues = 0;
  let totalErrors = 0;
  let totalWarnings = 0;

  const checks = {};

  categories.forEach(({ name, key, severity }) => {
    const result = results[key];
    const issueCount = result.issues.length;
    totalIssues += issueCount;

    const isError = severity === SEVERITY.ERROR;

    if (!result.pass) {
      if (isError) {
        totalErrors += issueCount;
      } else {
        totalWarnings += issueCount;
      }
    }

    // Transform issues to include parsed file info
    const transformedIssues = result.issues.map((issue) => {
      const { filePath, lineNumber } = parseIssueFile(issue.file);
      return {
        file: filePath,
        line: lineNumber,
        message: issue.message,
        remediation: issue.remediation,
      };
    });

    checks[key] = {
      name: name,
      severity: severity,
      passed: result.pass,
      issueCount: issueCount,
      issues: transformedIssues,
    };
  });

  // Transform overrides
  const transformedOverrides = overrides.map((override) => ({
    file: override.file,
    checkType: override.checkType,
    reason: override.reason,
  }));

  const report = {
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    executionTimeMs: executionTimeMs,
    summary: {
      passed: totalErrors === 0,
      totalChecks: categories.length,
      totalIssues: totalIssues,
      errors: totalErrors,
      warnings: totalWarnings,
      overridesApplied: overrides.length,
    },
    checks: checks,
    overrides: transformedOverrides,
    documentation: DOCS,
  };

  return { report, hasErrors: totalErrors > 0 };
}

/**
 * Output JSON report and exit
 * @param {number} executionTimeMs - Execution time in milliseconds
 */
function outputJSONReport(executionTimeMs) {
  const { report, hasErrors } = generateJSONReport(executionTimeMs);

  // Output JSON to stdout
  console.log(JSON.stringify(report, null, 2));

  // Still generate GitHub summary if in CI
  if (isGitHubActions()) {
    generateGitHubSummary();
  }

  // Exit with appropriate code
  process.exit(hasErrors ? 1 : 0);
}

/**
 * Parse file path and line number from issue file string
 * @param {string} fileString - File string in format "path:line" or just "path"
 * @returns {{ filePath: string, lineNumber: number | null }}
 */
function parseIssueFile(fileString) {
  // Handle Windows paths (C:\path\file.ts:10)
  let filePath, lineNumber;

  if (/^[a-zA-Z]:/.test(fileString)) {
    // Windows path
    const afterDrive = fileString.substring(2);
    const lastColonIndex = afterDrive.lastIndexOf(':');

    if (lastColonIndex !== -1) {
      const potentialLineNum = afterDrive.substring(lastColonIndex + 1);
      if (/^\d+$/.test(potentialLineNum)) {
        filePath = fileString.substring(0, 2) + afterDrive.substring(0, lastColonIndex);
        lineNumber = parseInt(potentialLineNum, 10);
      } else {
        filePath = fileString;
        lineNumber = null;
      }
    } else {
      filePath = fileString;
      lineNumber = null;
    }
  } else {
    // Unix path
    const lastColonIndex = fileString.lastIndexOf(':');
    if (lastColonIndex !== -1) {
      const potentialLineNum = fileString.substring(lastColonIndex + 1);
      if (/^\d+$/.test(potentialLineNum)) {
        filePath = fileString.substring(0, lastColonIndex);
        lineNumber = parseInt(potentialLineNum, 10);
      } else {
        filePath = fileString;
        lineNumber = null;
      }
    } else {
      filePath = fileString;
      lineNumber = null;
    }
  }

  // Convert absolute path to relative path for GitHub Actions
  // GitHub Actions expects paths relative to the repository root
  const cwd = process.cwd();
  if (filePath.startsWith(cwd)) {
    filePath = filePath.substring(cwd.length + 1);
  }

  // Normalize path separators for GitHub Actions (use forward slashes)
  filePath = filePath.replace(/\\/g, '/');

  return { filePath, lineNumber };
}

/**
 * Output GitHub Actions annotation
 * @param {'error' | 'warning'} level - Annotation level
 * @param {string} fileString - File path with optional line number
 * @param {string} message - The issue message
 * @param {string} title - Title for the annotation
 */
function outputGitHubAnnotation(level, fileString, message, title) {
  const { filePath, lineNumber } = parseIssueFile(fileString);

  // Build the annotation command
  // Format: ::error file={name},line={line},title={title}::{message}
  let annotation = `::${level} file=${filePath}`;

  if (lineNumber !== null) {
    annotation += `,line=${lineNumber}`;
  }

  if (title) {
    annotation += `,title=${title}`;
  }

  annotation += `::${message}`;

  console.log(annotation);
}

/**
 * Generate report
 */
function generateReport() {
  const inGitHubActions = isGitHubActions();

  console.log(`\n${'='.repeat(70)}`);
  console.log(`${colors.blue}SECURITY VALIDATION REPORT${colors.reset}`);
  console.log(`${'='.repeat(70)}\n`);

  const categories = Object.keys(config).map((key) => ({
    key,
    name: config[key].name,
    severity: config[key].severity,
  }));

  let hasErrors = false;
  let hasWarnings = false;

  // Track issue counts by category
  const issueCounts = {};
  let totalIssues = 0;

  categories.forEach(({ name, key, severity }) => {
    // Skip disabled checks
    if (severity === SEVERITY.OFF) {
      console.log(`${name}: ${colors.yellow}Disabled${colors.reset}`);
      return;
    }

    const result = results[key];
    const isError = severity === SEVERITY.ERROR;
    const hasFailed = !result.pass;

    // Track issue counts
    const issueCount = result.issues.length;
    if (issueCount > 0) {
      issueCounts[name] = issueCount;
      totalIssues += issueCount;
    }

    // Display check result with clear, unambiguous formatting
    // - Passed checks: just show the name with a checkmark
    // - Failed checks: show name with status and severity context
    if (result.pass) {
      console.log(`${colors.green}✅${colors.reset} ${name}`);
    } else if (isError) {
      hasErrors = true;
      console.log(`${colors.red}❌${colors.reset} ${name}: ${colors.red}FAILED${colors.reset} (blocks PR)`);
    } else {
      hasWarnings = true;
      console.log(`${colors.yellow}⚠️${colors.reset}  ${name}: ${colors.yellow}WARNING${colors.reset} (review recommended)`);
    }

    if (hasFailed) {
      const issueColor = isError ? colors.red : colors.yellow;
      const issueMarker = isError ? '✗' : '⚠';

      result.issues.forEach((issue) => {
        // Output GitHub Actions annotation if running in CI
        if (inGitHubActions) {
          const annotationLevel = isError ? 'error' : 'warning';
          const title = `Security: ${name}`;
          outputGitHubAnnotation(annotationLevel, issue.file, issue.message, title);
        }

        console.log(`  ${issueColor}${issueMarker}${colors.reset}  ${issue.file}`);
        console.log(`     ${issue.message}`);
        console.log(
          `     ${colors.blue}Fix:${colors.reset} ${issue.remediation}\n`,
        );
      });
    }
  });

  // Show overrides that were used
  if (overrides.length > 0) {
    console.log(`\n${'-'.repeat(70)}`);
    console.log(`${colors.yellow}Security Overrides Applied (${overrides.length}):${colors.reset}\n`);
    overrides.forEach((override) => {
      console.log(`  ${colors.yellow}~${colors.reset}  ${override.file}`);
      console.log(`     Check: ${override.checkType}`);
      console.log(`     Reason: ${override.reason}\n`);
    });
  }

  console.log(`\n${'='.repeat(70)}`);

  // Display issue counts summary
  if (totalIssues > 0) {
    const breakdown = Object.entries(issueCounts)
      .map(([name, count]) => `${count} ${name}`)
      .join(', ');
    console.log(
      `\n${colors.blue}Summary:${colors.reset} ${totalIssues} issue${totalIssues === 1 ? '' : 's'} found: ${breakdown}`,
    );
  }

  // Generate GitHub Actions Job Summary if running in CI
  if (inGitHubActions) {
    generateGitHubSummary();
  }

  // Final status message
  if (!hasErrors && !hasWarnings) {
    console.log(
      `\n${colors.green}All security checks passed!${colors.reset}\n`,
    );
    process.exit(0);
  } else if (!hasErrors && hasWarnings) {
    console.log(
      `\n${colors.yellow}Security checks passed with warnings. Review the warnings above.${colors.reset}\n`,
    );
    process.exit(0);
  } else {
    console.log(
      `\n${colors.red}Security validation failed. Please fix the errors above.${colors.reset}\n`,
    );
    process.exit(1);
  }
}

/**
 * Time limit for validation in milliseconds (2 minutes)
 */
const TIME_LIMIT_MS = 2 * 60 * 1000;

/**
 * Warning threshold - warn if execution exceeds 80% of time limit
 */
const TIME_WARNING_THRESHOLD_MS = TIME_LIMIT_MS * 0.8;

/**
 * Track execution time and check against limits
 * @param {number} startTime - Start time from Date.now()
 * @returns {{ elapsed: number, elapsedSeconds: number, percentOfLimit: number, isOverLimit: boolean, isNearLimit: boolean }}
 */
function checkExecutionTime(startTime) {
  const elapsed = Date.now() - startTime;
  const elapsedSeconds = (elapsed / 1000).toFixed(2);
  const percentOfLimit = ((elapsed / TIME_LIMIT_MS) * 100).toFixed(1);
  const isOverLimit = elapsed > TIME_LIMIT_MS;
  const isNearLimit = elapsed > TIME_WARNING_THRESHOLD_MS;

  return { elapsed, elapsedSeconds, percentOfLimit, isOverLimit, isNearLimit };
}

/**
 * Main execution
 */
function main() {
  // Parse command-line arguments first
  parseArgs();

  // Show help and exit if requested
  if (cliOptions.help) {
    showHelp();
    process.exit(0);
  }

  const startTime = Date.now();
  const isJsonFormat = cliOptions.format === 'json';

  // Only show progress messages in text mode
  if (!isJsonFormat) {
    console.log(
      `\n${colors.blue}Running Security Pattern Validation...${colors.reset}`,
    );
  }

  checkRBAC();
  checkProtectedPages();
  checkProtectedPageSessionValidation();
  checkRoleReferences();
  checkInputValidation();
  checkFormValidation();
  checkFileUploadValidation();
  checkXSSProtection();
  checkUnescapedUserInput();
  checkSQLInjection();
  checkQueryStringConcatenation();
  checkAuthentication();

  // POPIA Compliance checks
  checkPIILogging();
  checkPIIFieldHandling();

  // Check execution time before generating report
  const timing = checkExecutionTime(startTime);

  // For JSON format, output JSON and exit
  if (isJsonFormat) {
    outputJSONReport(timing.elapsed);
    return; // outputJSONReport calls process.exit
  }

  // Output timing information (text mode only)
  console.log(`\n${colors.blue}Execution Time:${colors.reset} ${timing.elapsedSeconds}s (${timing.percentOfLimit}% of 2-minute limit)`);

  if (timing.isOverLimit) {
    console.log(`${colors.red}WARNING: Validation exceeded 2-minute time limit!${colors.reset}`);
    if (isGitHubActions()) {
      console.log(`::warning title=Security Validation Timeout::Validation took ${timing.elapsedSeconds}s, exceeding the 2-minute limit. Consider optimizing checks or splitting into parallel jobs.`);
    }
  } else if (timing.isNearLimit) {
    console.log(`${colors.yellow}WARNING: Validation approaching 2-minute time limit (>${Math.round(TIME_WARNING_THRESHOLD_MS / 1000)}s)${colors.reset}`);
    if (isGitHubActions()) {
      console.log(`::warning title=Security Validation Slow::Validation took ${timing.elapsedSeconds}s, approaching the 2-minute limit. Consider monitoring for performance degradation.`);
    }
  }

  generateReport();

  // Final timing check
  const finalTiming = checkExecutionTime(startTime);
  console.log(`Total execution time: ${finalTiming.elapsedSeconds}s`);
}

main();
