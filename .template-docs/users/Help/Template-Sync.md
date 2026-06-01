# Template Sync

Keep your project up to date with the latest template improvements, bug fixes, and security patches. When you trigger a sync, the workflow opens a pull request in your repo containing any new changes from the template.

---

## How It Works

1. You click **Run workflow** on the `Sync from Template` action (see "Triggering a sync" below).
2. The workflow compares your repo to the template source and filters out your application code and other files that belong to you.
3. If there are changes, a pull request is created with the label `template-sync`.
4. You review the PR, resolve any conflicts, and merge when you're ready.

If there's nothing to sync, no PR is created and the workflow finishes quietly.

> **v1 is manual-only.** Trigger a sync whenever you want to check for template updates.

---

## Setup

You need to add one secret to your repo: a personal access token (a password that allows the sync workflow to read the template source on GitHub).

**Step 1: Generate a personal access token**

1. Go to [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new).
2. **Token name:** anything memorable (e.g. `template-sync for my-project`).
3. **Expiration:** as long as your org's policy allows, up to 1 year. Avoid "no expiration" — expiry is a helpful prompt to re-confirm you still need access.
4. **Resource owner:** `stadium-software`.
5. **Repository access → Only select repositories:** pick `stadium-software/stadium-8`.
6. **Permissions → Repository permissions → Contents:** set to `Read-only`. Leave everything else at "No access".
7. Click **Generate token** and copy the token value — you won't be able to see it again.

**Step 2: Add the token as a repo secret**

1. In your repo, go to **Settings → Secrets and variables → Actions**.
2. Click **New repository secret**.
3. **Name:** `TEMPLATE_SYNC_PAT`
4. **Secret:** paste the token value from Step 1.
5. Click **Add secret**.

**Step 3: Allow GitHub Actions to create pull requests**

1. In your repo, go to **Settings → Actions → General**.
2. Scroll down to **Workflow permissions**.
3. Tick **Allow GitHub Actions to create and approve pull requests**.
4. Click **Save**.

If the checkbox is greyed out, your org has the setting locked at the organization level. Ask your org admin to enable it under **Organization Settings → Actions → General → Workflow permissions**.

That's it. Head to "Triggering a sync" below.

---

## Triggering a sync

1. In your repo on GitHub, go to **Actions → Sync from Template**.
2. Click **Run workflow**.
3. Pick the branch (usually `main`) and click **Run workflow**.
4. Wait a minute or two. If there are changes, a PR labelled `template-sync` will appear.

You can trigger a sync as often as you like — you're in control of when to check for updates.

---

## What Gets Synced

A configuration file controls what gets synced. By default:

| Synced (auto-updated) | Not synced (your territory) |
|---|---|
| `.claude/` agents, commands, hooks, scripts | `web/` (your application code) |
| `.github/` scripts, issue templates, etc. | `.github/workflows/` (see below) |
| `.template-docs/` guides and help docs | `documentation/` (your specs) |
| Root config (`CLAUDE.md`, `.gitignore`, etc.) | `generated-docs/` (your generated output) |
| | `.env` files, IDE settings, your `/README.md` |

For `web/` changes, review the changelog included in the sync PR to understand what changed and apply updates manually.

### Workflow files require manual updates

Files under `.github/workflows/` are not auto-synced due to a GitHub security restriction. When the template ships a workflow change, here's how to pick it up:

1. Open the template repo (`stadium-software/stadium-8`) on GitHub.
2. Navigate to `.github/workflows/` and open the file that has changed.
3. Click **Raw**, then copy everything.
4. In your own repo, open the same file and paste the new content over the existing version.
5. Commit and push.

Workflow updates are rare — these files are stable and don't change often.

---

## Reviewing Sync PRs

Sync PRs may include:

- Updated agent definitions or workflow improvements
- New or improved quality gate checks
- Security patches
- Documentation updates

Review the PR diff carefully. If there are merge conflicts, resolve them in favour of whichever version is correct for your project.

---

## Troubleshooting

### I see an issue titled "Template sync: action required"

The workflow opens this issue automatically when it can't run. The body explains which cause applies:

1. **No credentials configured.** You haven't set `TEMPLATE_SYNC_PAT`. Follow the setup steps above.
2. **Template source unreachable.** Your `TEMPLATE_SYNC_PAT` is likely expired or invalid — generate a fresh token and update the secret.

Once you've resolved the cause, close the issue and click **Run workflow** again.

### Workflow runs but no PR is created

Most likely your repo is already up to date — no action needed. If you've previously had a sync run that failed after pushing a branch, there may be an orphaned branch the workflow is detecting. The workflow log will show:

> `::warn::Git branch 'chore/template_sync_<hash>' exists in the remote repository`

To recover, either:

- **Open the PR manually.** Go to your repo's **Branches** tab, find the `chore/template_sync_<hash>` branch, and click **New pull request** next to it.
- **Delete the branch and re-run.** Delete the branch from the **Branches** tab, then click **Run workflow** again.

### PR has merge conflicts

The sync found changes in files you've also modified. Review each conflict and keep the version that's correct for your project.
