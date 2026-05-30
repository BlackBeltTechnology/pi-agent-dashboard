# Electron Desktop App — Session Notes

Record of full implementation session: what built, what tried, what failed, lessons learned. Documents real journey including dead ends, so future work doesn't repeat mistakes.

## Session Timeline

### Phase 1: Branding & Icons
**Goal**: Fix missing app icon, tray, About dialog, app name.

**Starting state**: No icons anywhere. Tray used `nativeImage.createEmpty()` (invisible). No About dialog. Window title showed package.json name (`@blackbelt-technology/pi-dashboard-electron`).

**What we did**:
1. Used `nano-banana` (Gemini AI) to recenter π glyph in existing 512px icon → generated 1024×1024 master
2. Created macOS tray template icons (white π on transparent) via ImageMagick — AI couldn't generate actual transparency (produced checkerboard pattern instead)
3. Added `electron-icon-builder` to generate `.icns` + `.ico` from master PNG
4. Wired icon into `forge.config.ts` `packagerConfig.icon`
5. Fixed tray.ts with platform-specific icon loading
6. Created `app-menu.ts` with macOS menu (About, Edit, View, Window)
7. Set `app.name = "PI Dashboard"` + `title: "PI Dashboard"` on BrowserWindow

**Gotcha**: Electron Packager renames icon → `electron.icns` internally — verified our custom icon via MD5 comparison.

### Phase 2: Packaging Formats
**Goal**: Replace Squirrel (Windows) with NSIS, add AppImage (Linux).

**What tried first** (FAILED):
- `electron-forge-maker-nsis` + `electron-forge-maker-appimage` from electron-builder — wrap `app-builder-lib.buildForge()` + export plain function, NOT MakerBase class. Caused `TypeError: paths[0] must be of type string` in Forge's module resolution.

**What worked**:
- `@felixrieseberg/electron-forge-maker-nsis` — proper MakerBase implementation
- `@pengx17/electron-forge-maker-appimage` — proper MakerBase implementation

**Other issues hit during `npm run make`**:
1. Vite plugin expected `main` in package.json to be `.vite/*` → fixed by setting `"main": ".vite/build/main.js"` + adding `fileName: () => "main.js"` to vite.main.config.ts
2. `extraResource: ["./resources/node"]` failed when Node binary not downloaded → made conditional with `fs.existsSync()`
3. `appdmg` native module failed to build on Node v25 (V8 API changes) → only buildable on Node 22
4. Node 22.11 couldn't `require()` Vite 8 (ESM-only) → need Node 22.12+

### Phase 3: Cross-Platform Build Script
**Goal**: One command to build for all platforms from macOS.

**Architecture**:
- macOS: builds natively (only platform that can make DMG)
- Linux: Docker container with build tools → DEB + AppImage
- Windows: Docker container with NSIS → exe (theory; Wine issues in practice)

**Docker issues encountered** (in order):
1. `node:22-bookworm` base image had GPG signature errors → switched to `bookworm-slim`
2. Even `-slim` had GPG errors → added `--allow-unauthenticated` apt flag
3. Disk space errors → `docker system prune -af` + `docker builder prune -af`
4. Missing `curl` → added to apt install
5. Missing `ca-certificates` → added (curl SSL errors)
6. Missing `xz-utils` → added (tar couldn't extract .tar.xz)
7. `nsis` package not in bookworm repos → made optional (non-fatal install)
8. `wine32:i386` failed to install → made optional (non-fatal)
9. `npx electron-forge` resolved to ancient v5.2.4 → changed to `npx @electron-forge/cli make`

### Phase 4: macOS Catalina Support
**Goal**: Run on macOS 10.15 (Catalina) in VMware.

**What tried** (FAILED):
- `extendInfo: { LSMinimumSystemVersion: "10.15" }` in forge.config.ts — changes plist but Mach-O binary has `minos 11.0` baked in at compile time. Verified with `otool -l` showing `minos 11.0` + `sdk 14.0`. macOS refuses to load binary.

**What worked**: Downgraded Electron 33 → Electron 32 (`"electron": "^32.0.0"`). Electron 32 = last version supporting macOS 10.15.

### Phase 5: VM White Screen Fix
**Goal**: Fix blank white screen on VMware macOS.

**Root cause**: VMware's virtual GPU doesn't support hardware acceleration required by Chromium.

**What tried** (FAILED):
- `ELECTRON_DISABLE_GPU=1 open "PI Dashboard.app"` — macOS `open` doesn't pass env vars to app bundle. Variable never reaches Electron process.

**What worked**: Auto-detect VM at startup before `app.whenReady()`:
- macOS: `sysctl -n hw.model` → checks for "VMware"/"VirtualBox"/"Parallels"
- Linux: `systemd-detect-virt`
- Windows: WMIC BIOS serial number
- Calls `app.disableHardwareAcceleration()` + `appendSwitch("disable-gpu")`

### Phase 6: Loading Page & Error Handling
**Goal**: No more blank white pages when server isn't running.

**Problems**:
1. Dev mode blindly loaded `localhost:8000` → white page if server down
2. Production mode called `dialog.showErrorBox()` + quit on failure
3. Outer `main().catch()` silently quit on any unhandled error

**Solution**: Branded loading page with π symbol, animated dots, retry:
- Shows "Connecting to dashboard..." for first 15 seconds
- Then shows error with installation instructions
- Keeps retrying in background — auto-redirects when server appears
- Error dialog now shows 3 options: "Run Setup", "Retry", "Quit"
- Outer catch shows error in dialog instead of silent quit

### Phase 7: First-Run Wizard & Self-Contained App
**Goal**: App MUST work on completely clean OS with nothing installed.

**Problem**: `@blackbelt-technology/pi-dashboard` not published to npm → wizard can't install it.

**Solution**: Bundle server as extraResource instead of installing from npm.
- `bundle-server.mjs` copies `packages/server/` + `packages/shared/` + built web client
- Wizard only installs: pi, openspec, tsx (no dashboard package)
- Server lifecycle finds CLI at `resources/server/packages/server/src/cli.ts`

**Wizard issue**: `execSync` for npm install blocked Electron's main process → "PI Dashboard is not responding". Fixed by switching to async `exec` wrapped in Promises.

**PATH issue**: Bundled Node used for npm, but postinstall scripts (`protobufjs`) couldn't find `node` because bundled binary not on PATH. Fixed by prepending `path.dirname(getBundledNodePath())` to `env.PATH`.

### Phase 8: The __dirname Saga (Multiple Attempts)

> **UPDATE**: Second `__dirname` issue found in Phase 11 — affecting Vite-bundled main process itself (not server). See Phase 11 below.

Longest debugging effort. Dashboard server crashed with `__dirname is not defined` when launched from Electron app.

**Attempt 1**: Assumed node-pty being loaded as ESM due to `"type": "module"` propagation.
- Changed bundle root package.json to remove `"type": "module"` → **didn't fix**

**Attempt 2**: Created `dirname-shim.js` setting `globalThis.__dirname` as getter returning `process.cwd()`. Added as `--import` before tsx.
- **Didn't fix** — error came from node-pty's CJS require chain, not ESM imports

**Attempt 3**: Tried `tsx/dist/register.js` instead of `tsx/dist/esm/index.mjs` (register.js does CJS+ESM shimming).
- **File didn't exist** in installed tsx version

**Attempt 4**: Added `dirname-shim.js` as extraResource, loaded via `--import` flag.
- **Didn't fix**

**Attempt 5 — Docker test environment**: Created `test-server-launch.sh` running exact launch command in Docker. Revealed:
- node-pty's `package.json` correctly has NO `"type": "module"`
- package.json chain showed all `(none/cjs)` — no ESM leak
- REAL error: `Failed to load native module: pty.node` — wrong platform binary, not `__dirname`!

**Attempt 6**: `__dirname` error on actual VM was DIFFERENT issue from Docker test. VM had stale `~/.pi-dashboard` files. But core discovery from Docker testing:
- `node --import tsx/dist/esm/index.mjs cli.ts` → no `__dirname` shim
- `tsx cli.ts` (tsx binary) → **works perfectly**, shims everything

**Final solution**: Rewrote `server-lifecycle.ts` to find + use `tsx` binary directly:
```
spawn(tsxBin, [cliPath, "--port", port, "--pi-port", piPort])
```
Instead of:
```
spawn(nodePath, ["--import", tsxLoader, cliPath, "--port", port, "--pi-port", piPort])
```

### Phase 9: Native Module Platform Mismatch

**Problem**: `bundle-server.mjs` runs `npm install` on macOS → builds `pty.node` for `darwin-arm64`. `.deb` package ships with macOS binaries. On Linux VM: `Failed to load native module: pty.node, prebuilds/linux-x64: not found`.

**What tried**:
1. `npm rebuild` inside Docker after copying bundle → **built from source but only if build tools (python3, make, g++) present**
2. Needed to copy built `pty.node` to `prebuilds/linux-x64/` + remove macOS/Windows prebuilds

**Final solution**: Two-phase bundling:
1. `bundle-server.mjs --source-only` — copies source + client, NO npm install (no macOS binaries)
2. `docker-make.sh` runs `npm install` inside Linux container → correct native modules
3. Copies `build/Release/pty.node` → `prebuilds/linux-x64/pty.node`
4. Removes `prebuilds/darwin-*` + `prebuilds/win32-*`

### Phase 10: Doctor Diagnostic

**Goal**: In-app diagnostic to check all components + help users fix issues.

**Checks** (12 total):
| Check | What it reports |
|-------|----------------|
| Electron | Version, Chromium version, app version, platform |
| System Node.js | Version, path (or "not found, bundled will be used") |
| Bundled Node.js | Version, path in app resources |
| Bundled npm | Version, path |
| pi CLI | Version, source (system/managed), path |
| openspec CLI | Version, source, path |
| Dashboard server code | Version, location (bundled/managed/system) |
| TypeScript loader (tsx) | Version, source, path |
| Dashboard server | Running status, version, mode, URL |
| Setup wizard | Completion status, mode, timestamp |
| API key | Configured or not |
| Managed install | Directory status |
| Server log | Last 10 lines (if server not running) |
| Server launch test | Attempts actual launch to capture crash message |

Accessible from: macOS → PI Dashboard menu → Doctor; Windows/Linux → Help → Doctor.

## Architecture

```mermaid
graph TD
    A[Electron App] -->|discovers/launches| B[Dashboard Server]
    A -->|BrowserWindow loads| C[http://localhost:8000]
    B -->|serves| D[Web Client build]
    B -->|WebSocket| E[Pi Gateway :9999]
    
    subgraph "Bundled in App Resources"
        F[resources/node/ — Node.js binary]
        G[resources/server/ — Server source + deps + client build]
        H[resources/renderer/ — Wizard HTML]
        I[resources/icon.icns/.ico/.png]
    end
    
    subgraph "~/.pi-dashboard/ Managed Install"
        J[pi CLI]
        K[openspec CLI]
        L[tsx binary]
        M[mode.json — wizard state]
        N[server.log — launch diagnostics]
    end
    
    A -->|wizard installs| J
    A -->|spawns| L
    L -->|runs| G
```

## Key Technical Details

### Server Launch Command
```bash
# What the Electron app actually runs:
/home/user/.pi-dashboard/node_modules/.bin/tsx \
  /usr/lib/pi-dashboard/resources/server/packages/server/src/cli.ts \
  --port 8000 --pi-port 9999

# Environment:
PATH=/usr/lib/pi-dashboard/resources/node/bin:~/.pi-dashboard/node_modules/.bin:$PATH
NODE_PATH=/usr/lib/pi-dashboard/resources/server/node_modules:~/.pi-dashboard/node_modules
```

### Server CLI Resolution Order
1. Bundled: `process.resourcesPath/server/packages/server/src/cli.ts`
2. Dev mode: `../../server/src/cli.ts` (relative to electron package)
3. Managed: `~/.pi-dashboard/node_modules/@blackbelt-technology/pi-dashboard/packages/server/src/cli.ts`
4. `require.resolve("@blackbelt-technology/pi-dashboard-server/cli.ts")`

### tsx Binary Resolution Order
1. Managed: `~/.pi-dashboard/node_modules/.bin/tsx`
2. System PATH: `which tsx`

### Wizard Install List
```javascript
// These installed into ~/.pi-dashboard/ via bundled npm:
const packages = [
  "@earendil-works/pi-coding-agent",   // pi CLI
  "@fission-ai/openspec",            // openspec CLI
  "tsx",                              // TypeScript runner
];
// Note: dashboard server NOT installed — bundled in app
```

## File Layout

```
packages/electron/
├── forge.config.ts          — Electron Forge: makers, plugins, extraResource, executableName
├── package.json             — Electron 32.x, forge makers, electron-icon-builder
├── vite.main.config.ts      — Vite config for main process (fileName: "main.js")
├── vite.preload.config.ts   — Vite config for preload script (CJS format)
├── entitlements.plist        — macOS code signing entitlements
├── src/
│   ├── main.ts              — Entry: VM detect, single-instance, wizard, server launch, loading page, tray
│   ├── preload.ts           — contextBridge IPC for wizard renderer
│   ├── renderer/
│   │   └── wizard.html      — First-run setup wizard (mode select, install progress, API key)
│   └── lib/
│       ├── app-menu.ts      — Platform menus: macOS full / Win+Linux with View+About+Doctor, clipboard copy
│       ├── app-updater.ts   — electron-updater for GitHub Releases auto-update
│       ├── bundled-node.ts  — Resolve bundled Node.js/npm paths (packaged vs dev)
│       ├── dependency-detector.ts  — Detect pi, openspec, Node.js on PATH + managed install
│       ├── dependency-installer.ts — Async npm install with streaming progress + bundled Node on PATH
│       ├── doctor.ts        — 12+ diagnostic checks with versions, paths, launch test
│       ├── server-lifecycle.ts     — Health check → tsx binary spawn (inlined config, no shared pkg imports)
│       ├── tray.ts          — System tray: template image (macOS), ico (Win), png (Linux)
│       ├── ts-loader-resolver.ts   — Find tsx CJS register / ESM loader paths
│       ├── update-checker.ts       — Polls for dependency updates
│       ├── update-notifier.ts      — Shows update notifications
│       ├── window-state.ts  — Persists window bounds + maximized state
│       ├── wizard-ipc.ts    — IPC handlers: detect, install, save key, complete
│       └── wizard-state.ts  — Reads/writes mode.json, API key detection
├── resources/
│   ├── icon.png             — Master 1024×1024 RGBA (macOS squircle, transparent bg, π on dark navy)
│   ├── icon.icns            — macOS app icon (multi-resolution, generated)
│   ├── icon.ico             — Windows app icon (multi-resolution, generated)
│   ├── trayTemplate.png     — macOS tray 16×16 (white π on transparent)
│   ├── trayTemplate@2x.png  — macOS tray 32×32 (white π on transparent)
│   ├── desktop.ejs          — Linux .desktop template (StartupWMClass, keywords)
│   ├── dirname-shim.js      — Global __dirname fallback (safety net, may not be needed)
│   ├── icons/               — Generated resized PNGs (build artifact, gitignored)
│   ├── node/                — Bundled Node.js binary (build artifact, gitignored)
│   └── server/              — Bundled server + deps + client (build artifact, gitignored)
└── scripts/
    ├── build-installer.sh   — Main build: native + Docker (--linux, --windows, --all, --skip-client)
    ├── bundle-server.mjs    — Bundle server source + deps (--source-only for cross-platform)
    ├── docker-make.sh       — Docker entrypoint: source-only bundle → npm install → native rebuild → forge make
    ├── download-node.sh     — Download + strip Node.js binary for bundling
    ├── test-server-launch.sh     — Quick Docker server launch test
    ├── test-electron-install.sh   — Bundled-server Docker test (layout, pi-floor, spawn, health, session)
    ├── test-electron-install-inner.sh — Inner script for bundled-server test
    ├── test-deb-install.sh        — DEB install + Electron app Docker test (xvfb headless)
    ├── test-deb-install-inner.sh  — Inner script for DEB test
    ├── test-desktop-launch.sh     — Desktop-launch Docker test, minimal PATH (no system node)
    ├── test-desktop-launch-inner.sh — Inner script for desktop-launch test
    └── Dockerfile.build           — node:22-bookworm-slim + build tools
```

## Build Commands

```bash
# === Native build (current platform) ===
npm run electron:build

# === Cross-platform via Docker ===
npm run electron:build -- --linux          # DEB + AppImage
npm run electron:build -- --windows        # NSIS .exe (needs Wine, fragile)
npm run electron:build -- --all            # Native + Linux + Windows
npm run electron:build -- --skip-client    # Skip web client rebuild

# === Low-level commands ===
cd packages/electron
npm run package                            # Package only (no installer)
npm run make                               # Package + make installer
npm run icons                              # Regenerate .icns/.ico from master PNG
npm run start:dev                          # Dev mode (ELECTRON_DEV=1)

# === Test (Docker) ===
bash packages/electron/scripts/test-electron-install.sh  # Bundled-server: layout + pi-floor + spawn + health + session
bash packages/electron/scripts/test-deb-install.sh       # DEB install + Electron app under xvfb
bash packages/electron/scripts/test-desktop-launch.sh    # Desktop PATH (no system node), Electron launch + session
bash packages/electron/scripts/test-server-launch.sh     # Quick server launch test

# === Debug ===
cat ~/.pi-dashboard/server.log                           # Server launch diagnostics

# === Clean ===
rm -rf packages/electron/out                             # Built installers
rm -rf packages/electron/resources/server                # Bundled server
rm -rf packages/electron/resources/node                  # Bundled Node.js
docker rmi pi-dashboard-electron-builder                 # Docker build image
```

## CI Workflow

`.github/workflows/electron-build.yml` — triggers on `v*` tags or `workflow_dispatch`.

| Runner | Platform | Outputs | Notes |
|--------|----------|---------|-------|
| `macos-14` | darwin/arm64 | `.dmg` | Native ARM |
| `macos-13` | darwin/x64 | `.dmg` | Native Intel |
| `ubuntu-latest` | linux/x64 | `.deb` + `.AppImage` | Installs dpkg, fakeroot, libarchive-tools |
| `windows-latest` | win32/x64 | `.exe` (NSIS) | Native, no Wine needed |

Each runner builds natively. No cross-compilation in CI. Release job creates draft GitHub Release with all artifacts.

**Local testing with `act`**: Only Linux jobs work (Docker-based). macOS/Windows need real runners.

## Startup Flow (Clean OS)

```mermaid
graph TD
    A[App starts] --> B{VM detected?}
    B -->|yes| C[Disable GPU]
    B -->|no| D[Continue]
    C --> D
    D --> E{First run?}
    E -->|yes| F[Setup Wizard]
    F --> G{Mode?}
    G -->|standalone| H[Install pi + openspec + tsx]
    G -->|power-user| I[Verify existing install]
    H --> J[API key setup]
    I --> J
    J --> K[Save mode.json]
    K --> L[ensureServer]
    E -->|no| L
    L --> O{Health check?}
    O -->|running| N[Connect]
    O -->|down| P[Spawn tsx cli.ts]
    P --> Q{Up in 15s?}
    Q -->|yes| N
    Q -->|no| R[Error: Setup / Retry / Quit]
    R -->|setup| F
    R -->|retry| L
    R -->|quit| S[Exit]
    N --> T[Loading page π]
    T --> U{/api/health?}
    U -->|ok| V[Load dashboard]
    U -->|fail 15s| W[Show error + instructions]
    W -->|keeps retrying| U
```

## Lessons Learned

1. **tsx binary vs --import**: Always use `tsx` binary to run TypeScript servers. `--import` ESM loader doesn't shim CJS globals (`__dirname`, `__filename`). Wasted hours debugging.

2. **Native modules platform-specific**: `npm install` on macOS builds `.node` files for macOS. MUST rebuild inside target platform's environment (Docker for Linux, native runner for Windows).

3. **`"type": "module"` propagation**: Node.js walks up directory tree to find `package.json`. Parent has `"type": "module"` → ALL `.js` files underneath treated as ESM, including CJS packages in `node_modules`. Bundle root MUST NOT have this field.

4. **Electron version = macOS minimum**: `minos` field in Mach-O binary set at Electron compile time. No plist override changes it. MUST use right Electron version for target OS.

5. **macOS `open` doesn't pass env vars**: Can't use `ELECTRON_DISABLE_GPU=1 open "App.app"`. MUST detect VMs programmatically.

6. **Forge maker API**: Official `@electron-forge/maker-*` packages extend `MakerBase`. Community wrappers from electron-builder (`electron-forge-maker-*`) export plain functions — incompatible with Forge 7.x module resolution.

7. **Docker disk space**: Electron builds with full `npm ci` need significant disk space. `docker system prune -af --volumes` before builds. Increase Docker Desktop disk limit if needed.

8. **`npx` package name resolution**: `npx electron-forge` resolves to deprecated v5, not `@electron-forge/cli`. Always use full scoped name.

9. **Async critical in Electron main process**: `execSync` blocks main process + freezes UI. All npm install, detection, spawn ops MUST be async.

10. **Bundle server, don't install it**: npm package not published → bundle source + deps as extraResource. Wizard only installs external tools (pi, tsx).

11. **ESM dynamic imports fail in packaged Electron**: Lazy `import()` of `@scope/package` cannot resolve packages in `resources/server/node_modules/` from Electron main process. Inline functionality instead.

12. **`process.resourcesPath` is Electron-only**: tsx-launched server process does NOT have `process.resourcesPath`. Use `process.execPath` to find running Node.js binary.

13. **Desktop launchers don't source shell profiles**: Electron apps on Linux get minimal PATH (`/usr/local/bin:/usr/bin:/bin`). `~/.local/bin` + other user dirs missing. `buildSpawnEnv()` MUST add explicitly.

14. **`stdio: "ignore"` breaks shell pipelines**: `sleep N | cmd` inside `sh -c` fails when sh's stdin is `/dev/null`. Use `tail -f /dev/null | cmd` — `tail -f` uses inotify + doesn't depend on outer stdin.

15. **`window-all-closed` fires after wizard**: On Linux, closing wizard window triggers `window-all-closed` before main window exists. Guard with startup flag.

### Phase 11: __dirname in Vite ESM Bundle (Linux)

**Problem**: Even after Phase 8's tsx fix, Electron app crashed on Linux with `__dirname is not defined` — but in **main process** itself, not server.

**Root cause**: Electron main process bundled by Vite as ESM (`"type": "module"` in electron's `package.json`, output uses `import` statements). In ESM, `__dirname` not available. Two source files used bare `__dirname` without defining it:

1. `packages/electron/src/lib/bundled-node.ts` — `getResourcesPath()` dev fallback
2. `packages/electron/src/lib/server-lifecycle.ts` — `findServerCli()` dev candidate path

Two other files (`wizard-window.ts`, `tray.ts`) already had correct pattern.

**Why worked on macOS**: `process.resourcesPath` always found first in packaged builds, so `__dirname` fallback never evaluated. But in ESM, array literal `[..., path.resolve(__dirname, ...), ...]` evaluates ALL elements eagerly — `__dirname` throws `ReferenceError` even if result would be filtered out.

**Fix**: Added ESM-compatible `__dirname` derivation to both files:
```typescript
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
```

### Phase 12: Docker Install Test

**Goal**: Automated end-to-end test verifying full Electron app install + wizard + server launch flow on clean Linux.

**What tests** (19 checks):
1. Bundled resources (Node.js, npm, server CLI, node_modules)
2. Package.json safety (no `"type": "module"` leaking into CJS deps)
3. Native module verification (node-pty prebuild for linux-x64, no macOS/Windows leaks)
4. Wizard simulation (tsx install, mode.json creation)
5. `__dirname` safety (ESM derivation, CJS shimming, node-pty loading)
6. Server launch + health check + API endpoint verification

**Architecture**: Docker container with Ubuntu 22.04, downloads Linux x64 Node.js in build phase, npm-installs server deps (building native modules from source), runs tests as non-root user.

**Command**: `bash packages/electron/scripts/test-electron-install.sh`

### Phase 13: Server Lifecycle — Inlined Config & Health Check

**Problem**: After wizard completed, `ensureServer()` failed because used dynamic `import()` to load `@blackbelt-technology/pi-dashboard-shared`. In packaged Electron app, those packages inside `resources/server/node_modules/` which ESM dynamic imports **cannot resolve** from Electron main process.

**Fix**: Replaced all lazy imports in `server-lifecycle.ts` with inlined implementations:
- `loadMinimalConfig()` — reads port/piPort directly from `~/.pi/dashboard/config.json`
- `isDashboardRunning()` — simple HTTP fetch to `/api/health`
- Removed mDNS discovery (not needed for local Electron launch)

### Phase 14: Window Close & Startup Guard

**Problem 1**: On Linux/Windows, closing Electron window hid it to system tray (macOS convention). On Linux, tray often invisible → user can't quit app.

**Fix**: Only macOS uses hide-to-tray. Linux/Windows quit on close via `window-all-closed` handler.

**Problem 2**: `window-all-closed` handler fired when wizard window closed (before main window existed), quitting app before dashboard launched.

**Fix**: Added `isStartingUp` guard — `window-all-closed` only calls `quit()` after startup completes.

**Problem 3**: Fallback `serverUrl` path used broken `import()` from shared package.

**Fix**: Replaced with hardcoded default `http://localhost:8000`.

### Phase 15: Client Build Path in Bundled Server

**Problem**: Server logged "No client build found — running in API-only mode". `bundle-server.mjs` copied client to `dist/client/` but server resolves `path.join(__dirname, '../../dist/client')` from `packages/server/src/`, which goes up to `packages/` — expecting client at `packages/dist/client/`.

**Fix**: Changed `bundle-server.mjs` to copy client to `packages/dist/client/`.

### Phase 16: Node.js on PATH for Spawned Scripts

**Problem**: `pi` binary uses `#!/usr/bin/env node` shebang. On Linux VM with no system Node.js (only bundled at `/usr/lib/pi-dashboard/resources/node/bin/`), spawned `pi` failed with `/usr/bin/env: 'node': No such file or directory`.

**What didn't work**: Using `process.resourcesPath` to find bundled Node.js — Electron-only property, always `undefined` in tsx-launched server process.

**Fix**: `buildSpawnEnv()` in `process-manager.ts` now adds:
- `path.dirname(process.execPath)` — reliably finds current Node.js binary
- `~/.local/bin`, `~/.npm-global/bin`, `/usr/local/bin` — common user bin dirs missing from desktop launcher PATH

### Phase 17: Headless Session Spawn — The stdin Pipeline Bug

**Problem**: `pi --mode rpc` exited immediately when spawned by server. Extensive debugging revealed:
- Pi exits cleanly (code 0) with zero output
- Pi works fine from interactive terminal
- Pi works when spawned by Node.js with `stdio: ['pipe', 'pipe', 'pipe']`
- Pi dies when outer shell's stdin is `/dev/null` (which `stdio: "ignore"` sets)

**Root cause**: `sleep 2147483647 | pi --mode rpc` pipeline fails when shell's own stdin is `/dev/null`. Shell's `/dev/null` stdin interferes with internal pipeline pipe setup, causing pi to receive EOF on stdin + exit immediately. Linux-specific shell behavior.

**What didn't work**:
1. `stdio: ["pipe", "ignore", "ignore"]` — stdin pipe gets GC'd by Node.js after `unref()`, closing write end
2. Spawning pi directly (no shell wrapper) — same GC issue with detached+unref
3. `setsid` vs no-setsid — not the cause

**Fix**: Replaced `sleep 2147483647` with `tail -f /dev/null` as pipe-keeping process. `tail -f /dev/null` uses inotify internally + doesn't depend on shell's stdin, so works correctly even when outer shell has `stdio: "ignore"` (`/dev/null`).

```typescript
spawn("sh", ["-c", `tail -f /dev/null | ${piCmd}`], {
  cwd, detached: true, stdio: "ignore", env,
});
```

### Phase 18: Additional Improvements

- **Doctor → Copy to Clipboard**: Doctor dialog now has "Copy to Clipboard" button
- **Menu restructured (Linux/Windows)**: About + Doctor top-level menu items; View menu with Reload, DevTools, Zoom
- **OAuth popup close detection**: Detects when user closes OAuth window without completing (e.g., Claude without Pro plan), shows helpful message instead of infinite spinner
- **Wizard install progress**: Animated pulse on running items, elapsed timer per package, live npm output streaming
- **VS Code Server install guide**: Added openvscode-server as alternative installation option
- **API key save fix**: `acquireLock()` creates `~/.pi/agent/` directory before lock; provider ID mapping fixed for auth.json
- **Icon refresh**: macOS-style squircle with transparent background, ~28% corner radius, regenerated .icns/.ico
- **Auto-shutdown default**: Changed `autoShutdown` from `true` → `false` (only useful for TUI auto-start)

### Phase 19: Docker Test Suite

Three levels of Docker-based testing:

| Test | Command | What tests |
|------|---------|---------------|
| Bundled server | `test-electron-install.sh` | Bundle layout (node, jiti, cli.ts, pi-coding-agent, node-pty prebuild), pi version meets `piCompatibility.minimum`, spawn via bundled node + jiti loader, `/api/health`, `/api/session/spawn`, clean shutdown |
| DEB install | `test-deb-install.sh` | DEB layout, pi-floor check, xvfb-headless Electron launch, `/api/health`, sessions API, session spawn, clean shutdown |
| Desktop launch | `test-desktop-launch.sh` | Minimal PATH (no system node), bundled node present, pi-floor check, Electron under `env -i PATH=$DESKTOP_PATH`, session spawn |

Desktop-launch test catches bugs that only appear on real Linux desktops where Electron app started from `.desktop` file with minimal PATH.

All three rewritten under change `bump-pi-compat-to-0-78` for the bundle-only flow (pre-R3 managed-dir extract + offline-cacache install + wizard runtime-install stages removed; pi/openspec/tsx now ship pre-installed in `resources/server/node_modules/`).

### Phase 20: Bridge Extension Bundling & Auto-Registration

**Problem**: Pi sessions spawned from Electron app appeared briefly in dashboard then vanished. pi process started but never connected back to dashboard server.

**Root cause**: Bridge extension (`packages/extension/`) NOT bundled in DEB/DMG package. Without it, pi had no way to discover + connect to dashboard's WebSocket gateway. Extension only discoverable in dev mode (via monorepo root `package.json` `"pi"` field).

**Fix** (3 parts):
1. **`bundle-server.mjs`** — Added `packages/extension/` to server bundle + included in workspace list so its dependencies (`ws`, shared types) resolve via `node_modules/`.
2. **`extension-register.ts`** — New server module detecting bundled extension path + adding to `~/.pi/agent/settings.json` (pi's global package list). No-op in dev mode (no bundled extension). Cleans stale dashboard paths on location change.
3. **`server.ts`** — Calls `ensureBridgeExtensionRegistered()` at startup, before session discovery.

**Why works**: Pi discovers extensions from packages listed in `~/.pi/agent/settings.json`. Local paths resolved in-place. Extension's `package.json` has `"pi"` field declaring `src/bridge.ts` as extension. Dependencies resolve via server bundle's workspace `node_modules/` (shared types, ws). Docker test updated to verify extension bundled.

### Phase 21: Windows Support — Vite Externals, Paths with Spaces, .cmd Spawning

**Problem**: Windows portable exe crashed immediately with no visible error. Even diagnostic log file never created.

**Root cause chain** (4 issues fixed):

1. **Vite bundling Node.js builtins** — `vite.main.config.ts` only externalized `electron` + `electron-updater`. All Node.js builtins (`node:fs`, `node:path`, etc.) bundled by Vite, broke `require()` calls. Bundled ESM environment didn't expose `require`, causing `Error: Calling 'require' for "node:fs" in an environment that doesn't expose the require function`. Fixed by adding all `builtinModules` to `external` list in both `vite.main.config.ts` + `vite.preload.config.ts`.

2. **Bundled npm path on Windows** — `getBundledNpmPath()` only checked `node/lib/node_modules/npm/bin/npm-cli.js` (Unix layout). Windows Node.js puts npm at `node/node_modules/npm/bin/npm-cli.js` (no `lib/` prefix). Wizard install failed with "No Node.js available". Fixed by checking both paths.

3. **Spawning .cmd files on Windows** — `tsx.cmd` + `pi.cmd` are batch files requiring `shell: true` in Node.js `spawn()`. Without it: `spawn EINVAL`. Fixed in both `server-lifecycle.ts` (server launch) + `process-manager.ts` (session spawn).

4. **Paths with spaces** — Username `Róbert Csákány` produced paths like `C:\Users\Róbert Csákány\.pi-dashboard\...`. With `shell: true`, shell splits at spaces. Command `C:\Users\Róbert` treated as executable. Fixed by quoting both command + arguments: `spawn('"${tsxBin}"', args.map(a => '"${a}"'), { shell: true })`.

**Additional Windows fixes**:
- VM detection: added `wmic computersystem get manufacturer,model` check (catches "VMware, Inc." + "Hyper-V")
- Docker cross-build: switched from NSIS (needs Wine for uninstaller extraction) → ZIP archive. NSIS builds natively in CI on Windows.
- Tray icons: regenerated from master icon with bold π shape (182 opaque pixels at 16×16, was 62)

## Known Issues & Future Work

1. **Windows NSIS cross-compilation** — NSIS uninstaller extraction requires Wine to run 32-bit exe. Docker cross-build produces ZIP instead. CI builds NSIS natively on Windows.
2. **macOS universal binary** — Separate arm64 + x64 DMGs. TODO: `@electron/universal` to combine.
3. **Package size** — AppImage ~150MB+. Could strip more from node_modules or use compression.
4. **Auto-update for AppImage** — `electron-updater` works with DMG/NSIS but AppImage needs different mechanism.
5. **Code signing** — macOS signing configured (env-gated). Windows signing not set up.
6. **Server log not always written** — tsx binary itself fails to spawn (e.g., wrong architecture) → no log created. Doctor's launch test helps but isn't perfect.
7. **Clean OS testing** — Three Docker test scripts cover server-only, DEB install, desktop-launch scenarios. VMware still useful for visual testing.
8. **Shell stdin pipeline bug** — `sleep N | cmd` breaks when outer shell stdin is `/dev/null`. Use `tail -f /dev/null | cmd` instead. Linux-specific behavior.
9. **OAuth without Pro plan** — Anthropic OAuth redirects to chat UI instead of OAuth callback when user has no Pro plan. Popup close detection now handles this gracefully.

## Lessons Learned (Addendum)

16. **Bundle ALL components pi needs**: Bridge extension MUST be bundled alongside server — without it, pi starts but never connects to dashboard. In dev mode, monorepo `package.json` `"pi"` field handles discovery; bundled installs need extension registered in `~/.pi/agent/settings.json` as local path package.

17. **Externalize ALL Node.js builtins in Vite**: Vite for Electron main process MUST externalize every `node:*` module. Even one bundled → `require()` calls break in ESM bundle. Use `builtinModules` from `node:module` to generate full list.

18. **Windows .cmd files need `shell: true`**: npm/yarn bin stubs on Windows are `.cmd` batch files, not executables. Node.js `spawn()` cannot run them directly — needs `shell: true`. Always check `process.platform === 'win32'`.

19. **Quote all paths when `shell: true`**: On Windows with `shell: true`, paths containing spaces break command. Always wrap command + each argument in double quotes: `'"${path}"'`.

20. **Check both Unix and Windows npm layouts**: Node.js distribution has npm at `lib/node_modules/npm/` on Unix but `node_modules/npm/` on Windows (no `lib/` prefix). Check both paths when resolving bundled npm.
