#!/usr/bin/env node
/**
 * generate-todo-list.js
 * Emits a TodoWrite-compatible JSON list summarising 4-phase workflow progress.
 *
 * Usage:
 *   node .claude/scripts/generate-todo-list.js
 *
 * Phase model: INTAKE → PLAN → BUILD → COMPLETE.
 * Within an epic, stories are individual line items; completed stories collapse to
 * a single ✓ row, the current story is highlighted, future stories collapse to a
 * single range row (e.g. "Stories 3-6").
 */

const helpers = require('./lib/workflow-helpers');

// =============================================================================
// HELPERS
// =============================================================================

const SLUG_PREFIX_RE = {
  epic: /^epic-\d+-?/,
  story: /^story-\d+-?/
};
function slugSuffix(slug, prefix) {
  return slug.replace(SLUG_PREFIX_RE[prefix], '').replace(/-/g, ' ');
}

function phaseStatus(state, phase) {
  if (state.featureComplete || state.currentPhase === 'COMPLETE') return 'completed';
  if (state.currentPhase === phase) {
    return state.phaseStatus === 'in_progress' ? 'in_progress' : 'pending';
  }
  const currentIdx = helpers.GLOBAL_PHASES.indexOf(state.currentPhase);
  const phaseIdx = helpers.GLOBAL_PHASES.indexOf(phase);
  return currentIdx > phaseIdx ? 'completed' : 'pending';
}

function getTotalEpics(state) {
  if (state.totalEpics) return state.totalEpics;
  if (state.epics) return Math.max(...Object.keys(state.epics).map(Number), 0);
  return 0;
}

function buildDisplay(state, epicIndex) {
  const epicStateFor = (epicNum) => state.epics?.[epicNum];
  const storyStateFor = (epicNum, storyNum) => epicStateFor(epicNum)?.stories?.[storyNum];

  const view = {
    epicName(epicNum) {
      const persisted = epicStateFor(epicNum)?.name;
      if (persisted) return persisted;
      const entry = epicIndex.get(epicNum);
      if (!entry) return `Epic ${epicNum}`;
      return slugSuffix(entry.dirName, 'epic') || `Epic ${epicNum}`;
    },
    storyName(epicNum, storyNum) {
      const persisted = storyStateFor(epicNum, storyNum)?.name;
      if (persisted) return persisted;
      const story = epicIndex.get(epicNum)?.stories.get(storyNum);
      if (!story) return `Story ${storyNum}`;
      return slugSuffix(story.title, 'story') || `Story ${storyNum}`;
    },
    totalStories(epicNum) {
      const epicState = epicStateFor(epicNum);
      if (!epicState) return 0;
      if (epicState.totalStories) return epicState.totalStories;
      const indexed = epicIndex.get(epicNum)?.stories.size;
      if (indexed) return indexed;
      if (epicState.stories) return Object.keys(epicState.stories).length;
      return 0;
    },
    isEpicComplete(epicNum) {
      const epicState = epicStateFor(epicNum);
      if (!epicState) return false;
      if (epicState.phase === 'COMPLETE') return true;
      const total = view.totalStories(epicNum);
      if (total === 0) return false;
      const completed = Object.values(epicState.stories || {})
        .filter(s => s.phase === 'COMPLETE').length;
      return completed >= total;
    },
    isStoryComplete(epicNum, storyNum) {
      return storyStateFor(epicNum, storyNum)?.phase === 'COMPLETE';
    }
  };
  return view;
}

// =============================================================================
// MAIN LIST BUILDER
// =============================================================================

function buildTodoList(state) {
  const items = [];
  const display = buildDisplay(state, helpers.buildStoryIndex());

  // --- Phase 1: INTAKE ---
  items.push({
    content: 'Gather requirements (INTAKE)',
    status: phaseStatus(state, 'INTAKE'),
    activeForm: 'Gathering requirements'
  });

  // --- Phase 2: PLAN ---
  const totalEpics = getTotalEpics(state);
  const planSuffix = state.currentPhase !== 'INTAKE' && totalEpics > 0
    ? ` (${totalEpics} epic${totalEpics !== 1 ? 's' : ''})`
    : '';
  items.push({
    content: `Plan epics and stories (PLAN)${planSuffix}`,
    status: phaseStatus(state, 'PLAN'),
    activeForm: 'Planning epics and stories'
  });

  // If there's no epic structure yet, emit the placeholder BUILD row and stop here.
  if (!state.epics || Object.keys(state.epics).length === 0) {
    items.push({
      content: 'Build stories (BUILD)',
      status: phaseStatus(state, 'BUILD'),
      activeForm: 'Building stories'
    });
    return items;
  }

  // --- Phase 3: BUILD — expanded per-epic ---
  const futureEpics = [];

  for (let e = 1; e <= totalEpics; e++) {
    const isCurrentEpic = (e === state.currentEpic) && !state.featureComplete;
    const epicName = display.epicName(e);

    if (display.isEpicComplete(e) && !isCurrentEpic) {
      const totalStories = display.totalStories(e);
      const storySuffix = totalStories > 0 ? ` - ${totalStories} stor${totalStories !== 1 ? 'ies' : 'y'}` : '';
      items.push({
        content: `Epic ${e}: ${epicName} (complete${storySuffix})`,
        status: 'completed',
        activeForm: `Completing Epic ${e}`
      });
      continue;
    }

    if (!isCurrentEpic) {
      futureEpics.push(e);
      continue;
    }

    // Current epic — expand stories
    const totalStories = display.totalStories(e);
    const epicStatus = state.currentPhase === 'BUILD'
      ? (state.phaseStatus === 'in_progress' ? 'in_progress' : 'pending')
      : 'pending';
    items.push({
      content: `Epic ${e}: ${epicName} (BUILD)`,
      status: epicStatus,
      activeForm: `Building Epic ${e}`
    });

    const futureStories = [];
    for (let s = 1; s <= totalStories; s++) {
      const isCurrentStory = s === state.currentStory;
      const storyName = display.storyName(e, s);

      if (display.isStoryComplete(e, s)) {
        items.push({
          content: `  Story ${s}: ${storyName} (complete)`,
          status: 'completed',
          activeForm: `Completing Story ${s}`
        });
        continue;
      }

      if (!isCurrentStory) {
        futureStories.push(s);
        continue;
      }

      const storyStatus = state.currentPhase === 'BUILD' && state.phaseStatus === 'in_progress'
        ? 'in_progress'
        : 'pending';
      items.push({
        content: `  Story ${s}: ${storyName}`,
        status: storyStatus,
        activeForm: `Building Story ${s}`
      });
    }

    if (futureStories.length === 1) {
      const s = futureStories[0];
      items.push({
        content: `  Story ${s}: ${display.storyName(e, s)}`,
        status: 'pending',
        activeForm: `Working on Story ${s}`
      });
    } else if (futureStories.length > 1) {
      const first = futureStories[0];
      const last = futureStories[futureStories.length - 1];
      items.push({
        content: `  Stories ${first}-${last}: Remaining stories`,
        status: 'pending',
        activeForm: 'Working on remaining stories'
      });
    }
  }

  // --- Collapsed future epics ---
  if (futureEpics.length === 1) {
    const e = futureEpics[0];
    items.push({
      content: `Epic ${e}: ${display.epicName(e)}`,
      status: 'pending',
      activeForm: `Working on Epic ${e}`
    });
  } else if (futureEpics.length > 1) {
    const first = futureEpics[0];
    const last = futureEpics[futureEpics.length - 1];
    items.push({
      content: `Epics ${first}-${last}: Remaining epics`,
      status: 'pending',
      activeForm: 'Working on remaining epics'
    });
  }

  return items;
}

// =============================================================================
// PUBLIC API
// =============================================================================

function getTodoList(state) {
  if (!state) {
    return [{ content: 'Start workflow with /start', status: 'pending', activeForm: 'Starting workflow' }];
  }
  if (state.featureComplete || state.phaseStatus === 'complete') {
    return buildTodoList(state).map(item => ({ ...item, status: 'completed' }));
  }
  return buildTodoList(state);
}

module.exports = { getTodoList };

// =============================================================================
// MAIN
// =============================================================================

if (require.main === module) {
  const state = helpers.readWorkflowState();
  console.log(JSON.stringify(getTodoList(state)));
}
