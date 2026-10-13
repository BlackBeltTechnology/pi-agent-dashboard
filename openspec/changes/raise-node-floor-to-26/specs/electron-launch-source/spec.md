## MODIFIED Requirements

### Requirement: Uniform spawn primitive across launch sources

The Electron app SHALL spawn the server via a single primitive `spawnFromSource(source, config)` that uses identical argv structure across `devMonorepo`, `localLink`, `overlay`, and `bundled` sources, differing only in `cliPath` and `cwd`. The primitive SHALL stamp `DASHBOARD_STARTER=Electron` on the spawned process env. The primitive SHALL select the Node binary used to run the server via `pickNodeForServer(input)` (the bundled Node binary; else the first system Node from the shared server-spawn runtime resolution — override, `PATH`, version-manager probe, managed Node — that satisfies the server engines range; else `process.execPath` with `ELECTRON_RUN_AS_NODE=1` only when Electron's embedded Node satisfies that range; else an unavailable result, in which case the app SHALL NOT spawn and SHALL show the user an error naming the required range) and SHALL pass the result as `nodeBin` to `launchDashboardServer`. The primitive SHALL NOT rely on `launchDashboardServer`'s `process.execPath` default. Within the Electron app, `spawnFromSource` SHALL be the only path that launches the server; no legacy Electron launcher SHALL remain. (The bridge extension's own launcher is a separate starter and is out of scope.)

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

- **WHEN** `spawnFromSource` is invoked AND no bundled Node executable is present AND no system Node satisfies the server engines range AND Electron's embedded Node does
- **THEN** `pickNodeForServer` SHALL return `{ kind: "execpath-fallback", nodeBin: process.execPath, needsElectronRunAsNode: true }`
- **AND** `spawnFromSource` SHALL stamp `ELECTRON_RUN_AS_NODE = "1"` in the child env
- **AND** a warning SHALL be logged identifying the fallback path

#### Scenario: System Node used when bundled Node is missing

- **WHEN** `spawnFromSource` is invoked for a `devMonorepo` source with no bundled Node executable
- **AND** the first `node` on `PATH` is `v26.1.0`
- **THEN** `pickNodeForServer` SHALL return a system result with that binary as `nodeBin`
- **AND** the spawn SHALL NOT set `ELECTRON_RUN_AS_NODE`

#### Scenario: No qualifying runtime refuses to spawn

- **WHEN** no bundled Node exists, no system Node satisfies the range, and Electron's embedded Node is `24.18.1`
- **THEN** `pickNodeForServer` SHALL return an unavailable result naming `24.18.1` and `>=26.0.0 <27`
- **AND** `spawnFromSource` SHALL NOT spawn a server
- **AND** the launch SHALL fail through the existing launch-failure path (`requestServerLaunch()` returns `{ kind: "failed", reason }` and supervision emits a `failed` phase) with a reason naming the required range
