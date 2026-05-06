# server-launch (ADDED)

## ADDED Requirements

### Requirement: Single shared dashboard-server spawn primitive

All dashboard-server spawns SHALL go through `launchDashboardServer(opts)` exported from `packages/shared/src/server-launcher.ts`. No call site outside this module MAY construct `node --import <loader> <cli>` argv directly. Internally, `launchDashboardServer` SHALL delegate argv construction to the existing `spawnNodeScript` helper in `packages/shared/src/platform/node-spawn.ts`.

#### Scenario: Extension auto-spawn

- **WHEN** the bridge extension detects no running server and decides to auto-spawn
- **THEN** it calls `launchDashboardServer({ cliPath, stdio: "ignore", healthTimeoutMs: 2000, ... })`
- **AND** does not import `resolveJitiImport` or call `child_process.spawn` for the server directly

#### Scenario: CLI `pi-dashboard start`

- **WHEN** `cmdStart` runs in `packages/server/src/cli.ts`
- **THEN** it calls `launchDashboardServer({ cliPath, stdio: { logFile }, healthTimeoutMs: 5000 })`

#### Scenario: Electron `spawnFromSource`

- **WHEN** Electron resolves a `LaunchSource` and spawns the server
- **THEN** it calls `launchDashboardServer({ cliPath: source.cliPath, anchor: source.cliPath, env: ToolResolver.buildSpawnEnv(), stdio: { logFile }, healthTimeoutMs: 15000 })`
- **AND** stamps `DASHBOARD_STARTER=Electron` via `env`

#### Scenario: Lint allow-list pinned to two files

- **WHEN** the repo-lint test `no-raw-node-import` runs
- **THEN** the `ALLOWLIST` constant contains exactly `packages/shared/src/platform/node-spawn.ts` and `packages/shared/src/server-launcher.ts`
- **AND** no source file in `packages/{extension,server,electron}/src/` contains the `ban:raw-node-import-ok` marker

### Requirement: Unified jiti resolution via `ToolResolver`

`ToolResolver.resolveJiti({ anchor? })` SHALL be the single source of truth for resolving pi's `jiti-register.mjs`. Resolution order: managed pi (`~/.pi-dashboard/node_modules/@mariozechner/pi-coding-agent`) → system pi via `which("pi")` → caller-supplied `opts.anchor` walked up to nearest `node_modules` → `process.argv[1]` walked up. Returns the register hook as a `file://` URL string (preserving the Windows drive-letter URL-wrapping contract documented on the prior `buildJitiRegisterUrl` helper) or null.

#### Scenario: Managed pi present

- **WHEN** `~/.pi-dashboard/node_modules/@mariozechner/jiti/lib/jiti-register.mjs` exists
- **THEN** `resolveJiti()` returns a `file://` URL pointing at that path

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
- **AND** `launchDashboardServer` raises `JitiNotFoundError` when its caller did not supply a usable anchor

### Requirement: Removed predecessors

The following symbols SHALL be removed once all call sites are migrated:

- `packages/shared/src/resolve-jiti.ts` (file deleted; `resolveJitiImport`, `resolveJitiFromAnchor`, `buildJitiRegisterUrl` exports gone — contract preserved in `ToolResolver.resolveJiti`).
- `packages/electron/src/lib/ts-loader-resolver.ts` (file deleted).
- `resolveJitiFromPi` export in `packages/electron/src/lib/server-lifecycle.ts`.
- `deps.resolveJitiFromAnchor` injection seam in `packages/electron/src/lib/launch-source.ts`.

#### Scenario: Symbol-presence check

- **WHEN** the migration is complete
- **THEN** `git grep -nE 'resolveJitiImport|resolveJitiFromAnchor|resolveJitiFromPi|ts-loader-resolver|buildJitiRegisterUrl'` returns zero matches under `packages/` (excluding `out/`, `dist/`, `node_modules/`)
