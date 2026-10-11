# electron-launch-source

## Purpose

Defines a discriminated `LaunchSource` resolver that the Electron app uses to decide, on every launch, where to find the dashboard server (a running server, the dev monorepo, a local link, a staged runtime overlay, or the bundled server), with deterministic per-source probes and a single uniform spawn primitive.

## Requirements

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

### Requirement: spawnFromSource passes bundled-Node dir via getBundledNodeDir()

`packages/electron/src/lib/launch-source.ts::spawnFromSource` SHALL obtain the bundled-Node directory it passes to `pickNodeForServer({ bundledNodeDir, … })` by calling `getBundledNodeDir()` from `bundled-node.ts`. It SHALL NOT compute the directory by chaining `path.dirname` on the result of `getBundledNodePath()`.

#### Scenario: Windows resources layout resolves to bundled Node

- **WHEN** the Electron app spawns the server on Windows AND the bundled-Node binary exists at `<resources>\node\node.exe`
- **THEN** `spawnFromSource` SHALL pass `<resources>\node` as `bundledNodeDir` to `pickNodeForServer`
- **AND** `pickNodeForServer` SHALL return `{ kind: "bundled" }` with `nodeBin = <resources>\node\node.exe`
- **AND** the spawned server SHALL run under real Node (no `ELECTRON_RUN_AS_NODE=1`)
- **AND** the server log SHALL NOT contain the line `Bundled Node not found — falling back to process.execPath`

#### Scenario: POSIX resources layout resolves to bundled Node

- **WHEN** the Electron app spawns the server on macOS/Linux AND the bundled-Node binary exists at `<resources>/node/bin/node`
- **THEN** `spawnFromSource` SHALL pass `<resources>/node` as `bundledNodeDir` to `pickNodeForServer`
- **AND** `pickNodeForServer` SHALL return `{ kind: "bundled" }` with `nodeBin = <resources>/node/bin/node`

#### Scenario: Lint forbids dirname-arithmetic on bundled-Node path

- **WHEN** repository linters run (vitest `no-*` rule files under `packages/electron/src/__tests__/`)
- **THEN** any source file under `packages/electron/src/` containing `path.dirname(` chained around `getBundledNodePath()` SHALL fail the lint
- **AND** the failure message SHALL reference `getBundledNodeDir()` as the correct alternative

### Requirement: Overlay and local-link launch sources

The launch-source resolver SHALL support two additional kinds: `localLink` (a user-configured checkout) and `overlay` (a staged runtime release). Precedence SHALL be `attach → devMonorepo → localLink → overlay → bundled`. `localLink` SHALL be considered only when the effective runtime source is `local`, and `overlay` only when it is `npm` or `github`. The effective source SHALL be the most recently chosen of the dashboard source selection and the app-menu local folder. A candidate failing its compatibility gate or probe SHALL fall through to the next kind instead of raising an error.

#### Scenario: Overlay selected

- **WHEN** runtime source is `npm` or `github` AND a compatible current or pending overlay exists AND no server is running
- **THEN** the resolver SHALL return `overlay` with the overlay's server entry and working directory

#### Scenario: Local link selected

- **WHEN** runtime source is `local` AND the checkout passes preflight
- **THEN** the resolver SHALL return `localLink` with the checkout's server entry

#### Scenario: Overlay incompatible

- **WHEN** the overlay fails the compatibility gate
- **THEN** the resolver SHALL fall through to `bundled` AND SHALL record the failure reason

#### Scenario: Remote source chosen after local

- **WHEN** a local folder was linked AND the user later chooses `npm`, `github` or `bundled` in Settings
- **THEN** the resolver SHALL NOT return `localLink`

#### Scenario: Local link startup deadline

- **WHEN** the resolver returns `localLink`
- **THEN** the health deadline SHALL be the same as for `devMonorepo`

#### Scenario: Activation never attaches

- **WHEN** the resolver is invoked for a runtime activation
- **THEN** it SHALL NOT return `attach`, even if a server still answers the health probe

#### Scenario: Unpackaged dev run unaffected

- **WHEN** the app is unpackaged AND the working directory is the monorepo
- **THEN** the resolver SHALL return `devMonorepo` regardless of runtime source

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
