# File Operations Policy

**Scope:** All workflow agents and orchestrators.

This policy governs **file content** — use `Read` / `Grep` / `Glob` / `Edit` / `Write` rather than Bash. Piping the output of `node` / `npm` / `npx` / `git` through `| tail` / `| grep` / `| head` is allowed: those are streams, not files.

## Allowed Bash

| Category | Examples | Notes |
|----------|----------|-------|
| **Node scripts** | `node .claude/scripts/...`, `node web/...`, `node generated-docs/...` | Includes `scan-doc.js` for file metadata |
| **Git** | `git add`, `git commit`, `git push`, `git status` | Only when the agent's instructions call for it |
| **Directory listing** | `ls` | For quick directory checks |

## Directory Creation

The `Write` tool auto-creates parent directories — you do **not** need to `mkdir` before writing a file. The only time you need to create a directory from Bash is when the next step is a heredoc, `chmod`, or another non-`Write` operation that requires the directory to exist.

When you do need it, use `mkdir -p <path>` **literally** — the auto-approver recognizes the bash form. Do not translate it to PowerShell (`if (!(Test-Path …)) { New-Item -ItemType Directory … }`) even on Windows; the auto-approver does not recognize native PowerShell cmdlets and the user will be prompted.

## Use Dedicated Tools Instead

| Instead of... | Use... | Why |
|---------------|--------|-----|
| `cat`, `head`, `tail` | `Read` tool with `offset`/`limit` | Returns line numbers, handles all encodings, supports partial reads |
| `grep`, `rg` | `Grep` tool | Regex support, glob filtering, multiple output modes |
| `find` | `Glob` tool | Fast pattern matching, sorted by modification time |
| `wc -l` | `scan-doc.js` | Returns `.lines` field with total line count |
| `sed -n` | `Read` tool with `offset`/`limit` | Read specific line ranges without Bash |
| `awk` | `Read` + `Grep` tools | No file analysis needs require awk |
| `python3 -c` | `Read`/`Grep` or `scan-doc.js` | Never pipe files through interpreters |
| `cut`, `perl` | `Read`/`Grep` tools | Dedicated tools handle all text extraction needs |
