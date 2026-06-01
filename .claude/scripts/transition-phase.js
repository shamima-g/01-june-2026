#!/usr/bin/env node
/**
 * transition-phase.js
 * Manages workflow state transitions for the 4-phase model.
 *
 * Phases: INTAKE → PLAN → BUILD → COMPLETE.
 * Per-story progress lives in state.epics[N].stories[M] — there are no story-level phases.
 *
 * Usage:
 *   node .claude/scripts/transition-phase.js --to <PHASE>                                          # Phase transition
 *   node .claude/scripts/transition-phase.js --epic <N> --to <PHASE> [--story <M>]
 *   node .claude/scripts/transition-phase.js --current --to <PHASE> [--story <M>]
 *   node .claude/scripts/transition-phase.js --init [INTAKE|PLAN|BUILD]
 *   node .claude/scripts/transition-phase.js --mark-started
 *   node .claude/scripts/transition-phase.js --feature-complete
 *   node .claude/scripts/transition-phase.js --reopen-for-epics                # Re-open a completed feature for new epics
 *   node .claude/scripts/transition-phase.js --set-totals epics <N>
 *   node .claude/scripts/transition-phase.js --set-totals stories <N> --epic <E>
 *   node .claude/scripts/transition-phase.js --pre-complete-checks --story M [--epic N | --current]
 *   node .claude/scripts/transition-phase.js --set-manual-verification <status> --story M [--epic N | --current]
 *   node .claude/scripts/transition-phase.js --set-e2e-status <status> --story M [...]
 *   node .claude/scripts/transition-phase.js --get-deferred-verification [--epic N | --current]
 *   node .claude/scripts/transition-phase.js --show
 *   node .claude/scripts/transition-phase.js --repair
 */

const fs = require('fs');
const path = require('path');
const helpers = require('./lib/workflow-helpers');

const {
  STATE_FILE,
  BRIEF_PATH,
  API_SPEC_PATH,
  FEATURE_OVERVIEW_PATH,
  INTAKE_MANIFEST_FILE: INTAKE_MANIFEST_PATH,
  ALL_PHASES,
  GLOBAL_PHASES,
  MANUAL_VERIFICATION_STATUS_VALUES,
  E2E_STATUS_VALUES
} = helpers;
const STATE_DIR = path.dirname(STATE_FILE);

// Valid transitions for the 4-phase model.
// BUILD → PLAN re-enters per-epic stories for the next pending epic.
// BUILD → COMPLETE fires after the last epic's last story commits.
const VALID_TRANSITIONS = {
  'INTAKE': ['PLAN'],
  'PLAN': ['BUILD'],
  'BUILD': ['PLAN', 'COMPLETE'],
  'COMPLETE': [],
  'NONE': ['INTAKE']
};

// =============================================================================
// HELPERS
// =============================================================================

function ensureStateDir() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

function exitWithError(message) {
  console.log(JSON.stringify({ status: 'error', message }, null, 2));
  process.exit(1);
}

function parsePositiveInt(value, label) {
  const num = parseInt(value);
  if (isNaN(num) || num < 1) {
    exitWithError(`Invalid ${label}. Must be a positive integer.`);
  }
  return num;
}

function requireEpicArg(args, flagName) {
  const epicIdx = args.indexOf('--epic');
  if (epicIdx === -1 || !args[epicIdx + 1]) {
    exitWithError(`${flagName} requires --epic <N> to specify which epic.`);
  }
  return parsePositiveInt(args[epicIdx + 1], 'epic number');
}

function writeState(state) {
  ensureStateDir();
  state.lastUpdated = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function findFeatureSpec() {
  return fs.existsSync(BRIEF_PATH) ? BRIEF_PATH : null;
}

// Shared parser for the per-story flags: --story M and either --epic N or --current.
// Returns { epicNum, storyNum } or exits with an error if either is missing.
function requireStoryInState(state, epicNum, storyNum) {
  if (!state) exitWithError('No workflow state found');
  if (!state.epics?.[epicNum]?.stories?.[storyNum]) {
    exitWithError(`Epic ${epicNum}, Story ${storyNum} not found in state`);
  }
}

function requireEpicStoryRefs(args, flagName, state) {
  const storyIdx = args.indexOf('--story');
  const storyNum = storyIdx !== -1 ? parseInt(args[storyIdx + 1]) : NaN;
  let epicNum = NaN;
  if (args.includes('--current')) {
    if (state) epicNum = state.currentEpic;
  } else {
    const eIdx = args.indexOf('--epic');
    if (eIdx !== -1) epicNum = parseInt(args[eIdx + 1]);
  }
  if (!epicNum || Number.isNaN(epicNum) || !storyNum || Number.isNaN(storyNum)) {
    exitWithError(`${flagName} requires --story M and --epic N (or --current)`);
  }
  return { epicNum, storyNum };
}

function validateTransition(currentPhase, targetPhase) {
  const from = currentPhase || 'NONE';
  const allowed = VALID_TRANSITIONS[from] || [];
  if (!allowed.includes(targetPhase)) {
    return {
      valid: false,
      message: `Invalid transition: ${from} → ${targetPhase}. Allowed from ${from}: ${allowed.join(', ') || 'none'}`
    };
  }
  return { valid: true };
}

// =============================================================================
// COMMANDS
// =============================================================================

function showState() {
  const state = helpers.readWorkflowState();
  if (!state) {
    console.log(JSON.stringify({
      status: 'no_state',
      message: 'No workflow state found. Run /start to begin.',
      suggestion: 'Use --repair to initialize state from artifacts'
    }, null, 2));
    return;
  }
  console.log(JSON.stringify({ status: 'ok', state }, null, 2));
}

// Reconstruct state from artifacts. In the 4-phase model the artifacts are:
//   - generated-docs/specs/project-brief.md          → INTAKE produced output
//   - generated-docs/stories/_feature-overview.md    → PLAN produced epic list
//   - generated-docs/stories/epic-N-slug/_epic-overview.md → PLAN produced stories
//   - story AC checkboxes in story files             → BUILD progress per story
function repairState() {
  const spec = findFeatureSpec();
  if (!spec && !fs.existsSync(BRIEF_PATH)) {
    console.log(JSON.stringify({
      status: 'error',
      message: 'No project-brief.md or feature spec found. Cannot repair state.'
    }, null, 2));
    process.exit(1);
  }

  const detected = [];
  const assumed = [];

  const briefExists = fs.existsSync(BRIEF_PATH);
  const hasFeatureOverview = fs.existsSync(FEATURE_OVERVIEW_PATH);
  const epics = helpers.listEpics();

  if (briefExists) detected.push('project-brief.md exists');
  else assumed.push('project-brief.md missing — INTAKE incomplete');

  let currentPhase = 'INTAKE';
  let currentEpic = null;
  let currentStory = null;
  const epicStates = {};

  if (briefExists && !hasFeatureOverview && epics.length === 0) {
    currentPhase = 'PLAN';
    detected.push('Brief exists, no epics yet — at PLAN');
  } else if (briefExists && (hasFeatureOverview || epics.length > 0)) {
    currentPhase = 'BUILD';
    detected.push(`${epics.length} epic dir(s) on disk — at BUILD`);

    for (const epic of epics) {
      const storyFiles = helpers.findStoryFiles(epic.path);
      const stories = {};
      let allComplete = storyFiles.length > 0;
      let firstIncomplete = null;
      for (const sf of storyFiles) {
        const ac = helpers.countStoryAC(epic.path, sf.num);
        const complete = ac.total > 0 && ac.checked === ac.total;
        stories[sf.num] = {
          name: sf.title,
          phase: complete ? 'COMPLETE' : 'PENDING',
          acceptance: ac,
          testFiles: helpers.countTestFiles(epic.num, sf.num)
        };
        if (!complete) {
          allComplete = false;
          if (!firstIncomplete) firstIncomplete = sf.num;
        }
      }
      epicStates[epic.num] = {
        name: epic.dirName,
        phase: allComplete && storyFiles.length > 0 ? 'COMPLETE' : 'PENDING',
        totalStories: storyFiles.length,
        stories
      };
      if (!currentEpic && !allComplete) {
        currentEpic = epic.num;
        currentStory = firstIncomplete;
      }
    }
  }

  const manifest = helpers.readIntakeManifest();
  const manifestExists = manifest !== null;

  const repairedState = {
    featureName: path.basename(spec, '.md'),
    specPath: spec,
    currentEpic,
    currentStory,
    currentPhase: epics.length > 0 && Object.values(epicStates).every(e => e.phase === 'COMPLETE') ? 'COMPLETE' : currentPhase,
    phaseStatus: 'ready',
    epics: epicStates,
    repairedAt: new Date().toISOString(),
    repairNote: 'State reconstructed from artifacts.'
  };

  if (manifestExists || briefExists) {
    repairedState.intake = {
      manifestExists,
      briefExists,
      requirementCount: manifest?.requirementCount ?? null,
      businessRuleCount: manifest?.businessRuleCount ?? null,
      capturedAt: new Date().toISOString()
    };
  }

  const confidence = briefExists ? 'high' : 'medium';
  const confidenceReason = briefExists
    ? 'project-brief.md present — phase inferred from epic artifacts'
    : 'project-brief.md missing — INTAKE state partially inferred';

  writeState(repairedState);

  const response = {
    status: 'repaired',
    message: 'State file repaired from artifacts.',
    confidence,
    confidenceReason,
    detected,
    assumed,
    state: repairedState
  };
  if (confidence === 'medium') response.warning = 'MEDIUM CONFIDENCE: Review the detected state.';
  else response.note = 'High confidence repair.';

  console.log(JSON.stringify(response, null, 2));
}

function transitionPhase(epicNum, targetPhase, storyNum, options = {}) {
  const { cachedState = null } = options;

  if (!ALL_PHASES.includes(targetPhase)) {
    exitWithError(`Invalid phase: ${targetPhase}. Valid: ${ALL_PHASES.join(', ')}`);
  }

  let state = cachedState || helpers.readWorkflowState();

  if (!state) {
    const spec = findFeatureSpec();
    if (!spec && targetPhase !== 'INTAKE') {
      exitWithError('No project-brief.md or feature spec found. Create one or use --init INTAKE.');
    }
    state = {
      featureName: spec ? path.basename(spec, '.md') : 'pending-intake',
      specPath: spec || null,
      currentEpic: GLOBAL_PHASES.includes(targetPhase) ? null : epicNum,
      currentStory: storyNum || null,
      currentPhase: 'NONE',
      phaseStatus: 'ready',
      epics: {}
    };
  }

  const isGlobalTarget = GLOBAL_PHASES.includes(targetPhase);
  const currentPhase = state.currentPhase || 'NONE';

  const validation = validateTransition(currentPhase, targetPhase);
  if (!validation.valid) {
    console.log(JSON.stringify({
      status: 'error',
      message: validation.message,
      currentState: { epic: epicNum, story: storyNum || null, phase: currentPhase }
    }, null, 2));
    process.exit(1);
  }

  // Initialize epic state when targeting a phase that runs per-epic (BUILD)
  if (!isGlobalTarget || targetPhase === 'BUILD') {
    if (epicNum) {
      if (!state.epics[epicNum]) state.epics[epicNum] = { stories: {} };
      if (!state.epics[epicNum].stories) state.epics[epicNum].stories = {};
    }
  }

  // BUILD → COMPLETE on the last story commit
  if (targetPhase === 'COMPLETE' && storyNum && epicNum) {
    const epicState = state.epics[epicNum];
    if (!epicState.stories[storyNum]) epicState.stories[storyNum] = {};
    epicState.stories[storyNum].phase = 'COMPLETE';
    state.currentStory = storyNum;
    state.currentEpic = epicNum;

    let totalStories = epicState.totalStories;
    if (!totalStories) {
      const epicDir = helpers.findEpicDir(epicNum);
      if (epicDir) totalStories = helpers.findStoryFiles(epicDir).length;
    }
    if (!totalStories) totalStories = Object.keys(epicState.stories).length;

    const completedStories = Object.values(epicState.stories).filter(s => s.phase === 'COMPLETE').length;

    if (completedStories >= totalStories) {
      epicState.phase = 'COMPLETE';
      if (state.totalEpics && epicNum >= state.totalEpics) {
        state.featureComplete = true;
        state.currentPhase = 'COMPLETE';
        state.phaseStatus = 'complete';
      } else {
        // More epics — return to PLAN for the next pending epic
        state.currentEpic = epicNum + 1;
        state.currentStory = null;
        state.currentPhase = 'PLAN';
        state.phaseStatus = 'ready';
      }
    } else {
      // More stories in this epic — stay in BUILD, advance currentStory
      state.currentStory = storyNum + 1;
      state.currentPhase = 'BUILD';
      state.phaseStatus = 'ready';
      if (!epicState.stories[storyNum + 1]) {
        epicState.stories[storyNum + 1] = { phase: 'PENDING' };
      }
    }
  } else if (isGlobalTarget) {
    state.currentPhase = targetPhase;
    state.phaseStatus = 'ready';
    if (targetPhase === 'BUILD' && epicNum) {
      state.currentEpic = epicNum;
      if (storyNum) state.currentStory = storyNum;
      state.epics[epicNum].phase = 'BUILD';
    } else if (targetPhase === 'PLAN') {
      // PLAN may also target a specific epic (re-entry after one BUILD finishes)
      if (epicNum) state.currentEpic = epicNum;
    } else {
      state.currentEpic = null;
      state.currentStory = null;
    }
  }

  // INTAKE metric capture
  if (targetPhase === 'PLAN' && currentPhase === 'INTAKE') {
    const manifest = helpers.readIntakeManifest();
    state.intake = {
      manifestExists: manifest !== null,
      briefExists: fs.existsSync(BRIEF_PATH),
      requirementCount: manifest?.context?.requirementCount ?? manifest?.requirementCount ?? null,
      businessRuleCount: manifest?.context?.businessRuleCount ?? manifest?.businessRuleCount ?? null,
      capturedAt: new Date().toISOString()
    };
    if (!state.featureName || state.featureName === 'pending-intake') {
      const extracted = helpers.extractFeatureNameFromFiles();
      if (extracted) state.featureName = extracted;
    }
  }

  // Story metric capture on completion
  if (targetPhase === 'COMPLETE' && storyNum && epicNum) {
    const epicDir = helpers.findEpicDir(epicNum);
    if (epicDir) {
      const ac = helpers.countStoryAC(epicDir, storyNum);
      if (state.epics[epicNum]?.stories?.[storyNum]) {
        state.epics[epicNum].stories[storyNum].acceptance = ac;
        state.epics[epicNum].stories[storyNum].testFiles = helpers.countTestFiles(epicNum, storyNum);
      }
    }
  }

  // History
  if (!state.history) state.history = [];
  state.history.push({
    timestamp: new Date().toISOString(),
    epic: isGlobalTarget ? null : epicNum,
    story: storyNum || null,
    from: currentPhase,
    to: targetPhase
  });
  if (state.history.length > 30) state.history = state.history.slice(-30);

  writeState(state);

  let message;
  if (storyNum) {
    message = `Transitioned Epic ${epicNum}, Story ${storyNum} from ${currentPhase} to ${targetPhase}`;
  } else if (isGlobalTarget) {
    message = `Transitioned from ${currentPhase} to ${targetPhase}`;
  } else {
    message = `Transitioned Epic ${epicNum} from ${currentPhase} to ${targetPhase}`;
  }

  const response = {
    status: 'ok',
    message,
    state: {
      epic: state.currentEpic,
      story: state.currentStory,
      phase: state.currentPhase
    }
  };

  if (state.featureComplete) {
    response.featureComplete = true;
    response.message = `Feature complete! All ${state.totalEpics || Object.keys(state.epics).length} epics done.`;
  }

  console.log(JSON.stringify(response, null, 2));
}

function markStarted() {
  const state = helpers.readWorkflowState();
  if (!state) exitWithError('No workflow state found. Cannot mark phase as started.');
  if (state.phaseStatus === 'in_progress') {
    console.log(JSON.stringify({
      status: 'ok',
      message: 'Phase already marked as in progress',
      state: { epic: state.currentEpic, story: state.currentStory, phase: state.currentPhase, phaseStatus: state.phaseStatus }
    }, null, 2));
    return;
  }
  state.phaseStatus = 'in_progress';
  writeState(state);
  console.log(JSON.stringify({
    status: 'ok',
    message: `Phase ${state.currentPhase} marked as in progress`,
    state: { epic: state.currentEpic, story: state.currentStory, phase: state.currentPhase, phaseStatus: state.phaseStatus }
  }, null, 2));
}

function markFeatureComplete() {
  const state = helpers.readWorkflowState();
  if (!state) exitWithError('No workflow state found.');
  state.featureComplete = true;
  state.currentPhase = 'COMPLETE';
  state.phaseStatus = 'complete';
  writeState(state);
  console.log(JSON.stringify({
    status: 'ok',
    message: `Feature ${state.featureName || ''} marked complete`.trim(),
    state: { phase: state.currentPhase, phaseStatus: state.phaseStatus }
  }, null, 2));
}

// Leaves the existing epics array untouched so the planner can append rather than restart.
function reopenForEpics() {
  const state = helpers.readWorkflowState();
  if (!state) exitWithError('No workflow state found.');
  if (!state.featureComplete) {
    exitWithError('Feature is not marked complete — nothing to reopen.');
  }
  state.featureComplete = false;
  state.currentPhase = 'PLAN';
  state.phaseStatus = 'ready';
  state.currentEpic = null;
  state.currentStory = null;
  writeState(state);
  console.log(JSON.stringify({
    status: 'ok',
    reopened: true,
    message: `Feature ${state.featureName || ''} reopened for additional epics`.trim(),
    state: {
      phase: state.currentPhase,
      phaseStatus: state.phaseStatus,
      existingEpicCount: Array.isArray(state.epics) ? state.epics.length : Object.keys(state.epics || {}).length
    }
  }, null, 2));
}

function setTotals(subType, total, args) {
  const state = helpers.readWorkflowState();
  if (!state) exitWithError('No workflow state found. Run --init or --to first.');
  if (subType === 'epics') {
    state.totalEpics = total;
    writeState(state);
    console.log(JSON.stringify({ status: 'ok', message: `Set total epics to ${total}`, totalEpics: total }, null, 2));
    return;
  }
  if (subType === 'stories') {
    const epicNum = requireEpicArg(args, '--set-totals stories');
    if (!state.epics[epicNum]) state.epics[epicNum] = { stories: {} };
    state.epics[epicNum].totalStories = total;
    for (let i = 1; i <= total; i++) {
      if (!state.epics[epicNum].stories[i]) {
        state.epics[epicNum].stories[i] = { phase: 'PENDING' };
      }
    }
    writeState(state);
    console.log(JSON.stringify({ status: 'ok', message: `Set total stories for Epic ${epicNum} to ${total}`, epic: epicNum, totalStories: total }, null, 2));
    return;
  }
  exitWithError(`Unknown --set-totals type: ${subType}. Use 'epics' or 'stories'.`);
}

function initState(initialPhase) {
  const existingState = helpers.readWorkflowState();
  if (existingState) {
    console.log(JSON.stringify({
      status: 'exists',
      message: 'Workflow state already exists. Use --show to view or --repair to reconstruct.',
      state: existingState
    }, null, 2));
    return;
  }
  const spec = findFeatureSpec();
  if (!spec && initialPhase !== 'INTAKE') {
    exitWithError('No project-brief.md found. Use --init INTAKE to gather requirements first.');
  }
  const state = {
    featureName: spec ? path.basename(spec, '.md') : null,
    specPath: spec || null,
    currentEpic: null,
    currentStory: null,
    currentPhase: initialPhase,
    phaseStatus: 'ready',
    epics: {},
    history: [{
      timestamp: new Date().toISOString(),
      epic: null,
      story: null,
      from: 'NONE',
      to: initialPhase,
      note: 'Workflow initialized'
    }]
  };
  writeState(state);
  console.log(JSON.stringify({ status: 'ok', message: `Workflow initialized at ${initialPhase} phase`, state }, null, 2));
}

// =============================================================================
// CLI
// =============================================================================

function printUsage() {
  console.log(`
Usage:
  node .claude/scripts/transition-phase.js --to <PHASE>                           # Global phase transition
  node .claude/scripts/transition-phase.js --epic <N> --to <PHASE> [--story <M>]
  node .claude/scripts/transition-phase.js --current --to <PHASE> [--story <M>]
  node .claude/scripts/transition-phase.js --init [INTAKE|PLAN|BUILD]
  node .claude/scripts/transition-phase.js --mark-started
  node .claude/scripts/transition-phase.js --feature-complete
  node .claude/scripts/transition-phase.js --reopen-for-epics
  node .claude/scripts/transition-phase.js --set-totals epics <N>
  node .claude/scripts/transition-phase.js --set-totals stories <N> --epic <E>
  node .claude/scripts/transition-phase.js --pre-complete-checks --story M [--epic N | --current]
  node .claude/scripts/transition-phase.js --set-manual-verification <status> --story M [--epic N | --current]
  node .claude/scripts/transition-phase.js --set-e2e-status <status> --story M [...]
  node .claude/scripts/transition-phase.js --get-deferred-verification [--epic N | --current]
  node .claude/scripts/transition-phase.js --show
  node .claude/scripts/transition-phase.js --repair

Phase model: INTAKE → PLAN → BUILD → COMPLETE.
  INTAKE: gather requirements, produce project-brief.md.
  PLAN:   feature-planner produces epic list and per-epic stories.
  BUILD:  per-story test-generator → developer → playwright-runner ∥ code-reviewer → commit.
  After the last story in the last epic commits, BUILD → COMPLETE.
`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  if (args.includes('--show')) { showState(); return; }
  if (args.includes('--repair')) { repairState(); return; }
  if (args.includes('--mark-started')) { markStarted(); return; }
  if (args.includes('--feature-complete')) { markFeatureComplete(); return; }
  if (args.includes('--reopen-for-epics')) { reopenForEpics(); return; }

  // --init
  const initIdx = args.indexOf('--init');
  if (initIdx !== -1) {
    let initialPhase = 'INTAKE';
    const nextArg = args[initIdx + 1];
    if (nextArg && !nextArg.startsWith('--')) {
      initialPhase = nextArg.toUpperCase();
      if (!GLOBAL_PHASES.includes(initialPhase)) {
        exitWithError(`Invalid initial phase: ${initialPhase}. Use ${GLOBAL_PHASES.join(', ')}.`);
      }
    }
    initState(initialPhase);
    return;
  }

  // --set-totals
  const setTotalsIdx = args.indexOf('--set-totals');
  if (setTotalsIdx !== -1 && args[setTotalsIdx + 1]) {
    const subType = args[setTotalsIdx + 1];
    const total = parsePositiveInt(args[setTotalsIdx + 2], `total ${subType}`);
    setTotals(subType, total, args);
    return;
  }

  // Single state read shared across every command-handler branch below.
  const cachedState = helpers.readWorkflowState();

  // --pre-complete-checks (auto-check ACs before commit)
  if (args.includes('--pre-complete-checks')) {
    const { epicNum: epicArg, storyNum: storyArg } = requireEpicStoryRefs(args, '--pre-complete-checks', cachedState);
    const epicDir = helpers.findEpicDir(epicArg);
    if (!epicDir) exitWithError(`Epic ${epicArg} directory not found`);
    helpers.checkAllAcceptanceCriteria(epicDir, storyArg);
    console.log(JSON.stringify({ status: 'ok', message: `Auto-checked all ACs for Epic ${epicArg}, Story ${storyArg}` }, null, 2));
    return;
  }

  // --set-manual-verification
  if (args.includes('--set-manual-verification')) {
    const mvIdx = args.indexOf('--set-manual-verification');
    const mvValue = args[mvIdx + 1];
    if (!MANUAL_VERIFICATION_STATUS_VALUES.includes(mvValue)) {
      exitWithError(`--set-manual-verification value must be one of: ${MANUAL_VERIFICATION_STATUS_VALUES.join(', ')}`);
    }
    const { epicNum: epicArg, storyNum: storyArg } = requireEpicStoryRefs(args, '--set-manual-verification', cachedState);
    requireStoryInState(cachedState, epicArg, storyArg);
    cachedState.epics[epicArg].stories[storyArg].manualVerification = mvValue;
    writeState(cachedState);
    if (mvValue === 'deferred-passed') {
      const epicDir = helpers.findEpicDir(epicArg);
      if (epicDir) helpers.checkAllAcceptanceCriteria(epicDir, storyArg);
    }
    const msg = mvValue === 'auto-skipped'
      ? `Story ${storyArg} manual verification auto-skipped (component only)`
      : `Story ${storyArg} manual verification: ${mvValue}`;
    console.log(JSON.stringify({ status: 'ok', message: msg }, null, 2));
    return;
  }

  // --set-e2e-status
  if (args.includes('--set-e2e-status')) {
    const e2eIdx = args.indexOf('--set-e2e-status');
    const e2eValue = args[e2eIdx + 1];
    if (!E2E_STATUS_VALUES.includes(e2eValue)) {
      exitWithError(`--set-e2e-status value must be one of: ${E2E_STATUS_VALUES.join(', ')}`);
    }
    const { epicNum: epicArg, storyNum: storyArg } = requireEpicStoryRefs(args, '--set-e2e-status', cachedState);
    const passIdx = args.indexOf('--e2e-pass');
    const failIdx = args.indexOf('--e2e-fail');
    const targetsIdx = args.indexOf('--e2e-targets');
    const fixCycleIdx = args.indexOf('--e2e-fix-cycles');
    const e2ePassCount = passIdx !== -1 ? parseInt(args[passIdx + 1]) : null;
    const e2eFailCount = failIdx !== -1 ? parseInt(args[failIdx + 1]) : null;
    const e2eFixCycles = fixCycleIdx !== -1 ? parseInt(args[fixCycleIdx + 1]) : null;
    const e2eTargets = targetsIdx !== -1 && args[targetsIdx + 1]
      ? args[targetsIdx + 1].split(',').map(s => s.trim()).filter(Boolean)
      : null;
    requireStoryInState(cachedState, epicArg, storyArg);
    const story = cachedState.epics[epicArg].stories[storyArg];
    story.e2eStatus = e2eValue;
    story.e2eLastRun = new Date().toISOString();
    if (e2ePassCount !== null && !Number.isNaN(e2ePassCount)) story.e2ePassCount = e2ePassCount;
    if (e2eFailCount !== null && !Number.isNaN(e2eFailCount)) story.e2eFailCount = e2eFailCount;
    if (e2eFixCycles !== null && !Number.isNaN(e2eFixCycles)) story.e2eFixCycleCount = e2eFixCycles;
    if (e2eTargets) story.deferredE2eTargets = e2eTargets;
    writeState(cachedState);
    console.log(JSON.stringify({
      status: 'ok',
      message: `Story ${storyArg} E2E status: ${e2eValue}`,
      e2eStatus: e2eValue,
      e2eLastRun: story.e2eLastRun,
      e2ePassCount: story.e2ePassCount ?? null,
      e2eFailCount: story.e2eFailCount ?? null,
      e2eFixCycleCount: story.e2eFixCycleCount ?? null,
      deferredE2eTargets: story.deferredE2eTargets ?? []
    }, null, 2));
    return;
  }

  // --get-deferred-verification
  if (args.includes('--get-deferred-verification')) {
    let epicArg = null;
    if (args.includes('--current')) {
      if (cachedState) epicArg = cachedState.currentEpic;
    } else {
      const eIdx = args.indexOf('--epic');
      if (eIdx !== -1) epicArg = parseInt(args[eIdx + 1]);
    }
    if (!epicArg) exitWithError('--get-deferred-verification requires --epic N or --current');
    const deferred = helpers.getDeferredVerificationStories(epicArg);
    console.log(JSON.stringify({ status: 'ok', epicNum: epicArg, deferredCount: deferred.length, stories: deferred }, null, 2));
    return;
  }

  // Parse transition arguments
  let epicNum = null;
  let targetPhase = null;
  let storyNum = null;
  let useCurrent = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--epic' && args[i + 1]) {
      epicNum = parseInt(args[i + 1]); i++;
    } else if (args[i] === '--current') {
      useCurrent = true;
    } else if (args[i] === '--to' && args[i + 1]) {
      targetPhase = args[i + 1].toUpperCase(); i++;
    } else if (args[i] === '--story' && args[i + 1]) {
      storyNum = parseInt(args[i + 1]);
      if (isNaN(storyNum)) exitWithError('Invalid story number. Must be a positive integer.');
      i++;
    }
  }

  if (useCurrent) {
    if (!cachedState) exitWithError('No workflow state found. Cannot use --current.');
    epicNum = cachedState.currentEpic;
  }

  if (!targetPhase) {
    exitWithError('Missing required argument: --to <PHASE>');
  }

  transitionPhase(epicNum, targetPhase, storyNum, { cachedState });
}

main();
