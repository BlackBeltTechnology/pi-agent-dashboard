## 1. Build pipeline

- [x] 1.1 Bump bundled Node.js v22.12.0 → v22.18.0 in `download-node.sh`, `build-installer.sh`, `build-windows-zip.sh`, `docker-make.sh`, `.github/workflows/publish.yml`. Avoids nodejs/node#58515 Fastify-startup crash.
- [x] 1.2 Create `packages/electron/scripts/build-windows-zip.sh` — local Windows ZIP path (no Docker, no NSIS, no portable). Steps: web client → bundle-server → download Node → bundle-offline-packages → forge package → zip.
- [x] 1.3 Use lossless extractor (`ditto` on macOS, `7z` on Linux, `unzip` + file-count-check fallback) for the Windows Node.js zip. Bash `unzip` was silently dropping nested files.
- [x] 1.4 Sanity check after extraction: assert `minizlib/dist/commonjs/package.json` exists. Fail build with actionable error if missing.
- [x] 1.5 `bundle-offline-packages.mjs` uses bundled npm when target OS matches host (cache built with same npm version that runtime uses).
- [x] 1.6 Add `--windows-zip` flag to `build-installer.sh` (Docker path) threading `ZIP_ONLY=1` into `docker-make.sh` to skip portable-exe step.
- [x] 1.7 Add npm scripts: `electron:zip-windows`, `electron:zip-windows-docker`, `electron:bundle-server`, `electron:bundle-server:source-only`.

## 2. Wizard install reliability

- [x] 2.1 In `dependency-installer.ts::resolveNpm()`, probe `<node> <npm-cli> --version` (5s timeout) before committing to managed npm; fall back to bundled if probe fails.
- [x] 2.2 In `installStandalone`, catch offline-install failures and retry via registry install path. Reset per-package UI rows to "running" with `Falling back to registry…` message.
- [x] 2.3 Switch `buildOfflineInstallArgs` from `--offline` to `--prefer-offline` so cache misses fall back to network instead of hard-failing.
- [x] 2.4 Pre-clone git-source recommended extensions with `spawn("git", ["clone", url, dest])` (no shell) before pi's `DefaultPackageManager.installAndPersist()` runs. Bypasses pi's broken shell-quoting on paths with spaces.
- [x] 2.5 In `installRecommendedExtensions`, augment `process.env.PATH` with bundled/managed node bin dir for the duration of the install loop. Restore after loop.
- [x] 2.6 In `runNpmWithArgv`, extract `npm error` / `npm ERR!` lines from stderr and surface them as the rejected error message instead of the truncated last-500-chars footer.

## 3. Wizard UX

- [x] 3.1 Add `node runtime` row to the standalone-install progress list (`wizard.html`). `installManagedNode` emits progress under step id `node-runtime`; UI now has a row to display it during the 10–30 s file copy.
- [x] 3.2 In `runOfflineInstall`, fan out `running`/`done`/`error` events to each package step id (matching wizard UI rows) instead of only emitting under `offline-cache` / `offline-install` ids that no UI row consumes.

## 4. Window state

- [x] 4.1 In `window-state.ts::loadWindowState()`, clamp saved coords to displays' `workArea`. If no display has at least 50×50 of the window visible, drop x/y to fall back to centered default.

## 5. Tested manually on Windows test machine

- [x] 5.1 Wizard: dependency install completes (`pi-coding-agent`, `openspec`, `tsx`).
- [x] 5.2 Wizard: recommended extensions install (after PATH augmentation fix).
- [x] 5.3 Dashboard window opens after wizard completes (manually verified via `set PATH=...; pi-dashboard.exe` workaround equivalent to the committed PATH-augmentation fix).
- [x] 5.4 Server starts and serves the dashboard at http://localhost:8000.
