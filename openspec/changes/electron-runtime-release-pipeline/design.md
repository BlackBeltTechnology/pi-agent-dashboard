## Context

Consumer side (change `electron-runtime-overlay-updates`, design D1/D5) expects: `runtime-lock.json` inside `pi-dashboard-server@X`; npm `beta` dist-tag for prereleases; a GitHub Release `vX` with `pi-dashboard-runtime-<X>-<platform>-<arch>.tgz` + `.sha512` (`githubAssetName` in `packages/server/src/runtime-overlay/runtime-io.ts`). Publishing uses `.github/workflows/publish.yml`: per-package idempotent loop, npm Trusted Publisher (OIDC), sub-packages first, root metapackage last.

## Goals / Non-Goals

- Goal: every release X is installable by the overlay stager from npm and GitHub.
- Goal: a release with an unpublished bundled plugin fails loudly instead of shipping an uninstallable lock.
- Non-goal: changing consumer behaviour, the whole-app `electron-updater` path, or Standalone installs.

## Decisions

### R1. Lock generation
Generate from `packages/server/package.json#piDashboard.bundledPlugins` (via `readBundledPluginIds`) plus the fixed runtime package set, all at X, into a temp root; `npm install --package-lock-only`; copy the lock into the server package before `npm publish`. `packages/server` depends on only one plugin, so every plugin is listed explicitly.

### R2. Ordering
publish packages → registry gate (`npm view <name>@X version`, retry for propagation) → attach lock-dependent artifacts (GitHub asset) → mark release ready. The lock itself rides in the server tarball, so the gate must also fail the release before it is marked ready / promoted to `latest`/`beta`.
- Open: the lock is inside the server tarball published in step 1; a gate failure after that leaves a published server@X with a lock naming a missing plugin. Mitigation to decide in review: publish server with `--tag staging` and move `latest`/`beta` only after the gate passes.

### R3. GitHub asset
Built per platform/arch in the Electron release matrix by running the consumer's own install path (`npm ci --omit=dev` from the lock + plugin materialization), tarred, sha512 written alongside. Spike 1.1 decides whether one platform-independent asset suffices.

## Risks / Trade-offs

- Registry propagation delay → retries with backoff, bounded.
- npm versions are immutable → the gate must run before dist-tags move (R2 open item).

## Open Questions

1. GitHub asset shape (spike 1.1, moved from `electron-runtime-overlay-updates` open question 1). Interim: one asset per platform/arch.
2. R2 dist-tag staging vs direct publish.
