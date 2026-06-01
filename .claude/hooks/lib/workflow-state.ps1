# workflow-state.ps1
# Shared helpers for inject-phase-context.ps1 and inject-agent-context.ps1.
# Reads workflow-state.json and resolves the current story / test file paths
# from the filesystem so both hooks emit a consistent coordinates block.

function Get-ProjectRoot {
    param([string]$HookScriptRoot)
    return (Get-Item $HookScriptRoot).Parent.Parent.FullName
}

function Read-WorkflowState {
    param([string]$ProjectRoot)
    $stateFile = Join-Path $ProjectRoot 'generated-docs\context\workflow-state.json'
    try {
        return Get-Content $stateFile -Raw -ErrorAction Stop | ConvertFrom-Json
    } catch {
        return $null
    }
}

function ConvertTo-RelativePath {
    param([string]$AbsolutePath, [string]$ProjectRoot)
    return $AbsolutePath -replace [regex]::Escape($ProjectRoot + '\'), '' -replace '\\', '/'
}

function Test-ActiveWorkflow {
    param($State)
    if (-not $State) { return $false }
    if (-not $State.currentPhase) { return $false }
    if ($State.currentPhase -eq 'COMPLETE') { return $false }
    if ($State.featureComplete) { return $false }
    return $true
}

# Returns @{ StoryFile = <relative-path|null>; TestFile = <relative-path|null> } as
# forward-slash-normalised relative paths. StoryFile resolves to the per-epic
# overview (_epic-overview.md).
function Resolve-StoryAndTestFiles {
    param([string]$ProjectRoot, $State)
    $result = @{ StoryFile = $null; TestFile = $null }
    if (-not $State.currentEpic) { return $result }

    $storiesDir = Join-Path $ProjectRoot 'generated-docs\stories'
    $epicDirs = Get-ChildItem -Path $storiesDir -Directory -Filter "epic-$($State.currentEpic)-*" 2>$null
    if (-not $epicDirs -or $epicDirs.Count -eq 0) { return $result }

    $epicDir = $epicDirs[0].FullName
    $overview = Join-Path $epicDir '_epic-overview.md'
    if (Test-Path $overview) {
        $result.StoryFile = ConvertTo-RelativePath -AbsolutePath $overview -ProjectRoot $ProjectRoot
    }

    if (-not $State.currentStory) { return $result }

    $testDir = Join-Path $ProjectRoot 'web\src\__tests__\integration'
    $testFiles = Get-ChildItem -Path $testDir -File -Filter "epic-$($State.currentEpic)-story-$($State.currentStory)-*" 2>$null
    if ($testFiles -and $testFiles.Count -gt 0) {
        $result.TestFile = ConvertTo-RelativePath -AbsolutePath $testFiles[0].FullName -ProjectRoot $ProjectRoot
    }

    return $result
}
