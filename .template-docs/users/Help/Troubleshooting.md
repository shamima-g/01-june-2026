# Troubleshooting

Common issues and what to do about them. For most errors, the fastest fix is to copy the error message and ask Claude Code directly.

---

## Setup Issues

### "Module not found" errors or missing dependencies

If you see import errors after cloning the project, ask Claude Code:

> "I'm seeing module not found errors. Can you fix my dependencies?"

### Port 3000 is already in use

Another process is using port 3000. Ask Claude Code:

> "Port 3000 is already in use. Can you free it up?"

### `.env.local` not loading

Check the following:

- [ ] File is named exactly `.env.local` (not `.env.local.txt` or `.env`)
- [ ] File is inside the `web/` folder (same level as `package.json`)
- [ ] Dev server was restarted after the file was created or changed
- [ ] Variable names are spelled correctly (they are case-sensitive)

See [Environment Variables](./Environment-Variables.md) for more detail.

### Dev server won't start or keeps crashing

Ask Claude Code:

> "My dev server won't start. Here's the error: [paste error]"

---

## Build and Test Issues

Build errors, TypeScript errors, failing tests, and lint warnings are handled automatically by Claude Code through the quality gate process.

If you see one of these errors:
1. Run `/quality-check` in Claude Code to get a full status report
2. Or paste the error directly into Claude Code and ask it to fix it

See [Quality Gates](./Quality-Gates.md) for more detail on what each gate checks.

---

## Quality Gate Failures

### Security vulnerabilities (Gate 2)

Ask Claude Code:

> "npm audit is showing vulnerabilities. Can you fix them?"

Claude Code will assess each one and fix what can be safely resolved.

### Lighthouse performance score too low (Gate 5)

Ask Claude Code:

> "The Lighthouse performance score is failing. Can you investigate?"

For more detail on Gate 5, see the [Quality Gates guide](./Quality-Gates.md#gate-5-performance).

### Pre-commit check blocking a commit (Gate 3)

The commit was blocked because a code quality check didn't pass. Ask Claude Code:

> "My commit is being blocked by pre-commit checks. Can you fix the issues?"

---

## Getting Help

For any error not covered here:

1. Copy the full error message
2. Ask Claude Code: *"I'm getting this error: [paste error]. What's wrong and how do I fix it?"*

Claude Code has access to your full codebase and all documentation and can diagnose most issues directly.
