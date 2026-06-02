# Contributing to This Template

This guide is for maintainers of the template repository itself.

For detailed template architecture and maintenance workflows, see [Template Development Guide](TEMPLATE_DEVELOPMENT.md).

## Version Strategy

The template uses [Semantic Versioning](https://semver.org/):

- **MAJOR** (1.0.0): Breaking changes to template structure or patterns
- **MINOR** (0.1.0): New features, components, or workflows
- **PATCH** (0.0.1): Bug fixes, documentation updates, dependency bumps

## Creating a Release

1. Update [CHANGELOG.md](../CHANGELOG.md) with changes under `## [Unreleased]`
2. Move unreleased changes to a new version heading: `## [X.Y.Z] - YYYY-MM-DD`
3. Commit: `git commit -m "chore: prepare release vX.Y.Z"`
4. Create GitHub Release:
   - Tag: `vX.Y.Z`
   - Title: `vX.Y.Z`
   - Use "Generate release notes" for auto-categorized PR list
5. The release notes will auto-categorize PRs based on labels (configured in [.github/release.yml](../.github/release.yml))
6. **If this release changed any files under `.github/workflows/`:** the publish pipeline does **not** push workflow files to the release repo (`Digiata/Stadium-8`) — the publishing GitHub App lacks the `workflows` permission, so GitHub rejects the push. Copy the changed workflow files into the release repo manually, and in its `sync-template.yml` set the sync default to the release repo (`vars.TEMPLATE_SOURCE_REPO || 'Digiata/Stadium-8'`) so consumers sync from the right source.

## PR Labels for Release Notes

Use these labels on PRs for proper categorization:

| Label | Release Category |
|-------|------------------|
| `breaking` | Breaking Changes |
| `enhancement`, `feature` | Features |
| `bug`, `fix` | Bug Fixes |
| `security` | Security |
| `documentation`, `docs` | Documentation |
| `testing`, `test` | Testing |
| `chore`, `maintenance` | Maintenance |
| `ignore-for-release` | Excluded from notes |

## Template Sync System

Derived repositories inherit `.github/workflows/sync-template.yml` which:

- Runs on demand (manual trigger only — automated scheduled syncs are planned for a future release)
- Creates PRs for infrastructure updates
- Excludes `/web` folder (configured in [.templatesyncignore](../.templatesyncignore))

**What syncs automatically:** `.github/`, `.claude/`, root configs, `CLAUDE.md`, `CHANGELOG.md`

**What users review manually:** Everything in `/web` (documented in CHANGELOG)

## Related Files

- [CHANGELOG.md](../CHANGELOG.md) - Version history
- [.github/release.yml](../.github/release.yml) - Release notes configuration
- [.github/workflows/sync-template.yml](../.github/workflows/sync-template.yml) - Sync workflow (template → user repos)
- [.github/workflows/publish-template.yml](../.github/workflows/publish-template.yml) - Publish workflow (dev → release repo)
- [.templatesyncignore](../.templatesyncignore) - Files excluded from sync
- [.release-ignore](../.release-ignore) - Files excluded from publish
- [TEMPLATE_DEVELOPMENT.md](TEMPLATE_DEVELOPMENT.md) - Detailed maintainer guide
