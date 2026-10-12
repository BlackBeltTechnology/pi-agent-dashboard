## ADDED Requirements

### Requirement: pi-dashboard CLI wrapper answers metadata queries before resolving the native loader

The `pi-dashboard` CLI wrapper (`packages/server/bin/pi-dashboard.mjs`) SHALL answer `--version` / `-v` / `version` invocations without resolving any TypeScript loader. This is required so `doctor` and every user diagnostic can determine the installed dashboard version even on a damaged install where the native register module cannot be resolved.

#### Scenario: --version short-circuits before loader resolution

- **WHEN** `pi-dashboard --version` (or `-v`, or `version`) is invoked
- **AND** the native register module is NOT resolvable from the wrapper's tree
- **THEN** the wrapper SHALL print the value of `pkg.version` from its sibling `package.json` to stdout AND exit with code 0
- **AND** SHALL NOT call any loader resolution helper

#### Scenario: Other subcommands fail loud on a missing native loader

- **WHEN** `pi-dashboard start` (or any non-version argv) is invoked AND the native register module is NOT resolvable
- **THEN** the wrapper SHALL print the corrupted-install hint to stderr AND exit with code 1

#### Scenario: Start does not need jiti

- **WHEN** `pi-dashboard start` is invoked AND jiti is NOT resolvable
- **THEN** the wrapper SHALL re-exec Node with `--import <native-ts-register.mjs URL>` and SHALL NOT print a "cannot find jiti" hint

#### Scenario: --version on a healthy install

- **WHEN** `pi-dashboard --version` is invoked AND the native register module IS resolvable
- **THEN** the wrapper SHALL still take the short-circuit path (read sibling `package.json`, print, exit 0)
- **AND** SHALL NOT re-exec node with a TypeScript loader

#### Scenario: --version on a corrupt install

- **WHEN** `pi-dashboard --version` is invoked AND the wrapper's sibling `package.json` cannot be read or parsed
- **THEN** the wrapper SHALL fall through to the native loader resolution path (which, when the register module is absent, prints the corrupted-install hint)
- **AND** SHALL NOT silently exit 0 with an empty version

## MODIFIED Requirements

### Requirement: Uniform spawn primitive across launch sources

The Electron app SHALL spawn the server via a single primitive `spawnFromSource(source, config)` that uses identical argv structure across `devMonorepo`, `localLink`, `overlay`, and `bundled` sources, differing only in `cliPath` and `cwd`. The primitive SHALL stamp `DASHBOARD_STARTER=Electron` on the spawned process env. The primitive SHALL select the Node binary used to run the server via `pickNodeForServer(input)` (the bundled Node binary, else `process.execPath` with `ELECTRON_RUN_AS_NODE=1`; no system-Node rung) and SHALL pass the result as `nodeBin` to `launchDashboardServer`. The primitive SHALL NOT rely on `launchDashboardServer`'s `process.execPath` default. Within the Electron app, `spawnFromSource` SHALL be the only path that launches the server; no legacy Electron launcher SHALL remain. (The bridge extension's own launcher is a separate starter and is out of scope.)

#### Scenario: All non-attach sources spawn identically

- **WHEN** `spawnFromSource(source, config)` is invoked for any non-`attach` source kind
- **THEN** the spawn argv SHALL be `[<resolved-node-bin>, "--import", <native-ts-loader>, <cliPath-maybe-url-wrapped>, "--port", <port>, "--pi-port", <piPort>]`
- **AND** `<native-ts-loader>` SHALL be the Node-native register module (the only server loader, see `server-launch`)
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

## REMOVED Requirements

### Requirement: pi-dashboard CLI wrapper answers metadata queries without a TypeScript loader
**Reason**: Its scenarios are framed around jiti resolution, which the wrapper no longer does.
**Migration**: See "pi-dashboard CLI wrapper answers metadata queries before resolving the native loader". The `--version` short-circuit behaviour is unchanged.
