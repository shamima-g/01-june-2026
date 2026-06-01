# inject-agent-context.ps1
# SubagentStart hook: reinforces workflow state in subagent sessions.
# Fires when any BUILD/PLAN/INTAKE agent starts (see settings.json matcher for the canonical list).
#
# Injects: current epic/story/phase, story file path, test file path (~5-10 lines).
# Lightweight - just state coordinates so the subagent knows what to work on.
#
# Output: JSON with hookSpecificOutput.additionalContext
# Fail-safe: exits 0 with no output if state file missing or no active workflow.

$ErrorActionPreference = 'SilentlyContinue'

. (Join-Path $PSScriptRoot 'lib\workflow-state.ps1')

$projectRoot = Get-ProjectRoot -HookScriptRoot $PSScriptRoot
$state = Read-WorkflowState -ProjectRoot $projectRoot
if (-not (Test-ActiveWorkflow $state)) { exit 0 }

$files = Resolve-StoryAndTestFiles -ProjectRoot $projectRoot -State $state

# --- Build context ---
# INTAKE and PLAN are global phases with no current epic/story yet; only BUILD has them.
$isGlobalPhase = $state.currentPhase -in @('INTAKE', 'PLAN')
$phaseLower = $state.currentPhase.ToLower()
$globalLabel = "N/A ($phaseLower phase)"
$context = @"
## Workflow State
- Feature: $($state.featureName)
- Epic: $(if ($isGlobalPhase) { $globalLabel } else { "$($state.currentEpic) of $($state.totalEpics)" })
- Story: $(if ($isGlobalPhase) { $globalLabel } elseif ($state.currentStory) { $state.currentStory } else { 'N/A' })
- Phase: $($state.currentPhase)
- Spec: $($state.specPath)
"@

if ($files.StoryFile) {
    $context += "`n- Story file: $($files.StoryFile)"
}
if ($files.TestFile) {
    $context += "`n- Test file: $($files.TestFile)"
}

# --- Output JSON ---
$output = @{
    hookSpecificOutput = @{
        hookEventName = 'SubagentStart'
        additionalContext = $context
    }
} | ConvertTo-Json -Depth 3

Write-Output $output
exit 0
