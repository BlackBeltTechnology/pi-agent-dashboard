# Electron Immutable Bundle

Architectural invariant: Electron app bundle read-only at runtime. No code under `<resourcesPath>/` mutates after install. No `npm install` ever runs after the app ships.

## Path layout

```
<resourcesPath>/
  node/
    bin/node               # POSIX
    node.exe               # Windows
  server/
    node_modules/
      @blackbelt-technology/pi-dashboard-server/
        src/cli.ts         # server entry
      @earendil-works/pi-coding-agent/   # pi
      @fission-ai/openspec/              # openspec
      tsx/                                # ts loader
      fastify/  ws/  node-pty/  jiti/  ...
```

pi / openspec / tsx ship as regular `dependencies` of `@blackbelt-technology/pi-dashboard-server`. `bundle-server.mjs` runs `npm install --omit=dev` at build time. Result copied into `<resourcesPath>/server/node_modules/`. Read-only thereafter.

## Update path

electron-updater replaces the whole `.app` / `.exe` / `.AppImage`. No in-app installer. No partial updates. No file writes into bundle.

Standalone (`npm i -g`) arm and bridge arm keep the pi-core update endpoint for in-place pi-core upgrades. Electron arm hides that UI: `useLaunchSource()` returns `"electron"` → `UnifiedPackagesSection` skips Core sub-group + `App.tsx` skips `<PiUpdateBadge />`.

## Legacy `~/.pi-dashboard/`

Pre-R3 builds installed pi/openspec/tsx into `~/.pi-dashboard/node_modules/` at runtime. R3 leaves that dir untouched. `detectLegacyManagedDir({ homedir })` in `packages/shared/src/legacy-managed-dir.ts` returns `{present:true, path, pkgCount, sizeMb}` when detected; Doctor surfaces a warning-severity advisory ("Legacy install directory"). Server CLI logs the path once at startup. Safe to delete manually (`rm -rf ~/.pi-dashboard`).

## Bundle guardrails

- `packages/electron/scripts/bundle-server.mjs` Phase 1 GO/NO-GO: asserts `node-pty/prebuilds/{darwin-arm64,darwin-x64,linux-x64,win32-x64}/` exist after `npm install --omit=dev`. Build fails loudly on missing prebuilds.
- `scripts/verify-release-deps.mjs` blocks release if pi/openspec/tsx/node-pty/jiti regress below pinned floor.
- Repo-lint `packages/shared/src/__tests__/no-managed-dir-reference.test.ts` walks `packages/electron/src/lib/`, `packages/server/src/`, `packages/shared/src/`. Fails when a file references `.pi-dashboard` outside the explicit allowlist (detector + read-only probes + standalone-arm-only pi-core update writes).

## What broke before R3

Pre-R3 Electron ran first-run `npm install` from offline cacache into `~/.pi-dashboard/`. Failure modes: GCM hang on Windows (private repos), AppImage path collision, jiti version skew across system vs. managed pi, stale managed-dir under app version bump, offline-cacache SHA-256 mismatches, recursive bridge auto-start during install, version-marker stale-cache cascades.

R3 deletes the whole pyramid: no installable list, no list-driven reconcile, no preflight reconcile step, no reinstall affordance, no bundle-extract step, no offline-packages bundle, no managed-package allowlist, no bootstrap REST routes, no bootstrap banner, no bootstrap-status client hook.

## Regression rules

- Any new `npm install` / `fs.writeFile` / `fs.cp` writing into `<resourcesPath>/` is a violation. Use electron-updater.
- Any new write into `~/.pi-dashboard/` from `packages/electron/` or `packages/server/` requires entry on `no-managed-dir-reference.test.ts` allowlist with explicit rationale.
- Any reintroduction of an installable list, runtime bootstrap-install pyramid, bootstrap-state store, bootstrap banner, or bootstrap-status client hook blocks release.
