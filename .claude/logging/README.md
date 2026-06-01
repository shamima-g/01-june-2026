# Claude Code Session Logging

This directory contains the PowerShell script that captures Claude Code session data into markdown log files.

## Quick Start

Session logging is **automatic** - no setup required. All Claude Code sessions are logged to `.claude/logs/` as markdown files.

**Find your logs:** `.claude/logs/YYYY-MM-DD_HH-mmZ-description-SESSIONID.md`

## How It Works

The logging system uses Claude Code hooks defined in [settings.json](../settings.json) to capture session events and write them to markdown files in [logs/](../logs/).

### Real-Time Logging

Every session is logged in real-time:
1. **Session starts** - Creates a new markdown file
2. **User prompts** - Appended immediately with timestamp
3. **AI responses** - Appended with model info and tools used
4. **Session ends** - Summary added with token usage and modified files

### Automatic Recovery from /clear

When you use `/clear`, the session data is **automatically recovered**:
1. Session starts → creates a marker file (`.active-session-{id}`)
2. `/clear` executes (no hooks fire, marker file persists)
3. New session starts, triggering SessionStart hook
4. Script finds the orphaned marker file from the cleared session
5. Full conversation history is recovered and marked as "Recovered from /clear"
6. Stale marker file is deleted

This approach works regardless of how long the session was idle before `/clear` was run.

## Hook Events

| Hook | Event Type | Description |
|------|------------|-------------|
| `SessionStart` | `session_start` | New session begins |
| `UserPromptSubmit` | `prompt` | User submits a prompt |
| `Stop` | `response` | Claude completes a response |
| `SessionEnd` | `session_end` | Claude Code fully exits |
| `PreCompact` | `pre_compact` | Before `/compact` or auto-compaction |
| `PermissionRequest` | `permission_request` | Tool permission requested |
| `SubagentStart` | `subagent_start` | Task tool subagent starts |
| `SubagentStop` | `subagent_stop` | Task tool subagent completes |
| `PreToolUse` | `pre_tool_use` | Before tool execution (debug only) |
| `PostToolUse` | `post_tool_use` | After tool execution (debug only) |
| `Notification` | `notification` | System notifications (debug only) |

## Output Files

### Session Log Files

Each session creates a markdown file:
```
YYYY-MM-DD_HH-mmZ-first-few-words-of-prompt-SESSIONID.md
```

Example: `2025-12-04_12-23Z-update-the-readme-332d5481.md`

**File Structure:**
1. **Header** - Project name, session ID, start time, permission mode
2. **Conversation** - User prompts and Claude responses with timestamps
3. **Subagent Events** - Task tool start/stop with results
4. **Permission Requests** - Tool permissions requested during session
5. **Session Summary** - Token usage, tools used, modified files list

### Timestamps

All timestamps use **UTC with Z suffix** (e.g., `2025-12-04 14:30Z`) for consistency.

## Session Capture Options

| Method | What Happens | Use When |
|--------|--------------|----------|
| `/clear` | Auto-recovered on next session | Fresh start at context-clearing boundaries |
| Auto-compaction | PreCompact hook logs, then post-compaction hook restores workflow state | Automatic (handled by hooks) |
| Exit Claude Code | SessionEnd hook captures summary | Normal exit |

**Note:** `/compact` is not recommended for workflow sessions. It triggers the same lossy compression as auto-compaction. The post-compaction hook (`inject-phase-context.ps1`) handles instruction recovery automatically.

## Security Features

### Sensitive Data Sanitization

The logger automatically redacts sensitive data before writing to logs:
- API keys (generic, AWS, GitHub, OpenAI, Anthropic)
- Bearer tokens and authorization headers
- Passwords and secrets
- Connection strings with credentials
- Credit card numbers and SSNs
- Private keys (PEM format)
- Environment variables with sensitive names

Redacted content appears as `[REDACTED]`, `[AWS_KEY_REDACTED]`, etc.

## Configuration

Hooks are configured in [settings.json](../settings.json). Each hook:
- Uses `matcher: "*"` to capture all events
- Runs the PowerShell script with an event type parameter
- Has a timeout (10-30 seconds depending on complexity)

### Customization

To modify logging behavior, edit [capture-context.ps1](capture-context.ps1):
- `Get-SessionFilePath` - File naming logic
- `Get-CleanPrompt` - Prompt text cleaning
- `Remove-SensitiveData` - Add custom sanitization patterns
- `Format-TokenUsage` - Token display format

## Troubleshooting

### Logs Not Being Created

1. Verify hooks are configured in `.claude/settings.json`
2. Check that `.claude/logs/` directory exists (created automatically)
3. Review PowerShell execution policy allows running scripts

### Missing Session Summaries

Session summaries are added when:
- You exit Claude Code completely (SessionEnd)
- Auto-compaction fires (PreCompact hook captures state)
- A cleared session is recovered on next SessionStart

**Note:** `/clear` does not trigger any hooks directly - data is recovered when the next session starts.

### Token Usage Not Showing

Token usage requires running `/context` during your session. The logger parses `/context` output from the transcript to display token breakdown.

## Git Tracking Policy

**Session logs (`.md` files) are intentionally tracked in Git** for traceability during the template's trial/testing period.

### What Gets Tracked vs Ignored

| File Pattern | Tracked? | Purpose |
|--------------|----------|---------|
| `*.md` | ✅ Yes | Session log files |
| `.agent-cache*` | ❌ No | Temporary cache files |
| `.active-session-*` | ❌ No | Active session markers |

### For Claude Agents

When making commits, **always include `.claude/logs/`**:

```bash
git add .claude/logs/
git commit -m "your message"
```

**Do NOT:**
- Add `.claude/logs/` or `.claude/logs/*.md` to `.gitignore`
- Skip committing log files
- Delete log files before committing

This policy is also documented in:
- [CLAUDE.md](../../CLAUDE.md) - Main project instructions
- Agent configuration files in [agents/](../agents/)

---

## File Reference

| File | Purpose |
|------|---------|
| [capture-context.ps1](capture-context.ps1) | Main logging script |
| [../settings.json](../settings.json) | Hook configuration |
| [../logs/](../logs/) | Output directory for session logs |
| `.active-session-*` | Marker files for orphan detection (gitignored) |
