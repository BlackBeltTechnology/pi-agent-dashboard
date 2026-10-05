## ADDED Requirements

### Requirement: TypeScript loader selection with native default

Every fresh dashboard-server launch (CLI wrapper, `launchDashboardServer` from CLI / Electron / bridge auto-start, Electron launch helpers) SHALL use the Node-native TypeScript loader by default. A restart (`/api/restart`) and server worker threads SHALL keep the running server's loader; switching loaders requires a fresh launch. Setting `PI_DASHBOARD_TS_LOADER=jiti` SHALL select the jiti loader instead, resolved exactly as before. Any other value SHALL log a warning and select the native loader. Selection SHALL read the launching process's own environment (a caller's `opts.env` overlay does not change the selection) and SHALL be implemented once in a plain-JavaScript helper usable before any TypeScript loader is registered. Node launch sites SHALL locate the native register module by package specifier (`@blackbelt-technology/pi-dashboard-shared/platform/native-ts-register.mjs`) from the launch anchor, not by directory arithmetic; the shell launch helpers (`start-server.{sh,cmd,ps1}`), which cannot resolve packages, SHALL use the bundle's fixed layout path to that file. The spawn log header SHALL name the selected loader. The bundled-server plugin-load build gate SHALL boot with the selected loader.

#### Scenario: Default launch uses the native loader

- **WHEN** `launchDashboardServer` runs with `PI_DASHBOARD_TS_LOADER` unset
- **THEN** the child argv SHALL be `--import <native-ts-register.mjs URL> <cli>`
- **AND** the spawn log header SHALL contain `loader <native-ts-register.mjs URL>`

#### Scenario: jiti opt-in restores the previous launch

- **WHEN** `PI_DASHBOARD_TS_LOADER=jiti`
- **THEN** the loader SHALL be the URL returned by `ToolResolver.resolveJiti({ anchor })`
- **AND** the argv and entry URL-wrapping SHALL match the pre-change jiti launch

#### Scenario: Unknown loader value

- **WHEN** `PI_DASHBOARD_TS_LOADER=tsx`
- **THEN** a warning SHALL be logged and the native loader SHALL be used

#### Scenario: Native launch does not require jiti

- **WHEN** no jiti package resolves from any anchor AND the native loader is selected
- **THEN** `launchDashboardServer` SHALL NOT throw `JitiNotFoundError`

#### Scenario: Restart keeps the running loader

- **WHEN** a server launched with `PI_DASHBOARD_TS_LOADER=jiti` is restarted via `/api/restart` after the variable was unset
- **THEN** the restarted server SHALL run under jiti

#### Scenario: Bridge auto-start uses the native loader

- **WHEN** the bridge extension auto-starts the server with `PI_DASHBOARD_TS_LOADER` unset and no jiti resolvable
- **THEN** the server SHALL start under the native loader and the bridge SHALL NOT log a jiti-not-found failure

#### Scenario: Worker threads keep the server's loader

- **WHEN** the server was started with the native loader and a worker pool spawns a `.ts` worker
- **THEN** the worker SHALL run under the same loader without adding jiti

## MODIFIED Requirements

### Requirement: Unified jiti resolution via `ToolResolver` anchored at earendil pi

When the jiti loader is selected (`PI_DASHBOARD_TS_LOADER=jiti`), `ToolResolver.resolveJiti({ anchor?, resolver? })` SHALL be the single source of truth for resolving pi's `jiti-register.mjs`. Resolution order: managed pi install (`~/.pi-dashboard/node_modules/<pi-pkg>` for `@earendil-works/pi-coding-agent` only) → system pi via `which("pi")` → caller-supplied `opts.anchor` walked up to nearest `node_modules` → `process.argv[1]` walked up. For every anchor, the inner walk SHALL try `JITI_PACKAGES = ["jiti", "@mariozechner/jiti"]` (upstream first, namespaced-jiti fallback; `@mariozechner/jiti` is a loader package, unrelated to the dropped pi fork). Returns the register hook as a `file://` URL string (preserving the Windows drive-letter URL-wrapping contract documented on the prior `buildJitiRegisterUrl` helper) or null. The optional `resolver` parameter SHALL be the `JitiResolver` test-injection seam.

#### Scenario: Managed pi present (upstream)

- **WHEN** `~/.pi-dashboard/node_modules/@earendil-works/pi-coding-agent` exists and resolves `jiti/package.json`
- **THEN** `resolveJiti()` returns a `file://` URL pointing at the upstream `jiti/lib/jiti-register.mjs`

#### Scenario: Managed legacy fork is not an anchor

- **WHEN** `~/.pi-dashboard/node_modules/` contains only `@mariozechner/pi-coding-agent`
- **THEN** `resolveJiti()` SHALL NOT anchor at it
- **AND** resolution SHALL continue with system pi, `opts.anchor`, then `process.argv[1]`

#### Scenario: System pi only

- **WHEN** managed pi is absent but `which("pi")` resolves and pi's tree contains jiti
- **THEN** `resolveJiti()` returns the system pi's `jiti-register.mjs` as a `file://` URL

#### Scenario: Anchor walk-up (Electron packaged)

- **WHEN** `process.argv[1]` is empty or a flag (packaged Electron) and `opts.anchor` is a valid `cliPath` inside a `node_modules` tree containing jiti
- **THEN** `resolveJiti({ anchor: cliPath })` returns the jiti URL resolved from that tree

#### Scenario: Windows drive-letter wrapping

- **WHEN** the resolved jiti path begins with `B:\` or any other URL-scheme-colliding drive letter
- **THEN** `resolveJiti()` returns `file:///B:/.../jiti-register.mjs` (drive letter URL-wrapped, backslashes normalised to forward slashes)

#### Scenario: All sources missing

- **WHEN** none of managed, system, anchor, or argv yield a jiti path
- **THEN** `resolveJiti()` returns null
- **AND** `launchDashboardServer` raises `JitiNotFoundError` only when the jiti loader is selected and its caller did not supply a usable anchor

### Requirement: Caller-owned log-file policy

When `stdio: { logFile }` is supplied, `launchDashboardServer` SHALL:

- Create the parent directory with `mkdirSync(..., { recursive: true })`.
- Open the log file with `"a"` (append) mode.
- Write a single header line `[<ISO timestamp>] <starter?> launch (parent pid <pid>, port <port>, cli <cliPath>, loader <loaderUrl>)\n` before passing the fd to the child, where `<loaderUrl>` is the selected TypeScript loader (see "TypeScript loader selection with native default").
- Pass the fd as both stdout and stderr in `spawnOptions.stdio`.
- Close the parent's fd after `spawn` returns (child retains its inherited copy).

The absolute log-file path is **caller-owned**. Conventions in the migrated tree:
- Extension (bridge auto-spawn): `stdio: { logFile: getDashboardServerLogPath() }` → `~/.pi/dashboard/server.log`.
- CLI (`cmdStart`): `~/.pi/dashboard/server.log`.
- Electron: existing electron log path (unchanged by this proposal).

#### Scenario: Extension auto-spawn writes the shared server log

- **WHEN** the bridge auto-spawns the server via `stdio: { logFile: getDashboardServerLogPath() }`
- **THEN** `~/.pi/dashboard/server.log` SHALL be created (if absent) with the header line written before the child sees the fd
- **AND** a subsequent `cat ~/.pi/dashboard/server.log` SHALL show the launch header and any captured server output, never "No such file or directory"

#### Scenario: Header line written before child sees fd

- **WHEN** `launchDashboardServer({ stdio: { logFile } })` runs
- **THEN** the log file contains the header line for this launch on the first byte after the previous run's content (append mode preserves history)
- **AND** the parent process closes its copy of the fd after `spawn`
