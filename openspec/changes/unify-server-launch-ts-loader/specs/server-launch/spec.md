# server-launch (ADDED)

## ADDED Requirements

### Requirement: Single shared server-spawn primitive

All dashboard-server spawns SHALL go through `launchDashboardServer(opts)` exported from `packages/shared/src/server-launcher.ts`. No call site outside this module MAY construct `node --import <loader> <cliPath>` argv directly.

#### Scenario: Extension auto-spawn

- **WHEN** the bridge extension detects no running server and decides to auto-spawn
- **THEN** it calls `launchDashboardServer({ loader: "jiti-only", stdio: "ignore", healthTimeoutMs: 2000, ... })`
- **AND** does not invoke `child_process.spawn` for the server directly

#### Scenario: CLI `pi-dashboard start`

- **WHEN** `cmdStart` runs in `packages/server/src/cli.ts`
- **THEN** it calls `launchDashboardServer({ loader: "auto", stdio: { logFile }, healthTimeoutMs: 5000 })`

#### Scenario: Electron `spawnFromSource`

- **WHEN** Electron resolves a `LaunchSource` and spawns the server
- **THEN** it calls `launchDashboardServer({ loader: "auto", anchor: source.cliPath, env: buildSpawnEnv(), stdio: { logFile }, healthTimeoutMs: 15000 })`
- **AND** stamps `DASHBOARD_STARTER=Electron` via `env`

#### Scenario: Lint pin

- **WHEN** the repo-lint test `no-raw-node-import` runs
- **THEN** the allow-list contains exactly `node-spawn.ts` and `server-launcher.ts`

### Requirement: Unified TS-loader resolution via `ToolResolver`

`ToolResolver.resolveJiti(opts?)` SHALL be the single source of truth for resolving pi's `jiti-register.mjs`. Resolution order: managed pi (`~/.pi-dashboard/node_modules/@mariozechner/pi-coding-agent`) → system pi via `which("pi")` → caller-supplied `opts.anchor` walked up to nearest `node_modules` → `process.argv[1]` walked up. Returns absolute path or null.

#### Scenario: Managed pi present

- **WHEN** `~/.pi-dashboard/node_modules/@mariozechner/jiti/lib/jiti-register.mjs` exists
- **THEN** `resolveJiti()` returns that absolute path

#### Scenario: System pi only

- **WHEN** managed pi is absent but `which("pi")` resolves and pi's tree contains jiti
- **THEN** `resolveJiti()` returns the system pi's `jiti-register.mjs` path

#### Scenario: Anchor walk-up (Electron packaged)

- **WHEN** `process.argv[1]` is empty or a flag (packaged Electron) and `opts.anchor` is a valid `cliPath` inside a `node_modules` tree containing jiti
- **THEN** `resolveJiti({ anchor: cliPath })` returns the jiti path resolved from that tree

#### Scenario: All sources missing

- **WHEN** none of managed, system, anchor, or argv yield a jiti path
- **THEN** `resolveJiti()` returns null (callers raise their own typed error)

### Requirement: Removed predecessors

The following symbols SHALL be removed once all call sites are migrated:

- `packages/shared/src/resolve-jiti.ts` and its `resolveJitiImport` / `resolveJitiFromAnchor` exports
- `packages/electron/src/lib/ts-loader-resolver.ts`
- `resolveJitiFromPi` in `packages/electron/src/lib/server-lifecycle.ts`
- `resolveJitiFromAnchor` in `packages/electron/src/lib/launch-source.ts`

#### Scenario: Symbol-presence check

- **WHEN** the migration is complete
- **THEN** `git grep -nE 'resolveJitiImport|resolveJitiFromPi|resolveJitiFromAnchor|ts-loader-resolver'` returns no matches under `packages/` (excluding `out/`, `dist/`, `node_modules/`)
