# Claude Code Session Logger
# Captures Claude Code sessions in markdown format for commit/PR review
# Usage: Called by hooks in settings.json

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('prompt', 'response', 'session_start', 'session_end', 'permission_request', 'subagent_start', 'subagent_stop', 'pre_compact', 'pre_tool_use', 'post_tool_use', 'notification')]
    [string]$EventType
)

# Read all stdin content
$stdinContent = [System.Console]::In.ReadToEnd()

# Parse JSON - handle empty input gracefully
try {
    if ([string]::IsNullOrWhiteSpace($stdinContent)) {
        Write-Error "No input received from stdin"
        exit 1
    }

    $hookData = $stdinContent | ConvertFrom-Json

    if (-not $hookData.cwd) {
        Write-Error "Missing required field: cwd"
        exit 1
    }
}
catch {
    Write-Error "Failed to parse JSON input: $_"
    Write-Error "Input received: $stdinContent"
    exit 1
}

# Get project path and determine log directory
$projectPath = $hookData.cwd
$logDir = Join-Path $projectPath ".claude\logs"

# Ensure log directory exists
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
}

# Helper function: Get ISO timestamp in UTC with Z suffix
function Get-ISOTimestamp {
    # Returns format: yyyy-MM-dd HH:mmZ (UTC time)
    return (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd HH:mm") + "Z"
}

# Helper function: Get git user name for attribution
function Get-GitUserName {
    try {
        $userName = git config user.name 2>$null
        if ($userName -and $userName.Trim()) {
            return "User: " + $userName.Trim()
        }
    }
    catch {
        # Ignore git errors
    }
    return "User"  # Fallback if git config not available
}

# Helper function: Get model name from transcript entry
# Extracts model from assistant message metadata with fallback
function Get-ModelName {
    param(
        [object]$Entry = $null,      # Transcript entry object
        [object]$Message = $null,    # Message object (entry.message)
        [string]$Default = "claude"  # Fallback if model not found
    )

    # Priority 1: Check entry.model
    if ($Entry -and $Entry.PSObject.Properties.Name -contains "model" -and $Entry.model) {
        return $Entry.model
    }

    # Priority 2: Check message.model (entry.message.model)
    if ($Message -and $Message.PSObject.Properties.Name -contains "model" -and $Message.model) {
        return $Message.model
    }

    # Priority 3: If Entry has message property, check entry.message.model
    if ($Entry -and $Entry.PSObject.Properties.Name -contains "message") {
        $msg = $Entry.message
        if ($msg -and $msg.PSObject.Properties.Name -contains "model" -and $msg.model) {
            return $msg.model
        }
    }

    # Fallback to default
    return $Default
}

# Helper function: Get project context
function Get-ProjectContext {
    param([string]$ProjectPath)

    $projectInfo = @{
        name = Split-Path -Leaf $ProjectPath
        path = $ProjectPath
    }

    # Try to get project name from settings
    $settingsPath = Join-Path $ProjectPath ".claude\settings.json"
    if (Test-Path $settingsPath) {
        try {
            $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
            if ($settings.PSObject.Properties.Name -contains "projectName") {
                $projectInfo.name = $settings.projectName
            }
        }
        catch {
            # Ignore parsing errors
        }
    }

    return $projectInfo
}

# Helper function: Extract clean user prompt text (removing system tags)
function Get-CleanPrompt {
    param([string]$RawPrompt, [bool]$ForFilename = $false)

    # Remove system reminder tags and their contents
    $cleaned = $RawPrompt -replace '<system-reminder>[\s\S]*?</system-reminder>', ''

    if ($ForFilename) {
        # For filenames: completely remove XML tags and their contents, keep only the actual user text
        $cleaned = $cleaned -replace '<ide_opened_file>[\s\S]*?</ide_opened_file>', ''
        $cleaned = $cleaned -replace '<ide_selection>[\s\S]*?</ide_selection>', ''
    }
    else {
        # For markdown content: Convert IDE tags to user-friendly format
        $cleaned = $cleaned -replace '<ide_opened_file>The user opened the file ([^\n]+) in the IDE[^\n]*</ide_opened_file>', "`n_Opened file: ```$1```_`n"
        $cleaned = $cleaned -replace '<ide_selection>[\s\S]*?</ide_selection>', "`n_[Code selection from IDE]_`n"
    }

    # Trim whitespace
    $cleaned = $cleaned.Trim()

    return $cleaned
}

# Helper function: Sanitize sensitive data from content before saving to logs
# Removes/masks API keys, passwords, tokens, secrets, and other sensitive patterns
function Remove-SensitiveData {
    param([string]$Content)

    if ([string]::IsNullOrWhiteSpace($Content)) {
        return $Content
    }

    $sanitized = $Content

    # Common API key patterns (generic key formats)
    # Matches: api_key=xxx, apiKey: xxx, API_KEY=xxx, etc.
    $sanitized = $sanitized -replace '(?i)(api[_-]?key|apikey)\s*[:=]\s*[''"]?([a-zA-Z0-9_\-]{16,})[''"]?', '$1=[REDACTED]'

    # Bearer tokens
    $sanitized = $sanitized -replace '(?i)(bearer\s+)([a-zA-Z0-9_\-\.]+)', '$1[REDACTED]'

    # Authorization headers
    $sanitized = $sanitized -replace '(?i)(authorization\s*[:=]\s*[''"]?)([^''"}\s]{10,})', '$1[REDACTED]'

    # Password patterns
    # Matches: password=xxx, pwd: xxx, passwd=xxx, etc.
    $sanitized = $sanitized -replace '(?i)(password|passwd|pwd)\s*[:=]\s*[''"]?([^''"}\s\n]{1,})[''"]?', '$1=[REDACTED]'

    # Secret/token patterns
    $sanitized = $sanitized -replace '(?i)(secret|token|credential)\s*[:=]\s*[''"]?([a-zA-Z0-9_\-]{8,})[''"]?', '$1=[REDACTED]'

    # AWS access keys (AKIA...)
    $sanitized = $sanitized -replace '(?i)(AKIA[A-Z0-9]{16})', '[AWS_KEY_REDACTED]'

    # AWS secret keys (40 char base64-ish)
    $sanitized = $sanitized -replace '(?i)(aws[_-]?secret[_-]?access[_-]?key)\s*[:=]\s*[''"]?([A-Za-z0-9/+=]{40})[''"]?', '$1=[REDACTED]'

    # GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_)
    $sanitized = $sanitized -replace '(gh[pousr]_[A-Za-z0-9_]{36,})', '[GITHUB_TOKEN_REDACTED]'

    # OpenAI API keys (sk-...)
    $sanitized = $sanitized -replace '(sk-[A-Za-z0-9]{32,})', '[OPENAI_KEY_REDACTED]'

    # Anthropic API keys (sk-ant-...)
    $sanitized = $sanitized -replace '(sk-ant-[A-Za-z0-9\-]{32,})', '[ANTHROPIC_KEY_REDACTED]'

    # Generic private keys (PEM format)
    $sanitized = $sanitized -replace '(?s)(-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----).*?(-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----)', '$1[PRIVATE_KEY_REDACTED]$2'

    # Connection strings with passwords
    $sanitized = $sanitized -replace '(?i)((?:jdbc|mongodb|mysql|postgres|sqlserver|redis)[^;]*?(?:password|pwd)\s*=\s*)([^;''"}\s]+)', '$1[REDACTED]'

    # .env style secrets (KEY=value on its own line where key contains sensitive words)
    $sanitized = $sanitized -replace '(?im)^((?:.*_)?(?:SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL|AUTH)[A-Z_]*)\s*=\s*(.+)$', '$1=[REDACTED]'

    # Credit card numbers (basic pattern - 13-19 digits)
    $sanitized = $sanitized -replace '\b(\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{1,7})\b', '[CARD_REDACTED]'

    # SSN patterns
    $sanitized = $sanitized -replace '\b(\d{3}-\d{2}-\d{4})\b', '[SSN_REDACTED]'

    return $sanitized
}

# Helper function: Format tool details for enhanced logging
# Returns formatted string with details for specific tools (Task, Bash, TodoWrite, AskUserQuestion, Skill)
# Other tools return just their name
function Format-ToolDetail {
    param([hashtable]$Tool)

    $name = $Tool.name
    $toolInput = $Tool.input
    $toolResult = $Tool.result

    switch ($name) {
        'Task' {
            $desc = ""
            if ($toolInput -and $toolInput.PSObject.Properties.Name -contains "description") {
                $desc = $toolInput.description
            }
            return "Task: $desc"
        }
        'Bash' {
            $desc = ""
            if ($toolInput -and $toolInput.PSObject.Properties.Name -contains "description") {
                $desc = $toolInput.description
            }
            return "Bash: $desc"
        }
        'TodoWrite' {
            $lines = @("Update Todos")
            if ($toolInput -and $toolInput.PSObject.Properties.Name -contains "todos") {
                foreach ($todo in $toolInput.todos) {
                    $statusVal = $todo.status
                    $icon = switch ($statusVal) {
                        'completed' { '[x]' }
                        'in_progress' { '[*]' }
                        'pending' { '[ ]' }
                        default { '[-]' }
                    }
                    $lines += "$icon $($todo.content)"
                }
            }
            return ($lines -join "`n")
        }
        'AskUserQuestion' {
            $lines = @("AskUserQuestion")
            if ($toolResult) {
                $resultStr = if ($toolResult -is [string]) { $toolResult } else {
                    try { $toolResult | ConvertTo-Json -Compress -Depth 3 } catch { "$toolResult" }
                }
                $sanitized = Remove-SensitiveData -Content $resultStr
                if ($sanitized.Length -gt 500) {
                    $sanitized = $sanitized.Substring(0, 500) + "..."
                }
                $lines += "Out: $sanitized"
            }
            return ($lines -join "`n")
        }
        'Skill' {
            $skillName = ""
            if ($toolInput -and $toolInput.PSObject.Properties.Name -contains "skill") {
                $skillName = $toolInput.skill
            }
            return "Skill: /$skillName"
        }
        default {
            return $name
        }
    }
}

# Helper function: Sanitize text for filename
function Get-KebabCase {
    param([string]$Text, [int]$MaxWords = 6)

    # Take first N words
    $words = $Text -split '\s+' | Select-Object -First $MaxWords

    # Join and convert to kebab-case
    $kebab = ($words -join ' ') `
        -replace '[^\w\s-]', '' `
        -replace '\s+', '-' `
        -replace '-+', '-' `
        -replace '^-|-$', ''

    return $kebab.ToLower()
}

# Helper function: Generate title from user prompt
# NOTE: AI-powered title generation via Claude CLI was removed because it creates
# an infinite loop - calling claude triggers hooks which call claude again.
# Instead, we use intelligent text extraction to create meaningful titles.
function Get-AIGeneratedTitle {
    param(
        [string]$UserPrompt,
        [int]$TimeoutSeconds = 5,  # Kept for API compatibility but unused
        [int]$FallbackMaxChars = 50
    )

    # Return empty if no prompt provided
    if ([string]::IsNullOrWhiteSpace($UserPrompt)) {
        return ""
    }

    # Extract a meaningful title from the prompt
    # Strategy: Take the first sentence or first ~50 chars at word boundary
    $text = $UserPrompt.Trim()

    # Try to find first sentence (ending with . ! or ?)
    $sentenceEnd = $text.IndexOfAny([char[]]@('.', '!', '?'))
    if ($sentenceEnd -gt 10 -and $sentenceEnd -le 80) {
        # Use the first sentence if it's a reasonable length
        return $text.Substring(0, $sentenceEnd).Trim()
    }

    # Otherwise, truncate at word boundary around FallbackMaxChars
    if ($text.Length -gt $FallbackMaxChars) {
        $cutoff = $text.LastIndexOf(' ', $FallbackMaxChars)
        if ($cutoff -lt 20) { $cutoff = $FallbackMaxChars }
        return $text.Substring(0, $cutoff).Trim()
    }

    return $text
}

# Helper function: Parse token usage from transcript
# Looks for /context command output in user prompts
function Get-TokenUsage {
    param([string]$TranscriptPath)

    $tokenData = @{
        model = ""
        tokens_used = ""
        tokens_max = ""
        tokens_percentage = ""
        categories = @()
        context_snapshots = @()  # Store all /context invocations
        available = $false
    }

    if (-not (Test-Path $TranscriptPath)) {
        return $tokenData
    }

    try {
        $lines = Get-Content $TranscriptPath -ErrorAction SilentlyContinue

        foreach ($line in $lines) {
            if ([string]::IsNullOrWhiteSpace($line)) { continue }

            try {
                $entry = $line | ConvertFrom-Json

                # Look for /context output in user prompts
                # The output appears in <local-command-stdout> tags within user message content
                if ($entry.PSObject.Properties.Name -contains "type" -and $entry.type -eq "user") {
                    $promptText = ""
                    if ($entry.PSObject.Properties.Name -contains "message") {
                        $message = $entry.message
                        if ($message.PSObject.Properties.Name -contains "content") {
                            if ($message.content -is [string]) {
                                $promptText = $message.content
                            }
                            elseif ($message.content -is [array]) {
                                foreach ($block in $message.content) {
                                    if ($block.PSObject.Properties.Name -contains "text") {
                                        $promptText += $block.text
                                    }
                                }
                            }
                        }
                    }

                    # Check if this prompt contains /context output
                    if ($promptText -match '<local-command-stdout>.*?## Context Usage') {
                        # Extract the content between local-command-stdout tags
                        if ($promptText -match '<local-command-stdout>([\s\S]*?)</local-command-stdout>') {
                            $contextOutput = $matches[1]

                            $snapshot = @{
                                model = ""
                                tokens_used = ""
                                tokens_max = ""
                                tokens_percentage = ""
                                categories = @()
                            }

                            # Extract model name
                            if ($contextOutput -match '\*\*Model:\*\*\s*(\S+)') {
                                $snapshot.model = $matches[1]
                            }

                            # Extract tokens: "48.9k / 200.0k (24%)"
                            if ($contextOutput -match '\*\*Tokens:\*\*\s*([0-9.]+k?)\s*/\s*([0-9.]+k?)\s*\((\d+)%\)') {
                                $snapshot.tokens_used = $matches[1]
                                $snapshot.tokens_max = $matches[2]
                                $snapshot.tokens_percentage = $matches[3]
                            }

                            # Extract category breakdown from the table
                            # Format: | Category | Tokens | Percentage |
                            $categoryMatches = [regex]::Matches($contextOutput, '\|\s*([^|]+)\s*\|\s*([0-9.]+k?)\s*\|\s*([0-9.]+)%\s*\|')
                            foreach ($match in $categoryMatches) {
                                $category = $match.Groups[1].Value.Trim()
                                # Skip header row
                                if ($category -ne "Category" -and $category -notmatch '^-+$') {
                                    $snapshot.categories += @{
                                        name = $category
                                        tokens = $match.Groups[2].Value.Trim()
                                        percentage = $match.Groups[3].Value.Trim()
                                    }
                                }
                            }

                            # Add this snapshot to the list
                            $tokenData.context_snapshots += $snapshot
                            $tokenData.available = $true

                            # Update the "latest" values (last /context run wins)
                            $tokenData.model = $snapshot.model
                            $tokenData.tokens_used = $snapshot.tokens_used
                            $tokenData.tokens_max = $snapshot.tokens_max
                            $tokenData.tokens_percentage = $snapshot.tokens_percentage
                            $tokenData.categories = $snapshot.categories
                        }
                    }
                }
            }
            catch {
                continue
            }
        }
    }
    catch {
        # Return empty token data if parsing fails
    }

    return $tokenData
}

# Helper function: Format token usage for markdown output
function Format-TokenUsage {
    param(
        [hashtable]$Tokens,
        [bool]$IncludeCategories = $true
    )

    if (-not $Tokens.available) {
        return "_Token usage data not available. Run ``/context`` during session to capture token usage._"
    }

    $output = @()

    # Show latest snapshot info
    if ($Tokens.model) {
        $output += "- **Model:** $($Tokens.model)"
    }
    if ($Tokens.tokens_used -and $Tokens.tokens_max) {
        $output += "- **Tokens Used:** $($Tokens.tokens_used) / $($Tokens.tokens_max) ($($Tokens.tokens_percentage)%)"
    }

    # Show category breakdown if available and requested
    if ($IncludeCategories -and $Tokens.categories -and $Tokens.categories.Count -gt 0) {
        $output += ""
        $output += "| Category | Tokens | % |"
        $output += "|----------|--------|---|"
        foreach ($cat in $Tokens.categories) {
            $output += "| $($cat.name) | $($cat.tokens) | $($cat.percentage)% |"
        }
    }

    # Note if multiple /context snapshots were captured
    if ($Tokens.context_snapshots -and $Tokens.context_snapshots.Count -gt 1) {
        $output += ""
        $output += "_Note: ``/context`` was run $($Tokens.context_snapshots.Count) times during this session. Showing final snapshot._"
    }

    return ($output -join "`n")
}

# Helper function: Parse session summary from transcript
function Get-SessionSummary {
    param([string]$TranscriptPath)

    $summary = @{
        prompts_count = 0
        tools_used = @()
        files_modified = @()
        prompts = @()
        conversation = @()  # New: stores full conversation
    }

    if (-not (Test-Path $TranscriptPath)) {
        return $summary
    }

    try {
        $lines = Get-Content $TranscriptPath -ErrorAction SilentlyContinue

        foreach ($line in $lines) {
            if ([string]::IsNullOrWhiteSpace($line)) { continue }

            try {
                $entry = $line | ConvertFrom-Json

                # Collect user prompts (Claude Code transcript format)
                if ($entry.PSObject.Properties.Name -contains "type" -and $entry.type -eq "user") {
                    # Extract prompt text from entry.message.content
                    $promptText = ""
                    if ($entry.PSObject.Properties.Name -contains "message") {
                        $message = $entry.message
                        if ($message.PSObject.Properties.Name -contains "content") {
                            if ($message.content -is [string]) {
                                $promptText = $message.content
                            }
                            elseif ($message.content -is [array]) {
                                foreach ($block in $message.content) {
                                    if ($block.PSObject.Properties.Name -contains "text") {
                                        $promptText += $block.text
                                    }
                                }
                            }
                        }
                    }

                    # Only count as a prompt if there's actual text content
                    # (Tool results also have type="user" but typically no text)
                    if ($promptText) {
                        $summary.prompts_count++
                        $summary.prompts += $promptText
                        # Add to conversation log
                        $summary.conversation += @{
                            role = "user"
                            content = $promptText
                        }
                    }
                }

                # Collect assistant responses (Claude Code transcript format)
                if ($entry.PSObject.Properties.Name -contains "type" -and $entry.type -eq "assistant") {
                    # Extract response text from entry.message.content
                    $responseText = ""
                    $toolsUsed = @()

                    # Extract model name using helper function
                    $modelName = Get-ModelName -Entry $entry

                    if ($entry.PSObject.Properties.Name -contains "message") {
                        $message = $entry.message

                        if ($message.PSObject.Properties.Name -contains "content") {
                            if ($message.content -is [string]) {
                                $responseText = $message.content
                            }
                            elseif ($message.content -is [array]) {
                                foreach ($block in $message.content) {
                                    if ($block.PSObject.Properties.Name -contains "text") {
                                        $responseText += $block.text + "`n"
                                    }
                                    # Track tool uses in response
                                    elseif ($block.PSObject.Properties.Name -contains "type" -and $block.type -eq "tool_use") {
                                        $toolName = $block.name
                                        $toolsUsed += $toolName
                                    }
                                }
                            }
                        }
                    }

                    # Add to conversation log
                    $conversationEntry = @{
                        role = "assistant"
                        content = $responseText.Trim()
                        tools = $toolsUsed
                        model = $modelName
                    }
                    $summary.conversation += $conversationEntry
                }

                # Track tools used - check both standalone entries AND tool_use blocks in assistant messages
                # Standalone tool entries (older format)
                if ($entry.PSObject.Properties.Name -contains "name") {
                    $toolName = $entry.name
                    if ($summary.tools_used -notcontains $toolName) {
                        $summary.tools_used += $toolName
                    }

                    # Track files modified (only for Edit and Write tools)
                    if ($toolName -in @('Edit', 'Write')) {
                        if ($entry.PSObject.Properties.Name -contains "input") {
                            $toolInput = $entry.input
                            if ($toolInput.PSObject.Properties.Name -contains "file_path") {
                                $filePath = $toolInput.file_path
                                if ($summary.files_modified -notcontains $filePath) {
                                    $summary.files_modified += $filePath
                                }
                            }
                        }
                    }
                }

                # Tool use blocks inside assistant messages (current format)
                if ($entry.PSObject.Properties.Name -contains "type" -and $entry.type -eq "assistant") {
                    if ($entry.PSObject.Properties.Name -contains "message") {
                        $message = $entry.message
                        if ($message.PSObject.Properties.Name -contains "content" -and $message.content -is [array]) {
                            foreach ($block in $message.content) {
                                if ($block.PSObject.Properties.Name -contains "type" -and $block.type -eq "tool_use") {
                                    $toolName = $block.name
                                    if ($summary.tools_used -notcontains $toolName) {
                                        $summary.tools_used += $toolName
                                    }

                                    # Track files modified (only for Edit and Write tools)
                                    if ($toolName -in @('Edit', 'Write')) {
                                        if ($block.PSObject.Properties.Name -contains "input") {
                                            $toolInput = $block.input
                                            if ($toolInput.PSObject.Properties.Name -contains "file_path") {
                                                $filePath = $toolInput.file_path
                                                if ($summary.files_modified -notcontains $filePath) {
                                                    $summary.files_modified += $filePath
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            catch {
                continue
            }
        }
    }
    catch {
        # Return empty summary if parsing fails
    }

    return $summary
}

# Helper function: Extract ALL AI response turns since the last user prompt
# Returns a hashtable with 'turns' (array of turn objects), 'allTools' (aggregated tools), and 'found'
# Each turn has: content (text), tools (array), turnNumber
function Get-ResponseTurnsSinceLastPrompt {
    param([string]$TranscriptPath)

    $result = @{
        turns = @()
        allTools = @()
        found = $false
        model = "claude"  # Default fallback
    }

    if (-not (Test-Path $TranscriptPath)) {
        return $result
    }

    try {
        $lines = Get-Content $TranscriptPath -ErrorAction SilentlyContinue

        # Find the index of the last user prompt (with actual text content)
        $lastUserPromptIndex = -1
        for ($i = $lines.Count - 1; $i -ge 0; $i--) {
            $line = $lines[$i]
            if ([string]::IsNullOrWhiteSpace($line)) { continue }

            try {
                $entry = $line | ConvertFrom-Json
                if ($entry.PSObject.Properties.Name -contains "type" -and $entry.type -eq "user") {
                    # Check if this user entry has actual text content (not just tool results)
                    $hasTextContent = $false
                    if ($entry.PSObject.Properties.Name -contains "message") {
                        $message = $entry.message
                        if ($message.PSObject.Properties.Name -contains "content") {
                            if ($message.content -is [string] -and $message.content.Trim()) {
                                $hasTextContent = $true
                            }
                            elseif ($message.content -is [array]) {
                                foreach ($block in $message.content) {
                                    if ($block.PSObject.Properties.Name -contains "text" -and $block.text.Trim()) {
                                        $hasTextContent = $true
                                        break
                                    }
                                }
                            }
                        }
                    }
                    if ($hasTextContent) {
                        $lastUserPromptIndex = $i
                        break
                    }
                }
            }
            catch {
                continue
            }
        }

        if ($lastUserPromptIndex -eq -1) {
            # No user prompt found, return empty
            return $result
        }

        # Collect all assistant turns AFTER the last user prompt
        $turnNumber = 0
        $pendingTools = @{}  # Track tool_use IDs for matching with tool_results
        for ($i = $lastUserPromptIndex + 1; $i -lt $lines.Count; $i++) {
            $line = $lines[$i]
            if ([string]::IsNullOrWhiteSpace($line)) { continue }

            try {
                $entry = $line | ConvertFrom-Json

                if ($entry.PSObject.Properties.Name -contains "type" -and $entry.type -eq "assistant") {
                    $turnNumber++
                    $responseText = ""
                    $toolsUsed = @()

                    # Extract model name using helper function
                    $extractedModel = Get-ModelName -Entry $entry -Default $result.model
                    if ($extractedModel -ne "claude") {
                        $result.model = $extractedModel
                    }

                    if ($entry.PSObject.Properties.Name -contains "message") {
                        $message = $entry.message

                        if ($message.PSObject.Properties.Name -contains "content") {
                            if ($message.content -is [string]) {
                                $responseText = $message.content
                            }
                            elseif ($message.content -is [array]) {
                                foreach ($block in $message.content) {
                                    if ($block.PSObject.Properties.Name -contains "text") {
                                        $responseText += $block.text + "`n"
                                    }
                                    elseif ($block.PSObject.Properties.Name -contains "type" -and $block.type -eq "tool_use") {
                                        $toolName = $block.name
                                        $toolId = if ($block.PSObject.Properties.Name -contains "id") { $block.id } else { "" }
                                        $toolInputData = if ($block.PSObject.Properties.Name -contains "input") { $block.input } else { $null }
                                        # Store detailed tool info for enhanced logging
                                        $toolDetail = @{
                                            name = $toolName
                                            id = $toolId
                                            input = $toolInputData
                                            result = $null
                                        }
                                        $toolsUsed += $toolDetail
                                        # Track for tool_result matching
                                        if ($toolId) {
                                            $pendingTools[$toolId] = $toolDetail
                                        }
                                        # Also add to aggregated tools list (names only)
                                        if ($result.allTools -notcontains $toolName) {
                                            $result.allTools += $toolName
                                        }
                                    }
                                }
                            }
                        }
                    }

                    # Add this turn if it has content or tools
                    if ($responseText.Trim() -or $toolsUsed.Count -gt 0) {
                        $result.turns += @{
                            content = $responseText.Trim()
                            tools = $toolsUsed
                            turnNumber = $turnNumber
                        }
                        $result.found = $true
                    }
                }
                # Process user messages to extract tool_results (for AskUserQuestion output, etc.)
                elseif ($entry.PSObject.Properties.Name -contains "type" -and $entry.type -eq "user") {
                    if ($entry.PSObject.Properties.Name -contains "message") {
                        $userMsg = $entry.message
                        if ($userMsg.PSObject.Properties.Name -contains "content" -and $userMsg.content -is [array]) {
                            foreach ($resultBlock in $userMsg.content) {
                                if ($resultBlock.PSObject.Properties.Name -contains "type" -and $resultBlock.type -eq "tool_result") {
                                    $toolUseId = if ($resultBlock.PSObject.Properties.Name -contains "tool_use_id") { $resultBlock.tool_use_id } else { "" }
                                    if ($toolUseId -and $pendingTools.ContainsKey($toolUseId)) {
                                        $resultContent = ""
                                        if ($resultBlock.PSObject.Properties.Name -contains "content") {
                                            if ($resultBlock.content -is [string]) {
                                                $resultContent = $resultBlock.content
                                            }
                                            elseif ($resultBlock.content -is [array]) {
                                                foreach ($innerBlock in $resultBlock.content) {
                                                    if ($innerBlock.PSObject.Properties.Name -contains "text") {
                                                        $resultContent += $innerBlock.text
                                                    }
                                                }
                                            }
                                        }
                                        $pendingTools[$toolUseId].result = $resultContent
                                    }
                                }
                            }
                        }
                    }
                }
            }
            catch {
                continue
            }
        }

        return $result
    }
    catch {
        return $result
    }
}

# Helper function: Get or create session file
function Get-SessionFilePath {
    param(
        [string]$SessionId,
        [string]$LogDir,
        [string]$FirstPrompt = $null,
        [bool]$ForceNewName = $false
    )

    # Use short session ID for both searching and creating
    $shortSessionId = $SessionId.Substring(0, [Math]::Min(8, $SessionId.Length))

    # Check if file already exists for this session
    $existingFile = Get-ChildItem $LogDir -Filter "*-$shortSessionId.md" -ErrorAction SilentlyContinue | Select-Object -First 1

    # If not forcing a new name and file exists, return existing file
    if ($existingFile -and -not $ForceNewName) {
        return $existingFile.FullName
    }

    # Create new filename with timestamp and title (UTC with Z suffix)
    $timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd_HH-mm") + "Z"

    # If FirstPrompt is provided, use it in the filename
    if ($FirstPrompt) {
        # Sanitize the prompt before using in filename to prevent sensitive data exposure
        $sanitizedPrompt = Remove-SensitiveData -Content $FirstPrompt
        $title = Get-KebabCase -Text $sanitizedPrompt -MaxWords 7
        $filename = "$timestamp-$title-$shortSessionId.md"
    }
    else {
        # No prompt yet - use temporary filename
        $filename = "$timestamp-session-$shortSessionId.md"
    }

    return Join-Path $LogDir $filename
}

# Helper function: Get marker file path for active session tracking
# Marker files are used to detect orphaned sessions (e.g., from /clear command)
function Get-ActiveSessionMarkerPath {
    param(
        [string]$SessionId,
        [string]$LogDir,
        [string]$TranscriptPath = $null
    )

    $shortSessionId = $SessionId.Substring(0, [Math]::Min(8, $SessionId.Length))
    return Join-Path $LogDir ".active-session-$shortSessionId"
}

# Helper function: Create active session marker file
function New-ActiveSessionMarker {
    param(
        [string]$SessionId,
        [string]$LogDir,
        [string]$TranscriptPath
    )

    $markerPath = Get-ActiveSessionMarkerPath -SessionId $SessionId -LogDir $LogDir

    # Store transcript path in marker file for recovery
    $markerContent = @{
        session_id = $SessionId
        transcript_path = $TranscriptPath
        created = (Get-Date).ToUniversalTime().ToString("o")
    } | ConvertTo-Json -Compress

    $markerContent | Out-File -FilePath $markerPath -Encoding utf8 -Force
}

# Helper function: Remove active session marker file
function Remove-ActiveSessionMarker {
    param(
        [string]$SessionId,
        [string]$LogDir
    )

    $markerPath = Get-ActiveSessionMarkerPath -SessionId $SessionId -LogDir $LogDir

    if (Test-Path $markerPath) {
        Remove-Item $markerPath -Force -ErrorAction SilentlyContinue
    }
}

# Helper function: Find all stale (orphaned) session markers
function Get-OrphanedSessionMarkers {
    param(
        [string]$LogDir,
        [string]$CurrentSessionId
    )

    $currentShortId = $CurrentSessionId.Substring(0, [Math]::Min(8, $CurrentSessionId.Length))
    $orphanedMarkers = @()

    # Find all .active-session-* files except for current session
    $markerFiles = Get-ChildItem $LogDir -Filter ".active-session-*" -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ne ".active-session-$currentShortId" }

    foreach ($markerFile in $markerFiles) {
        try {
            $markerContent = Get-Content $markerFile.FullName -Raw | ConvertFrom-Json
            $orphanedMarkers += @{
                marker_path = $markerFile.FullName
                session_id = $markerContent.session_id
                transcript_path = $markerContent.transcript_path
                created = $markerContent.created
            }
        }
        catch {
            # If marker file is corrupted, still try to recover using filename
            $shortId = $markerFile.Name -replace '^\.active-session-', ''
            $orphanedMarkers += @{
                marker_path = $markerFile.FullName
                session_id = $shortId
                transcript_path = $null
                created = $null
            }
        }
    }

    return $orphanedMarkers
}

# Main logging logic
$timestamp = Get-ISOTimestamp
$sessionId = $hookData.session_id
$projectContext = Get-ProjectContext -ProjectPath $projectPath

switch ($EventType) {
    'session_start' {
        # IMPORTANT: Detect and capture orphaned sessions from /clear using marker files
        # When /clear is run, it doesn't trigger session_end for the old session
        # But it DOES trigger session_start for the new session
        # Marker files persist until session_end, so we can detect orphaned sessions reliably

        # Step 1: Check for orphaned session markers (from previous sessions that didn't end cleanly)
        $orphanedMarkers = Get-OrphanedSessionMarkers -LogDir $logDir -CurrentSessionId $sessionId

        foreach ($orphanedMarker in $orphanedMarkers) {
            $orphanedSessionId = $orphanedMarker.session_id
            $orphanedTranscriptPath = $orphanedMarker.transcript_path
            $shortOrphanedId = $orphanedSessionId.Substring(0, [Math]::Min(8, $orphanedSessionId.Length))

            # Try to find the transcript file if not stored in marker
            if (-not $orphanedTranscriptPath -or -not (Test-Path $orphanedTranscriptPath)) {
                # Fallback: try to find transcript in the transcript directory
                $transcriptDir = Split-Path -Parent $hookData.transcript_path
                $possibleTranscript = Get-ChildItem $transcriptDir -Filter "$orphanedSessionId*.jsonl" -ErrorAction SilentlyContinue | Select-Object -First 1
                if ($possibleTranscript) {
                    $orphanedTranscriptPath = $possibleTranscript.FullName
                }
            }

            # Only process if we can find the transcript
            if ($orphanedTranscriptPath -and (Test-Path $orphanedTranscriptPath)) {
                $summary = Get-SessionSummary -TranscriptPath $orphanedTranscriptPath
                $tokens = Get-TokenUsage -TranscriptPath $orphanedTranscriptPath

                # Handle based on whether there's actual content
                if ($summary.prompts_count -eq 0) {
                    # Empty orphaned session - delete the log file if it exists
                    $emptyOrphanedFile = Get-ChildItem $logDir -Filter "*-$shortOrphanedId.md" -ErrorAction SilentlyContinue | Select-Object -First 1
                    if ($emptyOrphanedFile) {
                        Remove-Item $emptyOrphanedFile.FullName -Force -ErrorAction SilentlyContinue
                    }
                }
                elseif ($summary.prompts_count -gt 0) {
                    # Check if a session log exists for this orphaned session
                    $existingLog = Get-ChildItem $logDir -Filter "*-$shortOrphanedId.md" -ErrorAction SilentlyContinue | Select-Object -First 1

                    if ($existingLog) {
                        # Append to existing session file
                        $orphanedSessionFile = $existingLog.FullName
                    }
                    else {
                        # Create a new session log file (UTC with Z suffix)
                        $transcript = Get-Item $orphanedTranscriptPath
                        $orphanedTimestamp = $transcript.LastWriteTime.ToUniversalTime().ToString("yyyy-MM-dd_HH-mm") + "Z"

                        # Use first prompt for AI-generated title
                        $firstPromptClean = ""
                        $aiTitle = "Recovered Session"
                        if ($summary.prompts.Count -gt 0) {
                            $firstPromptClean = Get-CleanPrompt -RawPrompt $summary.prompts[0] -ForFilename $true
                            # Sanitize to remove sensitive data before using in title/filename
                            $firstPromptClean = Remove-SensitiveData -Content $firstPromptClean
                            # Generate AI title for consistency with live sessions
                            $aiTitle = Get-AIGeneratedTitle -UserPrompt $firstPromptClean -TimeoutSeconds 5
                        }

                        if ($firstPromptClean) {
                            # aiTitle is already based on sanitized content
                            $orphanedTitle = Get-KebabCase -Text $aiTitle -MaxWords 7
                            $orphanedFilename = "$orphanedTimestamp-$orphanedTitle-$shortOrphanedId.md"
                        }
                        else {
                            $orphanedFilename = "$orphanedTimestamp-orphaned-session-$shortOrphanedId.md"
                        }

                        $orphanedSessionFile = Join-Path $logDir $orphanedFilename

                        # Create the session header with AI-generated title
                        $orphanedHeader = @"
# $aiTitle ($timestamp)

**Project:** $($projectContext.name)
**Session ID:** $orphanedSessionId
**Recovered:** $timestamp
**Status:** Session was terminated by /clear command

---

"@
                        $orphanedHeader | Out-File -FilePath $orphanedSessionFile -Encoding utf8
                    }

                    # Build the session summary content (to be appended in both cases)
                    $orphanedContent = @"

---

## Session Summary (Recovered from /clear)

**Recovered:** $timestamp
**Total Prompts:** $($summary.prompts_count)
**Tools Used:** $($summary.tools_used -join ', ')
**Files Modified:** $($summary.files_modified.Count)

"@

                    # Add token usage section
                    $tokenUsageText = Format-TokenUsage -Tokens $tokens -IncludeCategories $true
                    $orphanedContent += @"

### Token Usage

$tokenUsageText

"@

                    $orphanedContent | Out-File -FilePath $orphanedSessionFile -Append -Encoding utf8

                    # Add full conversation ONLY if creating a new file
                    # (If appending to existing file, conversation is already there from real-time logging)
                    if (-not $existingLog -and $summary.conversation.Count -gt 0) {
                        $userName = Get-GitUserName
                        $turnNumber = 0
                        foreach ($turn in $summary.conversation) {
                            $turnNumber++

                            if ($turn.role -eq "user") {
                                $cleanedPrompt = Get-CleanPrompt -RawPrompt $turn.content
                                # Sanitize user prompt to remove sensitive data
                                $sanitizedPrompt = Remove-SensitiveData -Content $cleanedPrompt
                                $turnContent = @"

_**$userName ($timestamp)**_

$sanitizedPrompt

"@
                            }
                            elseif ($turn.role -eq "assistant") {
                                # Sanitize assistant response to remove sensitive data
                                $responseContent = Remove-SensitiveData -Content $turn.content
                                $modelName = if ($turn.model) { $turn.model } else { "claude" }
                                $toolNote = ""
                                if ($turn.tools -and $turn.tools.Count -gt 0) {
                                    $toolNote = "`n`n_Tools used: $($turn.tools -join ', ')_"
                                }

                                $turnContent = @"

_**Agent (model $modelName)**_

$responseContent$toolNote

---

"@
                            }

                            $turnContent | Out-File -FilePath $orphanedSessionFile -Append -Encoding utf8
                        }
                    }
                }
            }

            # Always remove the stale marker file after processing (or attempting to process)
            Remove-Item $orphanedMarker.marker_path -Force -ErrorAction SilentlyContinue
        }

        # Step 1b: Clean up any empty session files (files that have no user content)
        # This catches sessions that were created before the marker system existed
        # or sessions that were abandoned without triggering session_end
        $shortCurrentSessionId = $sessionId.Substring(0, [Math]::Min(8, $sessionId.Length))
        $allSessionFiles = Get-ChildItem $logDir -Filter "*.md" -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -notlike "*-$shortCurrentSessionId.md" }  # Don't touch current session

        foreach ($sessionFile in $allSessionFiles) {
            try {
                $content = Get-Content $sessionFile.FullName -Raw -ErrorAction SilentlyContinue

                # Check for user content in both old and new log formats:
                # - New format: "_**User:" (italic bold user attribution)
                # - Old format: "## Prompt -" (heading-based prompt marker)
                $hasUserContent = ($content -match "_\*\*User:") -or ($content -match "## Prompt -")

                # Skip files that have user content - these are valid sessions
                if ($hasUserContent) {
                    continue
                }

                # Check if this is an empty session (no user content):
                # Pattern 1: Generic placeholder name like "2025-12-05_11_34-session-8403d997.md"
                #            Format: YYYY-MM-DD_HH_MM-session-XXXXXXXX.md or YYYY-MM-DD_HH-MMZ-session-XXXXXXXX.md
                $isGenericPlaceholder = $sessionFile.Name -match "^\d{4}-\d{2}-\d{2}_\d{2}[-_]\d{2}Z?-session-[a-f0-9]{8}\.md$"

                # Pattern 2: Has "Session Starting..." placeholder title in content (never got first prompt)
                $hasPlaceholderTitle = $content -match "^# Session Starting\.\.\."

                # Pattern 3: Has generic "# Claude Code Session" title (old placeholder format)
                $hasGenericTitle = $content -match "^# Claude Code Session\s*$" -or $content -match "^# Claude Code Session\s*\r?\n"

                if ($isGenericPlaceholder -or $hasPlaceholderTitle -or $hasGenericTitle) {
                    # This is an empty session - delete it
                    Remove-Item $sessionFile.FullName -Force -ErrorAction SilentlyContinue
                }
            }
            catch {
                # Ignore errors reading individual files
                continue
            }
        }

        # Step 2: Create or resume session file for this session
        $shortCurrentId = $sessionId.Substring(0, [Math]::Min(8, $sessionId.Length))
        $existingSessionFile = Get-ChildItem $logDir -Filter "*-$shortCurrentId.md" -ErrorAction SilentlyContinue | Select-Object -First 1

        if ($existingSessionFile) {
            # File already exists for this session ID - check if it has user content
            $existingContent = Get-Content $existingSessionFile.FullName -Raw -ErrorAction SilentlyContinue
            $hasUserContent = ($existingContent -match "_\*\*User:") -or ($existingContent -match "## Prompt -")

            if ($hasUserContent) {
                # Session file has real content - APPEND a resume marker instead of overwriting
                $sessionFile = $existingSessionFile.FullName
                $resumeMarker = @"

---

## Session Resumed ($timestamp)

**Permission Mode:** $($hookData.permission_mode)

---

"@
                $resumeMarker | Out-File -FilePath $sessionFile -Append -Encoding utf8
            }
            else {
                # Session file is empty/placeholder - safe to overwrite
                $sessionFile = $existingSessionFile.FullName
                $content = @"
# Session Starting... ($timestamp)

**Project:** $($projectContext.name)
**Session ID:** $sessionId
**Started:** $timestamp
**Permission Mode:** $($hookData.permission_mode)

---

"@
                $content | Out-File -FilePath $sessionFile -Encoding utf8
            }
        }
        else {
            # No existing file - create a new one
            $sessionFile = Get-SessionFilePath -SessionId $sessionId -LogDir $logDir

            $content = @"
# Session Starting... ($timestamp)

**Project:** $($projectContext.name)
**Session ID:** $sessionId
**Started:** $timestamp
**Permission Mode:** $($hookData.permission_mode)

---

"@
            $content | Out-File -FilePath $sessionFile -Encoding utf8
        }

        # Step 3: Create marker file for the current session
        New-ActiveSessionMarker -SessionId $sessionId -LogDir $logDir -TranscriptPath $hookData.transcript_path
    }

    'prompt' {
        # NOTE: /clear command does NOT trigger this hook
        # The /clear command is processed by Claude Code BEFORE any hooks can execute
        # Sessions terminated by /clear are captured in the session_start handler instead
        # (See session_start handler above for orphaned session detection logic)

        # Get the existing session file
        $shortSessionId = $sessionId.Substring(0, [Math]::Min(8, $sessionId.Length))
        $existingFile = Get-ChildItem $logDir -Filter "*-$shortSessionId.md" -ErrorAction SilentlyContinue | Select-Object -First 1

        # Clean the prompt text - one for filename (without markdown), one for content (with markdown)
        $cleanPromptForFilename = Get-CleanPrompt -RawPrompt $hookData.prompt -ForFilename $true
        # Sanitize for filename to prevent sensitive data in file names
        $cleanPromptForFilename = Remove-SensitiveData -Content $cleanPromptForFilename
        $cleanPromptForContent = Get-CleanPrompt -RawPrompt $hookData.prompt -ForFilename $false

        if ($existingFile) {
            # Check if this is the first prompt (file contains only session header)
            $fileContent = Get-Content $existingFile.FullName -Raw
            $isFirstPrompt = -not ($fileContent -match "_\*\*User:")

            if ($isFirstPrompt) {
                # Generate AI title for the session (with 5-second timeout)
                $aiTitle = Get-AIGeneratedTitle -UserPrompt $cleanPromptForFilename -TimeoutSeconds 5

                # Update the file header with AI-generated title (multiline mode for ^ anchor)
                $updatedHeader = $fileContent -replace '(?m)^# Session Starting\.\.\..*$', "# $aiTitle ($timestamp)"
                $updatedHeader | Out-File -FilePath $existingFile.FullName -Encoding utf8 -NoNewline

                # Rename file using AI-generated title in kebab-case
                $newFileName = Get-SessionFilePath -SessionId $sessionId -LogDir $logDir -FirstPrompt $aiTitle -ForceNewName $true
                Rename-Item -Path $existingFile.FullName -NewName (Split-Path -Leaf $newFileName) -Force
                $sessionFile = $newFileName
            }
            else {
                $sessionFile = $existingFile.FullName
            }
        }
        else {
            # File doesn't exist yet - create it with session header first
            # Generate AI title for the session
            $aiTitle = Get-AIGeneratedTitle -UserPrompt $cleanPromptForFilename -TimeoutSeconds 5
            $sessionFile = Get-SessionFilePath -SessionId $sessionId -LogDir $logDir -FirstPrompt $aiTitle

            # Create session header with AI-generated title
            $sessionHeader = @"
# $aiTitle ($timestamp)

**Project:** $($projectContext.name)
**Session ID:** $sessionId
**Started:** $timestamp
**Permission Mode:** $($hookData.permission_mode)

---

"@
            $sessionHeader | Out-File -FilePath $sessionFile -Encoding utf8
        }

        $userName = Get-GitUserName
        # Sanitize prompt content before saving to remove sensitive data
        $sanitizedPrompt = Remove-SensitiveData -Content $cleanPromptForContent
        $content = @"

_**$userName ($timestamp)**_

$sanitizedPrompt

"@

        $content | Out-File -FilePath $sessionFile -Append -Encoding utf8
    }

    'response' {
        # Wait longer for the transcript to be fully written
        # The Stop hook fires before the transcript is complete
        Start-Sleep -Milliseconds 2000

        # Get the existing session file
        $shortSessionId = $sessionId.Substring(0, [Math]::Min(8, $sessionId.Length))
        $existingFile = Get-ChildItem $logDir -Filter "*-$shortSessionId.md" -ErrorAction SilentlyContinue | Select-Object -First 1

        if (-not $existingFile) {
            # Session file doesn't exist - this shouldn't happen, but handle gracefully
            Write-Error "Session file not found for response logging"
            exit 1
        }

        $sessionFile = $existingFile.FullName

        # Extract ALL AI response turns since the last prompt with retry logic
        $transcriptPath = $hookData.transcript_path
        $responseData = $null
        $maxRetries = 5

        for ($retry = 0; $retry -lt $maxRetries; $retry++) {
            $responseData = Get-ResponseTurnsSinceLastPrompt -TranscriptPath $transcriptPath

            # Check if we got valid response turns
            if ($responseData.found) {
                break
            }

            # Wait before retrying
            if ($retry -lt ($maxRetries - 1)) {
                Start-Sleep -Milliseconds 500
            }
        }

        # Build response content - format each turn individually
        $content = ""
        $modelName = $responseData.model

        if ($responseData.found -and $responseData.turns.Count -gt 0) {
            foreach ($turn in $responseData.turns) {
                # Sanitize response content before saving to remove sensitive data
                $turnContent = Remove-SensitiveData -Content $turn.content
                $toolNote = ""
                if ($turn.tools -and $turn.tools.Count -gt 0) {
                    $detailedToolNames = @('Task', 'Bash', 'TodoWrite', 'AskUserQuestion', 'Skill')
                    $simpleToolNames = @()
                    $detailedLines = @()
                    foreach ($tool in $turn.tools) {
                        if ($tool -is [hashtable]) {
                            if ($tool.name -in $detailedToolNames) {
                                $detailedLines += (Format-ToolDetail -Tool $tool)
                            } else {
                                $simpleToolNames += $tool.name
                            }
                        } else {
                            $simpleToolNames += $tool
                        }
                    }
                    # Deduplicate simple tool names
                    $simpleToolNames = @($simpleToolNames | Select-Object -Unique)
                    $toolParts = @()
                    if ($simpleToolNames.Count -gt 0) {
                        $toolParts += "_Tools used: $($simpleToolNames -join ', ')_"
                    }
                    $toolParts += $detailedLines
                    if ($toolParts.Count -gt 0) {
                        $toolNote = "`n`n" + ($toolParts -join "`n`n")
                    }
                }

                # Only add turn header if there's content or tools
                if ($turnContent -or $turn.tools.Count -gt 0) {
                    $content += @"

_**Agent (model $modelName)**_

$turnContent$toolNote

---

"@
                }
            }
        }
        else {
            # Fallback if no turns found
            $content = @"

_**Agent (model $modelName)**_

_(No response content captured)_

---

"@
        }

        $content | Out-File -FilePath $sessionFile -Append -Encoding utf8
    }

    'session_end' {
        # NOTE: session_end is only triggered when fully exiting Claude Code, NOT by /clear
        # For /clear summaries, use the pre_compact event instead

        # Parse transcript for summary
        $transcriptPath = $hookData.transcript_path
        $summary = Get-SessionSummary -TranscriptPath $transcriptPath
        $tokens = Get-TokenUsage -TranscriptPath $transcriptPath

        # Clean up empty sessions (sessions with no user prompts)
        if ($summary.prompts_count -eq 0) {
            # This is an empty session - delete the log file if it exists
            # This happens when user starts Claude Code but never sends a prompt
            $shortSessionId = $sessionId.Substring(0, [Math]::Min(8, $sessionId.Length))
            $emptySessionFile = Get-ChildItem $logDir -Filter "*-$shortSessionId.md" -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($emptySessionFile) {
                Remove-Item $emptySessionFile.FullName -Force -ErrorAction SilentlyContinue
            }
            # Also remove the active session marker
            Remove-ActiveSessionMarker -SessionId $sessionId -LogDir $logDir
            exit 0
        }

        # Get session file using session ID
        # File should already exist from session_start and be renamed by first prompt
        $shortSessionId = $sessionId.Substring(0, [Math]::Min(8, $sessionId.Length))
        $existingFile = Get-ChildItem $logDir -Filter "*-$shortSessionId.md" -ErrorAction SilentlyContinue | Select-Object -First 1

        if (-not $existingFile) {
            # Session file not found - this means session_start/prompt hooks didn't run
            # Exit gracefully - we can't append to a file that doesn't exist
            exit 0
        }

        $sessionFile = $existingFile.FullName

        # Append session summary to the SAME file
        $endTime = Get-ISOTimestamp

        $summaryContent = @"

---

## Session Summary

**Ended:** $endTime
**Total Prompts:** $($summary.prompts_count)
**Tools Used:** $($summary.tools_used -join ', ')
**Files Modified:** $($summary.files_modified.Count)

"@

        # Add token information
        $tokenUsageText = Format-TokenUsage -Tokens $tokens -IncludeCategories $true
        $summaryContent += @"

### Token Usage

$tokenUsageText

"@

        # Add modified files list if any
        if ($summary.files_modified.Count -gt 0) {
            $summaryContent += @"

### Modified Files

"@
            foreach ($file in $summary.files_modified) {
                # Convert to relative path if possible
                $relativePath = $file -replace [regex]::Escape($projectPath), '.'
                $summaryContent += "- $relativePath`n"
            }
        }

        $summaryContent | Out-File -FilePath $sessionFile -Append -Encoding utf8

        # NOTE: Full Conversation section removed - live logging (prompt/response hooks)
        # now captures the same level of detail, avoiding duplication

        # Remove the active session marker file (session ended cleanly)
        Remove-ActiveSessionMarker -SessionId $sessionId -LogDir $logDir
    }

    'permission_request' {
        # Get the existing session file
        $shortSessionId = $sessionId.Substring(0, [Math]::Min(8, $sessionId.Length))
        $existingFile = Get-ChildItem $logDir -Filter "*-$shortSessionId.md" -ErrorAction SilentlyContinue | Select-Object -First 1

        if (-not $existingFile) {
            # Session file doesn't exist yet - create it
            $sessionFile = Get-SessionFilePath -SessionId $sessionId -LogDir $logDir
            $sessionHeader = @"
# Claude Code Session

**Project:** $($projectContext.name)
**Session ID:** $sessionId
**Started:** $timestamp
**Permission Mode:** $($hookData.permission_mode)

---

"@
            $sessionHeader | Out-File -FilePath $sessionFile -Encoding utf8
        }
        else {
            $sessionFile = $existingFile.FullName
        }

        # Extract permission request details
        $toolName = if ($hookData.PSObject.Properties.Name -contains "tool_name") { $hookData.tool_name } else { "Unknown" }
        $description = if ($hookData.PSObject.Properties.Name -contains "description") { $hookData.description } else { "" }
        $filePath = if ($hookData.PSObject.Properties.Name -contains "file_path") { $hookData.file_path } else { "" }

        # Build permission request details
        $details = "**Tool:** ``$toolName``"
        if ($description) {
            $details += "`n**Description:** $description"
        }
        if ($filePath) {
            $relativePath = $filePath -replace [regex]::Escape($projectPath), '.'
            $details += "`n**File:** ``$relativePath``"
        }

        $content = @"

#### Permission Request - $timestamp

$details

---

"@

        $content | Out-File -FilePath $sessionFile -Append -Encoding utf8
    }

    'subagent_start' {
        # Extract subagent details FIRST (using correct field names: agent_type, agent_id)
        # This must happen before any early exit so the cache file is always written
        $agentType = if ($hookData.PSObject.Properties.Name -contains "agent_type") { $hookData.agent_type } else { "Unknown" }
        $agentId = if ($hookData.PSObject.Properties.Name -contains "agent_id") { $hookData.agent_id } else { "" }

        # ALWAYS store agent type in cache file for lookup during stop event
        # This must happen even if we can't find the session file yet
        if ($agentId) {
            $cacheFile = Join-Path $logDir ".agent-cache-$agentId.txt"
            $agentType | Out-File -FilePath $cacheFile -Encoding utf8 -NoNewline
        }

        # Get the existing session file
        $shortSessionId = $sessionId.Substring(0, [Math]::Min(8, $sessionId.Length))
        $existingFile = Get-ChildItem $logDir -Filter "*-$shortSessionId.md" -ErrorAction SilentlyContinue | Select-Object -First 1

        if (-not $existingFile) {
            # Session file doesn't exist yet - this is likely a subagent-only session
            # Skip logging to file - but cache file was already written above
            exit 0
        }

        $sessionFile = $existingFile.FullName

        # Build subagent details
        $details = "**Type:** ``$agentType``"
        if ($agentId) {
            $details += "`n**Agent ID:** ``$agentId``"
        }

        $content = @"

#### Subagent Started - $timestamp

$details

---

"@

        $content | Out-File -FilePath $sessionFile -Append -Encoding utf8
    }

    'subagent_stop' {
        # Get the existing session file
        $shortSessionId = $sessionId.Substring(0, [Math]::Min(8, $sessionId.Length))
        $existingFile = Get-ChildItem $logDir -Filter "*-$shortSessionId.md" -ErrorAction SilentlyContinue | Select-Object -First 1

        if (-not $existingFile) {
            # Session file doesn't exist yet - this is likely a subagent-only session
            # Skip logging - subagent events will be logged in the parent session
            exit 0
        }

        $sessionFile = $existingFile.FullName

        # Extract subagent details (using correct field names: agent_id, agent_transcript_path)
        $agentId = if ($hookData.PSObject.Properties.Name -contains "agent_id") { $hookData.agent_id } else { "" }
        $agentTranscriptPath = if ($hookData.PSObject.Properties.Name -contains "agent_transcript_path") { $hookData.agent_transcript_path } else { "" }

        # Get agent type from cache (stored during start event)
        # Use retry logic to handle race condition where stop fires before start finishes writing
        $agentType = "Unknown"
        if ($agentId) {
            $cacheFile = Join-Path $logDir ".agent-cache-$agentId.txt"
            $maxRetries = 5

            for ($retry = 0; $retry -lt $maxRetries; $retry++) {
                if (Test-Path $cacheFile) {
                    try {
                        $agentType = Get-Content $cacheFile -Raw -ErrorAction SilentlyContinue
                        if ($agentType -and $agentType.Trim()) {
                            $agentType = $agentType.Trim()
                            # Remove cache file after successful read
                            Remove-Item $cacheFile -ErrorAction SilentlyContinue
                            break
                        }
                    }
                    catch {
                        # Ignore errors reading cache, will retry
                    }
                }

                # Wait before retrying (except on last attempt)
                if ($retry -lt ($maxRetries - 1)) {
                    Start-Sleep -Milliseconds 100
                }
            }
        }

        # Build subagent details
        $details = "**Type:** ``$agentType``"
        if ($agentId) {
            $details += "`n**Agent ID:** ``$agentId``"
        }

        # Try to extract result from agent transcript
        if ($agentTranscriptPath -and (Test-Path $agentTranscriptPath)) {
            try {
                $lines = Get-Content $agentTranscriptPath -ErrorAction SilentlyContinue
                # Look for the last assistant message in the transcript
                for ($i = $lines.Count - 1; $i -ge 0; $i--) {
                    $line = $lines[$i]
                    if ([string]::IsNullOrWhiteSpace($line)) { continue }

                    $entry = $line | ConvertFrom-Json -ErrorAction SilentlyContinue
                    if ($entry.PSObject.Properties.Name -contains "type" -and $entry.type -eq "assistant") {
                        $resultText = ""
                        if ($entry.PSObject.Properties.Name -contains "message") {
                            $message = $entry.message
                            if ($message.PSObject.Properties.Name -contains "content") {
                                if ($message.content -is [string]) {
                                    $resultText = $message.content
                                }
                                elseif ($message.content -is [array]) {
                                    foreach ($block in $message.content) {
                                        if ($block.PSObject.Properties.Name -contains "text") {
                                            $resultText += $block.text
                                        }
                                    }
                                }
                            }
                        }

                        if ($resultText.Trim()) {
                            # Sanitize and truncate long results
                            $sanitizedResult = Remove-SensitiveData -Content $resultText
                            $truncatedResult = if ($sanitizedResult.Length -gt 300) { $sanitizedResult.Substring(0, 300) + "..." } else { $sanitizedResult }
                            $details += "`n**Result:**`n$truncatedResult"
                            break
                        }
                    }
                }
            }
            catch {
                # Ignore errors reading transcript
            }
        }

        $content = @"

#### Subagent Completed - $timestamp

$details

---

"@

        $content | Out-File -FilePath $sessionFile -Append -Encoding utf8
    }

    'pre_compact' {
        # IMPORTANT: This fires before auto-compaction (or manual /compact)
        # This does NOT fire on /clear - /clear does not trigger any hooks
        # After compaction, inject-phase-context.ps1 restores workflow instructions

        # Parse transcript for full conversation before it's compacted
        $transcriptPath = $hookData.transcript_path
        $summary = Get-SessionSummary -TranscriptPath $transcriptPath
        $tokens = Get-TokenUsage -TranscriptPath $transcriptPath

        # Get session file using session ID
        $shortSessionId = $sessionId.Substring(0, [Math]::Min(8, $sessionId.Length))
        $existingFile = Get-ChildItem $logDir -Filter "*-$shortSessionId.md" -ErrorAction SilentlyContinue | Select-Object -First 1

        if ($existingFile) {
            $sessionFile = $existingFile.FullName
        }
        else {
            # Create file if it doesn't exist
            $sessionFile = Get-SessionFilePath -SessionId $sessionId -LogDir $logDir
            $sessionHeader = @"
# Claude Code Session

**Project:** $($projectContext.name)
**Session ID:** $sessionId
**Started:** $timestamp
**Permission Mode:** $($hookData.permission_mode)

---

"@
            $sessionHeader | Out-File -FilePath $sessionFile -Encoding utf8
        }

        # Add conversation snapshot marker with token usage
        $snapshotHeader = @"

---

## Session Summary (Captured on /clear)

**Captured:** $timestamp
**Reason:** Session cleared or compacted
**Total Prompts:** $($summary.prompts_count)
**Tools Used:** $($summary.tools_used -join ', ')
**Files Modified:** $($summary.files_modified.Count)

"@

        # Add token usage information
        $tokenUsageText = Format-TokenUsage -Tokens $tokens -IncludeCategories $true
        $snapshotHeader += @"

### Token Usage

$tokenUsageText

"@

        $snapshotHeader | Out-File -FilePath $sessionFile -Append -Encoding utf8

        # Add modified files list if any
        if ($summary.files_modified.Count -gt 0) {
            $filesContent = @"

### Modified Files

"@
            foreach ($file in $summary.files_modified) {
                # Convert to relative path if possible
                $relativePath = $file -replace [regex]::Escape($projectPath), '.'
                $filesContent += "- $relativePath`n"
            }
            $filesContent | Out-File -FilePath $sessionFile -Append -Encoding utf8
        }

        # Add full conversation log
        if ($summary.conversation.Count -gt 0) {
            $userName = Get-GitUserName
            $turnNumber = 0
            foreach ($turn in $summary.conversation) {
                $turnNumber++

                if ($turn.role -eq "user") {
                    # Clean prompt text (remove system tags)
                    $cleanedPrompt = Get-CleanPrompt -RawPrompt $turn.content
                    # Sanitize user prompt to remove sensitive data
                    $sanitizedPrompt = Remove-SensitiveData -Content $cleanedPrompt

                    $turnContent = @"

_**$userName ($timestamp)**_

$sanitizedPrompt

"@
                }
                elseif ($turn.role -eq "assistant") {
                    # Sanitize assistant response to remove sensitive data
                    $responseContent = Remove-SensitiveData -Content $turn.content
                    $modelName = if ($turn.model) { $turn.model } else { "claude" }

                    # Add tool usage note if tools were used
                    $toolNote = ""
                    if ($turn.tools -and $turn.tools.Count -gt 0) {
                        $toolNote = "`n`n_Tools used: $($turn.tools -join ', ')_"
                    }

                    $turnContent = @"

_**Agent (model $modelName)**_

$responseContent$toolNote

"@
                }

                $turnContent | Out-File -FilePath $sessionFile -Append -Encoding utf8
            }

            # Add separator
            "`n---`n" | Out-File -FilePath $sessionFile -Append -Encoding utf8
        }
        else {
            "_(No conversation to snapshot)_`n`n---`n" | Out-File -FilePath $sessionFile -Append -Encoding utf8
        }
    }

    'pre_tool_use' {
        # Log to debug file only - these events fire very frequently
        # Useful for debugging tool execution flow
    }

    'post_tool_use' {
        # Log to debug file only - these events fire very frequently
        # Useful for debugging tool execution flow
    }

    'notification' {
        # Log to debug file only - captures system notifications
        # Could be useful for tracking errors or warnings
    }
}

# Exit successfully
exit 0
