# Workflow Taxonomy

All 6 GitHub Actions workflows in `.github/workflows/`, what each does, when it fires, and what it can't do.

## Push-triggered

### `ci.yml` — main CI

| Field | Value |
|-------|-------|
| Triggers | `push` (any branch) |
| Jobs | `ci`, `standalone-install-smoke-linux` (matrix), `standalone-install-smoke-windows` (matrix) |
| Runs on | ubuntu-latest + matrix legs (Debian/Ubuntu/Alpine images for Linux, windows-latest) |

`ci` runs tests + lint + type-check + repo-lint tests. The smoke matrix exercises `pi install npm:@blackbelt-technology/pi-agent-dashboard` from a clean container/VM.

Smoke jobs verify:
- npm install resolves cleanly with the freshly-published packages
- Bridge starts, server bootstraps, `/api/health` responds
- No platform-specific regressions (Alpine musl, Windows path quirks, etc.)

### `deploy-site.yml` — site deploy

| Field | Value |
|-------|-------|
| Triggers | `push` on main, paths: `site/**` |
| Job | Build + deploy the marketing/docs site |

Lightweight. Only runs if site files changed. Failures here don't block code releases.

## Release flow (publish.yml + helpers)

### `publish.yml` — release orchestrator

| Field | Value |
|-------|-------|
| Triggers | `push` of tag `v*` **OR** `workflow_dispatch` with `version` input |
| Jobs | `prepare` → `publish` → `electron` → `github-release` |
| Permissions | `contents: write` on prepare; OIDC for publish |

Two entry paths:

1. **Tag push** (`v0.4.1` → workflow). `prepare` resolves the version from the tag, skips bump steps, jumps straight to publish.
2. **Dispatch** (operator types `0.4.1` in UI). `prepare` bumps every workspace package.json, runs `scripts/sync-versions.js`, regenerates lockfile, promotes `[Unreleased]` in CHANGELOG, commits + tags + pushes.

After `prepare`, both paths converge: publish → electron → github-release.

### `_electron-build.yml` — reusable Electron matrix

| Field | Value |
|-------|-------|
| Triggers | `workflow_call` only (never directly) |
| Jobs | 6-leg matrix: DMG (arm64+x64), AppImage, DEB, Windows ZIP, Windows portable .exe |
| Consumed by | `publish.yml` (release flow, `source_only_bundle=false`) and `ci-electron.yml` (on-demand, `source_only_bundle=true`) |

**Critical:** does NOT publish to npm or create a GitHub Release. Only produces artifacts via `actions/upload-artifact`. Publishing is the caller's job.

Inputs:
- `version`: SemVer string set via `npm version` on every workspace
- `ref`: Git ref to check out
- `legs`: Matrix subset (`all` / `darwin` / `linux` / `win32` / comma-list like `darwin-arm64,linux-x64`)
- `source_only_bundle`: If true, `bundle-server.mjs --source-only` skips host-side `npm install` and resolves `@blackbelt-technology/*` from local workspace source. Required for CI dev builds where the dispatched version isn't on npm.
- `artifact_retention_days`: 14 for CI, 90 for release.

### `sync-release-version.yml` — site cache updater

| Field | Value |
|-------|-------|
| Triggers | `release: { types: [published, edited] }` **OR** `workflow_dispatch` |
| Job | Writes `site/src/data/latest-release.json` with the latest release metadata and commits to develop |

After committing, `deploy-site.yml` picks up the change via its `paths: ["site/**"]` filter and redeploys.

## Manual-dispatch only

### `ci-electron.yml` — on-demand Electron smoke

| Field | Value |
|-------|-------|
| Triggers | `workflow_dispatch` only |
| Inputs | `legs` (matrix subset, default `all`) |
| Uses | `_electron-build.yml` with `source_only_bundle=true` |

**Purpose** — smoke-test that the full Electron matrix still builds green on a feature branch, WITHOUT publishing or creating a Release.

Use cases:
- Verify `bundle-server.mjs` / `forge.config.ts` changes without burning a SemVer slot
- Hand a teammate a one-off installer to reproduce a packaging bug
- Confirm matrix legs still green before cutting a release

**Safety invariants** (locked by repo-lint tests):
- No `npm publish`
- No GitHub Release (drafts, prereleases, or full)
- No tag push
- Version slug is a SemVer prerelease ranked **below** the base stable, so an accidental Release publish wouldn't reach electron-updater clients with `allowPrerelease: false`

Re-dispatching on the same branch cancels the prior run. Different branches run in parallel.

## Workflow dependency graph

```
                  ┌────────────┐
                  │  push tag  │
                  │    v*      │
                  └─────┬──────┘
                        │
              ┌─────────┴──────────┐
              ▼                    ▼
      ┌──────────────┐   ┌─────────────────┐
      │  publish.yml │   │ ci.yml (always) │
      └──────┬───────┘   └─────────────────┘
             │
       ┌─────┴──────┐
       │ prepare    │
       └─────┬──────┘
             │
       ┌─────┴──────┐
       │ publish    │
       └─────┬──────┘
             │
       ┌─────┴───────────────────┐
       │ electron                │
       │ (calls _electron-build) │
       └─────┬───────────────────┘
             │
       ┌─────┴──────────┐
       │ github-release │
       └─────┬──────────┘
             │
             ▼ (release event)
   ┌────────────────────────┐
   │ sync-release-version.yml│
   └─────┬──────────────────┘
         │ (commits site/**)
         ▼
   ┌─────────────────┐
   │ deploy-site.yml │
   └─────────────────┘
```

## Quick "where is X configured" cheatsheet

| Question | Workflow |
|----------|----------|
| Which Node versions are tested? | `ci.yml` matrix.node-version |
| Which Linux distros are smoked? | `ci.yml` matrix.image |
| Which Windows is tested? | `ci.yml` standalone-install-smoke-windows |
| What npm packages publish? | `publish.yml` publish job (sub-packages first, root last) |
| Which Electron platforms build? | `_electron-build.yml` matrix (6 legs) |
| How is the site updated after release? | `sync-release-version.yml` + `deploy-site.yml` |
| Can I test the Electron matrix without releasing? | `ci-electron.yml` (workflow_dispatch) |
