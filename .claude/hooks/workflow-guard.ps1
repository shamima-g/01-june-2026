# workflow-guard.ps1
# UserPromptSubmit hook: injects workflow state context on every user prompt.
# Ensures Claude always knows the TDD workflow state so it can redirect users
# who attempt development work outside the /start and /continue flow.
#
# Output: JSON with hookSpecificOutput.additionalContext
# Fail-safe: exits 0 with no output on parse errors or unknown state.

$ErrorActionPreference = 'SilentlyContinue'

$projectRoot = (Get-Item $PSScriptRoot).Parent.Parent.FullName
$stateFile = Join-Path $projectRoot 'generated-docs\context\workflow-state.json'
$nodeModulesPath = Join-Path $projectRoot 'web\node_modules'

$guardMessage = $null

# --- Branch A: Project not set up ---
if (-not (Test-Path $nodeModulesPath)) {
    $guardMessage = @"
WORKFLOW GUARD: Project not initialized. Dependencies are not installed.
Action: Redirect to /start — it handles install and prefs as part of Step 0 before INTAKE.
"@
}
# --- Branch B: No workflow state file ---
elseif (-not (Test-Path $stateFile)) {
    $guardMessage = @"
WORKFLOW GUARD: No active workflow. No feature development has been started.
Action: Redirect to /start to begin the TDD workflow.
"@
}
else {
    # --- Parse state file ---
    try {
        $state = Get-Content $stateFile -Raw | ConvertFrom-Json
    } catch {
        exit 0
    }

    # --- Branch C: Feature complete ---
    if ($state.featureComplete) {
        $guardMessage = @"
WORKFLOW GUARD: Previous feature is complete.
Action: Redirect to /continue — it will prompt for the new epic(s) to add and re-open PLAN.
"@
    }
    # --- Branch D: COMPLETE phase, between stories/epics ---
    elseif ($state.currentPhase -eq 'COMPLETE' -and -not $state.featureComplete) {
        $guardMessage = @"
WORKFLOW GUARD: Workflow paused between stories/epics.
Action: Redirect to /continue to advance to the next story or epic.
"@
    }
    # --- Branch E: Active phase ---
    elseif ($state.currentPhase) {
        $phase = $state.currentPhase
        $epic = if ($state.currentEpic) { $state.currentEpic } else { 'N/A' }
        $story = if ($state.currentStory) { $state.currentStory } else { 'N/A' }
        $feature = if ($state.featureName) { $state.featureName } else { 'Unknown' }

        $guardMessage = @"
WORKFLOW GUARD: Active workflow detected.
Phase: $phase | Epic: $epic | Story: $story | Feature: $feature
Action: Redirect to /continue to resume the TDD workflow.
"@
    }
    else {
        # Unknown state — do not inject
        exit 0
    }
}

# --- Output JSON ---
$output = @{
    hookSpecificOutput = @{
        hookEventName = 'UserPromptSubmit'
        additionalContext = $guardMessage
    }
} | ConvertTo-Json -Depth 3

Write-Output $output
exit 0
