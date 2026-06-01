# Claude Code Session Log Viewer
# Views Claude Code session logs in markdown format
# Usage: .\scripts\parse-logs.ps1 [options]

param(
    [Parameter(HelpMessage="Search by session ID pattern")]
    [string]$SessionId,

    [Parameter(HelpMessage="Search by date (format: yyyy-MM-dd)")]
    [string]$Date,

    [Parameter(HelpMessage="Search in session content (case-insensitive)")]
    [string]$Search,

    [Parameter(HelpMessage="Show last N sessions")]
    [int]$Last = 0,

    [Parameter(HelpMessage="Show summary statistics")]
    [switch]$Stats,

    [Parameter(HelpMessage="List all sessions (titles only)")]
    [switch]$List,

    [Parameter(HelpMessage="Show full content of matching sessions")]
    [switch]$Full,

    [Parameter(HelpMessage="Log directory path (relative to project root)")]
    [string]$LogDir = ".claude\logs"
)

# Helper function: Parse markdown session file
function Get-SessionInfo {
    param([string]$FilePath)

    $content = Get-Content $FilePath -Raw -ErrorAction SilentlyContinue

    if (-not $content) {
        return $null
    }

    # Extract metadata
    $info = @{
        file = $FilePath
        filename = Split-Path $FilePath -Leaf
        project = "unknown"
        session_id = "unknown"
        started = "unknown"
        ended = "unknown"
        permission_mode = "unknown"
        prompts_count = 0
        tools_used = @()
        files_modified = 0
        input_tokens = 0
        output_tokens = 0
        total_tokens = 0
        tokens_available = $false
        content = $content
    }

    # Parse metadata from content
    if ($content -match '\*\*Project:\*\*\s+(.+)') {
        $info.project = $matches[1].Trim()
    }

    if ($content -match '\*\*Session ID:\*\*\s+(.+)') {
        $info.session_id = $matches[1].Trim()
    }

    if ($content -match '\*\*Started:\*\*\s+(.+)') {
        $info.started = $matches[1].Trim()
    }

    if ($content -match '\*\*Permission Mode:\*\*\s+(.+)') {
        $info.permission_mode = $matches[1].Trim()
    }

    if ($content -match '\*\*Ended:\*\*\s+(.+)') {
        $info.ended = $matches[1].Trim()
    }

    if ($content -match '\*\*Total Prompts:\*\*\s+(\d+)') {
        $info.prompts_count = [int]$matches[1]
    }

    if ($content -match '\*\*Tools Used:\*\*\s+(.+)') {
        $toolsText = $matches[1].Trim()
        if ($toolsText) {
            $info.tools_used = $toolsText -split ',\s*'
        }
    }

    if ($content -match '\*\*Files Modified:\*\*\s+(\d+)') {
        $info.files_modified = [int]$matches[1]
    }

    # Parse token usage
    if ($content -match '\*\*Input Tokens:\*\*\s+(\d+)') {
        $info.input_tokens = [int]$matches[1]
        $info.tokens_available = $true
    }

    if ($content -match '\*\*Output Tokens:\*\*\s+(\d+)') {
        $info.output_tokens = [int]$matches[1]
        $info.tokens_available = $true
    }

    if ($content -match '\*\*Total Tokens:\*\*\s+(\d+)') {
        $info.total_tokens = [int]$matches[1]
    }

    return $info
}

# Helper function: Display session summary
function Show-SessionSummary {
    param($Session, [bool]$ShowFull = $false)

    Write-Host "`n=== $($Session.filename) ===" -ForegroundColor Cyan
    Write-Host "Project:         $($Session.project)" -ForegroundColor Gray
    Write-Host "Session ID:      $($Session.session_id)" -ForegroundColor Gray
    Write-Host "Started:         $($Session.started)" -ForegroundColor Gray

    if ($Session.ended -ne "unknown") {
        Write-Host "Ended:           $($Session.ended)" -ForegroundColor Gray
    }

    Write-Host "Permission Mode: $($Session.permission_mode)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Prompts:         $($Session.prompts_count)" -ForegroundColor Yellow
    Write-Host "Tools Used:      $($Session.tools_used -join ', ')" -ForegroundColor Yellow
    Write-Host "Files Modified:  $($Session.files_modified)" -ForegroundColor Yellow

    if ($Session.tokens_available) {
        Write-Host ""
        Write-Host "Token Usage:" -ForegroundColor Green
        Write-Host "  Input:  $($Session.input_tokens)" -ForegroundColor Gray
        Write-Host "  Output: $($Session.output_tokens)" -ForegroundColor Gray
        Write-Host "  Total:  $($Session.total_tokens)" -ForegroundColor Gray
    }

    if ($ShowFull) {
        Write-Host "`n--- Full Content ---" -ForegroundColor Magenta
        Write-Host $Session.content
    }

    Write-Host ""
}

# Main script
Write-Host "Claude Code Session Log Viewer" -ForegroundColor Cyan
Write-Host "===============================" -ForegroundColor Cyan
Write-Host ""

# Resolve log directory path
if (-not [System.IO.Path]::IsPathRooted($LogDir)) {
    $LogDir = Join-Path (Get-Location) $LogDir
}

# Check if log directory exists
if (-not (Test-Path $LogDir)) {
    Write-Host "Log directory not found: $LogDir" -ForegroundColor Red
    Write-Host "No session logs have been created yet." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Sessions will be logged to:" -ForegroundColor Gray
    Write-Host "  $LogDir" -ForegroundColor Gray
    exit 1
}

# Get all session files
$sessionFiles = Get-ChildItem $LogDir -Filter "*.md" -File | Sort-Object LastWriteTime -Descending

if ($sessionFiles.Count -eq 0) {
    Write-Host "No session logs found in: $LogDir" -ForegroundColor Yellow
    exit 0
}

Write-Host "Found $($sessionFiles.Count) session log(s)" -ForegroundColor Gray
Write-Host ""

# Parse all sessions
$sessions = @()
foreach ($file in $sessionFiles) {
    $sessionInfo = Get-SessionInfo -FilePath $file.FullName
    if ($sessionInfo) {
        $sessions += $sessionInfo
    }
}

# Apply filters
$filteredSessions = $sessions

if ($SessionId) {
    $filteredSessions = $filteredSessions | Where-Object { $_.session_id -like "*$SessionId*" }
}

if ($Date) {
    $filteredSessions = $filteredSessions | Where-Object { $_.started -like "$Date*" }
}

if ($Search) {
    $filteredSessions = $filteredSessions | Where-Object { $_.content -like "*$Search*" }
}

# Limit to last N if specified
if ($Last -gt 0) {
    $filteredSessions = $filteredSessions | Select-Object -First $Last
    Write-Host "Showing last $Last session(s)" -ForegroundColor Gray
    Write-Host ""
}

# Show statistics
if ($Stats) {
    Write-Host "=== SESSION STATISTICS ===" -ForegroundColor Cyan
    Write-Host ""

    $totalSessions = $sessions.Count
    $totalPrompts = ($sessions | Measure-Object -Property prompts_count -Sum).Sum
    $totalFilesModified = ($sessions | Measure-Object -Property files_modified -Sum).Sum

    Write-Host "Total Sessions:       $totalSessions" -ForegroundColor Yellow
    Write-Host "Total Prompts:        $totalPrompts" -ForegroundColor Yellow
    Write-Host "Total Files Modified: $totalFilesModified" -ForegroundColor Yellow

    # Token statistics
    $sessionsWithTokens = $sessions | Where-Object { $_.tokens_available }
    if ($sessionsWithTokens.Count -gt 0) {
        $totalInputTokens = ($sessionsWithTokens | Measure-Object -Property input_tokens -Sum).Sum
        $totalOutputTokens = ($sessionsWithTokens | Measure-Object -Property output_tokens -Sum).Sum
        $totalTokens = ($sessionsWithTokens | Measure-Object -Property total_tokens -Sum).Sum

        Write-Host ""
        Write-Host "Token Usage (across $($sessionsWithTokens.Count) sessions with data):" -ForegroundColor Green
        Write-Host "  Total Input:  $totalInputTokens" -ForegroundColor Gray
        Write-Host "  Total Output: $totalOutputTokens" -ForegroundColor Gray
        Write-Host "  Total:        $totalTokens" -ForegroundColor Gray
    }
    else {
        Write-Host ""
        Write-Host "No token usage data available." -ForegroundColor Yellow
        Write-Host "Tip: Run '/context' during sessions to include token data." -ForegroundColor Gray
    }

    # Top tools
    Write-Host ""
    Write-Host "Most Used Tools:" -ForegroundColor Yellow
    $allTools = $sessions | ForEach-Object { $_.tools_used } | Group-Object | Sort-Object Count -Descending | Select-Object -First 10
    foreach ($tool in $allTools) {
        Write-Host "  $($tool.Name): $($tool.Count) sessions" -ForegroundColor Gray
    }

    # Sessions by date
    Write-Host ""
    Write-Host "Sessions by Date:" -ForegroundColor Yellow
    $sessionsByDate = $sessions | ForEach-Object {
        if ($_.started -match '(\d{4}-\d{2}-\d{2})') {
            $matches[1]
        }
    } | Group-Object | Sort-Object Name -Descending | Select-Object -First 10
    foreach ($dateGroup in $sessionsByDate) {
        Write-Host "  $($dateGroup.Name): $($dateGroup.Count) sessions" -ForegroundColor Gray
    }

    Write-Host ""
    exit 0
}

# List mode - show titles only
if ($List) {
    Write-Host "Session List:" -ForegroundColor Yellow
    Write-Host ""

    foreach ($session in $filteredSessions) {
        $dateStr = if ($session.started -ne "unknown") { $session.started } else { "Unknown date" }
        Write-Host "[$dateStr] $($session.filename)" -ForegroundColor Cyan
        Write-Host "  Prompts: $($session.prompts_count) | Files: $($session.files_modified) | Session: $($session.session_id)" -ForegroundColor Gray

        if ($session.tokens_available) {
            Write-Host "  Tokens: $($session.total_tokens) (in: $($session.input_tokens), out: $($session.output_tokens))" -ForegroundColor Green
        }

        Write-Host ""
    }

    Write-Host "Total: $($filteredSessions.Count) session(s)" -ForegroundColor Gray
    exit 0
}

# Display sessions
if ($filteredSessions.Count -eq 0) {
    Write-Host "No sessions match the specified criteria." -ForegroundColor Yellow
}
else {
    foreach ($session in $filteredSessions) {
        Show-SessionSummary -Session $session -ShowFull $Full
    }

    if (-not $Full) {
        Write-Host "Tip: Use -Full to show complete session content" -ForegroundColor Gray
        Write-Host "     Use -Stats for overall statistics" -ForegroundColor Gray
        Write-Host "     Use -List for a compact list view" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "Done." -ForegroundColor Gray
