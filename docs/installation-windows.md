# Installing pi-dashboard on Windows

Guide to installing + running **pi-agent-dashboard** on Windows 10/11.

Two install paths:

1. **Electron `Setup.exe` installer** (recommended) — per-user NSIS installer, bundled Node + npm, Start Menu shortcut, uninstaller. `.zip` extract-and-run available as secondary. Works for most users.
2. **Tarball / npm install** (advanced) — for developers validating pre-release builds or running headless server without Electron.

Both share same runtime layout: agent runtime (`pi-coding-agent`) lives in `%USERPROFILE%\.pi-dashboard\node_modules\`; dashboard's config / logs / sessions live in `%USERPROFILE%\.pi\dashboard\` + `%USERPROFILE%\.pi\agent\sessions\`.

---

## Path 1 — Electron Setup.exe (recommended)

### Step 1 — Download

Grab latest Windows artifact from GitHub releases page:

- **`PI-Dashboard-Setup-<version>-<arch>.exe`** (primary) — per-user NSIS installer. Default dir `%LOCALAPPDATA%\Programs\PI Dashboard\`, user can change it. Start Menu shortcut, Add/Remove Programs entry, uninstaller. Installs `pi-dashboard.exe`. No admin, no UAC, no HKLM. x64 + arm64.
- **`PI-Dashboard-win32-x64.zip`** (secondary) — extract-and-run. Unzip + run `pi-dashboard.exe` in place. No install, no Start Menu entry.

`Setup.exe` built on `windows-latest` CI via `electron-builder --win nsis`. `.zip` also from CI.

### Step 2 — Launch

Start Menu shortcut (Setup.exe) or double-click `pi-dashboard.exe` (.zip).

Splash window appears within 1 second + progresses through startup phases:

```
Starting…
Checking dashboard server…
Detecting pi agent…
Checking bridge extension…
Opening setup wizard…            (first run only)
Launching dashboard server…
Opening dashboard…
```

Any phase stalls → same text appears in `%TEMP%\pi-dashboard-electron.log` — useful for bug reports.

### Step 3 — First-run setup wizard

On first launch, wizard opens automatically. Installs agent runtime (`@earendil-works/pi-coding-agent` + `tsx`) into `%USERPROFILE%\.pi-dashboard\node_modules\` using bundled Node + npm (no system Node required).

| Phase | What happens |
|---|---|
| Download Node | Skipped — Node bundled inside Electron app |
| Install pi-coding-agent | Spawns bundled `node.exe + npm-cli.js install @earendil-works/pi-coding-agent` |
| Install openspec | Skipped if already on system PATH; otherwise installed via same bundled npm |
| Install tsx | Skipped if already on system PATH; otherwise installed same way |

Wizard uses bundled Node even when system Node present. Sidesteps Windows-specific bug where `spawn("npm", ...)` fails with `ENOENT` because Windows doesn't auto-append `.cmd` extensions.

#### First-run offline (air-gapped / corporate proxy)

Release Electron builds ship **per-platform npm cacache** containing `pi-coding-agent`, `openspec`, `tsx` plus all transitive dependencies — inside `resources/offline-packages/` in app bundle. Wizard uses cache automatically: extracts tarball to `%USERPROFILE%\.pi-dashboard\.offline-cache\`, runs ONE `npm install --offline`, then deletes cache to reclaim ~140 MB.

- **Air-gapped install**: unzip/run Windows installer on machine with no network; wizard completes without contacting `registry.npmjs.org`.
- **Proxy-blocked install**: same — no registry traffic = no proxy failures.
- **Doctor check**: Doctor window shows "Offline packages bundle" row with target platform + pinned versions. "Not bundled (registry-install mode)" → dev/feature build; get release artifact.
- **Pin versions** live in `packages/electron/offline-packages.json` (bumped per dashboard release).
- Bundle missing or SHA-256 mismatch → wizard aborts with clear error; does **not** silently fall back to registry (deterministic offline contract). Tarball path manual install (Path 2 below) remains power-user fallback.

If you see `Error: spawn npm ENOENT` in wizard:

- Running build predating `29af651` — rebuild or upgrade to newer release.
- Workaround without rebuilding: install deps manually via cmd (see *Troubleshooting* below).

### Step 4 — Configure provider

Close wizard (or it closes automatically when deps install cleanly). Dashboard opens at <http://localhost:8000>.

- Click **Settings** (gear icon) → **Providers**.
- Configure ≥ 1 LLM provider (Anthropic, OpenAI, Google, etc.) via API key or OAuth.

### Step 5 — Spawn first session

- Click **Add folder** (top right sidebar).
- Navigate to project directory.
- Click **+ Session** on pinned folder.

pi agent spawns; chat view opens; start prompting.

### Using built-in Doctor

**Help → Doctor** (menu bar) runs diagnostics + shows what's installed / missing:

- ✓ Electron / System Node.js / Bundled Node.js / npm / openspec CLI / Dashboard server code
- ✗ pi CLI, tsx — **[fixable]** — click **Run Setup** to re-run wizard
- ⚠ Dashboard server not running, API key not configured — benign; resolved by normal use

Doctor output copies to clipboard or exports; attach to any bug report.

---

## Path 2 — Tarball / npm install (advanced)

For developers running pre-release builds from feature branch, headless server-only installs, or CI environments without GUI. **Normal user installing release → use Path 1 instead.**

### Prerequisites

- **Node.js ≥ 22.18.0** — pi-dashboard refuses to start on versions affected by [nodejs/node#58515](https://github.com/nodejs/node/issues/58515). Install MSI from [nodejs.org](https://nodejs.org/dist/v22.18.0/node-v22.18.0-x64.msi), or use [fnm](https://github.com/Schniz/fnm). **Avoid nvm-windows** if username contains non-ASCII characters — misreads paths + fails activation.
- **Git for Windows** — [git-scm.com](https://git-scm.com/download/win). During setup, select "Use Git from the Windows Command Prompt" so git on system PATH.
- **Long paths enabled** — run as Administrator: `reg add "HKLM\SYSTEM\CurrentControlSet\Control\FileSystem" /v LongPathsEnabled /t REG_DWORD /d 1 /f` then `git config --global core.longpaths true`. Reboot. Node's `node_modules` nesting can exceed Windows' default 260-char limit.
- **Windows Build Tools** (only if native modules fail to compile): `npm install --global windows-build-tools` or install **Visual Studio Build Tools** with "Desktop development with C++" workload.

### Install agent runtime

```cmd
mkdir "%USERPROFILE%\.pi-dashboard"
cd /d "%USERPROFILE%\.pi-dashboard"

:: npm init -y fails because .pi-dashboard starts with a dot — write package.json manually
echo {"name":"pi-dashboard-managed","version":"0.0.0","private":true} > package.json

npm install @earendil-works/pi-coding-agent tsx
```

Verify:

```cmd
dir node_modules\@earendil-works\pi-coding-agent\dist
:: should list index.js
```

### Install pi-dashboard

**Option A — from official npm release (once published):**

```cmd
cd /d "%USERPROFILE%\.pi-dashboard"
npm install @blackbelt-technology/pi-dashboard-server @blackbelt-technology/pi-dashboard-extension
```

**Option B — from local tarballs (pre-release testing):**

On dev machine (macOS / Linux / Windows):

```bash
git clone -b <branch> https://github.com/BlackBeltTechnology/pi-agent-dashboard.git
cd pi-agent-dashboard
npm install
npm run build

mkdir tarballs
npm pack --workspace=packages/shared    --pack-destination=./tarballs
npm pack --workspace=packages/client    --pack-destination=./tarballs
npm pack --workspace=packages/server    --pack-destination=./tarballs
npm pack --workspace=packages/extension --pack-destination=./tarballs
```

Copy all 4 `.tgz` files to `%USERPROFILE%\.pi-dashboard\tarballs\` on Windows, then:

```cmd
cd /d "%USERPROFILE%\.pi-dashboard"

:: Install all 4 in ONE command — each tarball declares sibling deps as "*"
:: which only resolves correctly when they see each other in the same install run
npm install ^
  tarballs\blackbelt-technology-pi-dashboard-shared-0.3.0.tgz ^
  tarballs\blackbelt-technology-pi-dashboard-web-0.3.0.tgz ^
  tarballs\blackbelt-technology-pi-dashboard-server-0.3.0.tgz ^
  tarballs\blackbelt-technology-pi-dashboard-extension-0.3.0.tgz
```

### Launch

```cmd
cd /d "%USERPROFILE%\.pi-dashboard"
npx pi-dashboard start
```

Or add managed install's `.bin` to PATH:

```cmd
setx PATH "%PATH%;%USERPROFILE%\.pi-dashboard\node_modules\.bin"
:: reopen cmd
pi-dashboard start
```

Open <http://localhost:8000>.

---

## Troubleshooting

> **Comprehensive symptom → root-cause → fix log:** [`docs/troubleshooting-windows-installer.md`](./troubleshooting-windows-installer.md). Includes full Windows bootstrap flow (which binaries called in what order, fallback chains, what happens when each missing), defensive infrastructure (`ensureWindowsSystemPath`, `pickNodeForServer`, `buildSafeArgv`), 14 documented symptoms with resolutions, quick-reference PowerShell diagnostic toolkit.

### Electron wizard: `Error: spawn npm ENOENT`

**Symptom:** First-run wizard fails during "Installing pi-coding-agent" with ENOENT error. pi-coding-agent shows ✗ in Doctor output.

**Cause:** Old build before commit `29af651`. Windows `npm` actually `npm.cmd` (batch wrapper); `child_process.spawn("npm", ...)` without `.cmd` extension fails because Windows doesn't auto-append extensions during spawn.

**Fix (preferred):** Download newer installer or rebuild from branch including `29af651`.

**Workaround (no rebuild):** Install missing deps yourself via cmd, then relaunch Dashboard:

```cmd
cd /d "%USERPROFILE%\.pi-dashboard"

if not exist package.json echo {"name":"pi-dashboard-managed","version":"0.0.0","private":true} > package.json

npm install @earendil-works/pi-coding-agent
```

Reopen Dashboard. Doctor shows ✓ pi CLI. Dismiss wizard (close window — Dashboard opens main UI automatically) or click **Doctor → Run Setup** to retry wizard for any remaining fixable items.

### Doctor says tsx / openspec "not found" but wizard says "Already installed (system)"

Detection inconsistency between two surfaces. Both read from same ToolRegistry, but some wizard branches inspect `detectSystemNode()` + global npm root directly, missing managed installs.

Workaround: use Doctor's output as source of truth. Doctor says ✗ → add override via **Settings → Tools** inside running dashboard (not wizard):

1. Open dashboard
2. Settings → General → scroll to **Tools**
3. Expand offending row (tsx, openspec, git, etc.)
4. Paste full path from `where tsx` in cmd
5. Rescan

Overrides persist to `%USERPROFILE%\.pi\dashboard\tool-overrides.json` + survive restarts / upgrades.

### Session spawn fails: `[headless] Windows pi spawn requires node.exe + cli.js (managed install). Found only pi.cmd on PATH.`

**Cause:** Dashboard found pi CLI wrapper (`pi.cmd` via `where`) but not pi-coding-agent module's `dist/index.js`. Windows headless spawn can't use `.cmd` files — they require `shell: true`, which breaks detached spawn.

**Fix 1 — rescan tools:** Settings → Tools → Rescan (top right). `pi-coding-agent` row flips to ✓ with source=`managed`.

**Fix 2 — manual override:** expand `pi-coding-agent` row, paste `%USERPROFILE%\.pi-dashboard\node_modules\@earendil-works\pi-coding-agent\dist\index.js` into override field.

**Fix 3 — restart server:** pi-coding-agent installed *after* pi-dashboard started → server's cached environment stale. `pi-dashboard stop && pi-dashboard start` (or close + relaunch Electron app).

### Session spawn fails: `[headless] Directory does not exist: <name>`

Pinned folder points to non-existent path.

- Unpin via 📌 icon + re-add with valid absolute path, or
- Edit `%USERPROFILE%\.pi\dashboard\preferences.json` manually (stop server first) + remove stale entry from `pinnedDirectories`.

### `git` / other tools show "not found" even though `where <tool>` works in cmd

Server inherited stale PATH from shell that didn't have tool. Fix:

```cmd
taskkill /F /IM node.exe
where git
:: confirm path shown, e.g. C:\Program Files\Git\cmd\git.exe

:: Start dashboard from NEW cmd window so it inherits current PATH
pi-dashboard start
```

Then Settings → Tools → Rescan.

Still fails: paste `where git` output into git row's override field.

### `npm warn cleanup ... EPERM: operation not permitted, rmdir`

Cosmetic warning during npm install. Windows has file handle on transitive dependency npm trying to clean up. Safe to ignore if `npm ls --depth=0` reports no errors.

Blocks install: close VS Code / File Explorer windows in path, disable antivirus temporarily, or `rmdir /S /Q node_modules && del package-lock.json && npm install`.

### `npm ERR! E404 ... @blackbelt-technology/pi-dashboard-shared is not in this registry`

Path 2 only. Ran `npm install -g <one-tarball>.tgz` instead of installing all four tarballs together in one command. Global install treats each tarball as isolated + re-resolves sibling `*` deps from registry (which doesn't have them).

Fix: run `npm install` with **all four tarball paths in one command** inside `%USERPROFILE%\.pi-dashboard` (see *Path 2 → Install pi-dashboard → Option B*).

### `Cannot find package 'tsx' imported from C:\...`

Dashboard tarballs installed but `tsx` missing. Run:

```cmd
cd /d "%USERPROFILE%\.pi-dashboard"
npm install tsx @earendil-works/pi-coding-agent
```

### Non-ASCII username path issues

Windows username contains accented characters (e.g. `Róbert Csákány`) → some legacy Node / npm / nvm-windows code paths misread PATH / HOME.

**Workarounds:**

- Move npm cache to ASCII path: `npm config set cache C:\npm-cache`
- Move managed install to ASCII path:
  ```cmd
  mkdir C:\pi-dashboard
  :: Install into C:\pi-dashboard instead of %USERPROFILE%\.pi-dashboard
  ```
  **Caveat:** non-default location → dashboard's `managed` tool-resolution strategy won't find pi-coding-agent automatically; set override manually in Settings → Tools.

### Dashboard starts but terminals don't work in packaged Electron build

Packaged build requires executable permissions on `node-pty`'s spawn helper. Handled at install time for npm installs, but packaged Electron bundles need their own bundle-time fix. Terminals silently fail in packaged .exe → file issue with build log attached.

---

## Upgrading

### Electron (Path 1)

- **Setup.exe:** download new `PI-Dashboard-Setup-<version>-<arch>.exe`, run it. Installs over old version. Config / sessions preserved.
- **.zip:** download new `.zip`, unzip over (or next to) old folder, launch new `pi-dashboard.exe`.

### Tarball / npm (Path 2)

```cmd
cd /d "%USERPROFILE%\.pi-dashboard"
pi-dashboard stop

:: Replace all .tgz files in tarballs\ with new versions, then:
npm install ^
  tarballs\blackbelt-technology-pi-dashboard-shared-<new>.tgz ^
  tarballs\blackbelt-technology-pi-dashboard-web-<new>.tgz ^
  tarballs\blackbelt-technology-pi-dashboard-server-<new>.tgz ^
  tarballs\blackbelt-technology-pi-dashboard-extension-<new>.tgz

pi-dashboard start
```

`%USERPROFILE%\.pi\dashboard\*` (config, preferences, tool overrides) + `%USERPROFILE%\.pi\agent\sessions\` (session history) preserved across upgrades on both paths.

---

## Uninstall

### Path 1 (Electron)

- **Setup.exe:** Windows Settings → Apps → PI Dashboard → Uninstall. Removes app; preserves `~/.pi/` + `~/.pi-dashboard/`.
- **.zip:** delete unzipped folder.

### Path 2 (tarball)

```cmd
pi-dashboard stop
rmdir /S /Q "%USERPROFILE%\.pi-dashboard"
```

### Optional — remove config + sessions too

```cmd
rmdir /S /Q "%USERPROFILE%\.pi\dashboard"
rmdir /S /Q "%USERPROFILE%\.pi\agent\sessions"
```

Added `~/.pi-dashboard/node_modules/.bin` to PATH via `setx` → remove that entry via **Settings → System → Advanced system settings → Environment Variables**.

---

## Directory reference

| Path | Purpose |
|---|---|
| `%USERPROFILE%\.pi-dashboard\` | Managed install directory |
| `%USERPROFILE%\.pi-dashboard\node_modules\@earendil-works\pi-coding-agent\` | pi agent runtime |
| `%USERPROFILE%\.pi-dashboard\node_modules\@blackbelt-technology\pi-dashboard-*\` | Dashboard packages (Path 2 only) |
| `%USERPROFILE%\.pi\dashboard\server.log` | Server stdout/stderr (append mode, timestamped) |
| `%USERPROFILE%\.pi\dashboard\preferences.json` | Pinned folders, session ordering |
| `%USERPROFILE%\.pi\dashboard\tool-overrides.json` | Per-tool path overrides from Settings → Tools |
| `%USERPROFILE%\.pi\dashboard\headless-pids.json` | Tracked child PIDs for orphan cleanup |
| `%USERPROFILE%\.pi\agent\sessions\` | pi agent session history (JSONL per session) |
| `%USERPROFILE%\.pi\agent\settings.json` | pi agent extension registration (auto-managed) |
| `%TEMP%\pi-dashboard-electron.log` | Electron main-process startup log (Path 1 only) |

---

## Build your own installer

Useful when validating feature branch before ship:

```bash
# On any machine with Docker (macOS / Linux / Windows)
git clone -b <branch> https://github.com/BlackBeltTechnology/pi-agent-dashboard.git
cd pi-agent-dashboard
npm install
npm run build

# Windows .zip via Docker (cross-platform from macOS/Linux)
./packages/electron/scripts/build-installer.sh --windows

# OR natively on Windows (ZIP + native modules)
cd packages/electron
npm run make
```

Docker produces `.zip` only. NSIS `Setup.exe` CI-only (`windows-latest` via `electron-builder --win nsis`); needs Windows host, no Wine. Artifacts land in `packages/electron/out/make/`. Expect ~5-15 minutes first time (Docker pulls base image + build tools), ~2-5 min subsequent.

Docker build uses `--platform linux/amd64`. On Apple Silicon, Rosetta emulation slow (~20-30 min); use CI or native Windows box for faster turnaround.

---

## Getting help

- Check `%USERPROFILE%\.pi\dashboard\server.log` for server errors.
- Check `%TEMP%\pi-dashboard-electron.log` for Electron startup traces.
- Run **Help → Doctor → Copy to Clipboard** in Electron app for full diagnostic snapshot.
- Run **Settings → Tools → Export** for ToolRegistry resolution trail (every strategy's attempt per tool).
- Open GitHub issue with those three attached.
