# Session Logging

Every Claude Code conversation in this project is automatically saved as a markdown file. You can use these logs to review what was built, share context with teammates, or audit AI-assisted changes before committing.

**No setup required** — logging starts automatically the first time you open Claude Code in this project.

---

## Where to Find Your Logs

Logs are saved in the `.claude/logs/` folder. Each file is named with the date, time, and a short description of the session — for example:

`.claude/logs/2025-12-04_14-30Z-implement-user-auth-a1b2c3d4.md`

Logs are plain markdown files — open them in any editor or read them on GitHub.

---

## What Gets Captured

| What | Details |
|------|---------|
| Your prompts | Every message you send, with timestamps |
| AI responses | Full responses with model info |
| Tools used | Which files were read, edited, or created |
| Files modified | List of changed files |
| Token usage | How much of Claude's memory the session used |

---

## Key Features

### Real-Time Logging

Each prompt and response is written immediately — you don't have to wait until the session ends. If Claude Code crashes or you close the window, everything up to that point is already saved.

### Automatic Recovery After `/clear`

If you run `/clear` to reset the conversation, the previous session is automatically recovered when you start the next one. Nothing is lost.

### Sensitive Data Protection

Before writing to disk, the logging scripts automatically redact common sensitive patterns:

- API keys and tokens
- Passwords and secrets
- Credit card numbers
- Connection strings
- Private keys

Automated redaction catches common patterns, but cannot detect credentials typed directly in your messages to Claude. Avoid pasting real credentials into Claude Code.

---

## Session Lifecycle

| How you end the session | What happens |
|-------------------------|-------------|
| Exit Claude Code normally | Full summary with token usage is added |
| Run `/clear` | Session is auto-recovered at the start of your next session |
| Claude Code compacts the conversation | Workflow state is restored automatically; no action needed |

---

## What a Log File Looks Like

Each log file has three parts: a header with session details, the full conversation, and a summary at the end.

The summary includes how many prompts were exchanged, which files were changed, and how much of Claude's memory was used — useful for reviewing what happened in a long session.

---

## Including Logs in Your Commits

Session logs are tracked in Git intentionally — they give reviewers a record of what was built and why.

During a pull request, reviewers can read the session logs directly on GitHub to understand what prompts drove the changes.

---

## Troubleshooting

### Logs Are Missing Token Data

Normal behaviour — token data is only included when you run `/context` during the session.
