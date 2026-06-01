# inject-phase-context.ps1
# Post-compaction hook: restores workflow instructions after auto-compaction.
# Fires via SessionStart (matcher: "compact") in the orchestrator session.
#
# Reads workflow-state.json and injects:
#   Tier 1 - Workflow coordinates (always)
#   Tier 2 - Orchestration rules (not in CLAUDE.md, lost on compaction)
#   Tier 3 - Recency reinforcement (observed drift points)
#   Phase-specific process steps from phase-context/*.md
#
# Output: JSON with hookSpecificOutput.additionalContext
# Fail-safe: exits 0 with no output if state file missing or no active workflow.

$ErrorActionPreference = 'SilentlyContinue'

. (Join-Path $PSScriptRoot 'lib\workflow-state.ps1')

$projectRoot = Get-ProjectRoot -HookScriptRoot $PSScriptRoot
$state = Read-WorkflowState -ProjectRoot $projectRoot
if (-not (Test-ActiveWorkflow $state)) { exit 0 }

$phaseContextDir = Join-Path $PSScriptRoot 'phase-context'
$files = Resolve-StoryAndTestFiles -ProjectRoot $projectRoot -State $state

# --- Tier 1: Workflow coordinates ---
$coordinates = @"
## Current Workflow Position
- Epic: $($state.currentEpic) of $($state.totalEpics)
- Story: $(if ($state.currentStory) { $state.currentStory } else { 'N/A (epic-level phase)' })
- Phase: $($state.currentPhase)
- Feature: $($state.featureName)
"@

if ($files.StoryFile) {
    $coordinates += "`n- Story file: $($files.StoryFile)"
}
if ($files.TestFile) {
    $coordinates += "`n- Test file: $($files.TestFile)"
}

# --- Tier 2: Orchestration rules (not in CLAUDE.md, lost on compaction) ---
$orchestration = @"

## Orchestration Rules (post-compaction recovery)

### Phase Model
INTAKE -> PLAN -> BUILD -> COMPLETE. State authority lives in workflow-state.json.

### Gates (only two)
1. Gate 1 -- end of INTAKE: approve project-brief.md.
2. Gate 2 -- end of PLAN: approve epic list and per-epic stories. Single-epic features collapse to one combined approval.
The workflow chains continuously from one phase to the next.

### Agent Autonomy
BUILD agents (developer, code-reviewer, playwright-runner) resolve standard decisions themselves and halt only for categories in .claude/shared/agent-autonomy.md ("Always halt"): permission changes, API contract changes, new dependencies, state/data-fetching library swaps, auth flow changes, cross-cutting architecture, project-brief contradictions, CLAUDE.md policy contradictions, missing Playwright spec for a routable story.

### User Approval Policy
Output proposed content as conversation text BEFORE calling AskUserQuestion. Never auto-approve on the user's behalf.
"@

# --- Tier 3: Recency reinforcement (observed drift points) ---
$reinforcement = @"

## Quality Reminders
- code-reviewer runs the canonical quality gates via .claude/scripts/quality-gates.js
- Always commit with .claude/logs/ included
"@

# --- Phase-specific snippet ---
# Snippet file is named after the lowercased phase (e.g. INTAKE -> intake.md).
$phaseSnippet = ''
if ($state.currentPhase) {
    $snippetFile = Join-Path $phaseContextDir "$($state.currentPhase.ToLower()).md"
    try {
        $phaseSnippet = "`n" + (Get-Content $snippetFile -Raw -ErrorAction Stop).TrimEnd()
    } catch {
        # Snippet missing or unreadable — leave $phaseSnippet empty.
    }
}

# --- Build final context ---
$context = ($coordinates + $orchestration + $reinforcement + $phaseSnippet).TrimEnd()

# --- Output JSON ---
$output = @{
    hookSpecificOutput = @{
        hookEventName = 'SessionStart'
        additionalContext = $context
    }
} | ConvertTo-Json -Depth 3

Write-Output $output
exit 0
