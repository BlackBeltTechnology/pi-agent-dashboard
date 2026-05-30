---
name: release-cut
description: >
  Cut a new pi-agent-dashboard release. Promotes `## [Unreleased]` in
  CHANGELOG.md to a versioned section, bumps all workspace package.json
  versions per SemVer, commits, tags `v<version>`, and pushes — which
  triggers the Release workflow that publishes **5 npm packages** (root +
  shared/extension/server/web via `npm publish -ws --include-workspace-root`)
  and the Electron artifacts
  and creates a draft GitHub Release. Use when the user says "cut a
  release", "release vX.Y.Z", "publish a new version", "tag a release".
license: MIT
metadata:
  author: pi-dashboard
  version: "1.0"
---

# Cut a pi-agent-dashboard Release

Canonical reference: [`docs/release-process.md`](../../../docs/release-process.md).
This skill automates steps 1–5 of that doc but **stops before publishing
the draft GitHub Release** — the human always clicks Publish.

## Pre-flight (MUST pass before touching anything)

Run these in order. If any fails, **stop and report** — do not continue.

1. **Clean working tree**
   ```bash
   git status --porcelain
   ```
   Must be empty. If not, ask the user to commit or stash.

2. **On the release branch**
   ```bash
   git rev-parse --abbrev-ref HEAD
   ```
   Must be `develop` (this repo has no `main`). If elsewhere, ask user to
   confirm before continuing.

3. **Up to date with origin**
   ```bash
   git fetch origin && git status -sb
   ```
   Branch must NOT be "behind". If behind, ask user to pull first.

4. **Tests pass**
   ```bash
   npm test
   ```

5. **Build succeeds**
   ```bash
   npm run build
   ```

6. **Dependency-shape gate** (introduced by `enable-standalone-npm-install` to prevent regressions of v0.5.3 publish-time bugs)
   ```bash
   node scripts/verify-release-deps.mjs
   ```
   Asserts critical runtime deps (`jiti`, pinned `node-pty`, etc.) are still declared in the publishable workspace `package.json` files. Failure means the next published tarball would be broken — STOP and fix the workspace before cutting.

7. **Dispatch `ci-smoke.yml` against `develop`** (recommended; catches installer regressions BEFORE the tag exists)

   The release pipeline (`publish.yml`) gates `publish` on a `release-gate` that runs the full 7-leg standalone-install-smoke matrix. If that gate fails on `workflow_dispatch`, `tag-and-push` is skipped — clean abort, no commit, no tag. But on a `git push --tags` cut, the tag already exists when the gate fires; failure leaves a dangling tag requiring `release-revoke`.

   Operators SHOULD run the smoke matrix first against `develop`:

   ```bash
   gh workflow run ci-smoke.yml --ref develop
   gh run watch  # or open the Actions UI
   ```

   All 7 legs must be green before cutting. If any leg fails, fix the regression on `develop` first — do NOT cut a tag that you know will fail the gate. Skip this step only when the change since the last release is provably installer-irrelevant (no lockfile, bundle-server, native dep, or preload-fastify touch). See change: gate-publish-on-smoke-and-tests.

If any pre-flight step fails, stop and surface the exact error to the user.

## Step 1 — Read current state

```bash
git describe --tags --abbrev=0        # last tag, e.g. v0.2.9
node -p "require('./package.json').version"   # current pkg version
```

Confirm they match (e.g. tag `v0.2.9` ↔ pkg `0.2.9`). If they diverge,
surface the mismatch and ask the user how to proceed.

## Step 2 — Curate `## [Unreleased]`

1. List commits since last tag:
   ```bash
   git log <last-tag>..HEAD --oneline
   ```
2. Read `CHANGELOG.md` and extract the current `## [Unreleased]` section.
3. Cross-check: every `feat:` / `fix:` commit should have a corresponding
   user-visible bullet under Added / Changed / Fixed.
4. If gaps exist, **use AskUserQuestion** to list missing items and
   confirm whether the user wants to add them now. If yes, draft bullets
   in end-user language (not commit-subject shorthand) and insert them.
5. Never invent behaviour — only summarise what the commits actually did.

## Step 3 — Decide next version (SemVer)

Propose per this decision tree, then **use AskUserQuestion to confirm**:

| `## [Unreleased]` contains                         | Bump    |
|----------------------------------------------------|---------|
| Any breaking change / removal (call it out)        | major   |
| Any `### Added` bullet (new user-visible feature)  | minor   |
| Only `### Fixed` / `### Changed` internals         | patch   |

Current version `X.Y.Z` → propose `X.(Y+1).0` for minor, etc.
**Do NOT auto-select** — always ask the user to confirm the target version
(offer the proposal as default).

## Step 4 — Promote `## [Unreleased]` → versioned section

In `CHANGELOG.md`:

1. Rename `## [Unreleased]` to `## [<version>] - <YYYY-MM-DD>` (use
   today's date from `date +%Y-%m-%d`, no leading `v`).
2. Insert a fresh empty `## [Unreleased]` section **above** it:

   ```markdown
   ## [Unreleased]

   ### Added

   ### Changed

   ### Fixed

   ## [<version>] - <YYYY-MM-DD>
   ...existing bullets...
   ```

Verify afterwards with:
```bash
grep -n "^## " CHANGELOG.md | head
```

## Step 5 — Bump all workspace versions + sync inter-package dep specifiers

```bash
npm version <version> --workspaces --include-workspace-root --no-git-tag-version
node scripts/sync-versions.js
npm install --package-lock-only --no-audit --no-fund
```

The first command bumps the `version` field on the root + every workspace.
The second rewrites every inter-package `dependencies` specifier (e.g.
`"@blackbelt-technology/pi-dashboard-shared": "^<old>"`) to the new version.
The third regenerates `package-lock.json` so its recorded cross-ref
specifiers match the bumped versions — without it, strict prerelease
semver causes `npm ci` on consumers to fall back to stale registry
tarballs. The CI `prepare` job runs the same three commands; doing it
locally keeps the commit honest. See change: fix-release-lockfile-drift.

> **Why the second step?** The npm CLI does not implement the `workspace:`
> protocol (it's a pnpm/yarn feature). We use plain semver ranges and
> synchronise them at bump time so the published tarballs have consistent
> metadata. CI's `publish.yml` runs `sync-versions.js` defensively too, but
> running it locally keeps the commit honest.

Verify with:
```bash
git diff --stat package.json packages/*/package.json package-lock.json
```

Should show `version` bumps in `package.json` and every
`packages/*/package.json` plus synchronised `@blackbelt-technology/pi-dashboard-*`
dependency specifiers, plus a regenerated `package-lock.json`. No other files.

## Step 6 — Commit

```bash
git add CHANGELOG.md package.json package-lock.json packages/*/package.json
git commit -m "chore(release): v<version>"
```

**Use AskUserQuestion (confirm)** before committing — show the user the
exact message + file list.

## Step 7 — Tag and push

```bash
git tag v<version>
git push origin develop
git push origin v<version>
```

**Use AskUserQuestion (confirm)** before pushing. Surface this warning:
pushing the tag triggers the Release workflow immediately. Reverting
requires `git push --delete origin v<version>` + re-tag.

## Step 8 — Post-push instructions (print to user)

Give the user this summary:

```
✅ Tag v<version> pushed.

Next steps (human):
1. Watch CI:  https://github.com/BlackBeltTechnology/pi-agent-dashboard/actions
   The Release workflow will:
     • publish @blackbelt-technology/pi-dashboard to npm
     • build Electron installers (macOS DMG × 2 — Apple Silicon +
       Intel, Linux DEB+AppImage, Windows NSIS+ZIP+portable per arch)
     • create a DRAFT GitHub Release with artifacts attached
2. Open the draft release:
   https://github.com/BlackBeltTechnology/pi-agent-dashboard/releases
3. Verify the body (auto-extracted from CHANGELOG.md [<version>] section)
   and all 7 platform artifacts are attached:
     • PI-Dashboard-darwin-arm64-<ver>.dmg  (Apple Silicon)
     • PI-Dashboard-darwin-x64-<ver>.dmg    (Intel)
     • pi-dashboard_<ver>_amd64.deb         (Linux x64)
     • pi-dashboard_<ver>_arm64.deb         (Linux arm64)
     • PI-Dashboard-<ver>.AppImage          (Linux x64)
     • PI-Dashboard-<ver> Setup.exe + .zip + portable.exe (Windows x64)
     • .zip + portable.exe (Windows arm64)
4. Click "Publish release" — this fires `release: published` which
   triggers the Deploy Site workflow to redeploy GitHub Pages with the
   new download version.

If something is wrong, see `.pi/skills/release-revoke/SKILL.md`.
```

## Guardrails

- **Never skip pre-flight.** A failing test or dirty tree means the
  release is not ready.
- **Never auto-publish.** Stop at the draft release.
- **Never force-push a tag.** If the tag already exists on origin,
  surface the conflict and hand off to the revoke skill.
- **One version at a time.** If the user asks to release two versions
  in a row, run this skill twice.
- **Respect the checkpoint in `docs/release-process.md`** — human clicks
  Publish, not the skill.
