---
description: Run all 5 quality gates to verify code is ready to commit
model: haiku
---

Run this command immediately — do not read any files first:

```bash
node .claude/scripts/quality-gates.js --auto-fix
```

This single script handles Gates 2-5 automatically (security, code quality, testing, performance). It auto-fixes formatting and lint issues before checking.

After the script finishes, show the user the summary output and:

- **If all gates passed:** Ask "Have you manually tested the feature? Does it work as expected?" (this is Gate 1 — the only manual gate).
- **If any gate failed:** Show which gate failed, suggest a fix, and offer to help. Re-run the script after fixes.
