# .claude Directory

Claude Code configuration and extensions for this project.

## Layout

```
.claude/
├── settings.json           # Shared project settings (committed)
├── settings.local.json     # User-specific overrides (git-ignored)
├── agents/                 # Custom subagents that drive INTAKE / PLAN / BUILD
├── commands/               # Slash commands (/start, /continue, /status, etc.)
├── hooks/                  # PreToolUse / UserPromptSubmit / SessionStart hooks
├── policies/               # Cross-cutting policies referenced by agents
├── shared/                 # Shared snippets (agent-startup, orchestrator-rules, etc.)
├── scripts/                # Node helpers (transition-phase, quality-gates, etc.)
├── templates/              # Document templates (project-brief.md)
├── logging/                # Session logging — see logging/README.md
└── logs/                   # Session log output (TRACKED in git per CLAUDE.md §1)
```

For the workflow itself, see [WORKFLOWS.md](WORKFLOWS.md) and the orchestrator commands at [commands/start.md](commands/start.md) and [commands/continue.md](commands/continue.md).

## Settings Hierarchy

Highest precedence first:

1. Enterprise managed settings (Windows: `C:\ProgramData\ClaudeCode\managed-settings.json`)
2. Command-line arguments
3. `.claude/settings.local.json` (project-local, git-ignored)
4. `.claude/settings.json` (project-shared, committed)
5. `~/.claude/settings.json` (user-global)

To override locally, create `.claude/settings.local.json`. Example — disable hooks for your environment only:

```json
{
  "hooks": {}
}
```

## What to Commit

✅ **DO commit:**
- `settings.json` — shared project configuration
- `logging/` — logging scripts
- `logs/*.md` — session logs (required for traceability per [CLAUDE.md §1](../CLAUDE.md))
- `agents/`, `commands/`, `hooks/`, `policies/`, `shared/`, `templates/`, `scripts/`

❌ **DON'T commit:**
- `settings.local.json` — personal preferences
- `.env` files with secrets
- `logs/.agent-cache*`, `logs/.active-session-*` — temporary marker files (already gitignored)

## Session Logging

Sessions are automatically logged to `.claude/logs/` via the hooks in `settings.json`. Each session creates one markdown file with prompts, tool usage, and a summary. See [logging/README.md](logging/README.md) for the full hook event list, recovery behavior, sensitive-data sanitization, and view commands (`scripts/parse-logs.ps1`).

## Resources

- Claude Code docs: https://code.claude.com/docs
- Hooks: https://code.claude.com/docs/en/hooks.md
- Settings: https://code.claude.com/docs/en/settings.md
- Project instructions: [../CLAUDE.md](../CLAUDE.md)
