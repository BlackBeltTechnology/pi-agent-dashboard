## ADDED Requirements

### Requirement: Discriminated launch-source resolution

The Electron app SHALL resolve a single `LaunchSource` per launch via a pure resolver `selectLaunchSource()`. The resolver SHALL classify the launch as exactly one of `attach`, `devMonorepo`, `piExtension`, `npmGlobal`, or `extracted`, with each non-`attach` kind carrying a resolved `cliPath` and `cwd`.

#### Scenario: Server already running

- **WHEN** `selectLaunchSource()` is invoked AND the health probe returns 200 within 1 second
- **THEN** the resolver SHALL return `{ kind: "attach", url, starter }` populated from the health response
- **AND** SHALL NOT spawn a new server

#### Scenario: Default precedence with no override

- **WHEN** `DASHBOARD_PREFER_SOURCE` is unset AND the health probe fails
- **THEN** the resolver SHALL evaluate sources in order `devMonorepo > piExtension > npmGlobal > extracted`
- **AND** SHALL return the first source whose probe succeeds

#### Scenario: Pinned override succeeds

- **WHEN** `DASHBOARD_PREFER_SOURCE` is set to a valid source name AND that source's probe succeeds
- **THEN** the resolver SHALL return that source
- **AND** SHALL NOT evaluate other sources

#### Scenario: Pinned override unavailable

- **WHEN** `DASHBOARD_PREFER_SOURCE` is set to a valid source name AND that source's probe fails
- **THEN** the resolver SHALL throw a typed `PinnedSourceUnavailable` error carrying the requested source kind
- **AND** SHALL NOT silently fall back to default precedence

#### Scenario: Invalid override value

- **WHEN** `DASHBOARD_PREFER_SOURCE` is set to a value outside the source-kind enum
- **THEN** the resolver SHALL log a warning AND ignore the override AND proceed with default precedence

### Requirement: Per-source probe contracts

Each non-`attach` source SHALL have a deterministic probe that returns `true` only when the source can produce a working `cli.ts` path. Probes SHALL be timeout-bounded.

#### Scenario: devMonorepo probe

- **WHEN** the resolver evaluates the `devMonorepo` source
- **THEN** the probe SHALL succeed iff `!app.isPackaged` AND `existsSync(<cwd>/packages/server/src/cli.ts)` AND `existsSync(<cwd>/packages/extension/src/bridge.ts)`

#### Scenario: piExtension probe

- **WHEN** the resolver evaluates the `piExtension` source
- **THEN** the probe SHALL succeed iff `~/.pi/agent/settings.json` parses AND has at least one `extensions[].path` resolving to a directory containing `bridge.ts` AND `require.resolve("@blackbelt-technology/pi-dashboard-server/package.json", {paths:[extDir, parentNodeModules]})` succeeds AND the resolved server's `package.json#version` is `>=` the bundled minimum AND `pi --version` returns a version `>=` bundled minimum
- **AND** the probe SHALL complete within 1 second of wall-clock time

#### Scenario: npmGlobal probe

- **WHEN** the resolver evaluates the `npmGlobal` source
- **THEN** the probe SHALL succeed iff `which pi-dashboard` returns a path AND `realpathSync(path)` is NOT under `process.resourcesPath` AND `pi-dashboard --version` returns a version `>=` bundled minimum
- **AND** the probe SHALL complete within 1 second

#### Scenario: extracted probe

- **WHEN** the resolver evaluates the `extracted` source
- **THEN** the probe SHALL always succeed (fallback)

### Requirement: Uniform spawn primitive

The Electron app SHALL spawn the server via a single primitive `spawnFromSource(source, config)` that uses identical argv structure across `devMonorepo`, `piExtension`, `npmGlobal`, and `extracted` sources, differing only in `cliPath` and `cwd`. The primitive SHALL stamp `DASHBOARD_STARTER=Electron` on the spawned process env.

#### Scenario: All non-attach sources spawn identically

- **WHEN** `spawnFromSource(source, config)` is invoked for any non-`attach` source kind
- **THEN** the spawn argv SHALL be `[process.execPath, "--import", <jiti-loader>, <cliPath-maybe-url-wrapped>, "--port", <port>, "--pi-port", <piPort>]`
- **AND** the env SHALL include `DASHBOARD_STARTER: "Electron"`
- **AND** the cwd SHALL be `source.cwd`
- **AND** the spawn SHALL be detached with stdio piped to the dashboard log file

#### Scenario: Spawn primitive returns started pid

- **WHEN** `spawnFromSource(source, config)` succeeds
- **THEN** the primitive SHALL return `{ pid: <number> }`
- **AND** Electron SHALL store this pid for later lifecycle ownership comparison
