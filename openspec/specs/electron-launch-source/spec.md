# electron-launch-source

## Purpose

Defines a discriminated `LaunchSource` resolver that the Electron app uses to decide, on every launch, where to find the dashboard server (running, dev monorepo, pi extension, npm global, or extracted bundle), with deterministic per-source probes and a single uniform spawn primitive.

## Requirements

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

Each non-`attach` source SHALL have a deterministic probe that returns `true` only when the source can produce a working `cli.ts` path. Probes SHALL be timeout-bounded. Probe diagnostics — including "would-succeed-but-rejected-because-X" reasons and any error caught during the probe — SHALL be appended to `~/.pi/dashboard/server.log` (the dashboard log file resolved by `launchDashboardServer`'s log-file policy) with a `[<ISO-ts>] [launch-source] ...` prefix, NOT emitted only to Electron stderr. This is required because packaged-Electron stderr on `.desktop` launches (Linux/macOS/Windows) is discarded by the host shell and silent probe failures otherwise cannot be diagnosed by users or developers.

#### Scenario: devMonorepo probe

- **WHEN** the resolver evaluates the `devMonorepo` source
- **THEN** the probe SHALL succeed iff `!app.isPackaged` AND `existsSync(<cwd>/packages/server/src/cli.ts)` AND `existsSync(<cwd>/packages/extension/src/bridge.ts)`

#### Scenario: piExtension probe

- **WHEN** the resolver evaluates the `piExtension` source
- **THEN** the probe SHALL iterate every package returned by `listPiPackages({ scope: "user" })` from `packages/shared/src/pi-package-resolver.ts` (which walks `~/.pi/agent/settings.json#packages[]` for `npm:<name>` / `git+<url>` / `https://...` / absolute-path / relative-path entries and returns the resolved install directory for each one whose computed install path exists on disk)
- **AND** for each resolved package the probe SHALL succeed iff `existsSync(<packageDir>/bridge.ts)` OR `existsSync(<packageDir>/src/bridge.ts)` AND `require.resolve("@blackbelt-technology/pi-dashboard-server/package.json", { paths: [packageDir, parentNodeModules] })` succeeds AND the resolved server's `package.json#version` is `>=` the bundled minimum AND `pi --version` returns a version `>=` bundled minimum
- **AND** the probe SHALL return the first valid match
- **AND** when the probe rejects a package, the rejection reason (which check failed) SHALL be appended to the dashboard log file with the `[launch-source]` prefix
- **AND** the probe SHALL complete within 1 second of wall-clock time

#### Scenario: piExtension probe ignores absent or legacy settings field

- **WHEN** `~/.pi/agent/settings.json` parses successfully but does NOT contain a top-level `packages` key (older pi versions; malformed config; hand-edited file)
- **THEN** the piExtension probe SHALL return null without throwing
- **AND** SHALL NOT read or evaluate any other top-level field (in particular SHALL NOT read `settings.extensions[]`, which is not part of pi's current schema)

#### Scenario: npmGlobal probe

- **WHEN** the resolver evaluates the `npmGlobal` source
- **THEN** the probe SHALL succeed iff `which pi-dashboard` returns a path AND `realpathSync(path)` is NOT under `process.resourcesPath` AND `pi-dashboard --version` returns a non-empty version string `>=` bundled minimum on stdout AND exit code 0
- **AND** the probe SHALL complete within 1 second
- **AND** when `pi-dashboard --version` fails (non-zero exit, empty stdout, timeout), the probe SHALL append the captured exit code and stderr first line to the dashboard log file with the `[launch-source]` prefix before returning null

#### Scenario: extracted probe

- **WHEN** the resolver evaluates the `extracted` source
- **THEN** the probe SHALL always succeed (fallback)
- **AND** every diagnostic emitted by `buildExtractedSource` (extracted source unhealthy; bundle extraction failed; stash failed; install failed; merge failed) SHALL be appended to the dashboard log file with the `[launch-source]` prefix

### Requirement: Extracted self-heal performs real-fs destructive operations

When `buildExtractedSource` invokes `extractBundle` to re-extract from the bundled `<resourcesPath>/server/` into `~/.pi-dashboard/`, the destructive filesystem operations inside `extractBundle` (the selective-wipe step that removes non-SURVIVE entries from `managedDir`, the directory creation, the recursive copy) SHALL run against real `node:fs` defaults, NOT against caller-supplied no-op stubs. This is required because stale absolute symlinks under `<managedDir>/node_modules/` from prior partial extractions, npm bin-shim creation, or prior-version installs, MUST be deleted before `cpSync` walks them — otherwise `cpSync` follows the symlinks back into `<resourcesPath>/server/`, trips `ERR_FS_CP_EINVAL: cannot copy <bundle-path> to a subdirectory of self <same-bundle-path>`, and aborts the entire self-heal block.

#### Scenario: selective wipe runs before re-extract

- **WHEN** `buildExtractedSource` invokes `extractBundle(managedDir, bundleSource, version, migrateDir, extractFs)`
- **THEN** `extractFs` SHALL be a `Partial<ExtractFs>` containing only the file-content probes required for `migrateConfigs` and `installable-defaults` seeding (`existsSync`, `readFileSync`, `writeFileSync`, `renameSync`)
- **AND** the destructive operations (`mkdirSync`, `readdirSync`, `rmSync`, `statSync`, `cpSync`) SHALL default to `node:fs` real-fs implementations via `buildFs`
- **AND** the selective-wipe step inside `extractBundle` SHALL therefore actually iterate `managedDir` entries and `rmSync` each non-SURVIVE entry before `cpSync` writes the fresh bundle

#### Scenario: stale symlink in destination does not trip cpSync EINVAL

- **WHEN** `~/.pi-dashboard/node_modules/<some-pkg>/node_modules/.bin/<shim>` exists as a symlink pointing to a path under `<resourcesPath>/server/...` (left over from a prior partial extraction)
- **AND** `buildExtractedSource` enters its extract+install block
- **THEN** the selective-wipe step SHALL delete `node_modules/` (and every other non-SURVIVE entry) before `cpSync` runs
- **AND** `cpSync` SHALL write the fresh bundle to a destination with no surviving stale symlinks
- **AND** `cpSync` SHALL NOT throw `ERR_FS_CP_EINVAL`

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

### Requirement: pi-dashboard CLI wrapper answers metadata queries without a TypeScript loader

The `pi-dashboard` CLI wrapper (`packages/server/bin/pi-dashboard.mjs`) SHALL answer `--version` / `-v` / `version` invocations without requiring jiti or any other TypeScript loader to be resolvable from the wrapper's own tree. This is required so `probeNpmGlobal`, `doctor`, and every user diagnostic can determine the installed dashboard version even on installs where the wrapper sits in a tree without a top-level jiti (workspace-managed installs; npm-global installs where jiti is hoisted only under `pi-coding-agent`).

#### Scenario: --version short-circuits before jiti resolution

- **WHEN** `pi-dashboard --version` (or `-v`, or `version`) is invoked
- **AND** jiti is NOT resolvable from the wrapper's tree
- **THEN** the wrapper SHALL print the value of `pkg.version` from its sibling `package.json` to stdout AND exit with code 0
- **AND** SHALL NOT call any jiti resolution helper
- **AND** SHALL NOT print the legacy "cannot find jiti" error

#### Scenario: Other subcommands still fail loud on missing jiti

- **WHEN** `pi-dashboard start` (or any non-version argv) is invoked AND jiti is NOT resolvable
- **THEN** the wrapper SHALL behave as before: print the existing "cannot find jiti" install hint to stderr AND exit with code 1

#### Scenario: --version on a healthy install

- **WHEN** `pi-dashboard --version` is invoked AND jiti IS resolvable
- **THEN** the wrapper SHALL still take the short-circuit path (read sibling `package.json`, print, exit 0)
- **AND** SHALL NOT re-exec node with a jiti loader

#### Scenario: --version on a corrupt install

- **WHEN** `pi-dashboard --version` is invoked AND the wrapper's sibling `package.json` cannot be read or parsed
- **THEN** the wrapper SHALL fall through to the existing jiti-resolution path (which, if jiti is also absent, prints the legacy install hint)
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
