#!/usr/bin/env node
/**
 * workflow-helpers.js
 * Shared helpers used by transition-phase.js, collect-dashboard-data.js,
 * generate-dashboard-html.js, and generate-todo-list.js.
 *
 * Phase model: INTAKE → PLAN → BUILD → COMPLETE.
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// PHASE CONSTANTS
// =============================================================================

const GLOBAL_PHASES = ['INTAKE', 'PLAN', 'BUILD'];
// PENDING is a per-story / per-epic phase value, never state.currentPhase, so it
// is intentionally excluded here — ALL_PHASES validates global-phase transitions only.
const ALL_PHASES = [...GLOBAL_PHASES, 'COMPLETE'];

// =============================================================================
// STATUS ENUMS
// =============================================================================

const MANUAL_VERIFICATION_STATUS_VALUES = Object.freeze([
  'passed',
  'auto-skipped',
  'deferred-passed',
  'skipped'
]);

const E2E_STATUS_VALUES = Object.freeze([
  'pending',
  'running',
  'passed',
  'passed-after-fix',
  'failed',
  'escalated',
  'auto-skipped:non-routable',
  'auto-skipped:fixme',
  'user-skipped',
  'user-skipped-after-escalation',
  'missing'
]);

// =============================================================================
// PATH CONSTANTS
// =============================================================================

const STORIES_DIR = 'generated-docs/stories';
const TEST_DIR = 'web/src/__tests__/integration';
const STATE_FILE = 'generated-docs/context/workflow-state.json';
const INTAKE_MANIFEST_FILE = 'generated-docs/context/intake-manifest.json';
const BRIEF_PATH = 'generated-docs/specs/project-brief.md';
const API_SPEC_PATH = 'generated-docs/specs/api-spec.yaml';
const DESIGN_TOKENS_PATH = 'generated-docs/specs/design-tokens.css';
const HANDLERS_PATH = 'web/src/mocks/handlers.ts';
const SNAPSHOT_PATH = 'generated-docs/context/mock-spec-snapshot.yaml';
const FEATURE_OVERVIEW_PATH = 'generated-docs/stories/_feature-overview.md';

// Shared regex source for AC identifiers (used by multiple traceability functions).
// Matches both "AC-1" (canonical) and "AC1" (legacy/bold format) — callers must
// normalize via capture group 1 (the digit) to ensure consistent Set lookups.
function acIdRegex() { return /AC-?(\d+)/g; }

// =============================================================================
// FILE FINDING HELPERS
// =============================================================================

function globToRegex(pattern) {
  return new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
}

function findFiles(dir, pattern) {
  const regex = globToRegex(pattern);
  try {
    return fs.readdirSync(dir)
      .filter(file => regex.test(file))
      .map(file => path.join(dir, file));
  } catch {
    return [];
  }
}

// =============================================================================
// EPIC / STORY DIRECTORY HELPERS
// =============================================================================

function findStoryFiles(epicDir) {
  const storyFiles = findFiles(epicDir, 'story-*.md').sort();
  const results = [];
  for (const file of storyFiles) {
    const basename = path.basename(file, '.md');
    const numMatch = basename.match(/story-(\d+)/);
    if (numMatch) {
      results.push({ num: parseInt(numMatch[1]), title: basename, path: file });
    }
  }
  return results;
}

// Single source of truth for walking STORIES_DIR. Returns
//   Map<epicNum, { num, dirName, path, stories: Map<storyNum, {num, title, path}> }>
// Memoized per-process: transition-phase, generate-todo-list,
// getRequirementsCoverage and friends share one walk per invocation rather than
// each re-scanning the tree. Stories Map preserves the sorted order from
// findStoryFiles (Map iteration order = insertion order).
let _storyIndexCache = null;

function buildStoryIndex() {
  if (_storyIndexCache) return _storyIndexCache;
  const index = new Map();
  let entries;
  try {
    entries = fs.readdirSync(STORIES_DIR, { withFileTypes: true });
  } catch {
    _storyIndexCache = index;
    return index;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const m = entry.name.match(/^epic-(\d+)/);
    if (!m) continue;
    const num = parseInt(m[1], 10);
    const epicPath = path.join(STORIES_DIR, entry.name);
    const stories = new Map();
    for (const sf of findStoryFiles(epicPath)) {
      stories.set(sf.num, sf);
    }
    index.set(num, { num, dirName: entry.name, path: epicPath, stories });
  }
  _storyIndexCache = index;
  return index;
}

function listEpics() {
  return [...buildStoryIndex().values()].sort((a, b) => a.num - b.num);
}

function findEpicDir(epicNum) {
  return buildStoryIndex().get(epicNum)?.path ?? null;
}

// =============================================================================
// ACCEPTANCE CRITERIA HELPERS
// =============================================================================
// Parse `## Acceptance Criteria` checkbox lists from story Markdown.
// In the 4-phase workflow, story AC also lives inline in workflow-state.json;
// these helpers exist for the cases that still consult the Markdown:
// transition-phase.js --repair, dashboard traceability, and the
// deferred-verification surfacing on the next routable story.

function extractACSection(content) {
  const acHeaderPattern = /^## Acceptance Criteria\s*$/m;
  const acStart = content.search(acHeaderPattern);
  if (acStart === -1) return null;
  const afterHeader = content.indexOf('\n', acStart) + 1;
  const nextH2 = content.indexOf('\n## ', afterHeader);
  const acEnd = nextH2 === -1 ? content.length : nextH2;
  return {
    text: content.slice(afterHeader, acEnd),
    startOffset: afterHeader,
    endOffset: acEnd
  };
}

function countStoryAC(epicDir, storyNum) {
  const storyFiles = findStoryFiles(epicDir);
  const story = storyFiles.find(s => s.num === storyNum);
  if (!story) return { total: 0, checked: 0 };
  try {
    const content = fs.readFileSync(story.path, 'utf-8');
    const ac = extractACSection(content);
    if (!ac) return { total: 0, checked: 0 };
    const checkedMatches = ac.text.match(/^\s*[-*] \[[xX]\]/gm);
    const uncheckedMatches = ac.text.match(/^\s*[-*] \[ \]/gm);
    const checked = checkedMatches ? checkedMatches.length : 0;
    const unchecked = uncheckedMatches ? uncheckedMatches.length : 0;
    return { total: checked + unchecked, checked };
  } catch {
    return { total: 0, checked: 0 };
  }
}

function checkAllAcceptanceCriteria(epicDir, storyNum) {
  const storyFiles = findStoryFiles(epicDir);
  const story = storyFiles.find(s => s.num === storyNum);
  if (!story) return;
  let content;
  try { content = fs.readFileSync(story.path, 'utf-8'); } catch { return; }
  const ac = extractACSection(content);
  if (!ac) return;
  const before = content.slice(0, ac.startOffset);
  const after = content.slice(ac.endOffset);
  const checkedSection = ac.text.replace(/^(\s*[-*] )\[ \]/gm, '$1[x]');
  fs.writeFileSync(story.path, before + checkedSection + after);
}

// =============================================================================
// STORY METADATA HELPERS
// =============================================================================

function extractStoryRoute(content) {
  const routeMatch = content.match(/\|\s*\*?\*?Route\*?\*?\s*\|\s*`?([^`|\n]+?)`?\s*\|/i);
  if (!routeMatch) return null;
  return routeMatch[1].trim();
}

/**
 * Stories in the current and prior epics that had manual verification auto-skipped
 * (Route: N/A, manualVerification: 'auto-skipped'). Surfaces on the next routable
 * story's verification checklist so non-routable work doesn't get stranded.
 */
function getDeferredVerificationStories(epicNum) {
  const state = readWorkflowState();
  if (!state?.epics) return [];
  const deferred = [];
  for (const [eNum, epicState] of Object.entries(state.epics)) {
    const eNumInt = parseInt(eNum);
    if (eNumInt > epicNum) continue;
    if (!epicState?.stories) continue;
    const epicDir = findEpicDir(eNumInt);
    if (!epicDir) continue;
    const storyFiles = findStoryFiles(epicDir);
    for (const [sNum, storyState] of Object.entries(epicState.stories)) {
      if (storyState.manualVerification !== 'auto-skipped') continue;
      const storyFile = storyFiles.find(s => s.num === parseInt(sNum));
      if (!storyFile) continue;
      try {
        const content = fs.readFileSync(storyFile.path, 'utf-8');
        const ac = extractACSection(content);
        deferred.push({
          epic: eNumInt,
          number: parseInt(sNum),
          name: storyState.name || storyFile.title,
          route: extractStoryRoute(content) || 'N/A',
          acceptanceCriteria: ac ? ac.text.trim() : null
        });
      } catch { /* ignore */ }
    }
  }
  return deferred;
}

// =============================================================================
// TEST FILE HELPERS
// =============================================================================

function countTestFiles(epicNum, storyNum, options) {
  const dirs = options?.dirs || [TEST_DIR];
  const recursive = options?.recursive || false;
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const entries = fs.readdirSync(dir, recursive ? { recursive: true } : undefined);
      const testFiles = entries.filter(f =>
        typeof f === 'string' &&
        f.includes(`epic-${epicNum}`) &&
        f.includes(`story-${storyNum}`) &&
        (f.endsWith('.test.tsx') || f.endsWith('.test.ts'))
      );
      if (testFiles.length > 0) return testFiles.length;
    } catch { /* skip */ }
  }
  return 0;
}

// =============================================================================
// STATE FILE READERS
// =============================================================================

function readWorkflowState() {
  if (!fs.existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function readIntakeManifest() {
  if (!fs.existsSync(INTAKE_MANIFEST_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(INTAKE_MANIFEST_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

// =============================================================================
// DISPLAY HELPERS
// =============================================================================

/**
 * Extract the feature name from the project brief or feature overview heading.
 */
function extractFeatureNameFromFiles() {
  const candidates = [BRIEF_PATH, FEATURE_OVERVIEW_PATH];
  for (const filePath of candidates) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const m = content.match(/^#\s+(?:Feature|Project Brief):\s*(.+)/m);
      if (m) return m[1].trim();
    } catch { /* ignore */ }
  }
  return null;
}

/**
 * Parse the feature overview file for all planned epics.
 * Returns array of { number, name } sorted by epic number.
 */
function parseFeatureOverview() {
  if (!fs.existsSync(FEATURE_OVERVIEW_PATH)) return [];
  try {
    const content = fs.readFileSync(FEATURE_OVERVIEW_PATH, 'utf-8');
    const results = [];
    const re = /^\d+\.\s+\*\*Epic\s+(\d+):\s+(.+?)\*\*.*Dir:\s*`(epic-\d+[^`/]*)/gm;
    let m;
    while ((m = re.exec(content)) !== null) {
      results.push({ number: parseInt(m[1]), name: m[3] });
    }
    results.sort((a, b) => a.number - b.number);
    return results;
  } catch {
    return [];
  }
}

function friendlyName(slug, type) {
  if (!slug) return slug;
  const prefixRe = new RegExp(`^${type}-(\\d+)-?`);
  const m = slug.match(prefixRe);
  if (!m) return slug;
  const num = m[1];
  const rest = slug.slice(m[0].length);
  if (!rest) return `${type.charAt(0).toUpperCase() + type.slice(1)} ${num}`;
  const words = rest.split('-');
  words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  return `${type.charAt(0).toUpperCase() + type.slice(1)} ${num}: ${words.join(' ')}`;
}

// =============================================================================
// AC TRACEABILITY (dashboard test coverage card)
// =============================================================================

function parseACsFromContent(content) {
  const results = [];
  const re = /- \[([ xX])\] \*?\*?AC-?(\d+):\s*\*?\*?\s*(.+)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const text = m[3].replace(/\*{1,2}\s*(?=[—–\s]|$)/, '').replace(/\s*[—–]\s.*$/, '').trim();
    results.push({ id: `AC-${m[2]}`, text, checked: m[1].toLowerCase() === 'x' });
  }
  return results;
}

// Per-process cache: each test dir is recursively walked at most once. Callers
// during a single CLI invocation (e.g. dashboard render) iterate dozens of
// stories — without this, every story re-walks `web/src/__tests__/integration`.
const _testDirCache = new Map();
function _listTestFilesIn(dir) {
  if (_testDirCache.has(dir)) return _testDirCache.get(dir);
  let entries;
  try {
    entries = fs.readdirSync(dir, { recursive: true });
  } catch {
    entries = [];
  }
  const files = entries.filter(f =>
    typeof f === 'string' &&
    (f.endsWith('.test.tsx') || f.endsWith('.test.ts'))
  );
  _testDirCache.set(dir, files);
  return files;
}

function scanTestFileForACs(epicNum, storyNum) {
  const tested = new Set();
  const testDirs = ['web/src/__tests__/integration', 'web/src/__tests__'];
  for (const dir of testDirs) {
    if (!fs.existsSync(dir)) continue;
    const allFiles = _listTestFilesIn(dir);
    const testFiles = allFiles.filter(f =>
      f.includes(`epic-${epicNum}`) && f.includes(`story-${storyNum}`)
    );
    for (const tf of testFiles) {
      try {
        const content = fs.readFileSync(path.join(dir, tf), 'utf-8');
        const re = acIdRegex();
        let m;
        while ((m = re.exec(content)) !== null) {
          tested.add(`AC-${m[1]}`);
        }
      } catch { /* ignore */ }
    }
    if (testFiles.length > 0) break;
  }
  return tested;
}

/**
 * Combined traceability lookup. Returns { acs, tested } — AC entries from the
 * story file paired with the set of AC IDs referenced in test files.
 *
 * Hot-path callers (e.g. the dashboard loop) that already have `epicDir`
 * in hand can pass it via `opts` to skip the readdir lookup.
 */
function getACTraceability(epicNum, storyNum, opts = {}) {
  const empty = { acs: [], tested: new Set() };
  const epicDir = opts.epicDir || findEpicDir(epicNum);
  if (!epicDir) return empty;
  const story = findStoryFiles(epicDir).find(s => s.num === storyNum);
  let acs = [];
  if (story) {
    try {
      acs = parseACsFromContent(fs.readFileSync(story.path, 'utf-8'));
    } catch { /* ignore */ }
  }
  const tested = scanTestFileForACs(epicNum, storyNum);
  return { acs, tested };
}

// =============================================================================
// REQUIREMENTS TRACEABILITY
// =============================================================================

const REQ_LINE_RE = /^\s*-\s*\*\*(R\d+|BR\d+|NFR\d+|CR\d+):\*\*\s*(.+)/;
const REQ_ID_RE = /\b(R\d+|BR\d+|NFR\d+|CR\d+)\b/g;

function reqType(id) {
  if (id.startsWith('NFR')) return 'nonFunctional';
  if (id.startsWith('BR')) return 'businessRules';
  if (id.startsWith('CR')) return 'compliance';
  return 'functional';
}

function expandRange(rangeStr) {
  const m = rangeStr.match(/^(R|BR|NFR|CR)(\d+)\s*[–—-]\s*(R|BR|NFR|CR)?(\d+)$/);
  if (!m) return [rangeStr];
  const prefix = m[1];
  if (m[3] && m[3] !== prefix) return [rangeStr];
  const start = parseInt(m[2], 10);
  const end = parseInt(m[4], 10);
  if (end < start || end - start > 100) return [rangeStr];
  const result = [];
  for (let i = start; i <= end; i++) result.push(`${prefix}${i}`);
  return result;
}

/**
 * Parse the project brief for R/BR/NFR/CR requirement IDs.
 * Returns Map<id, { id, type, description }>.
 */
function parseBriefRequirements() {
  const reqs = new Map();
  if (!fs.existsSync(BRIEF_PATH)) return reqs;
  let lines;
  try {
    lines = fs.readFileSync(BRIEF_PATH, 'utf-8').split('\n');
  } catch {
    return reqs;
  }
  let currentId = null;
  let currentType = null;
  let descLines = [];
  function flush() {
    if (currentId) {
      reqs.set(currentId, { id: currentId, type: currentType, description: descLines.join(' ').trim() });
    }
    currentId = null;
    currentType = null;
    descLines = [];
  }
  for (const line of lines) {
    const m = REQ_LINE_RE.exec(line);
    if (m) {
      flush();
      currentId = m[1];
      currentType = reqType(currentId);
      descLines.push(m[2].trim());
    } else if (currentId) {
      if (/^\s*-\s*\*\*/.test(line) || /^##/.test(line) || /^\s*$/.test(line)) {
        flush();
      } else {
        descLines.push(line.trim());
      }
    }
  }
  flush();
  return reqs;
}

function parseStoryRequirements() {
  const results = [];
  for (const epic of listEpics()) {
    for (const story of epic.stories.values()) {
      let content;
      try {
        content = fs.readFileSync(story.path, 'utf-8');
      } catch { continue; }
      const titleMatch = content.match(/^#\s+Story:\s*(.+)/m);
      const title = titleMatch ? titleMatch[1].trim() : story.title;
      const reqLine = content.match(/\*\*Requirements:\*\*\s*(.+)/);
      const requirementIds = [];
      if (reqLine) {
        let m2;
        const idRe = new RegExp(REQ_ID_RE.source, 'g');
        while ((m2 = idRe.exec(reqLine[1])) !== null) {
          requirementIds.push(m2[1]);
        }
      }
      results.push({
        epicNum: epic.num,
        storyNum: story.num,
        title,
        epicSlug: epic.dirName,
        fileName: path.basename(story.path),
        requirementIds
      });
    }
  }
  results.sort((a, b) => a.epicNum - b.epicNum || a.storyNum - b.storyNum);
  return results;
}

function parseFeatureOverviewRequirements() {
  const epicReqs = new Map();
  if (!fs.existsSync(FEATURE_OVERVIEW_PATH)) return epicReqs;
  let content;
  try {
    content = fs.readFileSync(FEATURE_OVERVIEW_PATH, 'utf-8');
  } catch { return epicReqs; }
  const coverageStart = content.indexOf('## Requirements Coverage');
  if (coverageStart === -1) return epicReqs;
  const afterCoverage = content.slice(coverageStart);
  const nextSection = afterCoverage.indexOf('\n## ', 1);
  const coverageText = nextSection >= 0 ? afterCoverage.slice(0, nextSection) : afterCoverage;
  const rows = coverageText.split('\n').filter(line => /^\|/.test(line) && !/^\|\s*[-]+/.test(line));
  for (const row of rows) {
    const epicMatch = row.match(/Epic\s+(\d+)/i);
    if (!epicMatch) continue;
    const epicNum = parseInt(epicMatch[1], 10);
    const ids = [];
    const rangeRe = /(R|BR|NFR|CR)(\d+)\s*[–—-]\s*(?:R|BR|NFR|CR)?(\d+)/g;
    let remaining = row;
    let rangeMatch;
    while ((rangeMatch = rangeRe.exec(row)) !== null) {
      ids.push(...expandRange(rangeMatch[0]));
      remaining = remaining.slice(0, rangeMatch.index) + ' '.repeat(rangeMatch[0].length) + remaining.slice(rangeMatch.index + rangeMatch[0].length);
    }
    const idRe = new RegExp(REQ_ID_RE.source, 'g');
    let idMatch;
    while ((idMatch = idRe.exec(remaining)) !== null) {
      ids.push(idMatch[1]);
    }
    epicReqs.set(epicNum, [...new Set(ids)]);
  }
  return epicReqs;
}

function coveragePct(bucket) {
  if (bucket.total === 0) return 100;
  return Math.round((bucket.covered / bucket.total) * 100);
}

function resolveTotalEpics(featureOverviewClaims, epicsScoped) {
  try {
    const state = readWorkflowState();
    if (state && state.totalEpics) return state.totalEpics;
  } catch { /* fall through */ }
  if (featureOverviewClaims.size > 0) {
    return Math.max(epicsScoped, Math.max(...featureOverviewClaims.keys()));
  }
  return epicsScoped;
}

function getRequirementsCoverage() {
  const briefRequirements = parseBriefRequirements();
  const storyRequirements = parseStoryRequirements();
  const featureOverviewClaims = parseFeatureOverviewRequirements();
  const warnings = [];
  const coveredBy = new Map();
  for (const story of storyRequirements) {
    if (story.requirementIds.length === 0) {
      warnings.push(`Story '${story.epicSlug}/${story.fileName}' has no Requirements field`);
    }
    for (const id of story.requirementIds) {
      if (!briefRequirements.has(id)) {
        warnings.push(`Story '${story.epicSlug}/${story.fileName}' references ${id} which does not exist in the project brief`);
        continue;
      }
      if (!coveredBy.has(id)) coveredBy.set(id, []);
      coveredBy.get(id).push(story);
    }
  }
  const types = {
    functional: { total: 0, covered: 0, uncovered: [] },
    businessRules: { total: 0, covered: 0, uncovered: [] },
    nonFunctional: { total: 0, covered: 0, uncovered: [] },
    compliance: { total: 0, covered: 0, uncovered: [] }
  };
  for (const [id, req] of briefRequirements) {
    const bucket = types[req.type];
    if (!bucket) continue;
    bucket.total++;
    if (coveredBy.has(id)) bucket.covered++;
    else bucket.uncovered.push(id);
  }
  const overallBucket = { total: briefRequirements.size, covered: coveredBy.size };
  const uncoveredIds = [
    ...types.functional.uncovered,
    ...types.businessRules.uncovered,
    ...types.nonFunctional.uncovered,
    ...types.compliance.uncovered
  ];
  const overall = {
    ...overallBucket,
    percent: coveragePct(overallBucket),
    uncovered: uncoveredIds
  };
  const storiesByEpic = new Map();
  for (const s of storyRequirements) {
    if (!storiesByEpic.has(s.epicNum)) storiesByEpic.set(s.epicNum, []);
    storiesByEpic.get(s.epicNum).push(s);
  }
  const epicGaps = new Map();
  for (const [epicNum, claimedIds] of featureOverviewClaims) {
    const epicStories = storiesByEpic.get(epicNum) || [];
    if (epicStories.length === 0) continue;
    const epicActualIds = new Set(epicStories.flatMap(s => s.requirementIds));
    const missing = claimedIds.filter(id => !epicActualIds.has(id));
    if (missing.length > 0) {
      epicGaps.set(epicNum, {
        claimed: claimedIds,
        missing,
        message: `Epic ${epicNum} claims ${missing.join(', ')} in feature-overview but no story references ${missing.length === 1 ? 'it' : 'them'}`
      });
    }
  }
  const epicsScoped = storiesByEpic.size;
  const totalEpics = resolveTotalEpics(featureOverviewClaims, epicsScoped);
  return {
    briefRequirements,
    storyRequirements,
    featureOverviewClaims,
    coveredBy,
    byType: types,
    overall,
    totalEpics,
    epicsScoped,
    epicGaps,
    warnings
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Phase constants
  GLOBAL_PHASES,
  ALL_PHASES,

  // Status enums
  MANUAL_VERIFICATION_STATUS_VALUES,
  E2E_STATUS_VALUES,

  // Path constants
  STORIES_DIR,
  STATE_FILE,
  INTAKE_MANIFEST_FILE,
  BRIEF_PATH,
  API_SPEC_PATH,
  DESIGN_TOKENS_PATH,
  HANDLERS_PATH,
  SNAPSHOT_PATH,
  FEATURE_OVERVIEW_PATH,

  // File finding
  findFiles,

  // Epic/story directory
  findEpicDir,
  findStoryFiles,
  buildStoryIndex,
  listEpics,

  // Acceptance criteria
  extractACSection,
  countStoryAC,
  checkAllAcceptanceCriteria,

  // Story metadata
  extractStoryRoute,
  getDeferredVerificationStories,

  // Test files
  countTestFiles,

  // Display helpers
  friendlyName,
  extractFeatureNameFromFiles,
  parseFeatureOverview,

  // AC traceability (dashboard test coverage card)
  parseACsFromContent,
  scanTestFileForACs,
  getACTraceability,

  // Requirements traceability
  parseBriefRequirements,
  parseStoryRequirements,
  parseFeatureOverviewRequirements,
  getRequirementsCoverage,
  expandRange,
  coveragePct,
  resolveTotalEpics,

  // State file readers
  readWorkflowState,
  readIntakeManifest
};
