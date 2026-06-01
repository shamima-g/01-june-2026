# Changelog

All notable changes to this template will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Workflow simplification:** collapsed the 9-phase model (INTAKE / DESIGN / SCOPE / STORIES / REALIGN / TEST-DESIGN / WRITE-TESTS / IMPLEMENT / QA) into 4 phases (INTAKE / PLAN / BUILD / COMPLETE) with 1–2 user gates and an agent-driven BUILD loop. See `.claude/WORKFLOWS.md`.
- INTAKE produces a single `project-brief.md` artifact (replaces the FRS / assumptions split).
- BUILD agents apply a four-tier autonomy policy (`agent-autonomy.md`) and halt only for genuinely unsafe ground.
- `/start` now chains directly into `/continue` after Gate 1 — no `/clear` boundaries anywhere in the flow.

### Removed

- Agents `intake-brd-review-agent`, `design-wireframe-agent`, `design-roles-agent`, `prototype-review-agent`, `spec-compliance-watchdog`, `test-designer` — folded into `intake-agent`, `test-generator`, or eliminated.
- Per-story Markdown files; story metadata now lives in `workflow-state.json` with a per-epic overview file for visibility.

## [0.2.0] - 2026-01-05

### Added

- `/status` command with visual workflow progress indicators showing current phase and completed steps
- `/continue` command for resuming interrupted TDD workflows with automatic state detection
- Design Wireframe agent for creating wireframes before story planning
- `/start` command now executes TDD workflow one epic at a time (Plan → Test → Implement → Review → Verify → Commit/PR per epic)
- Performance gate (Gate 5) with Lighthouse CI integration
- PR comment reporting for all quality gates (Security, Code Quality, Testing, Performance)
- Security scanning for hardcoded secrets (API keys, AWS keys, tokens) in PR checks
- Template update sync system with weekly workflow for receiving upstream changes
- Auto-fix step in quality-gate-checker (runs lint:fix, format, audit fix before reporting failures)
- Plain-language error explanations in quality-gate-checker for non-developer users
- Workflow state tracking to all agents for `/status` visibility
- Session logging now works in both CLI and VSCode extension

### Changed

- Quality gates now enforce strict binary pass/fail (no conditional passes or rationalized failures)
- Agents must present actual status and options to user instead of auto-approving failures
- Improved non-developer user experience with clearer documentation and error messages

### Fixed

- Ensure linting and tests are run before submitting story PRs
- Ensure design-wireframe-agent commits wireframes to prevent data loss
- Exclude bcrypt hashes from hardcoded secrets scan (false positives)
- Add detailed tracing to hardcoded secrets scan for debugging
- Run npm audit fix for dependency security updates
- Remove unused tasks folder

### Security

- Enhanced PR quality gates with regex scanning for hardcoded secrets
- PR comments now report security scan results

## [0.1.0] - 2025-12-12

### Added

- Initial template release
- Next.js 16 with App Router
- React 19 with TypeScript 5 strict mode
- Tailwind CSS 4 with Shadcn UI integration
- Production-ready API client with error handling
- Role-Based Access Control (RBAC) system
- Input validation with Zod schemas
- Toast notification system
- Quality Gates CI/CD workflow (Security, Code Quality, Testing)
- Claude Code agents for TDD workflow (feature-planner, test-generator, developer, code-reviewer, quality-gate-checker)
- Progress tracking system (auto-generated PROGRESS.md)
- Template sync workflow for receiving updates

### Security

- RBAC with role hierarchy (Admin, Power User, Standard User, Read Only)
- Server-side and API route protection helpers
- XSS prevention with HTML sanitization
- Input validation schemas for common patterns
