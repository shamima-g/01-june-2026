# Quality Gates

Quality gates are automatic checks that verify your app is working correctly. Most run in the background without you needing to do anything — but some require you to review changes manually.

Run `/quality-check` in Claude Code at any time to see the current status of all gates.

---

## Overview

| Gate | What It Checks | Automated? | Your Action |
|------|----------------|------------|-------------|
| **1. Functional** | Features work as intended | No | Review manually |
| **2. Security** | No vulnerabilities or exposed secrets | Mostly | POPIA compliance review |
| **3. Code Quality** | Code is valid, consistent, and builds correctly | Yes | None |
| **4. Testing** | All tests pass | Yes | None |
| **5. Performance** | App is fast and accessible | Partly | Real device and browser testing |

---

## When Gates Run

Gates run automatically at two points:

- **During the Build stage** — after each story is implemented, Claude Code runs all five gates before asking you to review the feature in your browser.
- **When code is pushed** — GitHub Actions runs gates automatically on every push and pull request to main.

---

## Gate 1: Functional

**What it checks:** That features work as specified and the app behaves correctly for users.

This gate is entirely manual — there are no automated checks. Review any change that adds or modifies a feature as part of your manual review.

---

## Gate 2: Security

**What it checks:** That no secrets (passwords, API keys, tokens) have been accidentally included in the code, and that the app follows security best practices.

Most of this runs automatically. When your feature handles personal data, you are responsible for reviewing it for POPIA compliance as part of your manual review.

---

## Gate 3: Code Quality

**What it checks:** That the code is valid TypeScript, passes linting rules, is consistently formatted, and the app builds without errors.

This gate is fully automated. If it fails, ask Claude Code to fix the issues.

---

## Gate 4: Testing

**What it checks:** That all automated tests pass.

This gate is fully automated. If it fails, ask Claude Code to investigate and fix the failing tests.

---

## Gate 5: Performance

**What it checks:** That the app meets minimum scores for speed, accessibility, and best practices.

Automated performance audits run as part of this gate. Manual testing on real devices and browsers is also required as part of your manual review.

---

**Need more help?** Run `/quality-check` in Claude Code or ask for specific guidance.
