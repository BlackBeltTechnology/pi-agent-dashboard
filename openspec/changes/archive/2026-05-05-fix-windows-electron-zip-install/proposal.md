## Why

A series of test runs of the Windows Electron ZIP build (PI-Dashboard-win32-x64) revealed five distinct first-run blockers that prevented installation on a clean Windows machine, including one with a non-ASCII / spaced username (`Róbert Csákány`). Each blocker manifested as a different failure mode (silent hang, dead-end error, off-screen window, broken npm, broken git clone), but the user-visible result was the same: the wizard never completes and the dashboard never starts.

This change captures the reactive bug fixes that landed during that test session so the build pipeline produces a working ZIP and the wizard recovers gracefully from each remaining failure mode.

## What Changes

### Build pipeline (`packages/electron/scripts/`)
- **New `build-windows-zip.sh`** — local Windows ZIP build path that mirrors what CI does without needing Docker. Steps: web client build → `bundle-server.mjs` → download Windows Node.js into `resources/node/` → `bundle-offline-packages.mjs` → `electron-forge package` → zip.
- **Lossless extractor** — `build-windows-zip.sh` uses `ditto` (macOS) or `7z` (Linux) to extract the Windows Node.js zip. Bash `unzip` was silently dropping nested files inside `node_modules/npm/` (specifically `minizlib/node_modules/minipass/dist/commonjs/`), causing `class extends value undefined` crashes on every `npm install` post-extraction.
- **Post-extraction sanity check** — explicitly verifies `minizlib/dist/commonjs/package.json` exists before bundling. Build fails loudly instead of producing a broken ZIP.
- **Bump bundled Node.js v22.12.0 → v22.18.0** in `build-installer.sh`, `build-windows-zip.sh`, `docker-make.sh`, `download-node.sh`, and `.github/workflows/publish.yml`. v22.12.0 has nodejs/node#58515 — Fastify crashes immediately at server startup. v22.18.0 is the smallest LTS that fixes it.
- **`bundle-offline-packages.mjs` uses bundled npm** (when target platform matches host) so the offline cache is built with the same npm version (10.9.3 from v22.18.0) that the runtime install will use, avoiding cache-key mismatches.
- **Offline install uses `--prefer-offline`** instead of `--offline`, so cache misses (npm version drift, missing transitive deps) fall back to the registry instead of hard-failing.
- **New `--windows-zip` flag** in `build-installer.sh` and corresponding `electron:zip-windows-docker` npm script: builds Windows ZIP only via Docker, threading `ZIP_ONLY=1` into `docker-make.sh` to skip the NSIS + portable-exe steps.

### Wizard reliability (`packages/electron/src/lib/`)
- **Pre-clone git extensions with discrete argv** to bypass pi's `DefaultPackageManager.installAndPersist()` shelling `git clone <url> <dest>` without quoting `<dest>`. Spaces in destination paths (Windows usernames containing spaces) fail with `git: Too many arguments`. Pre-cloning ourselves with `spawn("git", ["clone", url, dest])` (no shell) makes pi's manager skip its broken clone since the directory already exists.
- **Augment `process.env.PATH` for recommended-extensions install** so pi's manager (which inherits parent env, no override hook) finds bundled npm. Restored after the loop to avoid leakage.
- **Fitness-based npm resolution** — `resolveNpm()` probes `<managed-node> <managed-npm-cli> --version` before committing to managed; falls back to bundled if probe fails (e.g. partial cpSync, MAX_PATH issue, AV interference).
- **Offline install fallback to registry** — `installStandalone()` catches offline-install failures and retries via the registry path so users aren't dead-ended by cache-related issues.
- **Surface real npm errors** — extract `npm error` / `npm ERR!` lines from stderr instead of forwarding the truncated last-500-chars footer ("complete log of this run can be found in: ..."). Lets the user see what actually failed.

### Wizard UX (`packages/electron/src/renderer/wizard.html`)
- **`node runtime` row prepended** to the standalone-install progress list. The first 10–30 s of `installManagedNode` (copying ~hundreds of node_modules files into `~/.pi-dashboard/node/`) emits progress under step id `node-runtime`, but no UI element existed for it — users saw three empty circles and assumed the wizard was frozen.
- **Per-package fanout** in `runOfflineInstall` — emits `running`/`done`/`error` events for each pinned package id (`pi-coding-agent`, `openspec`, `tsx`) so the matching UI rows update during the single npm install. Previously emitted only under `offline-cache` / `offline-install` step ids that didn't match any UI row.

### Window state (`packages/electron/src/lib/window-state.ts`)
- **Bounds clamping** against `screen.getAllDisplays()`. If saved `x`/`y` coords land outside every connected display (e.g. user moved the install across machines / monitor layouts), drop them and fall back to centered default. Previously the dashboard window opened off-screen with no way to recover except deleting `window-state.json` manually.

## Impact

Affected code:
- `packages/electron/scripts/build-installer.sh` — `--windows-zip` flag, `ZIP_ONLY` env-var threading, Node version bump.
- `packages/electron/scripts/build-windows-zip.sh` (new) — local Windows ZIP path with lossless extractor and sanity check.
- `packages/electron/scripts/bundle-offline-packages.mjs` — prefers bundled npm when target=host.
- `packages/electron/scripts/docker-make.sh` — `ZIP_ONLY` skip-portable, Node version bump.
- `packages/electron/scripts/download-node.sh` — Node version bump.
- `packages/electron/src/lib/dependency-installer.ts` — fitness-based npm resolution, registry fallback, pre-clone helper, PATH augmentation, real npm error surface.
- `packages/electron/src/lib/offline-packages.ts` — `--offline` → `--prefer-offline`.
- `packages/electron/src/lib/window-state.ts` — display bounds clamping.
- `packages/electron/src/renderer/wizard.html` — node-runtime row + per-package fanout.
- `.github/workflows/publish.yml` — bundled Node version bump (v22.18.0).
- `package.json` — new npm scripts: `electron:zip-windows`, `electron:zip-windows-docker`, `electron:bundle-server`, `electron:bundle-server:source-only`.

No protocol or API changes. No new dependencies. All fixes are additive (older / non-affected code paths still work).
