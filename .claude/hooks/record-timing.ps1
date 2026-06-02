# record-timing.ps1
# Deterministic build-timing recorder.
#
# Fires on lifecycle hooks (UserPromptSubmit, Stop, SubagentStart, SubagentStop,
# SessionStart, SessionEnd) and appends ONE compact JSON line per event to an
# append-only ledger. The ledger survives /clear because it lives on disk and is
# never rewritten.
#
# The gap between a 'response' (Stop) and the next 'prompt' (UserPromptSubmit) is
# the user's manual-intervention / think time. The report generator subtracts those
# gaps so the final number is ACTIVE build time only.
#
# Fail-safe: this hook must NEVER block the workflow. Any error exits 0 silently.
# Usage (from settings.json):
#   powershell ... -File ".claude/hooks/record-timing.ps1" -EventType prompt

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('prompt', 'response', 'subagent_start', 'subagent_stop', 'session_start', 'session_end', 'permission_request', 'pre_tool_use')]
    [string]$EventType
)

$ErrorActionPreference = 'SilentlyContinue'

try {
    $stdinContent = [System.Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($stdinContent)) { exit 0 }

    $hookData = $stdinContent | ConvertFrom-Json
    $projectPath = $hookData.cwd
    if (-not $projectPath) { exit 0 }

    # Use a separate variable for the event label written to the ledger. $EventType
    # carries a [ValidateSet] that PowerShell re-checks on every assignment, so we
    # must NOT reassign it (e.g. to the derived 'permission_resolved' label).
    $eventName = $EventType

    # --- Resolve the timing ledger path (create dir on first use) ---
    $timingDir = Join-Path $projectPath 'generated-docs\timing'
    if (-not (Test-Path $timingDir)) {
        New-Item -ItemType Directory -Force -Path $timingDir | Out-Null
    }
    $ledgerPath = Join-Path $timingDir 'timing-ledger.jsonl'

    # --- PreToolUse fires for EVERY tool. Only record it when it resolves a pending
    #     permission prompt (the previous ledger event is permission_request), and
    #     relabel it 'permission_resolved'. This bounds the permission-wait gap
    #     without bloating the ledger with a line per tool call. ---
    if ($EventType -eq 'pre_tool_use') {
        $lastLine = $null
        if (Test-Path $ledgerPath) {
            $lastLine = Get-Content $ledgerPath -Tail 1 -ErrorAction SilentlyContinue
        }
        if (-not ($lastLine -and ($lastLine -match '"event":"permission_request"'))) {
            exit 0
        }
        $eventName = 'permission_resolved'
    }

    # --- Read current workflow phase (best-effort; null when no workflow yet) ---
    $phase = $null
    $epic = $null
    $story = $null
    $phaseStatus = $null
    $stateFile = Join-Path $projectPath 'generated-docs\context\workflow-state.json'
    if (Test-Path $stateFile) {
        try {
            $state = Get-Content $stateFile -Raw | ConvertFrom-Json
            $phase = $state.currentPhase
            $epic = $state.currentEpic
            $story = $state.currentStory
            $phaseStatus = $state.phaseStatus
        } catch { }
    }

    # --- Resolve subagent name for granular sub-phase attribution ---
    $agent = $null
    if ($eventName -eq 'subagent_start' -or $eventName -eq 'subagent_stop') {
        foreach ($prop in @('subagent_type', 'agent_type', 'agent_name', 'agent')) {
            if ($hookData.PSObject.Properties.Name -contains $prop -and $hookData.$prop) {
                $agent = $hookData.$prop
                break
            }
        }
        if (-not $agent -and $hookData.tool_input -and
            ($hookData.tool_input.PSObject.Properties.Name -contains 'subagent_type')) {
            $agent = $hookData.tool_input.subagent_type
        }
    }

    $sessionId = $hookData.session_id
    $shortSession = if ($sessionId) { $sessionId.Substring(0, [Math]::Min(8, $sessionId.Length)) } else { $null }

    # --- Build and append the ledger entry (one compact JSON line) ---
    $entry = [ordered]@{
        ts          = (Get-Date).ToUniversalTime().ToString("o")
        event       = $eventName
        phase       = $phase
        epic        = $epic
        story       = $story
        phaseStatus = $phaseStatus
        agent       = $agent
        session     = $shortSession
    }

    $line = $entry | ConvertTo-Json -Compress
    # Append BOM-less UTF-8. Windows PowerShell 5.1's `Add-Content -Encoding utf8`
    # prepends a BOM on file creation, which corrupts the first JSON line.
    # CRLF line endings so Get-Content -Tail (used above for the permission-resolve
    # check) reads reliably on Windows PowerShell. The report splits on /\r?\n/.
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::AppendAllText($ledgerPath, $line + "`r`n", $utf8NoBom)
}
catch {
    # Never block the workflow on a timing error.
}

exit 0
