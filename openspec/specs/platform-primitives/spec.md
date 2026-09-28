# platform-primitives Specification

## Purpose
TBD - created by openspec-sync-specs from change consolidate-platform-handlers. Establishes the single shared platform module owning cross-OS primitives (binary lookup, process control/enumeration, shell detection, OS-specific commands) and the Electron-specific platform module for Electron-API concerns.

## Requirements

### Requirement: Single shared platform module
Cross-OS primitives (binary lookup, process control/enumeration, shell detection, OS-specific commands) SHALL live in `packages/shared/src/platform/`. The module SHALL expose its public API through an `index.ts` barrel. No other file in `packages/shared`, `packages/server`, or `packages/extension` SHALL contain a `process.platform === "win32"` branch that implements a primitive itself; such files SHALL consume the primitive from `platform/`.

#### Scenario: Every Windows branch is served by a platform primitive
- **WHEN** a developer grep's `process.platform` across `packages/shared/src`, `packages/server/src`, and `packages/extension/src` (excluding `packages/shared/src/platform/`)
- **THEN** the only matches SHALL be (a) calls into `platform/` helpers, (b) spawn-strategy selection in `process-manager.ts` that consumes platform primitives to build commands, or (c) a one-line switch for choosing between platform-provided variants

#### Scenario: No platform branching in editor-detection or tunnel
- **WHEN** `packages/server/src/editor-detection.ts` or `packages/server/src/tunnel.ts` needs to look up a binary
- **THEN** it SHALL call `platform/binary-lookup` and SHALL NOT contain `where`/`which` strings inline

### Requirement: Platform is injectable for tests
Every exported primitive in `packages/shared/src/platform/` that depends on `process.platform` SHALL accept an optional `platform` parameter (typed as `NodeJS.Platform`) that overrides the global. When the parameter is omitted, the primitive SHALL read `process.platform`. Tests SHALL exercise platform branches by passing the parameter, not by mutating `process.platform` via `Object.defineProperty`.

#### Scenario: findPortHolders respects injected platform
- **WHEN** `findPortHolders(8000, { platform: "win32", exec: fake })` is called on a Linux host
- **THEN** the helper SHALL take the Windows branch (use `netstat -ano`, not `lsof`) and return the PIDs parsed by the Windows branch

#### Scenario: Tests do not mutate global platform
- **WHEN** a test file in `packages/shared/src/__tests__/` or `packages/server/src/__tests__/` exercises a platform primitive
- **THEN** the test SHALL pass `platform` as a function argument
- **AND** SHALL NOT call `Object.defineProperty(process, "platform", ...)`

### Requirement: Binary-lookup primitive (where/which, .cmd, managed-bin, login shell)
The `platform/binary-lookup.ts` module SHALL expose binary resolution that handles:
- `where` on Windows, `which` on Unix
- `.cmd` extension for managed-bin and extra-bin-dirs on Windows
- Managed-bin prefix search (`~/.pi-dashboard/node_modules/.bin`)
- Extra bin directories before system PATH
- Login-shell fallback (Unix only; skipped on Windows)
- Convenience helpers for `pi`, `tsx`, `node` resolution that return `[command, ...prefixArgs]` tuples to avoid `.cmd` spawn on Windows

#### Scenario: Windows `.cmd` extension applied
- **WHEN** `which("pi", { platform: "win32" })` is called and `~/.pi-dashboard/node_modules/.bin/pi.cmd` exists
- **THEN** it SHALL return the absolute path to `pi.cmd`

#### Scenario: Login shell skipped on Windows
- **WHEN** `which("pi", { platform: "win32", useLoginShell: true })` is called and all prior lookups fail
- **THEN** the helper SHALL NOT attempt a `bash -ilc` or `zsh -ilc` invocation
- **AND** SHALL return `null`

#### Scenario: Pi resolves to [node, cli.js] on Windows to avoid .cmd spawn
- **WHEN** `resolvePi({ platform: "win32" })` is called and pi is installed via npm global
- **THEN** it SHALL return `[nodePath, absolute-cli-js-path]` instead of `[pi.cmd]` so the caller can spawn without `shell: true`

### Requirement: Process primitive (kill, find-port, is-alive)
The `platform/process.ts` module SHALL expose:
- `findPortHolders(port, opts?)` — `netstat -ano` on Windows, `lsof -t -i :<port> -sTCP:LISTEN` on Unix; returns PIDs (excluding self) or `[]` on failure
- `killProcess(pid, opts?)` — `taskkill /F /T /PID` on Windows (tree kill), `SIGTERM` → `SIGKILL` on Unix
- `isProcessAlive(pid)` — cross-platform via `process.kill(pid, 0)` (semantics identical on all OSes)
- `killPidWithGroup(pid, signal, opts?)` — Unix signals the process group (`-pid`), Windows targets the pid directly

#### Scenario: killProcess uses taskkill on Windows
- **WHEN** `killProcess(12345, { platform: "win32", exec: fake })` is called
- **THEN** it SHALL invoke `taskkill /F /T /PID 12345`
- **AND** SHALL NOT invoke `process.kill(12345, "SIGTERM")`

#### Scenario: killPidWithGroup signals the process group on Unix
- **WHEN** `killPidWithGroup(12345, "SIGTERM", { platform: "linux", kill: fakeKill })` is called
- **THEN** `fakeKill` SHALL be called with `(-12345, "SIGTERM")`

#### Scenario: killPidWithGroup targets the pid directly on Windows
- **WHEN** `killPidWithGroup(12345, "SIGTERM", { platform: "win32", kill: fakeKill })` is called
- **THEN** `fakeKill` SHALL be called with `(12345, "SIGTERM")` (positive pid)

#### Scenario: findPortHolders falls back silently on parse failure
- **WHEN** `netstat` output cannot be parsed (unexpected format, permission error, empty output)
- **THEN** `findPortHolders(port, { platform: "win32" })` SHALL return `[]` without throwing

### Requirement: Process enumeration primitive (ps vs tasklist)
The `platform/process-scan.ts` module SHALL expose:
- `listChildPids(parentPid, opts?)` — `ps -eo pid=,ppid=` on Unix; Windows uses `wmic process get` or equivalent (or returns `[]` if enumeration is not supported for the caller's use case)
- `isProcessRunning(pattern, opts?)` — `pgrep -f` on Unix, `tasklist /FI "IMAGENAME eq <pattern>"` on Windows
- `parseEtime(etime)` — pure parser for `ps -o etime=` format (`mm:ss`, `hh:mm:ss`, `dd-hh:mm:ss`); exported for testing

#### Scenario: isProcessRunning uses tasklist on Windows
- **WHEN** `isProcessRunning("Code.exe", { platform: "win32", exec: fakeExec })` is called
- **THEN** the underlying command SHALL be `tasklist /FI "IMAGENAME eq Code.exe" /NH`
- **AND** the result SHALL be `true` when the fake exec output contains the image name

#### Scenario: parseEtime handles ps format variants
- **WHEN** `parseEtime("02:15")`, `parseEtime("01:30:00")`, or `parseEtime("2-03:00:00")` is called
- **THEN** it SHALL return 135000, 5400000, and 183600000 milliseconds respectively

### Requirement: Shell primitive (SHELL vs COMSPEC)
The `platform/shell.ts` module SHALL expose `detectShell(opts?)` that:
- Returns `process.env.COMSPEC || "powershell.exe"` on Windows
- Returns `process.env.SHELL || "/bin/bash"` on Unix
- Accepts an optional `platform` and `env` override for testing

#### Scenario: Windows uses COMSPEC
- **WHEN** `detectShell({ platform: "win32", env: { COMSPEC: "C:\\Windows\\System32\\cmd.exe" } })` is called
- **THEN** it SHALL return `"C:\\Windows\\System32\\cmd.exe"`

#### Scenario: Windows falls back to powershell.exe
- **WHEN** `detectShell({ platform: "win32", env: {} })` is called
- **THEN** it SHALL return `"powershell.exe"`

#### Scenario: Unix uses SHELL
- **WHEN** `detectShell({ platform: "linux", env: { SHELL: "/bin/zsh" } })` is called
- **THEN** it SHALL return `"/bin/zsh"`

#### Scenario: Unix falls back to /bin/bash
- **WHEN** `detectShell({ platform: "darwin", env: {} })` is called
- **THEN** it SHALL return `"/bin/bash"`

### Requirement: OS-command primitive (open-browser)
The `platform/commands.ts` module SHALL expose `openBrowser(url, opts?)` that:
- Uses `open "<url>"` on macOS
- Uses `xdg-open "<url>"` on Linux
- Uses `start "" "<url>"` on Windows
- Returns a promise or callback-style result; errors are logged but do not throw (best-effort)

#### Scenario: openBrowser dispatches per platform
- **WHEN** `openBrowser("https://example.com", { platform: "darwin", exec: fake })` is called
- **THEN** `fake` SHALL be called with a command matching `/^open\s+"https:\/\/example\.com"/`

#### Scenario: openBrowser uses start on Windows
- **WHEN** `openBrowser("https://example.com", { platform: "win32", exec: fake })` is called
- **THEN** `fake` SHALL be called with a command matching `/^start\s+""\s+"https:\/\/example\.com"/`

### Requirement: Electron platform module for Electron-API concerns
Electron-specific platform decisions that import from the `electron` package SHALL live in `packages/electron/src/platform/`. This module SHALL own:
- `tray-icon.ts` — `getTrayIcon(): NativeImage` selecting the correct icon file per OS
- `menu.ts` — `buildAppMenu(): MenuItemConstructorOptions[]` with darwin-specific first-position app menu
- `node.ts` — `getBundledNodePath(): string | null` resolving `node.exe` on Windows, `node` elsewhere
- `app-lifecycle.ts` — `configureAppLifecycle(app)` handling darwin dock-hide and linux `ozone-platform-hint`

`packages/electron/src/main.ts` SHALL import from `electron/platform/` instead of containing these branches inline. `packages/electron/src/lib/tray.ts`, `app-menu.ts`, `bundled-node.ts` SHALL either be relocated into `electron/platform/` or become thin re-export shims.

#### Scenario: Tray icon selection is centralized
- **WHEN** the Electron main process creates the system tray
- **THEN** it SHALL obtain the `NativeImage` via `electron/platform/tray-icon.ts:getTrayIcon()`
- **AND** `packages/electron/src/lib/tray.ts` (if retained) SHALL delegate to `getTrayIcon()` rather than branching on `process.platform` itself

### Requirement: Electron delegates to shared for non-UI platform concerns
Platform concerns that do NOT require Electron APIs (binary lookup, machine info via `sysctl`/`systemd-detect-virt`/`wmic`, jiti register-hook resolution) SHALL be implemented in `packages/shared/src/platform/` and consumed by Electron via import. `packages/electron/src/lib/server-lifecycle.ts` SHALL NOT contain a duplicate jiti resolver.

#### Scenario: Electron jiti resolver is removed
- **WHEN** a developer inspects `packages/electron/src/lib/server-lifecycle.ts` after the migration
- **THEN** the function `resolveJitiFromAnchor` SHALL NOT exist
- **AND** `resolveJitiFromPi` (if retained) SHALL delegate to `packages/shared/src/resolve-jiti.ts`

#### Scenario: Electron machine-info uses shared primitive
- **WHEN** `packages/electron/src/main.ts` logs machine info at startup
- **THEN** it SHALL call `platform/commands.ts:detectMachineInfo()` rather than branching on `process.platform` to invoke `sysctl`, `systemd-detect-virt`, or `wmic` inline

### Requirement: ToolResolver public API preserved during migration
The existing `ToolResolver` class and its public methods (`which`, `resolvePi`, `resolveTsx`, `resolveNode`, `buildSpawnEnv`) SHALL remain callable with identical signatures during the migration. Its implementation file MAY be relocated to `packages/shared/src/platform/binary-lookup.ts`; `packages/shared/src/tool-resolver.ts` SHALL become a one-line re-export during the transition and MAY be deleted once all internal callers are migrated.

#### Scenario: ToolResolver import path back-compat during migration
- **WHEN** a caller imports `ToolResolver` from `@blackbelt-technology/pi-dashboard-shared/tool-resolver.js` during the migration window
- **THEN** the import SHALL succeed and return the same class as importing from `@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js`

#### Scenario: Old import path removed after migration
- **WHEN** the final cleanup step of the migration completes
- **THEN** `packages/shared/src/tool-resolver.ts` SHALL NOT exist
- **AND** no file in the repository (excluding `openspec/changes/archive/`) SHALL import from `.../tool-resolver.js`

### Requirement: Spawn-env PATH key is case-normalized on Windows
On Windows, any site that builds a child env from a copy of the process env and then writes or overlays PATH SHALL produce an env with at most one key whose upper-cased name is `PATH`, and that key SHALL be named `PATH`. This covers the shared spawn-env builder and the env-overlay sites.

Normalizing a single env:
- Merges all case variants (`PATH`, `Path`, `path`, …) into one `PATH`.
- Entries are `;`-separated and de-duplicated case-insensitively in first-seen order. The `PATH` key's value comes first, then the other variants in sorted key order.
- Empty entries are dropped. Variants whose value is JS `undefined` contribute nothing and are removed.
- If at least one variant has a string value (even an empty one), a `PATH` key SHALL be written, possibly as an empty string. Otherwise no `PATH` key SHALL be written.
- The env SHALL be returned as the same object when any of the following holds:
  - the platform is not Windows
  - no PATH variant exists
  - the only variant is a string-valued key named exactly `PATH`

When a caller-supplied env is overlaid on a process-env copy, both sides SHALL be normalized first. A caller-supplied PATH in any casing, including an empty one, then replaces the inherited PATH, matching POSIX overlay semantics.

The input env and `process.env` SHALL NOT be mutated. On non-Windows platforms, keys that differ only in case are distinct variables and SHALL be left untouched.

#### Scenario: Windows `Path` key is preserved through spawn-env construction
- **WHEN** the spawn environment is built on win32 from an env whose only PATH-like key is `Path` = `C:\Program Files\Git\cmd;C:\Windows\System32`
- **THEN** the result SHALL contain exactly one key whose upper-cased name is `PATH`, and that key SHALL be `PATH`
- **AND** its `;`-separated value SHALL include `C:\Program Files\Git\cmd` and `C:\Windows\System32`
- **AND** the dashboard-prepended directories SHALL come before those inherited entries

#### Scenario: Duplicate case variants are merged, not shadowed
- **WHEN** an env on win32 carries both `PATH` = `C:\managed` and `Path` = `C:\managed;C:\Program Files\Git\cmd`
- **THEN** the normalized env SHALL have a single `PATH` = `C:\managed;C:\Program Files\Git\cmd`
- **AND** no `Path` key SHALL remain

#### Scenario: Case-insensitive de-duplication on Windows
- **WHEN** an env on win32 carries `Path` = `C:\Windows\System32;c:\windows\system32`
- **THEN** the normalized `PATH` SHALL contain that directory only once

#### Scenario: Caller overlay replaces inherited PATH regardless of casing
- **WHEN** on win32 a caller env `{ Path: "C:\\caller" }` is overlaid on a process-env copy `{ Path: "C:\\Windows\\System32", FOO: "1" }`
- **THEN** the child env SHALL have exactly one PATH key, `PATH` = `C:\caller`, and SHALL keep `FOO` = `1`
- **WHEN** the caller env is `{ Path: "" }` instead
- **THEN** the child env SHALL have `PATH` = `""` and no other PATH-like key

#### Scenario: Undefined, empty and missing values
- **WHEN** an env on win32 carries `Path` = JS `undefined` and `PATH` = `C:\a`
- **THEN** normalization SHALL yield `PATH` = `C:\a`, with no `Path` key and without throwing
- **WHEN** an env on win32 carries only `Path` = JS `undefined`
- **THEN** normalization SHALL yield an env with no PATH-like key
- **WHEN** an env on win32 carries only `Path` = `""`
- **THEN** normalization SHALL yield `PATH` = `""`
- **WHEN** an env on win32 carries no PATH-like key
- **THEN** normalization SHALL return the same object

#### Scenario: Identity cases
- **WHEN** an env on win32 has exactly one PATH-like key, named `PATH`, with a string value
- **THEN** normalization SHALL return the same object
- **WHEN** an env on win32 has exactly one PATH-like key named `Path`
- **THEN** normalization SHALL return a new object in which that key is renamed to `PATH`

#### Scenario: POSIX env is unchanged
- **WHEN** an env on linux or darwin carries `PATH` = `/usr/bin` and `Path` = `/opt/x`
- **THEN** normalization SHALL return the same object, with both keys and values unchanged

#### Scenario: Idempotent
- **WHEN** normalization is applied to its own output on win32
- **THEN** the result SHALL be the same object as its input

#### Scenario: Input env is not mutated
- **WHEN** normalization or the spawn-env builder is called with an env object on win32 that needs merging
- **THEN** the caller's object SHALL keep its original keys and values
