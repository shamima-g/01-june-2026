#!/usr/bin/env node
/**
 * collect-dashboard-data.js
 * Reshaper for the 4-phase workflow: reads workflow-state.json + the manifest +
 * project-brief.md, computes API mock coverage, and emits the dashboard payload.
 *
 * Usage:
 *   node .claude/scripts/collect-dashboard-data.js --format=json   # For generate-dashboard-html.js
 *   node .claude/scripts/collect-dashboard-data.js --format=text   # For /status terminal display
 *   node .claude/scripts/collect-dashboard-data.js --with-todos    # Include TodoWrite list
 */

const fs = require('fs');
const helpers = require('./lib/workflow-helpers');
const {
  BRIEF_PATH,
  API_SPEC_PATH,
  DESIGN_TOKENS_PATH,
  HANDLERS_PATH,
  SNAPSHOT_PATH,
  INTAKE_MANIFEST_FILE: MANIFEST_PATH,
  extractFeatureNameFromFiles,
  parseFeatureOverview
} = helpers;

// =============================================================================
// PARSE CLI
// =============================================================================

const args = process.argv.slice(2);
let formatArg = 'json';
let withTodos = false;
for (const arg of args) {
  if (arg.startsWith('--format=')) {
    formatArg = arg.split('=')[1];
  } else if (arg === '--with-todos') {
    withTodos = true;
  }
}

// =============================================================================
// DATA COLLECTION
// =============================================================================

function collectData(state) {
  if (!state) {
    return { status: 'no_state', message: 'No workflow state found. Run /start to begin.' };
  }

  const manifest = helpers.readIntakeManifest();
  const data = { status: 'ok' };

  // --- Workflow section (always present) ---
  data.workflow = {
    currentPhase: state.currentPhase || 'NONE',
    currentEpic: state.currentEpic || null,
    currentStory: state.currentStory || null,
    phaseStatus: state.phaseStatus || 'ready',
    featureComplete: state.featureComplete || false,
    featureName: state.featureName || extractFeatureNameFromFiles() || (manifest && manifest.featureName) || null,
    lastUpdated: state.lastUpdated || null
  };

  // --- Intake section ---
  if (state.intake) {
    data.intake = {
      manifestExists: state.intake.manifestExists,
      briefExists: state.intake.briefExists ?? false,
      requirementCount: state.intake.requirementCount,
      businessRuleCount: state.intake.businessRuleCount
    };
  } else if (state.currentPhase === 'INTAKE' || fs.existsSync(MANIFEST_PATH) || fs.existsSync(BRIEF_PATH)) {
    data.intake = {
      manifestExists: fs.existsSync(MANIFEST_PATH),
      briefExists: fs.existsSync(BRIEF_PATH),
      requirementCount: null,
      businessRuleCount: null
    };
  }

  // --- Epics section (from PLAN onward) ---
  const hasStateEpics = state.epics && Object.keys(state.epics).length > 0;
  const plannedEpics = parseFeatureOverview();
  const hasPlan = plannedEpics.length > 0 || (state.totalEpics && state.totalEpics > 0);

  if (hasStateEpics || hasPlan) {
    const epics = [];
    const stateEpicNums = new Set(Object.keys(state.epics || {}).map(Number));

    for (const [num, epic] of Object.entries(state.epics || {})) {
      const epicNum = parseInt(num);
      const epicDir = helpers.findEpicDir(epicNum);
      const storyFilesOnDisk = epicDir ? helpers.findStoryFiles(epicDir) : [];

      const stories = [];
      if (epic.stories) {
        for (const [sNum, story] of Object.entries(epic.stories)) {
          const storyObj = {
            number: parseInt(sNum),
            name: story.name || null,
            phase: story.phase || 'PENDING',
            acceptance: story.acceptance || null,
            testFiles: story.testFiles || 0,
            manualVerification: story.manualVerification || null,
            e2eStatus: story.e2eStatus || null,
            e2eLastRun: story.e2eLastRun || null,
            e2ePassCount: story.e2ePassCount ?? null,
            e2eFailCount: story.e2eFailCount ?? null,
            e2eFixCycleCount: story.e2eFixCycleCount ?? null,
            deferredE2eTargets: story.deferredE2eTargets || [],
            traceability: null
          };

          const storyPhase = story.phase || 'PENDING';
          if (storyPhase !== 'PENDING') {
            try {
              const { acs, tested } = helpers.getACTraceability(epicNum, parseInt(sNum), { epicDir });
              if (acs.length > 0) {
                storyObj.traceability = {
                  criteria: acs.map(ac => ({
                    id: ac.id,
                    text: ac.text,
                    checked: ac.checked,
                    tested: tested.has(ac.id)
                  }))
                };
              }
            } catch { /* ignore */ }
          }

          stories.push(storyObj);
        }
      }
      stories.sort((a, b) => a.number - b.number);

      epics.push({
        number: epicNum,
        name: epic.name || null,
        phase: epic.phase || 'PENDING',
        totalStories: epic.totalStories || storyFilesOnDisk.length || stories.length,
        manualTestStatus: epic.manualTestStatus || null,
        stories
      });
    }

    // Expected epic numbers come from feature-overview (named) or fall back to state.totalEpics (anonymous).
    const expectedEpics = plannedEpics.length > 0
      ? plannedEpics
      : Array.from({ length: state.totalEpics || 0 }, (_, i) => ({ number: i + 1, name: null }));
    for (const planned of expectedEpics) {
      if (!stateEpicNums.has(planned.number)) {
        epics.push({
          number: planned.number,
          name: planned.name,
          phase: 'PENDING',
          totalStories: 0,
          stories: []
        });
      }
    }

    epics.sort((a, b) => a.number - b.number);
    data.epics = epics;
    data.totalEpics = state.totalEpics || epics.length;
  }

  // --- Design artifacts (emitted on-demand during BUILD) ---
  const apiSpecExists = fs.existsSync(API_SPEC_PATH);
  const designTokensExists = fs.existsSync(DESIGN_TOKENS_PATH);

  if (apiSpecExists || designTokensExists) {
    data.designArtifacts = {
      brief: fs.existsSync(BRIEF_PATH),
      apiSpec: apiSpecExists,
      designTokens: designTokensExists,
      mocks: fs.existsSync(HANDLERS_PATH)
    };
  }

  // --- API coverage (computed on-the-fly) ---
  if (apiSpecExists) {
    data.api = computeApiCoverage();
    const ds = manifest?.context?.dataSource;
    if (ds) data.api.dataSource = ds;
  }

  // --- Current-story traceability convenience pointer ---
  if (state.currentEpic && state.currentStory && data.epics) {
    const currentStoryObj = data.epics
      .find(e => e.number === state.currentEpic)
      ?.stories?.find(s => s.number === state.currentStory);
    if (currentStoryObj?.traceability) {
      data.currentTraceability = {
        storyName: currentStoryObj.name || `Story ${state.currentStory}`,
        epicNum: state.currentEpic,
        storyNum: state.currentStory,
        criteria: currentStoryObj.traceability.criteria,
        totalAC: currentStoryObj.traceability.criteria.length
      };
    }
  }

  // --- Requirements traceability coverage ---
  try {
    const reqCov = helpers.getRequirementsCoverage();
    if (reqCov.briefRequirements.size > 0) {
      data.traceability = {
        functional: reqCov.byType.functional,
        businessRules: reqCov.byType.businessRules,
        nonFunctional: reqCov.byType.nonFunctional,
        compliance: reqCov.byType.compliance,
        overall: reqCov.overall,
        epicsScoped: reqCov.epicsScoped,
        totalEpics: reqCov.totalEpics
      };
    }
  } catch { /* ignore if helpers not available yet */ }

  return data;
}

// =============================================================================
// API COVERAGE COMPUTATION
// =============================================================================

function computeApiCoverage() {
  const result = { totalEndpoints: 0, mockCoverage: 0, drifted: 0, endpoints: [] };
  try {
    const specContent = fs.readFileSync(API_SPEC_PATH, 'utf-8');
    const paths = new Map();
    let currentPath = null;
    for (const line of specContent.split('\n')) {
      const pathMatch = line.match(/^\s{2}(\/[^\s:]+):\s*$/);
      if (pathMatch) { currentPath = pathMatch[1]; paths.set(currentPath, []); continue; }
      const methodMatch = line.match(/^\s{4}(get|post|put|patch|delete|head|options):\s*$/);
      if (methodMatch && currentPath) paths.get(currentPath).push(methodMatch[1].toUpperCase());
    }
    const endpoints = [];
    for (const [p, methods] of paths) {
      for (const m of methods) endpoints.push({ path: p, method: m, hasMock: false, drifted: false });
    }
    result.totalEndpoints = endpoints.length;

    try {
      const handlersContent = fs.readFileSync(HANDLERS_PATH, 'utf-8');
      for (const ep of endpoints) {
        const methodLower = ep.method.toLowerCase();
        if (handlersContent.includes(`http.${methodLower}(`) && handlersContent.includes(ep.path)) {
          ep.hasMock = true;
          result.mockCoverage++;
        }
      }
    } catch { /* handlers absent */ }

    try {
      const snapshotContent = fs.readFileSync(SNAPSHOT_PATH, 'utf-8');
      const specNormalized = specContent.replace(/\s+/g, ' ').trim();
      const snapNormalized = snapshotContent.replace(/\s+/g, ' ').trim();
      if (specNormalized !== snapNormalized) result.drifted = 1;
    } catch { /* snapshot absent */ }

    result.endpoints = endpoints;
  } catch { /* ignore parse errors */ }
  return result;
}

// =============================================================================
// TEXT FORMATTER
// =============================================================================

function formatText(data) {
  if (data.status === 'no_state') {
    return `=== Workflow Status ===\n\nNo workflow state found.\nRun /start to begin the TDD workflow.`;
  }

  const lines = [];
  const w = data.workflow;

  lines.push('=== Workflow Status ===');
  lines.push('');

  const featureName = w.featureName || 'Unknown';
  if (w.featureComplete) {
    lines.push(`Feature: ${featureName}`);
    lines.push('Feature complete!');
  } else {
    let posStr = '';
    if (w.currentEpic) {
      const totalEpics = data.totalEpics || (data.epics && data.epics.length) || null;
      const epicPart = totalEpics ? `Epic ${w.currentEpic} of ${totalEpics}` : `Epic ${w.currentEpic}`;
      const storyPart = w.currentStory ? ` — Story ${w.currentStory}` : '';
      posStr = `${epicPart}${storyPart}`;
    }
    lines.push(`Feature: ${featureName}`);
    lines.push(`Phase: ${w.currentPhase}${posStr ? '                    ' + posStr : ''}`);
  }

  if (data.intake) {
    lines.push('');
    lines.push('=== Project Brief ===');
    lines.push('');
    const mCheck = data.intake.manifestExists ? '✓' : '✗';
    const bCheck = data.intake.briefExists ? '✓' : '✗';
    lines.push(`Intake Manifest: ${mCheck}    Project Brief: ${bCheck}`);
    if (data.intake.requirementCount != null) {
      lines.push(`${data.intake.requirementCount} requirements, ${data.intake.businessRuleCount || 0} business rules`);
    }
  }

  if (data.epics && data.epics.length > 0) {
    lines.push('');
    lines.push('=== Epic Progress ===');
    lines.push('');
    const header = 'Epic                  | Phase    | Stories      | ACs       | Tests';
    const divider = '--------------------- | -------- | ------------ | --------- | -----';
    lines.push(header);
    lines.push(divider);
    for (const epic of data.epics) {
      const name = (epic.name || `epic-${epic.number}`).substring(0, 21).padEnd(21);
      const phase = (epic.phase || 'PENDING').padEnd(8);
      const completedStories = epic.stories.filter(s => s.phase === 'COMPLETE').length;
      const storiesStr = `${completedStories}/${epic.totalStories} complete`.padEnd(12);
      let totalAC = 0, checkedAC = 0, hasAcData = false;
      for (const story of epic.stories) {
        if (story.acceptance) {
          hasAcData = true;
          totalAC += story.acceptance.total;
          checkedAC += story.acceptance.checked;
        }
      }
      const acStr = hasAcData ? `${checkedAC}/${totalAC}`.padEnd(9) : '—'.padEnd(9);
      const testTotal = epic.stories.reduce((sum, s) => sum + (s.testFiles || 0), 0);
      const testStr = testTotal > 0 ? String(testTotal) : '—';
      lines.push(`${name} | ${phase} | ${storiesStr} | ${acStr} | ${testStr}`);
    }
  }

  if (data.designArtifacts) {
    lines.push('');
    lines.push('=== Design Artifacts ===');
    lines.push('');
    const da = data.designArtifacts;
    const parts = [
      `Brief: ${da.brief ? '✓' : '✗'}`,
      `API Spec: ${da.apiSpec ? '✓' : '✗'}`,
      `Design Tokens: ${da.designTokens ? '✓' : '✗'}`,
      `Mocks: ${da.mocks ? '✓' : '✗'}`
    ];
    lines.push(parts.join('   '));
  }

  if (!w.featureComplete) {
    lines.push('');
    lines.push('=== Current Position ===');
    lines.push('');
    if (w.currentEpic) {
      const epicName = data.epics?.find(e => e.number === w.currentEpic)?.name || `epic-${w.currentEpic}`;
      let resumeLine = `Resume: Epic ${w.currentEpic} (${epicName})`;
      if (w.currentStory) {
        const storyName = data.epics?.find(e => e.number === w.currentEpic)
          ?.stories?.find(s => s.number === w.currentStory)?.name || `story-${w.currentStory}`;
        resumeLine += `, Story ${w.currentStory} (${storyName})`;
      }
      lines.push(resumeLine);
    }
    if (w.phaseStatus === 'in_progress') lines.push(`Current Phase: ${w.currentPhase}`);
    else if (w.phaseStatus === 'ready') lines.push(`Next Phase: ${w.currentPhase}`);
    lines.push('Action: Run /continue to resume workflow');
  }

  lines.push('');
  lines.push('=== Commands ===');
  lines.push('');
  lines.push('/continue      - Resume workflow from current position');
  lines.push('/dashboard     - Open visual dashboard');
  lines.push('/quality-check - Run all quality gates');

  return lines.join('\n');
}

// =============================================================================
// PUBLIC API
// =============================================================================

module.exports = { collectData, formatText, computeApiCoverage };

// =============================================================================
// MAIN
// =============================================================================

if (require.main === module) {
  const state = helpers.readWorkflowState();
  const data = collectData(state);

  if (withTodos && data.status === 'ok') {
    const { getTodoList } = require('./generate-todo-list');
    data.todos = getTodoList(state);
  }

  if (formatArg === 'text') {
    console.log(formatText(data));
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}
