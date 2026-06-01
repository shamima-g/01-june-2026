#!/usr/bin/env node
/**
 * generate-dashboard-html.js
 *
 * Reads JSON from collect-dashboard-data.js and produces a self-contained HTML
 * dashboard file. The HTML includes a <meta http-equiv="refresh"> tag so the
 * browser auto-reloads from disk, picking up new data each time the file is
 * regenerated.
 *
 * Usage:
 *   node .claude/scripts/collect-dashboard-data.js --format=json | node .claude/scripts/generate-dashboard-html.js
 *   node .claude/scripts/generate-dashboard-html.js < data.json
 *   node .claude/scripts/generate-dashboard-html.js --output generated-docs/dashboard.html < data.json
 *
 * Or combined:
 *   node .claude/scripts/generate-dashboard-html.js --collect
 *   (runs collect-dashboard-data.js internally)
 */

const fs = require('fs');
const path = require('path');
const helpers = require('./lib/workflow-helpers');
const { friendlyName, GLOBAL_PHASES } = helpers;

// --- CLI args ---
const args = process.argv.slice(2);
const collectFlag = args.includes('--collect');
let outputPath = 'generated-docs/dashboard.html';
const outputIdx = args.indexOf('--output');
if (outputIdx !== -1 && args[outputIdx + 1]) {
  outputPath = args[outputIdx + 1];
}

// --- Get data ---
let data;
if (collectFlag) {
  try {
    const { collectData } = require('./collect-dashboard-data');
    data = collectData(helpers.readWorkflowState());
  } catch (e) {
    console.error('Failed to collect dashboard data:', e.message);
    process.exit(1);
  }
} else {
  // Read piped JSON from stdin. Use fd 0 directly instead of the path '/dev/stdin'
  // so it works cross-platform (on Windows, '/dev/stdin' is not a valid path).
  let input = '';
  const buf = Buffer.alloc(65536);
  let n;
  try {
    while ((n = fs.readSync(0, buf)) > 0) {
      input += buf.toString('utf-8', 0, n);
    }
  } catch (e) {
    // EAGAIN on non-piped stdin means no input is available — fall through to the check below.
    if (e.code !== 'EAGAIN') throw e;
  }
  if (!input.trim()) {
    console.error('No input. Use --collect or pipe JSON from collect-dashboard-data.js');
    process.exit(1);
  }
  data = JSON.parse(input.trim());
}

// --- Helpers ---
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function timestamp() {
  const d = new Date();
  return d.toISOString().replace('T', ' ').slice(0, 16);
}

function phaseTagClass(phase) {
  const map = {
    'COMPLETE': 'tag-green',
    'BUILD': 'tag-primary',
    'PLAN': 'tag-teal',
    'INTAKE': 'tag-secondary',
    'PENDING': 'tag-gray'
  };
  return map[phase] || 'tag-gray';
}

// Render the E2E (Playwright) status row for a story card. Returns '' when the
// story has no E2E state at all (pre-Playwright stories, or before BUILD).
function renderE2eRow(story) {
  const status = story.e2eStatus;
  if (!status) return '';

  // Map status → (label, color, extra info)
  const styleMap = {
    'passed':                          { label: 'E2E passed',                               color: 'var(--green)' },
    'passed-after-fix':                { label: 'E2E passed (after auto-fix)',              color: 'var(--green)' },
    'failed':                          { label: 'E2E failed',                               color: 'var(--red)' },
    'escalated':                       { label: 'E2E escalated — awaiting user',       color: 'var(--red)' },
    'auto-skipped:non-routable':       { label: 'E2E skipped (non-routable)',               color: 'var(--sub)' },
    'auto-skipped:fixme':              { label: 'E2E skipped (test.fixme)',                 color: 'var(--sub)' },
    'user-skipped':                    { label: 'E2E skipped (user)',                       color: 'var(--sub)' },
    'user-skipped-after-escalation':   { label: 'E2E skipped after escalation',             color: 'var(--peach)' },
    'missing':                         { label: 'E2E spec missing — BUILD halted',     color: 'var(--red)' },
    'running':                         { label: 'E2E running…',                        color: 'var(--primary)' },
    'pending':                         { label: 'E2E pending',                              color: 'var(--sub)' }
  };
  const style = styleMap[status] || { label: `E2E: ${status}`, color: 'var(--sub)' };

  const pass = story.e2ePassCount;
  const fail = story.e2eFailCount;
  const counts = (pass != null || fail != null)
    ? ` <span style="color:var(--sub)">(${pass ?? 0} passed${fail ? `, ${fail} failed` : ''})</span>`
    : '';

  const fixCycles = story.e2eFixCycleCount;
  const fixCycleNote = fixCycles
    ? ` <span style="color:var(--sub)">— ${fixCycles} auto-fix cycle${fixCycles > 1 ? 's' : ''}</span>`
    : '';

  const deferred = Array.isArray(story.deferredE2eTargets) ? story.deferredE2eTargets : [];
  const deferredNote = deferred.length
    ? `<div style="margin-left:24px;margin-top:4px;font-size:11px;color:var(--sub)">Included deferred specs: ${deferred.map(esc).join(', ')}</div>`
    : '';

  const lastRun = story.e2eLastRun ? ` <span style="color:var(--sub)">· ${esc(story.e2eLastRun.slice(0, 16).replace('T', ' '))}Z</span>` : '';

  return `<div style="margin-bottom:10px;font-size:13px">
    <span style="color:${style.color};font-weight:600">● ${esc(style.label)}</span>${counts}${fixCycleNote}${lastRun}
    ${deferredNote}
  </div>`;
}

// --- Build sections ---
const w = data.workflow || {};
const currentPhase = w.currentPhase || 'NONE';
const featureNameRaw = w.featureName || 'Untitled Feature';
const featureSlug = featureNameRaw.replace(/[^a-zA-Z0-9-]/g, '_');
// Friendly display name: replace hyphens/underscores with spaces, title-case first word
const featureName = (() => {
  const words = featureNameRaw.replace(/[-_]+/g, ' ').split(' ').filter(Boolean);
  if (words.length === 0) return featureNameRaw;
  words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  return words.join(' ');
})();

// Phase groupings — 4-phase model: INTAKE → PLAN → BUILD → COMPLETE
const phaseOrder = GLOBAL_PHASES;
const currentIdx = phaseOrder.indexOf(currentPhase);
// Gather every story with traceability data once — both the section-visibility
// flag and the Test Coverage card iteration read from this.
const storiesWithTrace = [];
for (const epic of (data.epics || [])) {
  for (const s of (epic.stories || [])) {
    if (s.traceability && s.traceability.criteria.length > 0) {
      storiesWithTrace.push({ epic, story: s });
    }
  }
}
const hasAnyTraceability = storiesWithTrace.length > 0;

// Current epic/story info
const totalEpics = data.totalEpics || data.epics?.length || 0;
const currentEpic = data.epics?.find(e => e.number === w.currentEpic);
const currentEpicName = friendlyName(currentEpic?.name, 'epic') || (w.currentEpic ? `Epic ${w.currentEpic}` : '');
const currentStoryObj = currentEpic?.stories?.find(s => s.number === w.currentStory);
const currentStoryName = friendlyName(currentStoryObj?.name, 'story') || (w.currentStory ? `Story ${w.currentStory}` : '');
const totalStories = currentEpic?.totalStories || currentEpic?.stories?.length || 0;
const completedStoriesInEpic = (currentEpic?.stories || []).filter(s => s.phase === 'COMPLETE').length;

// Phase tooltip descriptions — 4-phase model.
const PHASE_TOOLTIPS = {
  'INTAKE':   'Claude reads your docs, asks a few quick questions to fill in any gaps, and writes a short project summary for you to approve before any work starts.',
  'PLAN':     'Claude breaks the work into a clear list of features and steps, then checks the plan with you before building anything.',
  'BUILD':    'Claude builds the feature one piece at a time — writing checks first, then the code, then making sure everything still works in a real browser.',
  'COMPLETE': 'Everything in the plan is built and tested. The feature is ready to use.'
};

function stepHTML(phase) {
  let cls = 'step';
  if (w.featureComplete) {
    cls += ' done';
  } else if (phase === currentPhase) {
    cls += ' active';
  } else {
    const pIdx = phaseOrder.indexOf(phase);
    if (pIdx >= 0 && pIdx < currentIdx) {
      cls += ' done';
    }
  }
  const tipId = `phase-tip-${phase.toLowerCase().replace(/-/g, '_')}`;
  const tipText = PHASE_TOOLTIPS[phase] || '';
  const ariaDescribed = tipText ? ` aria-describedby="${tipId}"` : '';
  const tipHtml = tipText
    ? `<div class="step-tooltip" role="tooltip" id="${tipId}">${esc(tipText)}</div>`
    : '';
  return `<div class="step-tooltip-wrap"><div class="${cls}" tabindex="0"${ariaDescribed}>${esc(phase)}</div>${tipHtml}</div>`;
}

function pipelineHTML() {
  // Single horizontal pipeline: INTAKE → PLAN → BUILD → COMPLETE.
  const pipelineSteps = phaseOrder.map((p, i) => {
    const arrow = i < phaseOrder.length - 1 ? '<span class="arrow">&#8250;</span>' : '';
    return stepHTML(p) + arrow;
  }).join('');
  const completeStep = stepHTML('COMPLETE');

  let annotation = '';
  if (w.featureComplete) {
    annotation = `<span class="tier-info" style="color:var(--green)">Feature complete</span>`;
  } else if (currentPhase === 'BUILD' && w.currentEpic) {
    const epicPct = totalStories > 0 ? Math.round(completedStoriesInEpic / totalStories * 100) : 0;
    const epicLabel = currentEpicName.replace(/^Epic \d+:\s*/, '');
    const storySuffix = w.currentStory
      ? ` — Story ${w.currentStory}${currentStoryName ? `: ${esc(currentStoryName.replace(/^Story \d+:\s*/, ''))}` : ''}`
      : '';
    annotation = `<span class="tier-info">Epic ${w.currentEpic} of ${totalEpics}: ${esc(epicLabel)}${storySuffix}</span>
      <div class="tier-progress"><div class="progress-bar" style="width:80px"><div class="fill primary" style="width:${epicPct}%"></div></div><span class="label-sub">${completedStoriesInEpic}/${totalStories}</span></div>`;
  } else if (currentPhase === 'PLAN' && totalEpics > 0) {
    annotation = `<span class="tier-info">${totalEpics} epic${totalEpics !== 1 ? 's' : ''} planned</span>`;
  }

  return `
    <div class="tier">
      <span class="tier-label">Workflow</span>
      <div class="tier-steps"><div class="pipeline">${pipelineSteps}<span class="arrow">&#8250;</span>${completeStep}</div></div>
      <div class="tier-right">${annotation}</div>
    </div>`;
}

// SVG logo
const logoSVG = `<svg width="32" height="16" viewBox="0 0 32 16" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="s8grad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#3B82F6"/><stop offset="100%" stop-color="#10B981"/></linearGradient></defs>
  <path d="M8 2C4.5 2 2 4.5 2 8s2.5 6 6 6c2 0 3.5-1 4.5-2.5L16 8l-3.5-3.5C11.5 3 10 2 8 2zm16 0c-2 0-3.5 1-4.5 2.5L16 8l3.5 3.5C20.5 13 22 14 24 14c3.5 0 6-2.5 6-6s-2.5-6-6-6z" fill="none" stroke="url(#s8grad)" stroke-width="2" stroke-linecap="round"/>
</svg>`;

// Artifacts section — on-demand artifacts emitted during BUILD.
function artifactsHTML() {
  if (!data.designArtifacts) return '';
  const da = data.designArtifacts;
  const items = [
    { name: 'Project Brief', ok: da.brief, path: 'specs/project-brief.md' },
    { name: 'API Spec (OpenAPI)', ok: da.apiSpec, path: 'specs/api-spec.yaml' },
    { name: 'Design Tokens (CSS)', ok: da.designTokens, path: 'specs/design-tokens.css' },
    { name: 'Mock Handlers (MSW)', ok: da.mocks, path: null }
  ];
  const rows = items.map(i => {
    const label = i.ok && i.path
      ? `<a class="artifact-link" href="${i.path}" target="_blank">${esc(i.name)}</a>`
      : esc(i.name);
    return `<div class="artifact"><span class="dot ${i.ok ? 'yes' : 'no'}"></span> ${label}</div>`;
  }).join('\n          ');
  return `
      <div class="card">
        <h2>Artifacts</h2>
        <div class="artifacts">${rows}</div>
      </div>`;
}


// Epics section (no outer wrapper — collapsible section adds it)
function epicsHTML() {
  if (!data.epics || data.epics.length === 0) return '';
  const epicBlocks = data.epics.map(epic => {
    const completedStories = (epic.stories || []).filter(s => s.phase === 'COMPLETE').length;
    const total = epic.totalStories || epic.stories.length || 0;
    const pct = total > 0 ? Math.round(completedStories / total * 100) : 0;

    const storyRows = (epic.stories || []).map(s => {
      let marker = '&#9675;';
      let markerStyle = '';
      if (s.phase === 'COMPLETE') { marker = '&#10003;'; }
      else if (w.currentStory === s.number && w.currentEpic === epic.number) {
        marker = '&#9654;'; markerStyle = ' style="color:var(--primary)"';
      }
      const phaseTag = s.phase !== 'PENDING' && s.phase !== 'COMPLETE' ?
        `<span class="phase-tag ${phaseTagClass(s.phase)}">${esc(s.phase)}</span>` : '';
      return `
              <div class="story-row">
                <span class="epic-summary-cell epic-name" style="padding-left:12px"><span class="story-marker"${markerStyle}>${marker}</span>${esc(friendlyName(s.name, 'story') || `Story ${s.number}`)}</span>
                <span class="epic-summary-cell epic-phase">${s.phase === 'COMPLETE' ? `<span class="phase-tag tag-green">COMPLETE</span>` : phaseTag}</span>
                <span class="epic-summary-cell epic-progress"></span>
              </div>`;
    }).join('');

    // Expand current/in-progress epic; collapse completed and pending
    const isCurrentEpic = w.currentEpic === epic.number;
    const epicDefaultOpen = isCurrentEpic && !w.featureComplete;
    const epicId = `epic-${epic.number}`;

    const manualTestStatus = epic.manualTestStatus;
    const manualTestBadgeMap = {
      passed:  { label: 'mt: passed',  color: 'var(--green)', italic: false },
      issues:  { label: 'mt: issues',  color: 'var(--red)',   italic: false },
      skipped: { label: 'mt: skipped', color: 'var(--sub)',   italic: false },
      legacy:  { label: 'mt: legacy',  color: 'var(--sub)',   italic: true  },
    };
    const mt = manualTestBadgeMap[manualTestStatus];
    const manualTestBadge = mt
      ? ` <span style="margin-left:8px;font-size:11px;color:${mt.color};${mt.italic ? 'font-style:italic;' : ''}">[${esc(mt.label)}]</span>`
      : '';

    return `
          <details id="${epicId}" class="epic-details" data-default-open="${epicDefaultOpen}"${epicDefaultOpen ? ' open' : ''}>
            <summary class="epic-summary">
              <span class="epic-summary-cell epic-name">${esc(friendlyName(epic.name, 'epic') || `Epic ${epic.number}`)}${manualTestBadge}</span>
              <span class="epic-summary-cell epic-phase"><span class="phase-tag ${phaseTagClass(epic.phase)}">${esc(epic.phase)}</span></span>
              <span class="epic-summary-cell epic-progress">
                <div style="display:flex;align-items:center;gap:8px">
                  <div class="progress-bar" style="width:100px"><div class="fill ${epic.phase === 'COMPLETE' ? 'green' : 'primary'}" style="width:${pct}%"></div></div>
                  <span class="label-sub">${completedStories}/${total}</span>
                </div>
              </span>
            </summary>
            <div class="epic-story-list">${storyRows}
            </div>
          </details>`;
  }).join('');

  return `
        <div class="epic-header-row">
          <span class="epic-header-cell epic-name">Epic</span>
          <span class="epic-header-cell epic-phase">Phase</span>
          <span class="epic-header-cell epic-progress">Stories</span>
        </div>
        ${epicBlocks}`;
}

// API coverage section (no outer wrapper)
function apiHTML() {
  if (!data.api) return '';
  const api = data.api;
  const unmocked = api.totalEndpoints - api.mockCoverage;

  const endpointRows = (api.endpoints || []).map(ep => {
    const methodCls = (ep.method || 'GET').toUpperCase();
    return `
          <div class="endpoint">
            <span class="method-badge ${methodCls}">${esc(methodCls)}</span>
            <span>${esc(ep.path)}</span>
            <span class="mock-badge ${ep.hasMock ? 'mocked' : 'unmocked'}">${ep.hasMock ? 'Mocked' : 'Unmocked'}</span>
          </div>`;
  }).join('');

  return `
        <div class="api-section">
          <div class="api-summary">
            <div class="api-stat"><div class="num">${api.totalEndpoints}</div><div class="label-sub">Endpoints</div></div>
            <div class="api-stat"><div class="num" style="color:var(--green)">${api.mockCoverage}</div><div class="label-sub">Mocked</div></div>
            <div class="api-stat"><div class="num" style="color:var(--red)">${unmocked}</div><div class="label-sub">Unmocked</div></div>
            <div class="api-stat"><div class="num" style="color:var(--yellow)">${api.drifted || 0}</div><div class="label-sub">Drifted</div></div>
          </div>
          <div class="endpoint-list">${endpointRows}
          </div>
        </div>`;
}

// Requirements section
function requirementsHTML() {
  if (!data.intake) return '';
  const i = data.intake;
  const mCheck = i.manifestExists ? 'yes' : 'no';
  const bCheck = i.briefExists ? 'yes' : 'no';
  const counts = i.requirementCount != null
    ? `<div style="margin-top:8px;font-size:13px;color:var(--text)">${i.requirementCount} requirements, ${i.businessRuleCount || 0} business rules</div>`
    : '';
  return `
      <div class="card">
        <h2>Requirements</h2>
        <div class="artifact"><span class="dot ${mCheck}"></span> ${i.manifestExists ? '<a class="artifact-link" href="context/intake-manifest.json" target="_blank">Intake Manifest</a>' : 'Intake Manifest'}</div>
        <div class="artifact" style="margin-top:6px"><span class="dot ${bCheck}"></span> ${i.briefExists ? '<a class="artifact-link" href="specs/project-brief.md" target="_blank">Project Brief</a>' : 'Project Brief'}</div>
        ${counts}
      </div>`;
}

// --- Collapsible section helpers ---
function sectionOpen(sectionId) {
  switch (sectionId) {
    case 'project-setup': return currentPhase === 'INTAKE';
    case 'epic-progress': return data.epics && data.epics.length > 0;
    case 'test-coverage': return hasAnyTraceability;
    case 'api-coverage': return apiSectionDefaultOpen();
    default: return false;
  }
}

function projectSetupSummary() {
  const parts = [];
  if (data.intake?.requirementCount != null) {
    parts.push(`${data.intake.requirementCount} requirements`);
    if (data.intake.businessRuleCount) parts.push(`${data.intake.businessRuleCount} business rules`);
  }
  return parts.join(', ') || '';
}

function apiBadge() {
  if (!data.api) return '';
  const api = data.api;
  const ds = api.dataSource || '';
  if ((api.drifted || 0) > 0) return '<span class="api-badge badge-red">Drift Detected</span>';
  if (ds === 'existing-api' && api.mockCoverage === 0) return '<span class="api-badge badge-green">All Live</span>';
  if (api.mockCoverage === api.totalEndpoints && api.totalEndpoints > 0) return '<span class="api-badge badge-yellow">Mocked</span>';
  if (api.mockCoverage > 0 && api.mockCoverage < api.totalEndpoints) return '<span class="api-badge badge-orange">Mixed</span>';
  if (ds === 'api-in-development' && api.mockCoverage === 0) return '<span class="api-badge badge-primary">Awaiting Mocks</span>';
  if (ds === 'new-api') return '<span class="api-badge badge-gray">No Backend Yet</span>';
  return '<span class="api-badge badge-gray">API Defined</span>';
}

function apiCoverageSummary() {
  if (!data.api) return '';
  return `${data.api.totalEndpoints} endpoints, ${data.api.mockCoverage} mocked`;
}

function apiSectionDefaultOpen() {
  if (!data.api) return false;
  const ds = data.api.dataSource || '';
  // Collapsed for existing-api with no mocks; expanded otherwise
  if (ds === 'existing-api' && data.api.mockCoverage === 0 && (data.api.drifted || 0) === 0) return false;
  return true;
}

// Footer
function footerHTML() {
  const parts = [];
  if (w.featureComplete) {
    parts.push('<span>Feature complete</span>');
    parts.push('<span><code>/quality-check</code> before PR</span>');
  } else {
    if (w.currentEpic) {
      let resume = `Resume: <strong>${esc(currentEpicName)}`;
      if (w.currentStory) resume += `, ${esc(currentStoryName)}`;
      resume += '</strong>';
      parts.push(`<span>${resume}</span>`);
    }
    parts.push('<span><code>/continue</code> to resume</span>');
    parts.push('<span><code>/quality-check</code> before PR</span>');
  }
  return parts.join('\n    ');
}

function activeSection() {
  if (w.featureComplete) return null;
  if (currentPhase === 'INTAKE') return 'project-setup';
  if (hasAnyTraceability && currentPhase === 'BUILD') return 'test-coverage';
  if (currentPhase === 'BUILD') return 'epic-progress';
  return null;
}
const activeSectionId = activeSection();

// --- Assemble collapsible sections ---
function buildSections() {
  let sections = '';

  // Section 1: Project Setup
  const hasSetup = data.intake || data.designArtifacts;
  if (hasSetup) {
    const isOpen = sectionOpen('project-setup');
    const reqHTML = requirementsHTML();
    const artHTML = artifactsHTML();
    const setupContent = `
    <div class="grid">
      ${reqHTML}
      ${artHTML}
    </div>`;
    sections += `
<details id="section-project-setup"${activeSectionId === 'project-setup' ? ' class="section-active"' : ''} data-default-open="${isOpen}"${isOpen ? ' open' : ''}>
  <summary class="section-summary">Project Setup <span class="section-meta">${esc(projectSetupSummary())}</span></summary>
  <div class="section-body">${setupContent}</div>
</details>`;
  }

  // Section 2: Epic & Story Progress
  if (data.epics && data.epics.length > 0) {
    const isOpen = sectionOpen('epic-progress');
    sections += `
<details id="section-epic-progress"${activeSectionId === 'epic-progress' ? ' class="section-active"' : ''} data-default-open="${isOpen}"${isOpen ? ' open' : ''}>
  <summary class="section-summary">Epic &amp; Story Progress</summary>
  <div class="section-body">
    <div class="card">${epicsHTML()}</div>
  </div>
</details>`;
  }

  // Section 3: Test Coverage (per-story traceability — persists through all phases)
  if (hasAnyTraceability) {
    const isOpen = sectionOpen('test-coverage');

    // Overall counts across all stories. Auto-skipped and skipped stories are
    // excluded from the denominator — their ACs aren't "not verified", they're
    // "not applicable to verify at this point" and will surface on a later
    // routable story's verification checklist.
    let globalTotal = 0, globalChecked = 0;
    for (const { story } of storiesWithTrace) {
      const mv = story.manualVerification;
      if (mv === 'auto-skipped' || mv === 'skipped') continue;
      for (const c of story.traceability.criteria) {
        globalTotal++;
        if (c.checked) globalChecked++;
      }
    }

    // Build per-story cards
    const storyCards = storiesWithTrace.map(({ epic, story }) => {
      const tr = story.traceability;
      const criteria = tr.criteria;
      const mv = story.manualVerification;
      const autoSkipped = mv === 'auto-skipped';
      const skipped = mv === 'skipped';
      const checkedCount = criteria.filter(c => c.checked).length;
      const isCurrent = epic.number === w.currentEpic && story.number === w.currentStory;
      const storyLabel = friendlyName(story.name, 'story') || `Story ${story.number}`;
      const epicLabel = friendlyName(epic.name, 'epic') || `Epic ${epic.number}`;
      const phaseTag = story.phase && story.phase !== 'PENDING'
        ? `<span class="phase-tag ${phaseTagClass(story.phase)}" style="margin-left:8px;font-size:11px">${esc(story.phase)}</span>`
        : '';
      const currentMarker = isCurrent ? ' style="border-left:3px solid var(--primary);padding-left:12px"' : '';

      const rows = criteria.map(c => {
        const testedIcon = c.tested ? '&#10003;' : '&mdash;';
        let statusIcon, statusCls, statusTitle = '';
        if (autoSkipped) {
          statusIcon = '&#9203;';
          statusCls = 'color:var(--peach)';
          statusTitle = 'Awaiting deferred verification on a later routable story';
        } else if (skipped) {
          statusIcon = '&mdash;';
          statusCls = 'color:var(--sub)';
          statusTitle = 'Manual verification skipped';
        } else if (c.checked) {
          statusIcon = '&#10003;';
          statusCls = 'color:var(--green)';
        } else {
          statusIcon = '&#10007;';
          statusCls = 'color:var(--red)';
        }
        const statusTitleAttr = statusTitle ? ` title="${esc(statusTitle)}"` : '';
        return `<tr>
              <td style="font-weight:600;white-space:nowrap">${esc(c.id)}</td>
              <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:0" title="${esc(c.text)}">${esc(c.text)}</td>
              <td style="text-align:center;color:${c.tested ? 'var(--green)' : 'var(--sub)'}">${testedIcon}</td>
              <td style="text-align:center;${statusCls}"${statusTitleAttr}>${statusIcon}</td>
            </tr>`;
      }).join('');

      let counterLabel;
      if (autoSkipped) counterLabel = `${criteria.length} pending deferred verification`;
      else if (skipped) counterLabel = 'verification skipped';
      else counterLabel = `${checkedCount}/${criteria.length} verified`;

      const e2eRow = renderE2eRow(story);

      return `
        <div class="card" style="margin-bottom:12px"${currentMarker}>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <div>
              <span style="font-weight:600">${esc(epicLabel)} &rsaquo; ${esc(storyLabel)}</span>${phaseTag}
            </div>
            <span class="label-sub">${esc(counterLabel)}</span>
          </div>
          ${e2eRow}
          <table class="trace-table">
            <thead><tr><th style="width:1%;white-space:nowrap">AC</th><th>Criterion</th><th style="width:1%;white-space:nowrap;text-align:center">Tested</th><th style="width:1%;white-space:nowrap;text-align:center">&#9679;</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }).join('');

    const testContent = storyCards + `
      <div style="margin-top:4px;font-size:11px;color:var(--sub)">&#10003; verified/covered &nbsp; <span style="color:var(--peach)">&#9203;</span> pending deferred verification &nbsp; &#10007; not started</div>`;

    const summaryMeta = `${globalChecked}/${globalTotal} criteria verified`;
    sections += `
<details id="section-test-coverage"${activeSectionId === 'test-coverage' ? ' class="section-active"' : ''} data-default-open="${isOpen}"${isOpen ? ' open' : ''}>
  <summary class="section-summary">Test Coverage <span class="section-meta">${esc(summaryMeta)}</span></summary>
  <div class="section-body">${testContent}</div>
</details>`;
  }

  // Section 4: API Coverage
  if (data.api) {
    const isOpen = sectionOpen('api-coverage');
    sections += `
<details id="section-api-coverage" data-default-open="${isOpen}"${isOpen ? ' open' : ''}>
  <summary class="section-summary">API Coverage ${apiBadge()} <span class="section-meta">${esc(apiCoverageSummary())}</span></summary>
  <div class="section-body">
    <div class="card">${apiHTML()}</div>
  </div>
</details>`;
  }

  return sections;
}

// localStorage persistence script
const localStorageScript = `
<script>
(function() {
  var slug = '${featureSlug}';
  var prefix = 'stadium8-' + slug + '-';

  document.addEventListener('DOMContentLoaded', function() {
    var sections = document.querySelectorAll('details[id][data-default-open]');
    sections.forEach(function(el) {
      var key = prefix + el.id;
      var saved = null;
      try { saved = JSON.parse(localStorage.getItem(key)); } catch(e) {}
      if (saved && saved.defaultOpen === el.getAttribute('data-default-open')) {
        if (saved.open && !el.open) el.open = true;
        if (!saved.open && el.open) el.removeAttribute('open');
      } else {
        try { localStorage.removeItem(key); } catch(e) {}
      }
    });

    document.addEventListener('toggle', function(e) {
      var el = e.target;
      if (el.tagName === 'DETAILS' && el.id && el.hasAttribute('data-default-open')) {
        var key = prefix + el.id;
        try {
          localStorage.setItem(key, JSON.stringify({
            open: el.open,
            defaultOpen: el.getAttribute('data-default-open')
          }));
        } catch(e) {}
      }
    }, true);
  });
})();
</script>`;

// Completion summary card
function completionCardHTML() {
  if (!w.featureComplete) return '';
  const epicCount = data.epics?.length || 0;
  const storyCount = (data.epics || []).reduce((sum, e) => sum + (e.stories?.length || 0), 0);
  let totalAC = 0;
  for (const e of (data.epics || [])) {
    for (const s of (e.stories || [])) {
      if (s.acceptance) totalAC += s.acceptance.total;
    }
  }
  const parts = [];
  if (epicCount) parts.push(`${epicCount} epic${epicCount > 1 ? 's' : ''}`);
  if (storyCount) parts.push(`${storyCount} stor${storyCount > 1 ? 'ies' : 'y'}`);
  if (totalAC) parts.push(`${totalAC} acceptance criteria`);
  return `
<div class="completion-card">
  <div class="completion-icon">&#10003;</div>
  <div class="completion-text">
    <div class="completion-title">Feature complete</div>
    <div class="completion-detail">${parts.join(' &middot; ')}</div>
  </div>
</div>`;
}

// --- Assemble HTML ---
const noStateMessage = data.status === 'no_state'
  ? `<div class="card" style="text-align:center;padding:40px"><div style="margin-bottom:12px">${logoSVG}</div><h2 style="color:var(--text);font-size:16px">No workflow state found</h2><p style="color:var(--sub);margin-top:8px">Run <code>/start</code> to begin the TDD workflow.</p></div>`
  : '';

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="refresh" content="10">
<title>${esc(featureName)} - Stadium 8 Dashboard</title>
<style>
  :root {
    --bg: #111113;
    --surface: #1C1C1F;
    --surface2: #2A2A2E;
    --border: #3A3A3F;
    --text: #E4E4E7;
    --sub: #A1A1AA;
    --primary: #3B82F6;
    --secondary: #10B981;
    --green: #a6e3a1;
    --yellow: #f9e2af;
    --red: #f38ba8;
    --teal: #94e2d5;
    --peach: #fab387;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: var(--bg); color: var(--text); padding: 24px; line-height: 1.5;
  }
  .header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
  .header-brand { display: flex; align-items: center; gap: 10px; }
  .header-titles h1 { font-size: 20px; font-weight: 600; line-height: 1.2; }
  .header-titles .subtitle { font-size: 11px; color: var(--sub); letter-spacing: 1.5px; text-transform: uppercase; }
  .phase-badge { background: linear-gradient(135deg, var(--primary), var(--secondary)); color: white; padding: 2px 12px; border-radius: 12px; font-size: 12px; font-weight: 700; letter-spacing: 0.5px; }
  .timestamp { margin-left: auto; font-size: 12px; color: var(--sub); }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  .grid.full { grid-template-columns: 1fr; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
  .card h2 { font-size: 13px; font-weight: 600; color: var(--sub); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 12px; }

  /* Three-tier pipeline */
  .workflow-tiers { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px; margin-bottom: 16px; }
  .tier { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--surface2); }
  .tier:last-child { border-bottom: none; }
  .tier-label { min-width: 100px; font-size: 11px; font-weight: 600; color: var(--sub); text-transform: uppercase; letter-spacing: 0.5px; flex-shrink: 0; }
  .tier-steps { flex: 1; }
  .tier-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .tier-info { font-size: 11px; color: var(--text); }
  .tier-progress { display: flex; align-items: center; gap: 6px; }

  .pipeline { display: flex; gap: 4px; align-items: center; }
  .step-tooltip-wrap { position: relative; flex: 1; }
  .step { text-align: center; padding: 6px 4px; border-radius: 6px; font-size: 10px; font-weight: 600; background: var(--surface2); color: var(--sub); cursor: help; }
  .step.done { background: rgba(166,227,161,0.15); color: var(--green); }
  .step.active { background: rgba(59,130,246,0.15); color: var(--primary); box-shadow: 0 0 0 1px var(--primary); }
  .step-tooltip { position: absolute; top: calc(100% + 8px); left: 50%; transform: translateX(-50%); background: var(--surface2); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; font-size: 11px; font-weight: 400; line-height: 1.5; color: var(--text); white-space: normal; width: 200px; text-align: left; opacity: 0; pointer-events: none; transition: opacity 0.15s; z-index: 200; box-shadow: 0 4px 16px rgba(0,0,0,0.5); }
  .step-tooltip::before { content: ''; position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); border: 5px solid transparent; border-bottom-color: var(--border); }
  .step-tooltip-wrap:hover .step-tooltip, .step-tooltip-wrap:focus-within .step-tooltip { opacity: 1; pointer-events: auto; }

  .arrow { color: var(--border); font-size: 14px; flex-shrink: 0; }
  .artifacts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .artifact { display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; display: inline-block; }
  .dot.yes { background: var(--green); }
  .dot.no { background: var(--border); }
  .artifact-link { color: var(--text); text-decoration: none; border-bottom: 1px dashed var(--sub); transition: color 0.15s, border-color 0.15s; }
  .artifact-link:hover { color: var(--primary); border-color: var(--primary); }
  .story-marker { margin-right: 6px; }
  .progress-bar { width: 100%; height: 6px; background: var(--surface2); border-radius: 3px; overflow: hidden; }
  .fill { height: 100%; border-radius: 3px; }
  .fill.green { background: var(--green); }
  .fill.primary { background: var(--primary); }
  .fill.yellow { background: var(--yellow); }
  .phase-tag { display: inline-block; padding: 1px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
  .tag-green { background: rgba(166,227,161,0.15); color: var(--green); }
  .tag-primary { background: rgba(59,130,246,0.15); color: var(--primary); }
  .tag-teal { background: rgba(148,226,213,0.15); color: var(--teal); }
  .tag-secondary { background: rgba(16,185,129,0.15); color: var(--secondary); }
  .tag-gray { background: var(--surface2); color: var(--sub); }
  .api-section { display: flex; gap: 32px; }
  .api-summary { display: flex; flex-direction: column; gap: 12px; min-width: 120px; }
  .api-stat { text-align: center; }
  .api-stat .num { font-size: 22px; font-weight: 700; }
  .api-stat .label-sub { font-size: 11px; color: var(--sub); }
  .endpoint-list { flex: 1; max-height: 200px; overflow-y: auto; font-size: 12px; }
  .endpoint { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
  .method-badge { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 3px; min-width: 42px; text-align: center; }
  .method-badge.GET { background: rgba(59,130,246,0.2); color: var(--primary); }
  .method-badge.POST { background: rgba(166,227,161,0.2); color: var(--green); }
  .method-badge.PUT { background: rgba(249,226,175,0.2); color: var(--yellow); }
  .method-badge.DELETE { background: rgba(243,139,168,0.2); color: var(--red); }
  .method-badge.PATCH { background: rgba(250,179,135,0.2); color: var(--peach); }
  .mock-badge { font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 3px; margin-left: auto; white-space: nowrap; }
  .mock-badge.mocked { background: rgba(166,227,161,0.15); color: var(--green); }
  .mock-badge.unmocked { background: rgba(243,139,168,0.15); color: var(--red); }
  .api-badge { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 8px; margin-left: 4px; }
  .badge-green { background: rgba(166,227,161,0.15); color: var(--green); }
  .badge-yellow { background: rgba(249,226,175,0.15); color: var(--yellow); }
  .badge-orange { background: rgba(250,179,135,0.15); color: var(--peach); }
  .badge-red { background: rgba(243,139,168,0.15); color: var(--red); }
  .badge-primary { background: rgba(59,130,246,0.15); color: var(--primary); }
  .badge-gray { background: var(--surface2); color: var(--sub); }
  .epic-header-row { display: flex; align-items: center; padding: 6px 8px 6px 24px; border-bottom: 1px solid var(--border); }
  .epic-header-cell { font-size: 11px; font-weight: 600; color: var(--sub); text-transform: uppercase; }
  .epic-details { border-bottom: 1px solid var(--surface2); }
  .epic-details:last-child { border-bottom: none; }
  .epic-summary { display: flex; align-items: center; padding: 8px 8px 8px 0; cursor: pointer; list-style: none; }
  .epic-summary::-webkit-details-marker { display: none; }
  .epic-summary::before { content: '\\25B8'; color: var(--sub); font-size: 10px; width: 20px; text-align: center; flex-shrink: 0; transition: transform 0.15s; }
  .epic-details[open] > .epic-summary::before { transform: rotate(90deg); }
  .epic-summary-cell { font-size: 13px; }
  .epic-name { flex: 1; font-weight: 600; }
  .epic-phase { width: 100px; }
  .epic-progress { width: 140px; }
  .epic-story-list { padding-left: 20px; }
  .story-row { display: flex; align-items: center; padding: 4px 8px 4px 0; border-top: 1px solid var(--surface2); font-size: 12px; color: var(--sub); }
  .story-row .epic-name { font-weight: 400; }
  .story-marker { margin-right: 6px; }
  .trace-table { width: 100%; border-collapse: collapse; }
  .trace-table th { text-align: left; font-size: 11px; font-weight: 600; color: var(--sub); padding: 6px 8px; border-bottom: 1px solid var(--border); }
  .trace-table td { padding: 6px 8px; font-size: 12px; border-bottom: 1px solid var(--surface2); }
  .trace-table tr:last-child td { border-bottom: none; }
  .label-sub { font-size: 11px; color: var(--sub); }

  /* Collapsible sections */
  details { margin-bottom: 16px; }
  .section-summary { display: flex; align-items: center; gap: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px 16px; cursor: pointer; font-size: 14px; font-weight: 600; list-style: none; border-left: 3px solid transparent; }
  .section-active > .section-summary { border-left: 3px solid; border-image: linear-gradient(180deg, var(--primary), var(--secondary)) 1; }
  .section-summary::-webkit-details-marker { display: none; }
  .section-summary::before { content: '\\25B8'; color: var(--sub); font-size: 12px; transition: transform 0.15s; }
  details[open] > .section-summary::before { transform: rotate(90deg); }
  details[open] > .section-summary { border-radius: 10px 10px 0 0; margin-bottom: 0; }
  .section-meta { margin-left: auto; font-size: 12px; font-weight: 400; color: var(--sub); }
  .section-body { background: var(--surface); border: 1px solid var(--border); border-top: none; border-radius: 0 0 10px 10px; padding: 16px; }
  .section-body .card { border: none; padding: 0; background: transparent; }
  .section-body .grid { margin-bottom: 8px; }
  .section-body .grid:last-child { margin-bottom: 0; }

  .completion-card { display: flex; align-items: center; gap: 16px; background: linear-gradient(135deg, rgba(59,130,246,0.08), rgba(16,185,129,0.08)); border: 1px solid rgba(16,185,129,0.3); border-radius: 10px; padding: 16px 20px; margin-bottom: 16px; }
  .completion-icon { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, var(--primary), var(--secondary)); color: white; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; }
  .completion-title { font-size: 16px; font-weight: 600; }
  .completion-detail { font-size: 13px; color: var(--sub); margin-top: 2px; }
  .footer { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border); font-size: 12px; color: var(--sub); display: flex; align-items: center; gap: 24px; }
  .footer code { background: var(--surface2); padding: 1px 6px; border-radius: 4px; font-size: 11px; }
  .footer-brand { margin-left: auto; font-size: 10px; color: var(--sub); opacity: 0.6; letter-spacing: 1px; text-transform: uppercase; }
  .auto-refresh { font-size: 10px; color: var(--sub); opacity: 0.5; margin-top: 8px; text-align: right; }
</style>
</head>
<body>

${noStateMessage || `<div class="header">
  <div class="header-brand">
    ${logoSVG}
    <div class="header-titles">
      <h1>${esc(featureName)}</h1>
      <div class="subtitle">Stadium 8</div>
    </div>
  </div>
  <span class="phase-badge">${esc(currentPhase)}</span>
  <span class="timestamp">Updated ${timestamp()}</span>
</div>

<div class="workflow-tiers">
  ${pipelineHTML()}
</div>

${completionCardHTML()}
${buildSections()}

<div class="footer">
  ${footerHTML()}
  <span class="footer-brand">Stadium 8</span>
</div>`}

<div class="auto-refresh">Auto-refreshes every 10 seconds</div>

${localStorageScript}

</body>
</html>`;

// --- Write output ---
const dir = path.dirname(outputPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}
fs.writeFileSync(outputPath, html, 'utf-8');

const stats = fs.statSync(outputPath);
console.log(JSON.stringify({
  status: 'ok',
  path: outputPath,
  bytes: stats.size,
  timestamp: timestamp()
}));