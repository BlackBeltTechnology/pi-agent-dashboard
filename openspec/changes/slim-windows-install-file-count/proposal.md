## Why

The Windows NSIS `PI-Dashboard-Setup-<v>-<arch>.exe` installs very slowly. The cause is how
many files it writes, not how many bytes. Measured on the v0.11.0 `PI-Dashboard-win32-x64.zip`
(same tree the Setup.exe extracts), read from the zip central directory:

- **42,298 files, ~1,000 MB unpacked.** The Setup.exe is 279 MB compressed.
- Each new file on NTFS pays a create/close cost plus a Microsoft Defender real-time scan. With
  tens of thousands of small files, that per-file cost is most of the install time; decompressing
  the 7z archive is minor.

Where the files come from (top buckets):

| Files | Size | Path under `resources/` |
|---|---|---|
| 8,655 | 55 MB | `server/node_modules/@jimp` |
| 5,249 | 24 MB | `server/node_modules/@earendil-works` |
| 2,966 | 44 MB | `server/node_modules/@blackbelt-technology` |
| 2,965 | 44 MB | `server/packages` (the same workspace trees a second time) |
| 1,980 | 12 MB | `node/node_modules` (npm bundled with Node) |
| ~4,200 | — | files under `test/`, `tests/`, `docs/`, `example(s)/` directories |
| ~1,850 / ~5,050 | 5 / 13 MB | `*.md` / `*.d.mts` + `*.d.cts` |

Two things in `packages/electron/scripts/bundle-server.mjs` cause avoidable bulk:

1. **The `node_modules` prune misses most cruft.** It skips the first-party workspace trees and
   misses `*.d.mts`/`*.d.cts` and `tests` directories. `docker-make.sh` (the Docker cross-build)
   does not run that prune at all.
2. **Workspace packages ship twice.** Materialization copies each `packages/<dir>` into
   `node_modules/@blackbelt-technology/<pkg>`, and `packages/<dir>` stays too. The app's launch and
   every overlay path already use the `node_modules` copy. The bundled-extension path, doctor, the manual
   launch helpers, one CI gate, the bridge's relative server fallback and several test scripts still
   read `packages/<dir>` (full list in `design.md`).

Applying this change's rules to the v0.11.0 file list removes an estimated **10,635 files (25.1%)**
(see `design.md`).

## What Changes

- **Baseline:** the win32-x64 NSIS smoke step times the silent install (`Setup.exe /S`). It reports
  the time, the installed file count and the runner image in the job summary. It is informational
  and never fails the job.
- **One shared helper, run last.** `scripts/lib/prune-bundle.mjs` is used by `bundle-server.mjs`,
  `docker-make.sh` and `build-windows-zip.sh`.
  - Third-party packages: prune `*.d.mts`/`*.d.cts` and `tests` directories in addition to the
    current rules, guarded so that no directory containing a `package.json` is ever removed.
  - First-party packages (`@blackbelt-technology/*`, `resources/plugins/*`): prune only `AGENTS.md`
    sidecars (outside `.pi/`) and `__tests__`.
    Skills, commands and licences are kept.
- **The `node_modules` copy is canonical.** `resources/server/packages/<dir>` is deleted after
  install and materialization; `packages/dist` stays. The synthetic `package.json` drops its
  `workspaces` field after install, and the local `build-windows-zip.sh` drops its post-bundle
  `npm install`. The
  remaining readers move to the `node_modules` path. A stale persisted `…/server/packages/extension`
  registration is already dropped by the existing `registerBridgeExtension` cleanup; a new test pins
  that.
- **File-count budget gate** on every Electron leg: `assert-bundle-file-budget.mjs`, with
  per-leg budgets set to the measured post-change count + 5%. A leg with no pinned budget reports
  only. Success is measured by file count; install time is reported as directional evidence.
- **Not in scope (follow-ups):** an esbuild single-file bundle; replacing `jimp`; first-launch
  archive extraction; pruning `docs`/`examples`; pruning the runtime-overlay tarball (staged
  separately by `runtime-stager.ts`).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `electron-build-pipeline`: MODIFIES "Bundled dashboard server ships the pi runtime" (final layout:
  workspace source only under `node_modules`). ADDS the post-materialization prune, the packaged
  file-count budget gate and Windows install timing.
- `electron-runtime-overlay`: the bundled runtime's extension directory moves to
  `node_modules/@blackbelt-technology/pi-dashboard-extension`, and a stale registration is reconciled.

## Impact

- Bundling: `packages/electron/scripts/bundle-server.mjs`, `docker-make.sh`, `build-windows-zip.sh`,
  and the new `scripts/lib/prune-bundle.mjs`.
- Repointed readers:
  - `src/lib/runtime-overlay.ts` (`extensionPathFor`), `src/lib/bridge-register.ts`, `src/lib/doctor.ts`;
  - `packages/extension/src/server-launcher.ts` (relative fallback);
  - `scripts/server-launch-helpers/*`, `assert-bundled-server-plugin-load.mjs`;
  - `test-server-launch.sh`, `test-electron-install.sh`, `test-deb-install-inner.sh`;
  - `launch-source.test.ts`, `tests/e2e-electron/runtime-overlay-update.electron.spec.ts`;
  - the `qa/tests/*` files that target a bundle.
- New `scripts/assert-bundle-file-budget.mjs`. `_electron-build.yml` gets the budget step on every
  leg and the timing in the win32-x64 NSIS smoke step.
- **Compatibility:**
  - the bundled runtime ships with its own shell;
  - overlays already use the `node_modules` layout;
  - the release-lock audit runs before workspace deletion;
  - the persisted extension path is reconciled by the existing name-identity cleanup;
  - the runtime-overlay tarball is unchanged.
- **Rollback:** revert. The reverted shell re-registers `packages/extension`, and the
  `node_modules` entry is dropped by name-identity dedup.

## Discipline Skills

- `performance-optimization`: measure first (the baseline install timing is task 1) and verify
  the gain against that same measurement.
- `doubt-driven-review`: D2 changes the packaged layout and migrates a persisted extension path
  (an irreversible upgrade step). Review it before it stands.
