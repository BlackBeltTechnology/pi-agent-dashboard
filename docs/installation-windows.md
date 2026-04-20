# Installing pi-dashboard on Windows

A comprehensive guide to installing and running **pi-agent-dashboard** on Windows 10/11 from tarballs (pre-release) or once it is published to npm.

The recipe uses `%USERPROFILE%\.pi-dashboard` as a self-contained install directory. This is the **managed install location** that pi-dashboard's `ToolRegistry` checks first — installing there means the dashboard and its pi runtime can discover each other automatically.

---

## Prerequisites

### 1. Node.js ≥ 22.18.0

pi-dashboard's server refuses to start on Node versions affected by [nodejs/node#58515](https://github.com/nodejs/node/issues/58515) (v22.0–v22.17 and v24.1–v24.2). Use v22.18+ or v24.3+.

**Option A — Official MSI installer (recommended for Windows)**

Download and run: [https://nodejs.org/dist/v22.18.0/node-v22.18.0-x64.msi](https://nodejs.org/dist/v22.18.0/node-v22.18.0-x64.msi)

Verify in a new `cmd` window:

```cmd
node --version
:: v22.18.0
npm --version
:: 10.x
```

**Option B — fnm (fast node manager, Unicode-safe)**

```powershell
winget install Schniz.fnm
fnm install 22
fnm use 22
```

**⚠ Why not nvm-windows?**

nvm-windows reads paths through the legacy Windows ANSI code page. If your Windows username contains non-ASCII characters (e.g. `Róbert Csákány`), nvm-windows produces mojibake paths (`R�bert Cs�k�ny`) and fails the existence check when trying to activate a version. Use the MSI or fnm instead.

### 2. Git for Windows (optional but recommended)

Install from [git-scm.com](https://git-scm.com/download/win). During setup, select **"Use Git from the Windows Command Prompt"** so `git` is added to the **system** PATH, not just the Git Bash shell's PATH. Pi-dashboard needs `git` for branch listing, checkout, and stash features.

### 3. Enable long paths (recommended)

Node's `node_modules` nesting can exceed Windows' 260-char default `MAX_PATH`. Enable long paths once (Administrator):

```cmd
reg add "HKLM\SYSTEM\CurrentControlSet\Control\FileSystem" /v LongPathsEnabled /t REG_DWORD /d 1 /f
git config --global core.longpaths true
```

Reboot.

### 4. Windows Build Tools (only if native modules fail)

`node-pty` (terminal emulator) requires native compilation. If `npm install` fails with C++ build errors:

```cmd
npm install --global windows-build-tools
```

Or install the official **Visual Studio Build Tools** via Microsoft's installer with the "Desktop development with C++" workload.

---

## Install (managed location)

All commands assume a standard `cmd.exe`. PowerShell works too with minor quoting changes.

### Step 1 — Create the managed install directory

```cmd
mkdir "%USERPROFILE%\.pi-dashboard"
cd /d "%USERPROFILE%\.pi-dashboard"
```

### Step 2 — Write a minimal `package.json`

`npm init -y` will **fail** here because `.pi-dashboard` starts with a dot — npm package names can't start with a dot. Write one manually:

```cmd
echo {"name":"pi-dashboard-managed","version":"0.0.0","private":true} > package.json
```

### Step 3 — Install pi-coding-agent + tsx

```cmd
npm install @mariozechner/pi-coding-agent tsx
```

- **`@mariozechner/pi-coding-agent`** is the pi agent runtime. The dashboard spawns headless pi sessions by calling its `cli.js` directly (not the `.cmd` wrapper, which would flash a console window).
- **`tsx`** is the fallback TypeScript loader. pi-coding-agent ships `jiti` which the server prefers, but `tsx` covers the path where pi isn't resolvable at server boot.

Verify:

```cmd
dir node_modules\@mariozechner\pi-coding-agent\dist
:: should list index.js
```

### Step 4 — Get the pi-dashboard tarballs

**If installing from an official release:** download the 4 `.tgz` files from the GitHub release assets for pi-agent-dashboard and skip to Step 5.

**If building from source** (e.g. from a feature branch during validation):

On a dev machine (macOS / Linux / Windows):

```bash
git clone -b <branch-name> https://github.com/BlackBeltTechnology/pi-agent-dashboard.git
cd pi-agent-dashboard
npm install
npm run build

mkdir tarballs
npm pack --workspace=packages/shared    --pack-destination=./tarballs
npm pack --workspace=packages/client    --pack-destination=./tarballs
npm pack --workspace=packages/server    --pack-destination=./tarballs
npm pack --workspace=packages/extension --pack-destination=./tarballs
```

Four files are produced:

- `blackbelt-technology-pi-dashboard-shared-<version>.tgz`
- `blackbelt-technology-pi-dashboard-web-<version>.tgz`
- `blackbelt-technology-pi-dashboard-server-<version>.tgz`
- `blackbelt-technology-pi-dashboard-extension-<version>.tgz`

Copy all four to the Windows machine. Convenient location: `%USERPROFILE%\.pi-dashboard\tarballs\`.

### Step 5 — Install all pi-dashboard tarballs

**Order matters** — shared first (others depend on it), then web, server, and extension:

```cmd
cd /d "%USERPROFILE%\.pi-dashboard"

npm install ^
  tarballs\blackbelt-technology-pi-dashboard-shared-0.3.0.tgz ^
  tarballs\blackbelt-technology-pi-dashboard-web-0.3.0.tgz ^
  tarballs\blackbelt-technology-pi-dashboard-server-0.3.0.tgz ^
  tarballs\blackbelt-technology-pi-dashboard-extension-0.3.0.tgz
```

*The `^` is cmd's line-continuation character. One-line form works too.*

**Why a single `npm install` with all four paths?** Each tarball's `package.json` declares sibling deps as `"*"` — meaning "from the npm registry". Installing them in one command lets npm resolve those `*` specifiers against the other tarballs being installed in the same run, rather than trying to fetch unpublished versions from the registry.

Verify:

```cmd
dir node_modules\@blackbelt-technology
:: pi-dashboard-extension
:: pi-dashboard-server
:: pi-dashboard-shared
:: pi-dashboard-web
```

### Step 6 — Launch pi-dashboard

Add the managed install's `.bin` to PATH for the current session, or invoke via `npx`:

```cmd
:: Option A — full path (one-shot)
"%USERPROFILE%\.pi-dashboard\node_modules\.bin\pi-dashboard.cmd" start

:: Option B — via npx from the managed dir
cd /d "%USERPROFILE%\.pi-dashboard"
npx pi-dashboard start

:: Option C — add to user PATH permanently (recommended)
setx PATH "%PATH%;%USERPROFILE%\.pi-dashboard\node_modules\.bin"
:: close and reopen cmd
pi-dashboard start
```

Open a browser at <http://localhost:8000>.

---

## First-run configuration

The dashboard opens with an **empty state landing page** that walks you through three steps:

### ① Setup credentials

Click **Settings** (gear icon, top right) → **Providers**. Configure at least one LLM provider (OpenAI, Anthropic, Google, etc.) via API key or OAuth.

### ② Add a folder

Click **Add folder** (top right of the sidebar). Navigate to a project directory and select it.

### ③ Start a session

Click **+ Session** on the pinned folder. A pi agent spawns; you can send prompts from the chat view.

If **+ Session** produces a `Spawn failed` banner, see the *Troubleshooting* section below.

---

## Troubleshooting

### `Spawn failed: [headless] Windows pi spawn requires node.exe + cli.js (managed install). Found only pi.cmd on PATH.`

The dashboard found the pi CLI wrapper (`pi.cmd`) but can't locate the pi-coding-agent module's `dist/index.js`. Windows headless spawn can't use `.cmd` files (spawning `.cmd` requires `shell:true`, which is incompatible with detached spawn).

**Fix 1 — Rescan tools (if you just installed pi-coding-agent)**

Settings → Tools → click **Rescan** (top right). The `pi-coding-agent` row should flip to ✓ with source=`managed`.

**Fix 2 — Manual override**

In Settings → Tools, click to expand the `pi-coding-agent` row. Paste the full path into the override input:

```
C:\Users\<you>\.pi-dashboard\node_modules\@mariozechner\pi-coding-agent\dist\index.js
```

Click the row's rescan button. The override is persisted to `%USERPROFILE%\.pi\dashboard\tool-overrides.json`.

**Fix 3 — Restart the server**

If pi-coding-agent was installed *after* the server started, its cached environment is stale:

```cmd
pi-dashboard stop
pi-dashboard start
```

### `Spawn failed: [headless] Directory does not exist: <name>`

A pinned folder points to a path that doesn't exist. Either:

- Unpin it via the 📌 icon and re-add with a valid absolute path, or
- Edit `%USERPROFILE%\.pi\dashboard\preferences.json` manually (stop the server first) and remove the stale entry from `pinnedDirectories`.

### Tools says `git` is not found even though `where git` works

The server inherited a PATH from a shell that didn't have git on it. Fix:

```cmd
taskkill /F /IM node.exe
where git
:: confirm path shown, e.g. C:\Program Files\Git\cmd\git.exe
cd /d "%USERPROFILE%\.pi-dashboard"
pi-dashboard start
```

The new server inherits the current cmd's PATH. Then **Settings → Tools → Rescan**.

If it still fails: paste the `where git` output into the git row's override field.

### `EPERM: operation not permitted, rmdir ...node_modules\electron-installer-debian\...`

Cosmetic `npm warn cleanup`. Windows has a file handle on a transitive dependency npm is trying to clean up. Safe to ignore if `npm ls --depth=0` reports no errors.

If it blocks the install: close VS Code / File Explorer windows in the path, disable antivirus temporarily, or `rmdir /S /Q node_modules && del package-lock.json && npm install`.

### `npm ERR! E404 ... @blackbelt-technology/pi-dashboard-shared is not in this registry`

You ran `npm install -g <one-tarball>.tgz` instead of installing all four tarballs together. Global install treats each tarball as isolated and re-resolves sibling `*` deps from the registry.

Fix: run `npm install` with **all four tarball paths in one command** inside `%USERPROFILE%\.pi-dashboard` (see Step 5).

### `Cannot find package 'tsx' imported from C:\...`

You installed the dashboard tarballs but forgot Step 3. Run:

```cmd
cd /d "%USERPROFILE%\.pi-dashboard"
npm install tsx @mariozechner/pi-coding-agent
```

### `Path "..." does not exist` errors on paths with non-ASCII characters

If your Windows username contains accented characters (common for Hungarian / other non-English locales), some legacy Node / npm code paths misread the PATH/HOME environment variables. Workarounds:

- Move npm cache to an ASCII path:
  ```cmd
  npm config set cache C:\npm-cache
  ```
- Move the managed install to an ASCII path:
  ```cmd
  mkdir C:\pi-dashboard
  :: then install everything into C:\pi-dashboard instead of %USERPROFILE%\.pi-dashboard
  ```
  Note that using a non-default location means the dashboard's `managed` tool-resolution strategy won't find pi-coding-agent automatically — you'll need to set the override manually in Settings → Tools.

### Dashboard starts but terminals don't work in packaged Electron build

The packaged build requires executable permissions on `node-pty`'s spawn helper. This is a known category of issue we fix at install time for npm installs, but packaged Electron bundles need their own bundle-time fix. If terminals silently fail in a DMG / AppImage / NSIS build, file an issue with the build log attached.

---

## Upgrading

To upgrade to a new tarball version:

```cmd
cd /d "%USERPROFILE%\.pi-dashboard"
pi-dashboard stop

:: Replace all four .tgz files in tarballs\ with new versions, then:
npm install ^
  tarballs\blackbelt-technology-pi-dashboard-shared-<new>.tgz ^
  tarballs\blackbelt-technology-pi-dashboard-web-<new>.tgz ^
  tarballs\blackbelt-technology-pi-dashboard-server-<new>.tgz ^
  tarballs\blackbelt-technology-pi-dashboard-extension-<new>.tgz

pi-dashboard start
```

Your `%USERPROFILE%\.pi\dashboard\*` (config, preferences, tool overrides) and `%USERPROFILE%\.pi\agent\sessions\` (session history) are preserved across upgrades.

---

## Uninstall

```cmd
pi-dashboard stop
rmdir /S /Q "%USERPROFILE%\.pi-dashboard"

:: Optional: remove all config and session history too
rmdir /S /Q "%USERPROFILE%\.pi\dashboard"
rmdir /S /Q "%USERPROFILE%\.pi\agent\sessions"
```

If you added the managed install to PATH via `setx`, remove that PATH entry via **Settings → System → Advanced system settings → Environment Variables**.

---

## Directory reference

| Path | Purpose |
|---|---|
| `%USERPROFILE%\.pi-dashboard\node_modules\` | Installed dashboard + pi-coding-agent + tsx |
| `%USERPROFILE%\.pi-dashboard\package.json` | Managed install manifest (`name: pi-dashboard-managed`) |
| `%USERPROFILE%\.pi\dashboard\server.log` | Server stdout/stderr (append mode, timestamped) |
| `%USERPROFILE%\.pi\dashboard\preferences.json` | Pinned folders, session ordering |
| `%USERPROFILE%\.pi\dashboard\tool-overrides.json` | Per-tool path overrides from Settings → Tools |
| `%USERPROFILE%\.pi\dashboard\headless-pids.json` | Tracked child PIDs for orphan cleanup |
| `%USERPROFILE%\.pi\agent\sessions\` | pi agent session history (JSONL per session) |
| `%USERPROFILE%\.pi\agent\settings.json` | pi agent extension registration (auto-managed) |

---

## Getting help

- Check `%USERPROFILE%\.pi\dashboard\server.log` for startup errors.
- Run **Settings → Tools → Export** to download a diagnostic file showing every tool's resolution trail — helpful when filing an issue.
- Open a GitHub issue with the diagnostic export and the `server.log` excerpt attached.
