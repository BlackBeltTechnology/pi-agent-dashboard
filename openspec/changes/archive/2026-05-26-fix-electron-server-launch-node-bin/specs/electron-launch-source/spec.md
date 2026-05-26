## MODIFIED Requirements

### Requirement: Uniform spawn primitive

The Electron app SHALL spawn the server via a single primitive `spawnFromSource(source, config)` that uses identical argv structure across `devMonorepo`, `piExtension`, `npmGlobal`, and `extracted` sources, differing only in `cliPath` and `cwd`. The primitive SHALL stamp `DASHBOARD_STARTER=Electron` on the spawned process env. The primitive SHALL select the Node binary used to run the server via `pickNodeForServer(input)` (bundled-first, system-fallback, `process.execPath`-with-`ELECTRON_RUN_AS_NODE=1` as last resort) and SHALL pass the result as `nodeBin` to `launchDashboardServer`. The primitive SHALL NOT rely on `launchDashboardServer`'s `process.execPath` default.

#### Scenario: All non-attach sources spawn identically

- **WHEN** `spawnFromSource(source, config)` is invoked for any non-`attach` source kind
- **THEN** the spawn argv SHALL be `[<resolved-node-bin>, "--import", <jiti-loader>, <cliPath-maybe-url-wrapped>, "--port", <port>, "--pi-port", <piPort>]`
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

- **WHEN** `spawnFromSource` is invoked AND no bundled Node executable is present AND `detectSystemNode()` returns `{ found: true, path, version }` AND `isKnownBadNode(version) === false`
- **THEN** `pickNodeForServer` SHALL return `{ kind: "system", nodeBin: path, version }`
- **AND** the spawn SHALL NOT set `ELECTRON_RUN_AS_NODE` in the child env

#### Scenario: execPath fallback when neither bundled nor safe-system Node available

- **WHEN** `spawnFromSource` is invoked AND no bundled Node is present AND no safe system Node is detected
- **THEN** `pickNodeForServer` SHALL return `{ kind: "execpath-fallback", nodeBin: process.execPath, needsElectronRunAsNode: true }`
- **AND** `spawnFromSource` SHALL stamp `ELECTRON_RUN_AS_NODE = "1"` in the child env
- **AND** a warning SHALL be logged identifying the fallback path

#### Scenario: Legacy V1 launcher applies the same picker

- **WHEN** `launchServer()` in `packages/electron/src/lib/server-lifecycle.ts` is reached (with `LAUNCH_SOURCE_V2=false`)
- **THEN** it SHALL call `pickNodeForServer` and pass the result as `nodeBin` into `launchDashboardServer`
- **AND** SHALL apply the same `ELECTRON_RUN_AS_NODE` stamping rule as `spawnFromSource`
