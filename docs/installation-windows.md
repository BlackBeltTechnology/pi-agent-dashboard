# Installing pi-dashboard on Windows

A comprehensive guide to installing and running **pi-agent-dashboard** on Windows 10/11.

Two install paths are documented:

1. **Electron portable / installer** (recommended) — one-click download, bundled Node + npm, graphical setup wizard. Works for most users.
2. **Tarball / npm install** (advanced) — for developers validating pre-release builds or running the headless server without Electron.

Both paths share the same runtime layout: the agent runtime (`pi-coding-agent`) lives in `%USERPROFILE%\.pi-dashboard\node_modules\`, and the dashboard's config / logs / sessions live in `%USERPROFILE%\.pi\dashboard\` and `%USERPROFILE%\.pi\agent\sessions\`.

---

## Path 1 — Electron portable (recommended)

### Step 1 — Download

Grab the latest Windows installer or portable zip from the GitHub releases page:

- **`PI-Dashboard-<version>-Setup.exe`** — full installer, creates Start Menu entries and file associations.
- **`PI-Dashboard-win32-x64.zip`** — portable zip, no install needed; unzip and run `pi-dashboard.exe` in place.

Both are built on a Linux CI runner via Docker + electron-forge → NSIS. Artifacts are identical in behaviour; installer vs portable is a packaging preference.

### Step 2 — Launch

Double-click `pi-dashboard.exe` (portable) or the Start Menu shortcut (installer).

The splash window appears within 1 second and progresses through startup phases:

```
Starting…
Checking dashboard server…
Detecting pi agent…
Checking bridge extension…
Opening setup wizard…            (first run only)
Launching dashboard server…
Opening dashboard…
```

If any phase stalls, the same text appears in `%TEMP%\pi-dashboard-electron.log` — useful for bug reports.

### Step 3 — First-run setup wizard

On first launch, the wizard opens automatically. It installs the agent runtime (`@mariozechner/pi-coding-agent` + `tsx`) into `%USERPROFILE%\.pi-dashboard\node_modules\` using the bundled Node + npm (no system Node required).

| Phase | What happens |
|---|---|
| Download Node | Skipped — Node is already bundled inside the Electron app |
| Install pi-coding-agent | Spawns bundled `node.exe + npm-cli.js install @mariozechner/pi-coding-agent` |
| Install openspec | Skipped if already on system PATH; otherwise installed via the same bundled npm |
| Install tsx | Skipped if already on system PATH; otherwise installed the same way |

The wizard uses bundled Node even when system Node is present. This sidesteps a Windows-specific bug where `spawn("npm", ...)` fails with `ENOENT` because Windows doesn't auto-append `.cmd` extensions.

#### First-run offline (air-gapped / corporate proxy)

Release Electron builds ship a **per-platform npm cacache** containing `pi-coding-agent`, `openspec`, and `tsx` plus all transitive dependencies — inside `resources/offline-packages/` in the app bundle. The wizard uses this cache automatically: it extracts the tarball to `%USERPROFILE%\.pi-dashboard\.offline-cache\`, runs ONE `npm install --offline`, then deletes the cache to reclaim ~140 MB.

- **Air-gapped install**: unzip/run the Windows installer on a machine with no network; the wizard completes without contacting `registry.npmjs.org`.
- **Proxy-blocked install**: same — no registry traffic means no proxy failures.
- **Doctor check**: the Doctor window shows an "Offline packages bundle" row with the target platform and the pinned versions. If it says "Not bundled (registry-install mode)", you have a dev/feature build; get a release artifact.
- **Pin versions** live in `packages/electron/offline-packages.json` (bumped per dashboard release).
- If the bundle is missing or its SHA-256 doesn't match the manifest, the wizard aborts with a clear error — it does **not** silently fall back to the registry (deterministic offline contract). The tarball path manual install (Path 2 below) remains the power-user fallback.

If you see `Error: spawn npm ENOENT` in the wizard:

- You're running a build predating `29af651` — rebuild or upgrade to a newer release.
- Workaround without rebuilding: install deps manually via cmd (see *Troubleshooting* below).

### Step 4 — Configure a provider

Close the wizard (or it closes automatically when deps install cleanly). The dashboard opens at <http://localhost:8000>.

- Click **Settings** (gear icon) → **Providers**.
- Configure at least one LLM provider (Anthropic, OpenAI, Google, etc.) via API key or OAuth.

### Step 5 — Spawn your first session

- Click **Add folder** (top right sidebar).
- Navigate to a project directory.
- Click **+ Session** on the pinned folder.

A pi agent spawns; chat view opens; start prompting.

### Using the built-in Doctor

**Help → Doctor** (menu bar) runs diagnostics and shows what's installed / missing:

- ✓ Electron / System Node.js / Bundled Node.js / npm / openspec CLI / Dashboard server code
- ✗ pi CLI, tsx — **[fixable]** — click **Run Setup** to re-run the wizard
- ⚠ Dashboard server not running, API key not configured — benign; resolved by normal use

The Doctor diagnostic output can be copied to clipboard or exported; attach it to any bug report.

---

## Path 2 — Tarball / npm install (advanced)

For developers running pre-release builds from a feature branch, headless server-only installs, or CI environments without GUI. **If you're a normal user installing a release, use Path 1 instead.**

### Prerequisites

- **Node.js ≥ 22.18.0** — pi-dashboard refuses to start on versions affected by [nodejs/node#58515](https://github.com/nodejs/node/issues/58515). Install the MSI from [nodejs.org](https://nodejs.org/dist/v22.18.0/node-v22.18.0-x64.msi), or use [fnm](https://github.com/Schniz/fnm). **Avoid nvm-windows** if your username contains non-ASCII characters — it misreads paths and fails activation.
- **Git for Windows** — [git-scm.com](https://git-scm.com/download/win). During setup, select "Use Git from the Windows Command Prompt" so git is on system PATH.
- **Long paths enabled** — run as Administrator: `reg add "HKLM\SYSTEM\CurrentControlSet\Control\FileSystem" /v LongPathsEnabled /t REG_DWORD /d 1 /f` then `git config --global core.longpaths true`. Reboot. Node's `node_modules` nesting can exceed Windows' default 260-char limit.
- **Windows Build Tools** (only if native modules fail to compile): `npm install --global windows-build-tools` or install **Visual Studio Build Tools** with the "Desktop development with C++" workload.

### Install the agent runtime

```cmd
mkdir "%USERPROFILE%\.pi-dashboard"
cd /d "%USERPROFILE%\.pi-dashboard"

:: npm init -y fails because .pi-dashboard starts with a dot — write package.json manually
echo {"name":"pi-dashboard-managed","version":"0.0.0","private":true} > package.json

npm install @mariozechner/pi-coding-agent tsx
```

Verify:

```cmd
dir node_modules\@mariozechner\pi-coding-agent\dist
:: should list index.js
```

### Install pi-dashboard

**Option A — from an official npm release (once published):**

```cmd
cd /d "%USERPROFILE%\.pi-dashboard"
npm install @blackbelt-technology/pi-dashboard-server @blackbelt-technology/pi-dashboard-extension
```

**Option B — from local tarballs (pre-release testing):**

On a dev machine (macOS / Linux / Windows):

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

Or add the managed install's `.bin` directory to PATH:

```cmd
setx PATH "%PATH%;%USERPROFILE%\.pi-dashboard\node_modules\.bin"
:: reopen cmd
pi-dashboard start
```

Open <http://localhost:8000>.

---

## Troubleshooting

### Electron wizard: `Error: spawn npm ENOENT`

**Symptom:** First-run wizard fails during "Installing pi-coding-agent" with the ENOENT error. pi-coding-agent shows ✗ in the Doctor output.

**Cause:** Old build before commit `29af651`. Windows `npm` is actually `npm.cmd` (a batch wrapper); `child_process.spawn("npm", ...)` without the `.cmd` extension fails because Windows doesn't auto-append extensions during spawn.

**Fix (preferred):** Download a newer installer or rebuild from a branch that includes `29af651`.

**Workaround (no rebuild):** Install the missing deps yourself via cmd, then relaunch the Dashboard:

```cmd
cd /d "%USERPROFILE%\.pi-dashboard"

if not exist package.json echo {"name":"pi-dashboard-managed","version":"0.0.0","private":true} > package.json

npm install @mariozechner/pi-coding-agent
```

Reopen the Dashboard. Doctor now shows ✓ pi CLI. Dismiss the wizard (close the window — Dashboard opens the main UI automatically) or click **Doctor → Run Setup** to retry the wizard for any remaining fixable items.

### Doctor says tsx / openspec "not found" but wizard says "Already installed (system)"

Detection inconsistency between the two surfaces. Both read from the same ToolRegistry, but some branches of the wizard inspect `detectSystemNode()` + global npm root directly, which misses managed installs.

Workaround: use Doctor's output as the source of truth. If Doctor says ✗, add an override via **Settings → Tools** inside the running dashboard (not the wizard):

1. Open the dashboard
2. Settings → General → scroll to **Tools**
3. Expand the offending row (tsx, openspec, git, etc.)
4. Paste the full path you got from `where tsx` in cmd
5. Rescan

Overrides persist to `%USERPROFILE%\.pi\dashboard\tool-overrides.json` and survive restarts / upgrades.

### Session spawn fails: `[headless] Windows pi spawn requires node.exe + cli.js (managed install). Found only pi.cmd on PATH.`

**Cause:** Dashboard found the pi CLI wrapper (`pi.cmd` via `where`) but not the pi-coding-agent module's `dist/index.js`. Windows headless spawn can't use `.cmd` files — they require `shell: true`, which breaks detached spawn.

**Fix 1 — rescan tools:** Settings → Tools → Rescan (top right). The `pi-coding-agent` row should flip to ✓ with source=`managed`.

**Fix 2 — manual override:** expand the `pi-coding-agent` row, paste `%USERPROFILE%\.pi-dashboard\node_modules\@mariozechner\pi-coding-agent\dist\index.js` into the override field.

**Fix 3 — restart server:** if pi-coding-agent was installed *after* pi-dashboard started, the server's cached environment is stale. `pi-dashboard stop && pi-dashboard start` (or close and relaunch the Electron app).

### Session spawn fails: `[headless] Directory does not exist: <name>`

A pinned folder points to a path that doesn't exist.

- Unpin via the 📌 icon and re-add with a valid absolute path, or
- Edit `%USERPROFILE%\.pi\dashboard\preferences.json` manually (stop the server first) and remove the stale entry from `pinnedDirectories`.

### `git` / other tools show "not found" even though `where <tool>` works in cmd

The server inherited a stale PATH from a shell that didn't have the tool on it. Fix:

```cmd
taskkill /F /IM node.exe
where git
:: confirm path shown, e.g. C:\Program Files\Git\cmd\git.exe

:: Start dashboard from a NEW cmd window so it inherits current PATH
pi-dashboard start
```

Then Settings → Tools → Rescan.

If it still fails: paste the `where git` output into the git row's override field.

### `npm warn cleanup ... EPERM: operation not permitted, rmdir`

Cosmetic warning during npm install. Windows has a file handle on a transitive dependency npm is trying to clean up. Safe to ignore if `npm ls --depth=0` reports no errors.

If it blocks the install: close VS Code / File Explorer windows in the path, disable antivirus temporarily, or `rmdir /S /Q node_modules && del package-lock.json && npm install`.

### `npm ERR! E404 ... @blackbelt-technology/pi-dashboard-shared is not in this registry`

Path 2 only. You ran `npm install -g <one-tarball>.tgz` instead of installing all four tarballs together in one command. Global install treats each tarball as isolated and re-resolves sibling `*` deps from the registry (which doesn't have them).

Fix: run `npm install` with **all four tarball paths in one command** inside `%USERPROFILE%\.pi-dashboard` (see *Path 2 → Install pi-dashboard → Option B*).

### `Cannot find package 'tsx' imported from C:\...`

Dashboard tarballs installed but `tsx` is missing. Run:

```cmd
cd /d "%USERPROFILE%\.pi-dashboard"
npm install tsx @mariozechner/pi-coding-agent
```

### Non-ASCII username path issues

If your Windows username contains accented characters (e.g. `Róbert Csákány`), some legacy Node / npm / nvm-windows code paths misread PATH / HOME.

**Workarounds:**

- Move npm cache to an ASCII path: `npm config set cache C:\npm-cache`
- Move the managed install to an ASCII path:
  ```cmd
  mkdir C:\pi-dashboard
  :: Install into C:\pi-dashboard instead of %USERPROFILE%\.pi-dashboard
  ```
  **Caveat:** using a non-default location means the dashboard's `managed` tool-resolution strategy won't find pi-coding-agent automatically — you'll need to set the override manually in Settings → Tools.

### Dashboard starts but terminals don't work in the packaged Electron build

The packaged build requires executable permissions on `node-pty`'s spawn helper. This is handled at install time for npm installs, but packaged Electron bundles need their own bundle-time fix. If terminals silently fail in a packaged .exe, file an issue with the build log attached.

### Startup feels slow on cold launch (Windows portable)

The splash window should appear within 1 second — if it doesn't, check `%TEMP%\pi-dashboard-electron.log` for the phase progression. Expected sequence:

```
[timestamp] === Electron starting ===
[timestamp] splash: Checking dashboard server…
[timestamp] splash: Detecting pi agent…
[timestamp] splash: Checking bridge extension…
[timestamp] splash: Opening setup wizard…           (or: Launching dashboard server…)
[timestamp] splash: Opening dashboard…
```

If any phase stalls > 10 seconds, share that block in a bug report.

---

## Upgrading

### Electron (Path 1)

- **Installer:** download the new `PI-Dashboard-<version>-Setup.exe`, run it. It uninstalls the old version and installs the new one. Config / sessions preserved.
- **Portable:** download the new `.zip`, unzip over (or next to) the old folder, launch the new `pi-dashboard.exe`.

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

Your `%USERPROFILE%\.pi\dashboard\*` (config, preferences, tool overrides) and `%USERPROFILE%\.pi\agent\sessions\` (session history) are preserved across upgrades on both paths.

---

## Uninstall

### Path 1 (Electron)

- **Installer:** Windows Settings → Apps → PI Dashboard → Uninstall.
- **Portable:** delete the folder you unzipped.

### Path 2 (tarball)

```cmd
pi-dashboard stop
rmdir /S /Q "%USERPROFILE%\.pi-dashboard"
```

### Optional — remove config and sessions too

```cmd
rmdir /S /Q "%USERPROFILE%\.pi\dashboard"
rmdir /S /Q "%USERPROFILE%\.pi\agent\sessions"
```

If you added `~/.pi-dashboard/node_modules/.bin` to PATH via `setx`, remove that entry via **Settings → System → Advanced system settings → Environment Variables**.

---

## Directory reference

| Path | Purpose |
|---|---|
| `%USERPROFILE%\.pi-dashboard\` | Managed install directory |
| `%USERPROFILE%\.pi-dashboard\node_modules\@mariozechner\pi-coding-agent\` | pi agent runtime |
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

Useful if you're validating a feature branch before it ships:

```bash
# On any machine with Docker (macOS / Linux / Windows)
git clone -b <branch> https://github.com/BlackBeltTechnology/pi-agent-dashboard.git
cd pi-agent-dashboard
npm install
npm run build

# Windows installer via Docker (cross-platform from macOS/Linux)
./packages/electron/scripts/build-installer.sh --windows

# OR natively on Windows
cd packages/electron
npm run make
```

Artifacts land in `packages/electron/out/make/`. Expect ~5-15 minutes first time (Docker pulls base image + Wine + build tools), ~2-5 min subsequent.

The Docker build uses `--platform linux/amd64`. On Apple Silicon, Rosetta emulation makes this slow (~20-30 min); consider using CI or a native Windows box for faster turnaround.

---

## Getting help

- Check `%USERPROFILE%\.pi\dashboard\server.log` for server errors.
- Check `%TEMP%\pi-dashboard-electron.log` for Electron startup traces.
- Run **Help → Doctor → Copy to Clipboard** in the Electron app for a full diagnostic snapshot.
- Run **Settings → Tools → Export** for a ToolRegistry resolution trail (every strategy's attempt per tool).
- Open a GitHub issue with those three attached.
