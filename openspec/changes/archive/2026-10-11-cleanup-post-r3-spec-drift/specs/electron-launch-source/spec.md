## MODIFIED Requirements

### Requirement: Discriminated launch-source resolution

The Electron app SHALL resolve a single `LaunchSource` per launch via a pure resolver `selectLaunchSource()`. The resolver SHALL classify the launch as exactly one of `attach`, `devMonorepo`, `localLink`, `overlay`, or `bundled`, with each non-`attach` kind carrying a resolved `cliPath` and `cwd`.

#### Scenario: Server already running

- **WHEN** `selectLaunchSource()` is invoked AND the health probe returns 200 within 1 second
- **THEN** the resolver SHALL return `{ kind: "attach", url, starter }` populated from the health response
- **AND** SHALL NOT spawn a new server

#### Scenario: Default precedence with no override

- **WHEN** `DASHBOARD_PREFER_SOURCE` is unset AND the health probe fails
- **THEN** the resolver SHALL evaluate sources in order `devMonorepo > localLink > overlay > bundled`
- **AND** SHALL return the first source whose probe succeeds
- **AND** when no source succeeds it SHALL throw a typed `BundledServerMissingError` carrying the expected bundled server entry path

#### Scenario: Pinned override succeeds

- **WHEN** `DASHBOARD_PREFER_SOURCE` is set to a valid source name AND that source's probe succeeds
- **THEN** the resolver SHALL return that source
- **AND** SHALL NOT evaluate other sources

#### Scenario: Pinned override unavailable

- **WHEN** `DASHBOARD_PREFER_SOURCE` is set to a valid source name AND that source's probe fails
- **THEN** the resolver SHALL throw a typed `PinnedSourceUnavailableError` carrying the requested source kind
- **AND** SHALL NOT silently fall back to default precedence

#### Scenario: Invalid override value

- **WHEN** `DASHBOARD_PREFER_SOURCE` is set to a value outside the source-kind enum (including the retired names `piExtension`, `npmGlobal` and `extracted`)
- **THEN** the resolver SHALL log a warning AND ignore the override AND proceed with default precedence

### Requirement: pi-dashboard CLI wrapper answers metadata queries without a TypeScript loader

The `pi-dashboard` CLI wrapper (`packages/server/bin/pi-dashboard.mjs`) SHALL answer `--version` / `-v` / `version` invocations without requiring jiti or any other TypeScript loader to be resolvable from the wrapper's own tree. This is required so `doctor` and every user diagnostic can determine the installed dashboard version even on installs where the wrapper sits in a tree without a top-level jiti (workspace-managed installs; npm-global installs where jiti is hoisted only under `pi-coding-agent`).

#### Scenario: --version short-circuits before jiti resolution

- **WHEN** `pi-dashboard --version` (or `-v`, or `version`) is invoked
- **AND** jiti is NOT resolvable from the wrapper's tree
- **THEN** the wrapper SHALL print the value of `pkg.version` from its sibling `package.json` to stdout AND exit with code 0
- **AND** SHALL NOT call any jiti resolution helper
- **AND** SHALL NOT print the legacy "cannot find jiti" error

#### Scenario: Other subcommands still fail loud on missing jiti

- **WHEN** `pi-dashboard start` (or any non-version argv) is invoked with `PI_DASHBOARD_TS_LOADER=jiti` AND jiti is NOT resolvable
- **THEN** the wrapper SHALL behave as before: print the existing "cannot find jiti" install hint to stderr AND exit with code 1

#### Scenario: Native loader does not need jiti

- **WHEN** `pi-dashboard start` is invoked with `PI_DASHBOARD_TS_LOADER` unset AND jiti is NOT resolvable
- **THEN** the wrapper SHALL re-exec Node with `--import <native-ts-register.mjs URL>` and SHALL NOT print the "cannot find jiti" hint

#### Scenario: --version on a healthy install

- **WHEN** `pi-dashboard --version` is invoked AND jiti IS resolvable
- **THEN** the wrapper SHALL still take the short-circuit path (read sibling `package.json`, print, exit 0)
- **AND** SHALL NOT re-exec node with a TypeScript loader

#### Scenario: --version on a corrupt install

- **WHEN** `pi-dashboard --version` is invoked AND the wrapper's sibling `package.json` cannot be read or parsed
- **THEN** the wrapper SHALL fall through to the selected loader's resolution path (which, for jiti with jiti absent, prints the legacy install hint)
- **AND** SHALL NOT silently exit 0 with an empty version

## REMOVED Requirements

### Requirement: Per-source probe contracts

**Reason**: Its scenarios describe the `piExtension`, `npmGlobal` and `extracted` probes, which were deleted together with the runtime extraction into `~/.pi-dashboard/` (change `eliminate-electron-runtime-install`). Only the `devMonorepo` probe survives unchanged.
**Migration**: Replaced by "Launch-source probe contracts" below (devMonorepo + bundled). `localLink` and `overlay` probes stay in "Overlay and local-link launch sources". The old "Probes SHALL be timeout-bounded" clause is not carried over. The devMonorepo and bundled probes are synchronous `existsSync` checks with nothing to time out; the localLink/overlay preflight and compatibility gate are owned by "Overlay and local-link launch sources" (and the runtime-overlay capability), and the only network probe (health) keeps its 1-second bound in "Discriminated launch-source resolution" → "Server already running".

### Requirement: Uniform spawn primitive

**Reason**: It lists the deleted source kinds `piExtension`, `npmGlobal` and `extracted`, and its "Legacy V1 launcher applies the same picker" scenario pins `launchServer()` / `LAUNCH_SOURCE_V2`, which no longer exist.
**Migration**: Replaced by "Uniform spawn primitive across launch sources" below. That requirement also drops the "System Node fallback when bundled missing" scenario: `pickNodeForServer` has only `bundled` and `execpath-fallback` results (`packages/electron/src/lib/pick-node.ts:32-33`).

### Requirement: Extracted self-heal performs real-fs destructive operations

**Reason**: `buildExtractedSource` and `extractBundle` no longer exist. The packaged app runs the server directly from the read-only `<resourcesPath>/server/` tree; nothing is extracted, wiped or copied at launch.
**Migration**: None. A damaged bundle surfaces as `BundledServerMissingError` (see "Discriminated launch-source resolution"); recovery is reinstalling the app.

## ADDED Requirements

### Requirement: Launch-source probe contracts

The `devMonorepo` and `bundled` probes SHALL be deterministic, side-effect-free existence checks that return a source only when the server entry (`cli.ts`) exists. The `localLink` and `overlay` candidates follow "Overlay and local-link launch sources". Launch-source diagnostics SHALL be appended to `~/.pi/dashboard/server.log` with a `[<ISO-ts>] [launch-source] ...` prefix, NOT emitted only to Electron stderr, because packaged-Electron stderr is discarded on desktop launches.

#### Scenario: devMonorepo probe

- **WHEN** the resolver evaluates the `devMonorepo` source
- **THEN** the probe SHALL succeed iff `!app.isPackaged` AND `existsSync(<cwd>/packages/server/src/cli.ts)` AND `existsSync(<cwd>/packages/extension/src/bridge.ts)`

#### Scenario: bundled probe

- **WHEN** the resolver evaluates the `bundled` source
- **THEN** the probe SHALL succeed iff `resourcesPath` is set AND `<resourcesPath>/server/node_modules/@blackbelt-technology/pi-dashboard-server/src/cli.ts` exists
- **AND** the returned `cwd` SHALL be `<resourcesPath>/server`
- **AND** the probe SHALL NOT write, extract, or install anything

#### Scenario: Invalid override is logged to the dashboard log

- **WHEN** `DASHBOARD_PREFER_SOURCE` holds an unknown value
- **THEN** the warning SHALL be appended to the dashboard log file with the `[launch-source]` prefix

### Requirement: Uniform spawn primitive across launch sources

The Electron app SHALL spawn the server via a single primitive `spawnFromSource(source, config)` that uses identical argv structure across `devMonorepo`, `localLink`, `overlay`, and `bundled` sources, differing only in `cliPath` and `cwd`. The primitive SHALL stamp `DASHBOARD_STARTER=Electron` on the spawned process env. The primitive SHALL select the Node binary used to run the server via `pickNodeForServer(input)` (the bundled Node binary, else `process.execPath` with `ELECTRON_RUN_AS_NODE=1`; no system-Node rung) and SHALL pass the result as `nodeBin` to `launchDashboardServer`. The primitive SHALL NOT rely on `launchDashboardServer`'s `process.execPath` default. Within the Electron app, `spawnFromSource` SHALL be the only path that launches the server; no legacy Electron launcher SHALL remain. (The bridge extension's own launcher is a separate starter and is out of scope.)

#### Scenario: All non-attach sources spawn identically

- **WHEN** `spawnFromSource(source, config)` is invoked for any non-`attach` source kind
- **THEN** the spawn argv SHALL be `[<resolved-node-bin>, "--import", <selected-ts-loader>, <cliPath-maybe-url-wrapped>, "--port", <port>, "--pi-port", <piPort>]`
- **AND** `<selected-ts-loader>` SHALL be the Node-native register module by default, or the jiti register hook when `PI_DASHBOARD_TS_LOADER=jiti` (see `server-launch`)
- **AND** `<resolved-node-bin>` SHALL be the `nodeBin` returned by `pickNodeForServer`
- **AND** the env SHALL include `DASHBOARD_STARTER: "Electron"`
- **AND** the cwd SHALL be `source.cwd`
- **AND** the spawn SHALL NOT detach (`detach: false`, so the server's lifetime is owned by the Electron app) and its stdio SHALL be piped to the dashboard log file

#### Scenario: Spawn primitive returns started pid

- **WHEN** `spawnFromSource(source, config)` succeeds
- **THEN** the primitive SHALL return `{ pid: <number> }`
- **AND** Electron SHALL store this pid for later lifecycle ownership comparison

#### Scenario: Bundled Node preferred

- **WHEN** `spawnFromSource` is invoked AND the bundled Node executable at `<bundledNodeDir>/bin/node` (POSIX) or `<bundledNodeDir>\node.exe` (Windows) exists and is executable
- **THEN** `pickNodeForServer` SHALL return `{ kind: "bundled", nodeBin: <bundled-path> }`
- **AND** the spawn SHALL NOT set `ELECTRON_RUN_AS_NODE` in the child env

#### Scenario: execPath fallback when bundled Node is missing

- **WHEN** `spawnFromSource` is invoked AND no bundled Node executable is present
- **THEN** `pickNodeForServer` SHALL return `{ kind: "execpath-fallback", nodeBin: process.execPath, needsElectronRunAsNode: true }`
- **AND** `spawnFromSource` SHALL stamp `ELECTRON_RUN_AS_NODE = "1"` in the child env
- **AND** a warning SHALL be logged identifying the fallback path
