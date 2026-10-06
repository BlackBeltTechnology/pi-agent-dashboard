## MODIFIED Requirements

### Requirement: pi-dashboard CLI wrapper answers metadata queries without a TypeScript loader

The `pi-dashboard` CLI wrapper (`packages/server/bin/pi-dashboard.mjs`) SHALL answer `--version` / `-v` / `version` invocations without requiring jiti or any other TypeScript loader to be resolvable from the wrapper's own tree. This is required so `probeNpmGlobal`, `doctor`, and every user diagnostic can determine the installed dashboard version even on installs where the wrapper sits in a tree without a top-level jiti (workspace-managed installs; npm-global installs where jiti is hoisted only under `pi-coding-agent`).

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

### Requirement: Uniform spawn primitive

The Electron app SHALL spawn the server via a single primitive `spawnFromSource(source, config)` that uses identical argv structure across `devMonorepo`, `piExtension`, `npmGlobal`, and `extracted` sources, differing only in `cliPath` and `cwd`. The primitive SHALL stamp `DASHBOARD_STARTER=Electron` on the spawned process env. The primitive SHALL select the Node binary used to run the server via `pickNodeForServer(input)` (bundled-first, system-fallback, `process.execPath`-with-`ELECTRON_RUN_AS_NODE=1` as last resort) and SHALL pass the result as `nodeBin` to `launchDashboardServer`. The primitive SHALL NOT rely on `launchDashboardServer`'s `process.execPath` default.

#### Scenario: All non-attach sources spawn identically

- **WHEN** `spawnFromSource(source, config)` is invoked for any non-`attach` source kind
- **THEN** the spawn argv SHALL be `[<resolved-node-bin>, "--import", <selected-ts-loader>, <cliPath-maybe-url-wrapped>, "--port", <port>, "--pi-port", <piPort>]`
- **AND** `<selected-ts-loader>` SHALL be the Node-native register module by default, or the jiti register hook when `PI_DASHBOARD_TS_LOADER=jiti` (see `server-launch`)
- **AND** `<resolved-node-bin>` SHALL be the `nodeBin` returned by `pickNodeForServer`
- **AND** the env SHALL include `DASHBOARD_STARTER: "Electron"`
- **AND** the cwd SHALL be `source.cwd`
- **AND** the spawn SHALL be detached with stdio piped to the dashboard log file

#### Scenario: Spawn primitive returns started pid

- **WHEN** `spawnFromSource(source, config)` succeeds
- **THEN** the primitive SHALL return `{ pid: <number> }`
- **AND** Electron SHALL store this pid for later lifecycle ownership comparison

#### Scenario: Bundled Node preferred

- **WHEN** `spawnFromSource` is invoked AND the bundled Node executable at `<bundledNodeDir>/bin/node` (POSIX) or `<bundledNodeDir>\node.exe` (Windows) exists and is executable
- **THEN** `pickNodeForServer` SHALL return `{ kind: "bundled", nodeBin: <bundled-path> }`
- **AND** the spawn SHALL NOT set `ELECTRON_RUN_AS_NODE` in the child env

#### Scenario: System Node fallback when bundled missing

- **WHEN** `spawnFromSource` is invoked AND no bundled Node executable is present AND `detectSystemNode()` returns `{ found: true, path, version }`
- **THEN** `pickNodeForServer` SHALL return `{ kind: "system", nodeBin: path, version }`
- **AND** the spawn SHALL NOT set `ELECTRON_RUN_AS_NODE` in the child env

#### Scenario: execPath fallback when neither bundled nor system Node available

- **WHEN** `spawnFromSource` is invoked AND no bundled Node is present AND no system Node is detected
- **THEN** `pickNodeForServer` SHALL return `{ kind: "execpath-fallback", nodeBin: process.execPath, needsElectronRunAsNode: true }`
- **AND** `spawnFromSource` SHALL stamp `ELECTRON_RUN_AS_NODE = "1"` in the child env
- **AND** a warning SHALL be logged identifying the fallback path

#### Scenario: Legacy V1 launcher applies the same picker

- **WHEN** `launchServer()` in `packages/electron/src/lib/server-lifecycle.ts` is reached (with `LAUNCH_SOURCE_V2=false`)
- **THEN** it SHALL call `pickNodeForServer` and pass the result as `nodeBin` into `launchDashboardServer`
- **AND** SHALL apply the same `ELECTRON_RUN_AS_NODE` stamping rule as `spawnFromSource`
