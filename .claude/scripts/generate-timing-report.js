#!/usr/bin/env node
/**
 * generate-timing-report.js
 * Reads the append-only timing ledger and produces a human-readable report of how
 * long the project took to build — broken down by phase (macro) and by agent /
 * sub-phase (granular), with MANUAL-INTERVENTION TIME EXCLUDED.
 *
 * Model:
 *   - The ledger is a JSONL stream of lifecycle events (prompt, response,
 *     subagent_start/stop, session_start/end), each stamped with a real ISO clock
 *     time and the workflow phase that was active at the moment.
 *   - An interval between two consecutive events is ACTIVE unless it follows a point
 *     where Claude stopped and handed control back to the user. Those gaps —
 *     after `response`, `session_end`, `session_start` — are MANUAL / IDLE time and
 *     are subtracted.  Active build time = wall-clock − manual time.
 *   - Each active interval is attributed to the phase recorded on its starting event.
 *   - Subagent_start → subagent_stop spans give the granular per-agent breakdown
 *     (developer = development, test-generator = test-generation, etc.).
 *
 * Usage:
 *   node .claude/scripts/generate-timing-report.js            # writes the report
 *   node .claude/scripts/generate-timing-report.js --json     # also prints JSON
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.cwd();
const LEDGER_PATH = path.join(PROJECT_ROOT, 'generated-docs', 'timing', 'timing-ledger.jsonl');
const REPORT_PATH = path.join(PROJECT_ROOT, 'generated-docs', 'timing', 'timing-report.md');
const STATE_PATH = path.join(PROJECT_ROOT, 'generated-docs', 'context', 'workflow-state.json');

// Intervals that START with one of these events are the user's time, not Claude's.
// `permission_request` → next event (the approval, recorded as `permission_resolved`)
// is the time spent waiting for the user to approve/deny a tool call.
const IDLE_AFTER = new Set(['response', 'session_end', 'session_start', 'permission_request']);

// Map agent type → the granular sub-phase it represents.
const AGENT_SUBPHASE = {
  'intake-agent': 'intake',
  'api-connectivity-agent': 'intake',
  'feature-planner': 'planning',
  'design-api-agent': 'api-design',
  'design-style-agent': 'styling',
  'type-generator-agent': 'type-generation',
  'mock-setup-agent': 'mock-setup',
  'test-generator': 'test-generation',
  developer: 'development',
  'code-reviewer': 'review',
  'playwright-runner': 'e2e'
};

function fmt(ms) {
  if (ms <= 0) return '0s';
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}

function readLedger() {
  if (!fs.existsSync(LEDGER_PATH)) {
    console.error(`No timing ledger found at ${LEDGER_PATH}. Nothing to report yet.`);
    process.exit(1);
  }
  const raw = fs.readFileSync(LEDGER_PATH, 'utf8').replace(/^﻿/, '');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const events = [];
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      e._t = Date.parse(e.ts);
      if (!Number.isNaN(e._t)) events.push(e);
    } catch {
      // skip malformed lines
    }
  }
  events.sort((a, b) => a._t - b._t);
  return events;
}

function analyze(events) {
  const result = {
    wallClockMs: 0,
    manualMs: 0,
    permissionMs: 0,
    activeMs: 0,
    byPhase: {},          // phase → active ms
    byAgentSubphase: {},  // sub-phase → { ms, count }
    byStory: {},          // "epic-N/story-M" → active ms (interval-based total)
    byStoryCycle: {},     // "epic-N/story-M" → { build, debug, tagged } (A: from cycle tags)
    byStorySpan: {},      // "epic-N/story-M" → { build, debug } (B: span-based estimate)
    agentSpans: 0,
    firstTs: null,
    lastTs: null,
    eventCount: events.length
  };
  if (events.length === 0) return result;

  result.firstTs = events[0].ts;
  result.lastTs = events[events.length - 1].ts;
  result.wallClockMs = events[events.length - 1]._t - events[0]._t;

  // Walk consecutive events: classify each interval as active or manual/idle.
  for (let i = 0; i < events.length - 1; i++) {
    const cur = events[i];
    const next = events[i + 1];
    const dur = next._t - cur._t;
    if (dur <= 0) continue;

    if (IDLE_AFTER.has(cur.event)) {
      result.manualMs += dur;
      if (cur.event === 'permission_request') result.permissionMs += dur;
    } else {
      result.activeMs += dur;
      const phase = cur.phase || 'UNKNOWN';
      result.byPhase[phase] = (result.byPhase[phase] || 0) + dur;
      if (cur.phase === 'BUILD' && cur.epic && cur.story) {
        const key = `epic-${cur.epic}/story-${cur.story}`;
        result.byStory[key] = (result.byStory[key] || 0) + dur;
        // A — split build vs debug from the cycle tag the hook stamps. A numeric
        // cycle >= 2 is a fix cycle (debugging); cycle 1 (or an untagged interval)
        // counts toward the initial build. A story is "tagged" once any of its
        // BUILD intervals carry a numeric cycle.
        const c = result.byStoryCycle[key] || { build: 0, debug: 0, tagged: false };
        const cyc = typeof cur.cycle === 'number' ? cur.cycle : null;
        if (cyc !== null) {
          c.tagged = true;
          if (cyc >= 2) c.debug += dur;
          else c.build += dur;
        } else {
          c.build += dur;
        }
        result.byStoryCycle[key] = c;
      }
    }
  }

  // Granular per-agent spans (start → matching stop, FIFO per agent name).
  // The stack holds the START event (not just its time) so each span can be
  // attributed to the story it ran under.
  const open = {};
  // B — per-story span occurrence counter: the 1st span of a given agent role in a
  // story is the initial build/verify; 2nd+ spans of that role are fix-cycle re-runs
  // (debugging). This is the span-based estimate used when no cycle tag is present.
  const spanOcc = {};
  for (const e of events) {
    if (e.event === 'subagent_start') {
      (open[e.agent] = open[e.agent] || []).push(e);
    } else if (e.event === 'subagent_stop') {
      const stack = open[e.agent];
      if (stack && stack.length) {
        const startEv = stack.shift();
        const dur = e._t - startEv._t;
        if (dur > 0) {
          const sub = AGENT_SUBPHASE[e.agent] || (e.agent || 'unknown');
          const bucket = result.byAgentSubphase[sub] || { ms: 0, count: 0 };
          bucket.ms += dur;
          bucket.count += 1;
          result.byAgentSubphase[sub] = bucket;
          result.agentSpans += 1;

          if (startEv.phase === 'BUILD' && startEv.epic && startEv.story) {
            const key = `epic-${startEv.epic}/story-${startEv.story}`;
            const okey = `${key}::${e.agent}`;
            spanOcc[okey] = (spanOcc[okey] || 0) + 1;
            const sp = result.byStorySpan[key] || { build: 0, debug: 0 };
            if (spanOcc[okey] === 1) sp.build += dur;
            else sp.debug += dur;
            result.byStorySpan[key] = sp;
          }
        }
      }
    }
  }

  return result;
}

function readStateHistory() {
  if (!fs.existsSync(STATE_PATH)) return null;
  try {
    const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return Array.isArray(state.history) ? state.history : null;
  } catch {
    return null;
  }
}

function readFixCycleCounts() {
  // Per-story fix-cycle counts the orchestrator persists on each story record
  // (e2eFixCycleCount). Keyed "epic-N/story-M" to align with byStory.
  if (!fs.existsSync(STATE_PATH)) return {};
  const counts = {};
  try {
    const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    const epics = state.epics || {};
    for (const ek of Object.keys(epics)) {
      const ep = epics[ek];
      const idx = ep && ep.index != null ? ep.index : ek;
      const stories = (ep && ep.stories) || [];
      for (const s of stories) {
        if (!s || s.index == null) continue;
        if (typeof s.e2eFixCycleCount === 'number') {
          counts[`epic-${idx}/story-${s.index}`] = s.e2eFixCycleCount;
        }
      }
    }
  } catch {
    // best-effort
  }
  return counts;
}

function phaseDurationsFromHistory(history) {
  // Macro cross-check: time between phase-transition timestamps in state.history.
  if (!history || history.length === 0) return null;
  const rows = [];
  for (let i = 0; i < history.length - 1; i++) {
    const from = Date.parse(history[i].timestamp);
    const to = Date.parse(history[i + 1].timestamp);
    if (!Number.isNaN(from) && !Number.isNaN(to)) {
      rows.push({ phase: history[i].to, ms: to - from });
    }
  }
  return rows;
}

function buildReport(a, historyRows, fixCounts) {
  const lines = [];
  lines.push('# Build Timing Report');
  lines.push('');
  lines.push('> Active build time = wall-clock − manual-intervention time. Manual-intervention');
  lines.push('> time (waiting on the user: gate approvals, manual verification, `/clear` gaps,');
  lines.push('> answering questions) is measured and excluded.');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|---|---|');
  lines.push(`| First event | ${a.firstTs || '—'} |`);
  lines.push(`| Last event | ${a.lastTs || '—'} |`);
  lines.push(`| Total wall-clock | ${fmt(a.wallClockMs)} |`);
  lines.push(`| Manual-intervention time (excluded) | ${fmt(a.manualMs)} |`);
  lines.push(`| &nbsp;&nbsp;— of which permission-approval waits | ${fmt(a.permissionMs)} |`);
  lines.push(`| **Active build time** | **${fmt(a.activeMs)}** |`);
  lines.push(`| Recorded events | ${a.eventCount} |`);
  lines.push('');

  lines.push('## Active time by phase (macro)');
  lines.push('');
  lines.push('| Phase | Active time | % of active |');
  lines.push('|---|---|---|');
  const phaseOrder = ['INTAKE', 'PLAN', 'BUILD', 'COMPLETE', 'UNKNOWN'];
  const phases = Object.keys(a.byPhase).sort(
    (x, y) => (phaseOrder.indexOf(x) + 1 || 99) - (phaseOrder.indexOf(y) + 1 || 99)
  );
  for (const p of phases) {
    const pct = a.activeMs ? Math.round((a.byPhase[p] / a.activeMs) * 100) : 0;
    lines.push(`| ${p} | ${fmt(a.byPhase[p])} | ${pct}% |`);
  }
  if (phases.length === 0) lines.push('| _no data_ | — | — |');
  lines.push('');

  lines.push('## Active time by sub-phase (granular — from agent spans)');
  lines.push('');
  lines.push('| Sub-phase | Active time | Runs |');
  lines.push('|---|---|---|');
  const subs = Object.keys(a.byAgentSubphase).sort(
    (x, y) => a.byAgentSubphase[y].ms - a.byAgentSubphase[x].ms
  );
  for (const s of subs) {
    lines.push(`| ${s} | ${fmt(a.byAgentSubphase[s].ms)} | ${a.byAgentSubphase[s].count} |`);
  }
  if (subs.length === 0) lines.push('| _no agent spans recorded_ | — | — |');
  lines.push('');

  const storyKeys = Object.keys(a.byStory).sort();
  if (storyKeys.length) {
    const fc = fixCounts || {};
    let anyEst = false;
    lines.push('## BUILD time per story — build vs debug');
    lines.push('');
    lines.push('> "Debug" = fix-cycle work after the first build+verify round. When events');
    lines.push('> carry a `cycle` tag (cycle ≥ 2 ⇒ debugging) the split is exact; older');
    lines.push('> stories with no tag fall back to a span-based estimate (2nd+ run of an');
    lines.push('> agent in a story = a re-run), marked `~est`.');
    lines.push('');
    lines.push('| Story | Active total | Build | Debug | Fix cycles | Basis |');
    lines.push('|---|---|---|---|---|---|');
    for (const k of storyKeys) {
      const total = a.byStory[k] || 0;
      const cyc = a.byStoryCycle[k];
      const span = a.byStorySpan[k];
      let build;
      let debug;
      let basis;
      if (cyc && cyc.tagged) {
        build = cyc.build;
        debug = cyc.debug;
        basis = 'cycle-tagged';
      } else if (span) {
        build = span.build;
        debug = span.debug;
        basis = '~est (spans)';
        anyEst = true;
      } else {
        build = total;
        debug = 0;
        basis = '—';
      }
      const fixN = Object.prototype.hasOwnProperty.call(fc, k) ? String(fc[k]) : '—';
      lines.push(
        `| ${k} | ${fmt(total)} | ${fmt(build)} | ${fmt(debug)} | ${fixN} | ${basis} |`
      );
    }
    lines.push('');
    if (anyEst) {
      lines.push('_`~est (spans)` rows split by agent-span re-runs, so Build+Debug may not');
      lines.push('equal the interval-based Active total. Stories built after `cycle` tagging');
      lines.push('was added report an exact split._');
      lines.push('');
    }
  }

  lines.push('## Cross-check vs workflow-state.json history');
  lines.push('');
  if (historyRows && historyRows.length) {
    lines.push('Wall-clock spans between phase transitions recorded in `state.history[]`');
    lines.push('(includes manual time — for sanity-checking phase boundaries, not active time):');
    lines.push('');
    lines.push('| Entered phase | Wall-clock until next transition |');
    lines.push('|---|---|');
    for (const r of historyRows) lines.push(`| ${r.phase} | ${fmt(r.ms)} |`);
    lines.push('');
  } else {
    lines.push('_No `state.history[]` available to cross-check._');
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('_Generated by `.claude/scripts/generate-timing-report.js` from');
  lines.push('`generated-docs/timing/timing-ledger.jsonl`._');
  lines.push('');
  return lines.join('\n');
}

function main() {
  const events = readLedger();
  const analysis = analyze(events);
  const historyRows = phaseDurationsFromHistory(readStateHistory());
  const fixCounts = readFixCycleCounts();
  const report = buildReport(analysis, historyRows, fixCounts);

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, report);

  console.log(JSON.stringify({
    status: 'ok',
    report: path.relative(PROJECT_ROOT, REPORT_PATH),
    wallClock: fmt(analysis.wallClockMs),
    manualExcluded: fmt(analysis.manualMs),
    activeBuildTime: fmt(analysis.activeMs),
    events: analysis.eventCount,
    agentSpans: analysis.agentSpans
  }, null, 2));

  if (process.argv.includes('--json')) {
    console.log('\n--- analysis ---');
    console.log(JSON.stringify(analysis, null, 2));
  }
}

main();
