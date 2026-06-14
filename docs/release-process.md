# Release Process

How-to for cutting pi-agent-dashboard release.
Goal: **low-friction, human-curated release notes** — no generator
tooling; discipline during dev + curation pass at tag time.

## Overview

```
 ┌────────────────┐     ┌────────────────┐     ┌────────────────┐
 │  Development   │ ──▶ │   Cut release  │ ──▶ │   CI publishes │
 │                │     │                │     │                │
 │  PR appends    │     │  Promote       │     │  npm +         │
 │  bullets to    │     │  [Unreleased]  │     │  Electron      │
 │  [Unreleased]  │     │  bump + tag    │     │  GitHub Release│
 └────────────────┘     └────────────────┘     └────────────────┘
```

Single source of truth: [`CHANGELOG.md`](../CHANGELOG.md). GitHub Release
body **extracted automatically** from matching section at tag time.

## Commit Conventions

[Conventional Commits](https://www.conventionalcommits.org/) prefixes,
enforced **by code review only** (no commit lint, no husky hooks).

| Prefix      | Meaning                                          |
|-------------|--------------------------------------------------|
| `feat:`     | User-visible new capability                      |
| `fix:`      | Bug fix                                          |
| `refactor:` | Internal restructure, no behaviour change        |
| `docs:`     | Docs-only changes                                |
| `test:`     | Test-only changes                                |
| `chore:`    | Dependency bumps, tooling, version bumps         |
| `ci:`       | CI / release workflow changes                    |

Optional scopes in parens encouraged (`feat(error-banner): …`).

## During Development

PR ships user-visible behaviour → **add bullet** under matching subsection
of `## [Unreleased]` in `CHANGELOG.md`:

```markdown
## [Unreleased]

### Added
- Drop-and-paste screenshots directly into the OpenSpec explore dialog.

### Changed

### Fixed
- Fork entryId timing: leaf registry now resolves the parent message correctly.
```

Bullets in **end-user language**, not commit-subject shorthand. Link to
relevant docs when helpful. Missing bullet does **not** block PR —
release author back-fills during curation.

## Cutting a Release

### 1. Curate `Unreleased`

- Review `git log <last-tag>..HEAD`; confirm every user-visible change has
  bullet under `## [Unreleased]`.
- Add anything contributors missed.
- Tighten wording. Reorder for impact.
- Pick next version per SemVer: feature additions → minor, bug fixes only
  → patch, breaking changes → major.

### 2. Promote `Unreleased` → versioned section

In `CHANGELOG.md`:

1. Rename `## [Unreleased]` → `## [<version>] - <YYYY-MM-DD>` (today, no
   leading `v`).
2. Insert fresh empty `## [Unreleased]` section **above** it:

   ```markdown
   ## [Unreleased]

   ### Added

   ### Changed

   ### Fixed

   ## [<version>] - <YYYY-MM-DD>
   ...
   ```

### 3. Bump workspace versions

```bash
npm version <version> --workspaces --include-workspace-root --no-git-tag-version
node scripts/sync-versions.js
```

First command updates `version` in `package.json` + every workspace under
`packages/*` in single edit. Second (`sync-versions.js`) rewrites every
inter-package dependency specifier (e.g.
`"@blackbelt-technology/pi-dashboard-shared": "^<old>"`) to bumped
version. Without it, published root declares `"pi-dashboard-server":
"^<old>"` while actual server tarball `^<new>` — inconsistent registry
metadata.

Verify: `git diff package.json packages/*/package.json` — expected:
lockstep `version` bumps + synchronised inter-package dep specifiers.

> Why separate script? npm CLI does not implement `workspace:` protocol
> (pnpm/yarn-only). Use plain semver ranges (`"^0.3.0"`) + sync at bump
> time. CI also runs `sync-versions.js` defensively in `publish.yml`
> after `npm version`, so forgotten local invocation does not corrupt
> release.

### 4. Commit

```bash
git add CHANGELOG.md package.json package-lock.json packages/*/package.json
git commit -m "chore(release): v<version>"
```

### 5. Tag and push

```bash
git tag v<version>
git push origin develop
git push origin v<version>
```

Tag push triggers `.github/workflows/publish.yml`.

## What CI Does

On `v*` tag push, `publish.yml`:

1. **`publish` job** — publishes **five npm packages** in one invocation
   of `npm publish --workspaces --include-workspace-root --provenance
   --access public`:
   - `@blackbelt-technology/pi-agent-dashboard` (root metapackage)
   - `@blackbelt-technology/pi-dashboard-shared`
   - `@blackbelt-technology/pi-dashboard-extension`
   - `@blackbelt-technology/pi-dashboard-server`
   - `@blackbelt-technology/pi-dashboard-web`

   Job runs `node scripts/sync-versions.js` between `npm version` +
   `npm run build` so inter-package dep specifiers match bumped version
   even if release author forgot local invocation.

   `packages/electron` marked `"private": true`, auto-skipped by
   `npm publish --workspaces`; ships as native installers via Electron
   job.

2. **`electron` job (matrix)** — builds DMG (macOS arm64), DEB + AppImage
   (Linux x64 + arm64), NSIS `Setup.exe` + ZIP (Windows x64 + arm64).
   Per-user NSIS artifact `PI-Dashboard-Setup-<version>-<arch>.exe`; portable
   `.exe` dropped; `.zip` unchanged. appId `hu.blackbelt.pi-dashboard`
   immutable after first NSIS release — changing it strands installed users
   on the old Add/Remove Programs entry.
3. **`github-release` job** —
   - Extracts `## [<version>]` section from `CHANGELOG.md` →
     `release-notes.md`.
   - Extraction fails / returns empty → writes one-line fallback body
     pointing at `CHANGELOG.md`, logs warning.
   - Calls `softprops/action-gh-release@v2` with
     `body_path: release-notes.md`, `draft: true`, all Electron artifacts
     attached.

Release lands as **draft** — nothing published until *Publish* clicked on
GitHub Releases page.

## Manual Fallback

Auto-extracted body rendered incorrectly (missing section, wrong version,
truncated bullets) → fix before publishing:

1. Open draft release on GitHub.
2. Replace body with correct content from `CHANGELOG.md`.
3. Click *Publish release*.

Worst case (no release at all, wrong artifacts) → delete tag, fix, re-push:

```bash
git push --delete origin v<version>
git tag --delete v<version>
# fix the issue, bump if needed
git tag v<version>
git push origin v<version>
```

## After Publishing

- Announce in project channels (Discord, X, etc. — if/when exist).
- Monitor GitHub Issues for install/upgrade regressions.
- Leave `## [Unreleased]` empty-but-present so next contributor has
  obvious target.
