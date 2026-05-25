# Tasks

## 1. Source scripts

- [ ] 1.1 Create `packages/electron/scripts/server-launch-helpers/start-server.cmd` with the content below. Pattern: resolve `%~dp0` → server dir; bundled node at `%~dp0..\node\node.exe`; jiti URL built from `%~dp0node_modules\jiti\lib\jiti-register.mjs` with `\` → `/`; entry passed as raw Windows path; `%*` passes extra args through.
- [ ] 1.2 Create `packages/electron/scripts/server-launch-helpers/start-server.ps1` mirroring 1.1 via `$PSScriptRoot`. `$ErrorActionPreference = 'Stop'`.
- [ ] 1.3 Create `packages/electron/scripts/server-launch-helpers/start-server.sh` (POSIX bash). Uses `cd "$(dirname "$0")"`; bundled node at `../node/bin/node` (Linux/macOS layout); jiti URL via `printf 'file://%s' "$jiti_path"`. `set -euo pipefail`.
- [ ] 1.4 Add `#!/usr/bin/env bash` shebang to the .sh file. Mark executable in repo via `chmod +x` + commit (jj will preserve the bit).

## 2. Hook into bundle-server.mjs

- [ ] 2.1 After the synthetic `package.json` write (around line 167) and BEFORE the source-only short-circuit (around line 227), `cpSync` the three helpers from `packages/electron/scripts/server-launch-helpers/` into `<SERVER_BUNDLE>/`.
- [ ] 2.2 On POSIX hosts (`process.platform !== "win32"`), `chmodSync` the bundled `.sh` to `0o755` to preserve the executable bit (forge-packager's `cpSync` defaults strip it on some host filesystems).
- [ ] 2.3 Log a one-line `console.log("  Bundled 3 launch helper(s) into server bundle root")`. Matches existing log style.

## 3. Extend CI assertion (light gate)

- [ ] 3.1 Update `packages/electron/scripts/assert-runnable-bundle.mjs` to also assert:
  - `packages/electron/resources/server/start-server.cmd` (always present — Windows users may still use the file even from a Linux-built artefact in odd workflows; harmless on non-Windows).
  - `packages/electron/resources/server/start-server.ps1` (always).
  - `packages/electron/resources/server/start-server.sh` (always).
- [ ] 3.2 Existing assertions (cli.ts + package.json under `node_modules/@blackbelt-technology/pi-dashboard-server/`) stay unchanged.
- [ ] 3.3 Failure message names the missing helper path AND the change name `add-bundle-manual-launch-scripts`.

## 4. Tests

- [ ] 4.1 Add `packages/electron/scripts/__tests__/launch-helpers.test.mjs` (vitest or node:test) that:
  - Spawns `start-server.sh --help` (or whatever no-server-spinup probe `cli.ts` supports) on POSIX hosts, asserts exit 0 within 5 s.
  - On Windows hosts, spawns `start-server.cmd --help`. Skipped on POSIX.
  - The test runs against the BUILT bundle, not the source scripts, so it requires `bundle-server.mjs` to have produced `packages/electron/resources/server/`. Skip-with-message when that dir is absent (don't fail CI legs that don't run the bundle step first).
- [ ] 4.2 Lockfile test (no shell): `packages/shared/src/__tests__/launch-helper-shape.test.ts` reads the three source files and pins:
  - Each one contains the substring `--import` and `jiti-register.mjs` (smoke).
  - The `.cmd` file does NOT contain `\\` backslash inside a quoted URL (catches a common authoring regression).
  - The `.sh` file starts with `#!/usr/bin/env bash` and contains `set -euo pipefail`.

## 5. Documentation

- [ ] 5.1 Delegate `docs/file-index-skills-misc.md` (where workflow + ops scripts live) update to a general-purpose subagent: add a row for `packages/electron/scripts/server-launch-helpers/` describing the three scripts in caveman style.
- [ ] 5.2 Update `packages/electron/scripts/server-launch-helpers/README.md` (new file) with: purpose, usage on each OS, what argv it builds, link to `node-spawn.ts::buildNodeImportArgvParts` as the upstream contract. ~20 lines.

## 6. Validate

- [ ] 6.1 Locally: `node packages/electron/scripts/bundle-server.mjs` (or `--source-only` on a non-build machine), then confirm `packages/electron/resources/server/start-server.{cmd,ps1,sh}` exists.
- [ ] 6.2 On POSIX: run `bash packages/electron/resources/server/start-server.sh status` — should print server status (likely "not running") and exit cleanly.
- [ ] 6.3 Dispatch `ci-electron.yml` with `legs: win32-x64`. Download the artifact, unzip on Windows, double-click `start-server.cmd` — server window opens and stays open until Ctrl+C. `/api/health` returns 200.
- [ ] 6.4 Same on `legs: linux-x64` (download AppImage, extract via `--appimage-extract`, run `squashfs-root/resources/server/start-server.sh`).
