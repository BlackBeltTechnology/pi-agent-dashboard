---
name: release-revoke
description: 'Revoke or rollback a pi-agent-dashboard release: delete the GitHub Release, remove the git tag locally and on origin, deprecate the npm version (`npm unpublish` is blocked after 72h), and optionally revert the release commit. Use when the user says "revoke release", "rollback release", "delete release", "unpublish vX.Y.Z", "yank release".'
license: MIT
metadata:
  author: pi-dashboard
  version: "1.0"
---

# Revoke a pi-agent-dashboard Release

This skill undoes a release cut by the `release-cut` skill. It handles
three layers independently because they have different semantics:

| Layer              | Revocable?                  | Mechanism                         |
|--------------------|-----------------------------|-----------------------------------|
| GitHub Release     | Yes (draft or published)    | `gh release delete`               |
| Git tag            | Yes                         | `git push --delete` + `git tag -d`|
| Electron artifacts | Yes (deleted with release)  | handled by `gh release delete`    |
| npm package        | Effectively permanent       | `npm deprecate` (NOT `unpublish`) |

**Key fact about npm:** `npm unpublish` is blocked 72h after publish, or
any time the version has dependents. The right "revoke" for an npm
release is `npm deprecate`, which leaves the tarball in place but marks
it with a warning visible to anyone who tries to install it.

## Step 1 — Select version

Run:
```bash
git tag -l 'v*' | sort -V | tail -10
```

**Use AskUserQuestion (select)** showing the last 10 tags. Do NOT auto-pick.

Store the chosen version as `<version>` (with the leading `v`).

## Step 2 — Inspect current state

```bash
gh release view <version> --json isDraft,publishedAt,assets,url 2>/dev/null || echo "NO_RELEASE"
git tag -l <version>                         # local tag exists?
git ls-remote --tags origin <version>        # remote tag exists?
npm view @blackbelt-technology/pi-dashboard@${version#v} version 2>/dev/null || echo "NOT_ON_NPM"
```

Parse results and report to the user:
- Whether GitHub Release exists (draft vs published)
- Whether the tag exists locally / on origin
- Whether this version is on npm

## Step 3 — Confirm intent

**Use AskUserQuestion (confirm)** with a full impact preview, e.g.:

```
About to revoke <version>:
  • GitHub Release: PUBLISHED — will be deleted (artifacts gone)
  • Git tag: exists locally + on origin — will be deleted from both
  • npm: published <N> days ago — will be deprecated
         (npm unpublish not possible: > 72h old / has dependents)

This is PARTIALLY REVERSIBLE:
  • GitHub Release + tag can be re-created by re-tagging.
  • npm deprecation CAN be reversed with `npm deprecate <pkg>@<v> ""`.
  • npm version number is burned — cannot republish same version.

Proceed?
```

Refuse to continue without explicit confirmation.

## Step 4 — Delete GitHub Release

Only if Step 2 showed the release exists:
```bash
gh release delete <version> --yes --cleanup-tag=false
```

`--cleanup-tag=false` is important — we delete the tag ourselves in
Step 5 so the ordering is explicit.

## Step 5 — Delete git tag

```bash
git push --delete origin <version>    # remote (only if it exists)
git tag --delete <version>            # local  (only if it exists)
```

Wrap each in an existence check — don't fail if already gone.

## Step 6 — npm deprecate

Ask for a deprecation message (**AskUserQuestion input**), defaulting to:
```
Deprecated — see https://github.com/BlackBeltTechnology/pi-agent-dashboard/releases for a newer version.
```

Then run (only if Step 2 confirmed it's on npm):
```bash
npm deprecate @blackbelt-technology/pi-dashboard@${version#v} "<message>"
```

Verify:
```bash
npm view @blackbelt-technology/pi-dashboard@${version#v} deprecated
```
Should echo the message back.

**Note:** requires the user to be logged in as a maintainer
(`npm whoami` + having publish rights on the package). If the command
fails with auth error, surface it and ask the user to run
`npm login` then retry this step.

## Step 7 — Offer to revert the release commit

Check if the latest commit on `develop` is the release commit:
```bash
git log -1 --format="%s"    # should be "chore(release): <version>" if yes
```

If yes, **use AskUserQuestion (confirm)** to offer:
```bash
git revert HEAD --no-edit
git push origin develop
```

Explain: this restores `## [Unreleased]` as the target for the
next release and restores the pre-release `package.json` versions.

If the release commit is NOT the latest (other commits on top), **do
not revert automatically** — surface the situation and let the user
decide. Offer manual guidance:
- Revert ad-hoc with `git revert <sha>` + resolve conflicts
- Or leave the version bump in place and bump to the next version on the
  next release

## Step 8 — Summary

Print a final report:
```
Revocation complete for <version>:
  ✅ GitHub Release deleted (was: draft|published|absent)
  ✅ Git tag deleted from origin + local (was: present|absent)
  ✅ npm deprecated: "<message>"   [or: skipped — not on npm]
  ✅ Release commit reverted       [or: skipped — not the latest commit]

Note: the GitHub Pages site still advertises <version> until the next
release (or a manual workflow_dispatch of deploy-site.yml).
```

## Guardrails

- **Never `npm unpublish` without asking.** Even within 72h, it breaks
  anyone who happens to have installed the broken version. Deprecation
  is always the safer default.
- **Never skip confirmation.** Every destructive step gets its own
  AskUserQuestion.
- **Never force-push.** All deletions are explicit, non-history-rewriting
  operations.
- **Handle partial state gracefully.** If the tag exists but no release,
  or release exists but no tag, or npm exists but tag doesn't —
  delete only what exists. Never error on "already gone".
- If the release was auto-triggered but CI failed mid-matrix (e.g.
  npm published but Electron build failed), this skill is still the
  right tool — it will deprecate npm and delete the partial draft.
- **Published production releases self-distribute.** Since
  fix-electron-auto-update-pipeline, production tags (`vX.Y.Z`) publish
  immediately (not draft) and carry `latest*.yml` update metadata.
  `gh release delete` removes the release, but electron-updater clients
  that already polled `/releases/latest` may have cached or downloaded
  it. Deleting the release stops NEW clients resolving it; it does NOT
  recall an update already pulled. To supersede a bad published release,
  cut a higher production tag (`vX.Y.Z+1`) so clients update forward —
  do not rely on deletion alone. Pre-release tags stay drafts and have
  no such reach.
