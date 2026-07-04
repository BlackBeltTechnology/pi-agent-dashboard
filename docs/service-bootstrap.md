# Service Bootstrap & Tool Resolution

## Overview

PI Dashboard reaches one server process via **3 starters** (`Electron`, `Bridge`, `Standalone`) exposed across **2 invocation surfaces** (GUI click, shell command). Each starter MUST resolve tool paths (pi, openspec, node, tsx, bridge extension) to launch server + spawn pi sessions. Doc describes starters, surfaces, tool resolution problem, target architecture. See [Concepts](#concepts) for the runtime-vs-doc-device split.

**R3 update** (`eliminate-electron-runtime-install`): Electron is launcher only. Runtime install eliminated. pi/openspec/tsx ship as regular npm dependencies inside the .app and load read-only from `<resourcesPath>/server/node_modules/`. `selectLaunchSource()` resolves to `attach | devMonorepo | bundled` (3 strategies). See [electron-bootstrap-flow.md](./electron-bootstrap-flow.md) for the 6-state startup machine. See [electron-immutable-bundle.md](./electron-immutable-bundle.md) for the immutable-bundle invariant.

## Concepts

Two doc devices. One runtime fact.

**Starter** — runtime identity. 3 values: `Electron`, `Bridge`, `Standalone`. Stamped via `DASHBOARD_STARTER` env in `packages/shared/src/server-launcher.ts#launchDashboardServer`. Exposed as `launchSource` on `GET /api/health`. Read by `decideShutdownOnQuit` (Electron) + `useLaunchSource()` (client). Single source of truth for pid ownership and arm-aware UI gating.

**Invocation surface** — user entry point. 2 values: GUI click, shell command. Not observable at runtime. Doc device only. Groups starters by PATH-inheritance pedigree.

Mapping:

| Surface | Starter    | PATH source                  | Owns pid?      | Detached? |
|---------|------------|------------------------------|----------------|-----------|
| GUI     | Electron   | minimal system PATH          | yes            | no        |
| shell   | Bridge     | full shell PATH (nvm/brew)   | no             | yes       |
| shell   | Standalone | full shell PATH (nvm/brew)   | yes (SIGINT)   | no        |

Chain 1 = GUI surface → Electron starter. Chain 2 = shell surface → Bridge or Standalone starter (PATH pedigree shared, lifecycle differs).

Client gates on `launchSource === "electron"` as proxy for "immutable bundle" (`UnifiedPackagesSection.tsx`, `App.tsx#PiUpdateBadge`). Bridge vs. Standalone never branched at server level — identical from server POV. Difference is detachment + invocation surface, not server behavior.

## Startup Chains

```
┌──────────────────────────────────────────────────────────────────────────┐
│  CHAIN 1: ELECTRON APP → SERVER                                         │
│                                                                          │
│  /Applications/PI Dashboard.app                                          │
│    │                                                                     │
│    ├─ main.ts: checking-server-health                                    │
│    │    └─ isDashboardRunning(port) → attach when up                     │
│    │                                                                     │
│    ├─ main.ts: wizard-welcome (first-run only)                           │
│    │    └─ ~/.pi/dashboard/first-run-done marker skips on relaunch       │
│    │                                                                     │
│    ├─ selectLaunchSource(): attach | devMonorepo | bundled               │
│    │    bundled = <resourcesPath>/server/node_modules/                   │
│    │    pi/openspec/tsx are regular npm deps (read-only at runtime)      │
│    │                                                                     │
│    ├─ spawnFromSource() stamps DASHBOARD_STARTER=Electron                │
│    │    setSpawnedPid(pid) for lifecycle ownership                       │
│    │                                                                     │
│    ├─ server boots: no runtime install, no bootstrap state               │
│    │    legacy ~/.pi-dashboard/ untouched (advisory only)                │
│    │                                                                     │
│    └─ BrowserWindow → http://localhost:8000                              │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│  CHAIN 2: PI TUI → BRIDGE EXTENSION → SERVER                            │
│                                                                          │
│  Terminal: `pi` (user's shell has full PATH)                             │
│    │                                                                     │
│    ├─ pi loads ~/.pi/agent/settings.json → packages[]                    │
│    │    └─ finds bridge extension → loads bridge.ts                      │
│    │                                                                     │
│    ├─ bridge.ts reads ~/.pi/dashboard/config.json                        │
│    │                                                                     │
│    ├─ autoStartServer() discovery chain:                                 │
│    │    ├─ mDNS browse (2s timeout)                                      │
│    │    ├─ health check on configured port                               │
│    │    └─ launchServer() if autoStart=true                              │
│    │         └─ spawn(process.execPath, ["--import", jiti, cli.ts])      │
│    │            process.execPath = the node running pi (from shell PATH) │
│    │            cli.ts = resolved relative to extension __dirname        │
│    │                                                                     │
│    └─ ConnectionManager → ws://localhost:9999                            │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## The Tool Resolution Problem

### What needs resolving

| Tool | Used by | Purpose |
|------|---------|---------|
| `pi` | Server process-manager | Spawn new pi sessions (headless or tmux) |
| `openspec` | Pi sessions (inherited PATH) | OpenSpec CLI inside sessions |
| `node` | Server launch, tsx, spawn | Node.js runtime |
| `tsx` | Server launch (standalone) | TypeScript loader for server CLI |
| `bridge` | settings.json, pi loader | Extension dir with package.json + bridge.ts |
| `serverCli` | Electron + bridge launcher | Server entry point (cli.ts) |

### Why it's hard

**Chain 2 (TUI) works naturally** — user's shell has full PATH with nvm/volta/homebrew/fnm, so all tools findable. Server inherits this environment.

**Chain 1 (Electron) breaks** — macOS/Linux GUI apps get minimal system PATH (`/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin`). Tools installed via nvm, volta, homebrew invisible.

### Current mitigations (fragile)

| Component | File | Strategy |
|-----------|------|----------|
| Electron detector | `dependency-detector.ts` | Login shell fallback (`$SHELL -lc "which <cmd>"`) |
| Electron server launch | `server-lifecycle.ts` | Prepends detected pi bin dir + bundled node to PATH |
| Server process-manager | `process-manager.ts` | `buildSpawnEnv()` adds managed bin + node bin + user dirs |
| Server extension-register | `extension-register.ts` | Relative path from `__dirname` |
| Bridge server-launcher | `server-launcher.ts` | Uses `process.execPath` + relative `__dirname` |

Each component resolves tools independently. No shared state. Login shell output includes macOS session restore noise (`Restored session:...`, `Saving session...completed.`) MUST be parsed out.

### Failure modes

| Scenario | What breaks | Root cause |
|----------|-------------|------------|
| Electron GUI, nvm user | Wizard shows pi ✗ | `which pi` fails on minimal PATH |
| Server spawned by Electron | Can't spawn pi sessions | Server PATH missing nvm bin dir |
| nvm version change (v22.22→v22.23) | Persisted paths become stale | Hardcoded absolute paths |
| AppImage on Linux | Bridge path in settings.json invalid after relaunch | Temp mount path changes |
| tmux sessions | `pi` not found in tmux shell | tmux server has its own env, not spawner's |

## Tool Source Hierarchy

Each tool can come from multiple sources. Priority depends on mode:

### Power-user mode

Prefers user's system install:

```
pi, openspec:  System PATH (nvm/volta) → Managed (~/.pi-dashboard/) → Bundled
node:          System PATH → Bundled (Electron resources)
tsx:           System PATH → Managed → Bundled
bridge:        System (npm global) → Bundled (Electron resources) → Dev (relative)
serverCli:     System (pi-dashboard CLI) → Bundled → Managed
```

### Standalone npm install

Install: `npm install -g @blackbelt-technology/pi-agent-dashboard`. No pre-install of pi required.

pi/openspec/tsx ship as regular `dependencies` of `@blackbelt-technology/pi-dashboard-server`. npm resolves them at install time. No first-run install delay. No background install. Server starts ready.

`jiti` is a direct dep of `@blackbelt-technology/pi-dashboard-server`. Bin wrapper `packages/server/bin/pi-dashboard.mjs` resolves jiti from own `node_modules/jiti` via `argv[1]` walk-up. Re-execs `node --import <jiti-url> cli.ts <args>`.

`cli.ts` logs `[bootstrap] ready (pi resolved via <source>)` on successful pi resolve via `ToolRegistry`. Failure throws hard with `corrupted node_modules` hint.

### Electron arm (immutable bundle)

All runtime deps under `<resourcesPath>/server/node_modules/`. Read-only at runtime.

```
pi, openspec, tsx: Bundled (regular npm deps of pi-dashboard-server)
node:              Bundled (<resourcesPath>/node/bin/node)
bridge:            Bundled (<resourcesPath>/server/node_modules/.../packages/extension)
serverCli:         Bundled (<resourcesPath>/server/node_modules/.../packages/server/src/cli.ts)
```

Update path: electron-updater whole-app replacement. No in-app npm install. Legacy `~/.pi-dashboard/` left untouched; `detectLegacyManagedDir` surfaces Doctor advisory only.

## Target Architecture: Persisted Tool Paths

### Config schema

Add `toolPaths` to `~/.pi/dashboard/config.json`:

```jsonc
{
  "port": 8000,
  "piPort": 9999,
  "toolPaths": {
    "pi":        "/Users/x/.nvm/versions/node/v22.22.0/bin/pi",
    "openspec":  "/Users/x/.nvm/versions/node/v22.22.0/bin/openspec",
    "node":      "/Applications/PI Dashboard.app/Contents/Resources/node/bin/node",
    "tsx":       "/Users/x/.pi-dashboard/node_modules/.bin/tsx",
    "bridge":    "/Applications/PI Dashboard.app/Contents/Resources/server/packages/extension",
    "serverCli": "/Applications/PI Dashboard.app/Contents/Resources/server/packages/server/src/cli.ts"
  },
  "autoStart": true,
  "spawnStrategy": "headless"
}
```

All paths absolute. `null` or missing → detect at runtime.

### Writers

```
┌──────────────────────────────────────────────────────────────────────┐
│  WHO WRITES toolPaths?                                               │
│                                                                      │
│  ┌─────────────────┐                                                 │
│  │  Electron Wizard │──── initial detection + user selection         │
│  └────────┬────────┘     writes all toolPaths on first run           │
│           │                                                          │
│  ┌────────▼────────┐                                                 │
│  │  Server Startup  │──── validate + re-detect on every start        │
│  └────────┬────────┘     updates stale paths (nvm version change)    │
│           │                                                          │
│  ┌────────▼────────┐                                                 │
│  │  Settings Panel  │──── manual override via dashboard UI           │
│  └────────┬────────┘     (Doctor could also edit)                    │
│           │                                                          │
│  ┌────────▼────────┐                                                 │
│  │  Bridge Start    │──── if toolPaths empty, detect from shell env  │
│  └─────────────────┘     (Chain 2: full PATH available)              │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Consumers

```
┌──────────────────────────────────────────────────────────────────────┐
│  WHO READS toolPaths?                                                │
│                                                                      │
│  Electron ensureServer()                                             │
│    ├─ toolPaths.serverCli → server CLI path                          │
│    ├─ toolPaths.tsx → TypeScript loader                              │
│    ├─ toolPaths.node → node binary for PATH                         │
│    └─ derives PATH from dirname of all resolved paths                │
│                                                                      │
│  Server process-manager                                              │
│    ├─ toolPaths.pi → resolvePiCommand() shortcut                     │
│    ├─ derives PATH from dirname(pi), dirname(node) for spawn env     │
│    └─ tmux: injects PATH export into tmux command                    │
│                                                                      │
│  Bridge server-launcher                                              │
│    ├─ toolPaths.serverCli → CLI path (fallback: __dirname relative)  │
│    └─ toolPaths.node → spawn binary                                  │
│                                                                      │
│  Bridge registration                                                 │
│    └─ toolPaths.bridge → written to settings.json packages[]         │
│                                                                      │
│  Wizard / Doctor / Settings Panel                                    │
│    └─ toolPaths.* → display, validate, edit                          │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Server startup validation

On every server start:

```
for each tool in toolPaths:
  if path is set:
    if file/dir exists at path:
      keep (valid)
    else:
      re-detect using:
        1. login shell (macOS/Linux GUI)
        2. system PATH
        3. managed install
        4. bundled location
      if found:
        update config.json with new path
        log: "Tool <name> moved from <old> to <new>"
      else:
        warn: "Tool <name> not found at <old> and could not be re-detected"
        set to null (consumers use fallback)
  else:
    detect (same chain as above)
    if found: write to config.json
```

### PATH derivation

Instead of hardcoding directories, derive PATH from resolved tool paths:

```typescript
function buildPathFromToolPaths(toolPaths: ToolPaths): string {
  const dirs = new Set<string>();
  for (const toolPath of Object.values(toolPaths)) {
    if (toolPath && existsSync(toolPath)) {
      dirs.add(path.dirname(toolPath));
    }
  }
  return [...dirs, process.env.PATH || ""].join(path.delimiter);
}
```

Auto-handles nvm, volta, homebrew — wherever tools live, parent dirs end up on PATH.

### tmux PATH injection

tmux sessions start in new shell not inheriting server's env. Fix: prepend resolved PATH to tmux command:

```typescript
function buildTmuxCommand(cwd, sessionExists, options, resolvedPath) {
  const pathExport = `export PATH="${resolvedPath}:$PATH" && `;
  const piCmd = `${pathExport}cd ${safeCwd} && pi`;
  // ...
}
```

## Platform-Specific Considerations

### macOS (.app bundle)

- `process.resourcesPath` = `/Applications/PI Dashboard.app/Contents/Resources`
- Bundled paths stable across app launches
- Login shell fallback needed for nvm/volta detection (GUI apps don't source `.zshrc`)
- Login shell outputs session restore noise — parse by finding first line starting with `/`

### Linux (deb/rpm)

- `process.resourcesPath` = `/usr/lib/pi-dashboard/resources`
- Stable paths, similar to macOS
- Login shell fallback needed for nvm/volta
- Less session restore noise than macOS zsh

### Linux (AppImage)

- `process.resourcesPath` = `/tmp/.mount_PIxxxxxx/resources`
- **Unstable** — mount path changes every launch
- `toolPaths.bridge` + `toolPaths.serverCli` MUST NOT be persisted from AppImage paths
- Detection: reject paths containing `/tmp/.mount_`
- Workaround: use global npm install or re-detect on every start

### Windows (NSIS)

- `process.resourcesPath` = `C:\Program Files\PI Dashboard\resources`
- Stable paths
- No login shell fallback (not needed — PATH global on Windows)
- Spawn uses `windowsHide: true` to prevent console windows

## Key Files

| File | Role |
|------|------|
| `packages/shared/src/config.ts` | `DashboardConfig` interface, defaults, loader |
| `packages/electron/src/lib/dependency-detector.ts` | Tool detection with login shell fallback |
| `packages/electron/src/lib/server-lifecycle.ts` | `ensureServer()`, mode-aware launch, `launchViaCli()` |
| `packages/electron/src/lib/health-check.ts` | `isDashboardRunning()` shared utility |
| `packages/electron/src/lib/bridge-register.ts` | Register bundled extension in settings.json |
| `packages/electron/src/lib/wizard-ipc.ts` | Wizard IPC: detect, install, register bridge |
| `packages/electron/src/lib/wizard-window.ts` | Wizard window with `startStep` parameter |
| `packages/electron/src/renderer/wizard.html` | Wizard UI: mode selection, bridge install, verification |
| `packages/electron/src/main.ts` | Startup flow: health check → detection → wizard → server |
| `packages/extension/src/bridge.ts` | Bridge entry point, auto-start trigger |
| `packages/extension/src/server-auto-start.ts` | mDNS → health check → launch chain |
| `packages/extension/src/server-launcher.ts` | Spawns server via `process.execPath` + jiti |
| `packages/server/src/server.ts` | Server init, calls `ensureBridgeExtensionRegistered()` |
| `packages/server/src/extension-register.ts` | Register bridge in settings.json (server-side) |
| `packages/server/src/process-manager.ts` | `spawnPiSession()`, `buildSpawnEnv()`, `resolvePiCommand()` |
| `packages/server/src/session-bootstrap.ts` | Startup session discovery |

## Migration Path

`toolPaths` config additive — all fields optional. Existing installations continue to work with runtime detection as fallback:

1. **Phase 1**: Add `toolPaths` to config schema. Server reads if present, falls back to current detection. No breaking changes.
2. **Phase 2**: Wizard writes `toolPaths` on setup. Server validates on start. Doctor displays.
3. **Phase 3**: Settings panel allows editing. `dashboard-settings.json` simplified to "wizard completed" flag only.
4. **Phase 4**: Remove scattered detection logic from `resolvePiCommand()`, `resolveTsxCommand()`, `findServerCli()`, etc. All read from config with detect-on-miss fallback.

## Appendix: Detection Methods

### Login shell fallback (macOS/Linux)

-lc (login, non-interactive). -i forbidden — interactive shell claims tty foreground group; parent pi receives SIGTSTP at shell exit.

Used when `which <cmd>` fails on process PATH (Electron GUI apps):


```typescript
const shell = process.env.SHELL || "/bin/zsh";
const output = execSync(`${shell} -lc "which ${cmd}"`, {
  encoding: "utf-8",
  timeout: 5000,
}).trim();
// Extract path: find first line starting with "/"
// (macOS zsh emits "Restored session:..." and "Saving session..." noise)
const pathLine = output.split("\n").find(l => l.trim().startsWith("/"));
```

### buildSpawnEnv (server process-manager)

Adds directories to PATH for spawned pi sessions:

```typescript
function buildSpawnEnv(baseEnv = process.env): NodeJS.ProcessEnv {
  // With toolPaths:
  const config = loadConfig();
  const resolvedPath = buildPathFromToolPaths(config.toolPaths);
  return { ...baseEnv, PATH: `${resolvedPath}:${baseEnv.PATH}` };

  // Without toolPaths (current):
  // managed bin + node bin + ~/.local/bin + /usr/local/bin
}
```
