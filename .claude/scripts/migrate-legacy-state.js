#!/usr/bin/env node
/**
 * migrate-legacy-state.js
 * One-shot migrator for workflow-state.json files written by the pre-4-phase
 * workflow (commits before 6d6da27, 2026-05-21). Maps legacy phase vocabulary
 * to the INTAKE / PLAN / BUILD / COMPLETE model, drops removed sub-objects,
 * and copies feature-requirements.md → project-brief.md.
 *
 * Usage:
 *   node .claude/scripts/migrate-legacy-state.js                # dry-run, prints diff JSON
 *   node .claude/scripts/migrate-legacy-state.js --apply        # write changes (backup is saved)
 *   node .claude/scripts/migrate-legacy-state.js --restore      # swap the backup back in
 *   node .claude/scripts/migrate-legacy-state.js --root <dir>   # operate on <dir> instead of CWD
 *
 * Output: JSON `{ status, changes, warnings, [migrated] }`.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const helpers = require('./lib/workflow-helpers');

const STATE_REL = helpers.STATE_FILE;
const BACKUP_REL = 'generated-docs/context/workflow-state.legacy-backup.json';
const FRS_REL = 'generated-docs/specs/feature-requirements.md';
const BRIEF_REL = helpers.BRIEF_PATH;
const STORIES_DIR_REL = helpers.STORIES_DIR;

const TOP_LEVEL_PHASE_MAP = {
  'INTAKE': 'INTAKE',
  'DESIGN': 'PLAN',
  'SCOPE': 'PLAN',
  'STORIES': 'BUILD',
  'REALIGN': 'BUILD',
  'TEST-DESIGN': 'BUILD',
  'WRITE-TESTS': 'BUILD',
  'IMPLEMENT': 'BUILD',
  'QA': 'BUILD',
  'PHASE-BOUNDARY': 'BUILD',
  'COMPLETE': 'COMPLETE',
  'NONE': 'INTAKE'
};

const STORY_PHASE_MAP = {
  'COMPLETE': 'COMPLETE',
  'PENDING': 'PENDING',
  'REALIGN': 'PENDING',
  'TEST-DESIGN': 'PENDING',
  'WRITE-TESTS': 'PENDING',
  'IMPLEMENT': 'PENDING',
  'QA': 'PENDING'
};

const EPIC_PHASE_MAP = {
  'STORIES': 'PENDING',
  'PENDING': 'PENDING',
  'COMPLETE': 'COMPLETE'
};

// A phase is "legacy" if it maps to a different value than itself. Derived from
// the maps so the two never drift apart.
function isLegacyPhase(map, phase) {
  return phase in map && map[phase] !== phase;
}

function mapPhase(map, value, defaultValue, label, warnings) {
  if (map[value]) return map[value];
  warnings.push(`${label}: unknown phase '${value}', defaulting to ${defaultValue}`);
  return defaultValue;
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function findStoryFile(root, epicNum, storyNum) {
  const storiesDir = path.join(root, STORIES_DIR_REL);
  let epicDir;
  try {
    const match = fs.readdirSync(storiesDir, { withFileTypes: true })
      .find(e => e.isDirectory() && new RegExp(`^epic-${epicNum}(?:[-_]|$)`).test(e.name));
    if (!match) return null;
    epicDir = path.join(storiesDir, match.name);
  } catch {
    return null;
  }
  const story = helpers.findStoryFiles(epicDir).find(s => s.num === parseInt(storyNum));
  return story ? story.path : null;
}

function countACFromFile(storyFilePath) {
  let content;
  try { content = fs.readFileSync(storyFilePath, 'utf-8'); } catch { return null; }
  const section = helpers.extractACSection(content);
  if (!section) return null;
  const checked = (section.text.match(/^\s*[-*] \[[xX]\]/gm) || []).length;
  const unchecked = (section.text.match(/^\s*[-*] \[ \]/gm) || []).length;
  if (checked + unchecked === 0) return null;
  return { total: checked + unchecked, checked };
}

function countTestFiles(root, epicNum, storyNum) {
  return helpers.countTestFiles(parseInt(epicNum), parseInt(storyNum), {
    dirs: [
      path.join(root, 'web/src/__tests__/integration'),
      path.join(root, 'web/src/__tests__')
    ],
    recursive: true
  });
}

function detectLegacy(state, root) {
  const reasons = [];
  if (state) {
    if (state.currentPhase && isLegacyPhase(TOP_LEVEL_PHASE_MAP, state.currentPhase)) {
      reasons.push(`currentPhase is legacy: ${state.currentPhase}`);
    }
    if (state.epics) {
      for (const [num, epic] of Object.entries(state.epics)) {
        if (epic?.phase && isLegacyPhase(EPIC_PHASE_MAP, epic.phase)) {
          reasons.push(`epic ${num} phase is legacy: ${epic.phase}`);
        }
        if (epic?.stories) {
          for (const [snum, story] of Object.entries(epic.stories)) {
            if (story?.phase && isLegacyPhase(STORY_PHASE_MAP, story.phase)) {
              reasons.push(`epic ${num} story ${snum} phase is legacy: ${story.phase}`);
            }
          }
        }
      }
    }
    if (state.design) reasons.push('top-level `design` block (removed in 4-phase model)');
    if (state.designArtifacts) reasons.push('top-level `designArtifacts` block (removed in 4-phase model)');
    if (state.intake && 'frsExists' in state.intake) reasons.push('intake.frsExists (renamed to briefExists)');
  }
  const frsExists = fs.existsSync(path.join(root, FRS_REL));
  const briefExists = fs.existsSync(path.join(root, BRIEF_REL));
  if (frsExists && !briefExists) reasons.push('feature-requirements.md exists, project-brief.md does not');
  return reasons;
}

function synthesizeAcceptance(out, root, epicNum, storyNum, warnings) {
  if (out.acceptance) return;
  const storyFile = findStoryFile(root, epicNum, storyNum);
  const ac = storyFile ? countACFromFile(storyFile) : null;
  if (ac) {
    out.acceptance = ac;
  } else {
    warnings.push(`Epic ${epicNum} story ${storyNum}: completed but no acceptance criteria found in story file (or no story file). Leaving acceptance unset.`);
  }
}

function synthesizeTestFiles(out, root, epicNum, storyNum, warnings) {
  if (typeof out.testFiles === 'number') return;
  const count = countTestFiles(root, epicNum, storyNum);
  if (count > 0) {
    out.testFiles = count;
  } else {
    warnings.push(`Epic ${epicNum} story ${storyNum}: completed but no test files found on disk.`);
  }
}

function synthesizeCompletionStatus(out, field, value, epicNum, storyNum, warnings) {
  if (out[field]) return;
  out[field] = value;
  warnings.push(`Epic ${epicNum} story ${storyNum}: synthesized ${field}='${value}' (story was COMPLETE in legacy state).`);
}

function migrateStory(story, epicNum, storyNum, root, warnings) {
  const out = { ...story };
  if (story.phase) {
    out.phase = mapPhase(STORY_PHASE_MAP, story.phase, 'PENDING', `Epic ${epicNum} story ${storyNum}`, warnings);
  }

  // Completed stories must carry the fields the new schema expects; synthesize
  // what's missing from on-disk evidence (or warn if evidence is absent).
  if (out.phase === 'COMPLETE') {
    synthesizeAcceptance(out, root, epicNum, storyNum, warnings);
    synthesizeTestFiles(out, root, epicNum, storyNum, warnings);
    synthesizeCompletionStatus(out, 'e2eStatus', 'passed', epicNum, storyNum, warnings);
    synthesizeCompletionStatus(out, 'manualVerification', 'passed', epicNum, storyNum, warnings);
  }

  return out;
}

function migrateEpic(epic, epicNum, root, warnings) {
  const out = { ...epic };
  if (epic.phase) {
    out.phase = mapPhase(EPIC_PHASE_MAP, epic.phase, 'PENDING', `Epic ${epicNum}`, warnings);
  }
  if (epic.stories) {
    out.stories = {};
    for (const [snum, story] of Object.entries(epic.stories)) {
      out.stories[snum] = migrateStory(story, epicNum, snum, root, warnings);
    }
  }
  return out;
}

function migrateState(state, root, warnings) {
  if (!state) return null;
  const out = { ...state };

  const originalTop = state.currentPhase || 'NONE';
  out.currentPhase = mapPhase(TOP_LEVEL_PHASE_MAP, originalTop, 'INTAKE', 'Top-level currentPhase', warnings);

  if (state.epics) {
    out.epics = {};
    for (const [num, epic] of Object.entries(state.epics)) {
      out.epics[num] = migrateEpic(epic, num, root, warnings);
    }
  }

  if (state.design) {
    warnings.push('Dropped `design` block (multi-agent design phase removed in 4-phase model).');
    delete out.design;
  }
  if (state.designArtifacts) {
    warnings.push('Dropped `designArtifacts` block (not tracked in 4-phase model).');
    delete out.designArtifacts;
  }

  if (state.intake && 'frsExists' in state.intake) {
    out.intake = { ...state.intake };
    out.intake.briefExists = state.intake.frsExists;
    delete out.intake.frsExists;
  }

  if (typeof state.featureComplete !== 'boolean') {
    out.featureComplete = false;
  }

  out.migratedFromLegacyAt = new Date().toISOString();
  out.migrationNote = `Migrated from pre-4-phase workflow. Original currentPhase=${originalTop}.`;

  return out;
}

function buildBriefFromFrs(frsPath, briefPath) {
  const frsContent = fs.readFileSync(frsPath, 'utf-8');
  const today = new Date().toISOString().split('T')[0];
  const header = `<!-- Migrated from feature-requirements.md on ${today} by migrate-legacy-state.js -->\n\n`;
  fs.mkdirSync(path.dirname(briefPath), { recursive: true });
  fs.writeFileSync(briefPath, header + frsContent);
}

function planMigration(root) {
  const stateFile = path.join(root, STATE_REL);
  const frsFile = path.join(root, FRS_REL);
  const briefFile = path.join(root, BRIEF_REL);

  let state = null;
  try {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  } catch { /* state absent or unparseable — treated as no state */ }
  const stateExists = state !== null;
  const frsExists = fs.existsSync(frsFile);
  const briefExists = fs.existsSync(briefFile);

  if (!stateExists && !frsExists) {
    return { status: 'no_legacy', message: 'No workflow-state.json or feature-requirements.md found.', changes: [], warnings: [] };
  }

  const reasons = detectLegacy(state, root);
  if (reasons.length === 0) {
    return { status: 'no_migration_needed', message: 'State is already on the 4-phase model.', changes: [], warnings: [] };
  }

  const warnings = [];
  const migrated = stateExists ? migrateState(state, root, warnings) : null;
  const changes = [];
  if (stateExists) {
    changes.push({ kind: 'state-rewrite', file: STATE_REL, reasons });
  }
  if (frsExists && !briefExists) {
    changes.push({ kind: 'spec-copy', from: FRS_REL, to: BRIEF_REL });
  } else if (frsExists && briefExists) {
    warnings.push('Both feature-requirements.md and project-brief.md exist; leaving project-brief.md unchanged.');
  }

  return { status: 'legacy_detected', changes, warnings, migrated };
}

function applyMigration(root) {
  const plan = planMigration(root);
  if (plan.status !== 'legacy_detected') return plan;

  const stateFile = path.join(root, STATE_REL);
  const backupFile = path.join(root, BACKUP_REL);

  for (const change of plan.changes) {
    if (change.kind === 'state-rewrite') {
      if (!fs.existsSync(backupFile)) {
        fs.copyFileSync(stateFile, backupFile);
      } else {
        plan.warnings.push(`Backup ${BACKUP_REL} already exists; not overwriting (previous migration?).`);
      }
      writeJson(stateFile, plan.migrated);
    } else if (change.kind === 'spec-copy') {
      buildBriefFromFrs(path.join(root, change.from), path.join(root, change.to));
    }
  }

  return { status: 'applied', changes: plan.changes, warnings: plan.warnings, migrated: plan.migrated };
}

function restoreMigration(root) {
  const stateFile = path.join(root, STATE_REL);
  const backupFile = path.join(root, BACKUP_REL);
  const briefFile = path.join(root, BRIEF_REL);

  if (!fs.existsSync(backupFile)) {
    return { status: 'no_backup', message: `No backup at ${BACKUP_REL}. Cannot restore.`, changes: [], warnings: [] };
  }

  const changes = [];
  const warnings = [];

  fs.copyFileSync(backupFile, stateFile);
  fs.unlinkSync(backupFile);
  changes.push({ kind: 'state-restore', file: STATE_REL });

  // Only remove project-brief.md if it still carries the migration header —
  // a user-edited brief should not be silently deleted on restore.
  if (fs.existsSync(briefFile)) {
    const content = fs.readFileSync(briefFile, 'utf-8');
    if (content.startsWith('<!-- Migrated from feature-requirements.md')) {
      fs.unlinkSync(briefFile);
      changes.push({ kind: 'brief-remove', file: BRIEF_REL });
    } else {
      warnings.push(`${BRIEF_REL} does not carry the migration header; leaving in place.`);
    }
  }

  return { status: 'restored', changes, warnings };
}

function parseArgs(argv) {
  const opts = { mode: 'plan', root: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') opts.mode = 'apply';
    else if (arg === '--restore') opts.mode = 'restore';
    else if (arg === '--root') { opts.root = path.resolve(argv[++i]); }
    else if (arg === '--help' || arg === '-h') opts.mode = 'help';
  }
  return opts;
}

function printUsage() {
  console.log(`migrate-legacy-state.js — migrate pre-4-phase workflow-state.json to the 4-phase model.

Usage:
  node .claude/scripts/migrate-legacy-state.js                # dry-run, prints planned changes
  node .claude/scripts/migrate-legacy-state.js --apply        # write changes (creates workflow-state.legacy-backup.json)
  node .claude/scripts/migrate-legacy-state.js --restore      # swap the backup back in
  node .claude/scripts/migrate-legacy-state.js --root <dir>   # operate on <dir> instead of CWD

Phase mapping:
  INTAKE                                                       → INTAKE
  DESIGN, SCOPE                                                → PLAN
  STORIES, REALIGN, TEST-DESIGN, WRITE-TESTS, IMPLEMENT, QA    → BUILD
  PHASE-BOUNDARY                                               → BUILD
  COMPLETE                                                     → COMPLETE
`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.mode === 'help') { printUsage(); return; }

  let result;
  if (opts.mode === 'apply') result = applyMigration(opts.root);
  else if (opts.mode === 'restore') result = restoreMigration(opts.root);
  else result = planMigration(opts.root);

  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'no_backup') process.exit(1);
}

main();
