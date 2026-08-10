# installation-windows.md — index

Pull-only condensed map. Source: docs/installation-windows.md.

## Overview
Two install paths: (1) Electron Setup.exe (per-user NSIS, bundled Node+npm, Start Menu, uninstaller; .zip secondary); (2) tarball/npm (advanced, pre-release/headless). Runtime layout shared: agent runtime → `%USERPROFILE%\.pi-dashboard\node_modules\`; config/logs/sessions → `%USERPROFILE%\.pi\dashboard\` + `.pi\agent\sessions\`.

## Path 1 — Electron Setup.exe (recommended)
- Step 1 Download — `PI-Dashboard-Setup-<version>-<arch>.exe` (NSIS per-user, default `%LOCALAPPDATA%\Programs\PI Dashboard\`, no admin/UAC/HKLM, x64+arm64) or `PI-Dashboard-win32-x64.zip` (extract-and-run). Built windows-latest `electron-builder --win nsis`.
- Step 2 Launch — Start Menu or `pi-dashboard.exe`. Splash <1s, phases (Starting/Checking server/Detecting pi/Bridge/Wizard/Launching/Opening). Stalls logged to `%TEMP%\pi-dashboard-electron.log`.
- Step 3 First-run wizard — installs `@earendil-works/pi-coding-agent`+`tsx` into `.pi-dashboard\node_modules\` via bundled Node+npm. Node download skipped (bundled). openspec/tsx skipped if on PATH. Bundled Node sidesteps `spawn("npm")` ENOENT.
  - First-run offline (air-gapped/proxy) — release builds ship npm cacache `resources/offline-packages/` (pi-coding-agent/openspec/tsx+transitive). Extracts to `.pi-dashboard\.offline-cache\`, ONE `npm install --offline`, deletes cache (~140MB). Pins in `packages/electron/offline-packages.json`. Missing/SHA-256 mismatch → wizard aborts (deterministic, no registry fallback). `spawn npm ENOENT` → build predates `29af651`.
- Step 4 Configure provider — dashboard at http://localhost:8000. Settings→Providers, ≥1 LLM via API key/OAuth.
- Step 5 Spawn first session — Add folder → +Session.
- Using built-in Doctor — Help→Doctor. ✓ Electron/Node/npm/openspec/server code; ✗ pi CLI/tsx [fixable] Run Setup; ⚠ benign. Copies to clipboard.

## Path 2 — Tarball / npm install (advanced)
For pre-release/headless/CI. Normal user → Path 1.
- Prerequisites — Node ≥22.18.0 (refuses nodejs/node#58515 versions; avoid nvm-windows non-ASCII username), Git for Windows (Use Git from Command Prompt), long paths enabled (`LongPathsEnabled` reg + `git config core.longpaths true`, reboot), Windows Build Tools (only if native modules fail).
- Install agent runtime — mkdir `.pi-dashboard`, write package.json manually (dot-dir breaks `npm init`), `npm install @earendil-works/pi-coding-agent tsx`.
- Install pi-dashboard — Option A official npm; Option B local tarballs (npm pack shared/client/server/extension, copy 4 .tgz, install ALL 4 in one command — sibling `*` deps resolve only together).
- Launch — `npx pi-dashboard start` or add `.bin` to PATH via setx. http://localhost:8000.

## Troubleshooting
Full log: `docs/troubleshooting-windows-installer.md` (bootstrap flow, `ensureWindowsSystemPath`/`pickNodeForServer`/`buildSafeArgv`, 14 symptoms).
- `spawn npm ENOENT` — old build before `29af651`; Windows npm=npm.cmd. Fix: newer installer; workaround manual `npm install pi-coding-agent`.
- Doctor says tsx/openspec not found but wizard "Already installed" — detection inconsistency. Use Doctor as truth; add override Settings→Tools → `tool-overrides.json`.
- 'Windows pi spawn requires node.exe + cli.js. Found only pi.cmd' — found pi.cmd not `dist/index.js`; Windows headless can't use .cmd. Fix: rescan / override to `dist\index.js` / restart server.
- 'Directory does not exist: <name>' — pinned folder non-existent; unpin or edit `preferences.json` `pinnedDirectories`.
- git/tools "not found" though `where` works — stale PATH; `taskkill node.exe`, start from new cmd, rescan.
- `EPERM rmdir` npm warn cleanup — cosmetic; ignore if `npm ls` clean.
- `E404 ...pi-dashboard-shared not in registry` — Path 2; installed one tarball not all four together.
- `Cannot find package 'tsx'` — install `tsx @earendil-works/pi-coding-agent`.
- Non-ASCII username path issues — move npm cache + managed install to ASCII path (set override).
- Terminals don't work in packaged Electron — node-pty spawn-helper needs exec perms (bundle-time fix); file issue.

## Upgrading
- Electron (Path 1) — download new Setup.exe/.zip, install over. Config/sessions preserved.
- Tarball/npm (Path 2) — `pi-dashboard stop`, replace .tgz, install all 4, start. `.pi\dashboard\*` + sessions preserved.

## Uninstall
- Path 1 — Settings→Apps→Uninstall (preserves ~/.pi/ + ~/.pi-dashboard/) or delete zip folder.
- Path 2 — `pi-dashboard stop`, `rmdir /S /Q .pi-dashboard`.
- Optional remove config+sessions — rmdir `.pi\dashboard` + `.pi\agent\sessions`; remove setx PATH entry.

## Directory reference
`.pi-dashboard\` managed install; `node_modules\@earendil-works\pi-coding-agent\` runtime; `.pi\dashboard\server.log`/`preferences.json`/`tool-overrides.json`/`headless-pids.json`; `.pi\agent\sessions\` JSONL; `.pi\agent\settings.json`; `%TEMP%\pi-dashboard-electron.log`.

## Build your own installer
Docker cross-build (any OS): `build-installer.sh --windows` → .zip only. Native Windows: `cd packages/electron; npm run make`. NSIS Setup.exe CI-only (windows-latest, no Wine). Artifacts `packages/electron/out/make/`. Docker `--platform linux/amd64`; Apple Silicon Rosetta slow.

## Getting help
Check `.pi\dashboard\server.log` + `%TEMP%\pi-dashboard-electron.log`. Help→Doctor→Copy to Clipboard. Settings→Tools→Export. Attach to GitHub issue.
