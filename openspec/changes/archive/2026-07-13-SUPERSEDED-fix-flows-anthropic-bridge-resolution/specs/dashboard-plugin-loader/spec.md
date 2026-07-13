# dashboard-plugin-loader delta

## MODIFIED Requirements

### Requirement: Bridge auto-register uses dashboard- key prefix AND writes to packages[]

The plugin loader SHALL extend the existing `~/.pi/agent/settings.json` writer (currently `packages/shared/src/plugin-bridge-register.ts`) so that every plugin declaring a `bridge` entry is registered in TWO places atomically:

1. Under `dashboardPluginBridges[dashboard-<plugin-id>]` (forward-compat target for future `pi-coding-agent` versions that read this key).
2. As an entry in `packages[]` whose value equals the resolved bridge file path. This is the authoritative location for `pi-coding-agent` 0.74+ which only reads `packages[]`.

The loader SHALL NEVER write or delete entries that lack the `dashboard-` prefix (in `dashboardPluginBridges`) or whose `packages[]` path does not match a current `dashboardPluginBridges` value. User-added entries are preserved unconditionally.

The loader SHALL detect when a `dashboard-<plugin-id>` entry already exists with a mismatched path; in that case the loader SHALL log a warning, skip the registration for that plugin, and surface the conflict via `/api/health.plugins[].error`.

The atomic write helper used by the existing dashboard-bridge entry SHALL be reused — the loader SHALL NOT re-implement file writes. The dual write SHALL be atomic at the file level (single tmp + rename).

#### Scenario: Plugin bridge entry registered under managed key + packages[]

- **WHEN** plugin "flows-anthropic-bridge" declares `"bridge": "./src/bridge/index.ts"` and the dashboard starts
- **THEN** `~/.pi/agent/settings.json#dashboardPluginBridges` SHALL contain `"dashboard-flows-anthropic-bridge": "<absolute path>"`
- **AND** `~/.pi/agent/settings.json#packages` SHALL contain the same absolute path as an array element
- **AND** the file write SHALL be atomic (no observer can read a state with only one of the two writes applied).

#### Scenario: User-owned packages[] entries preserved

- **WHEN** the user has manually added `"../my-extension"` to `packages[]` and the dashboard starts
- **THEN** the loader SHALL leave that entry untouched and SHALL NOT delete it on plugin disable.
- **AND** the loader SHALL NOT delete `packages[]` entries whose absolute path does not match any current `dashboardPluginBridges` value.

#### Scenario: Disable removes both managed entries

- **WHEN** the user sets `plugins.flows-anthropic-bridge.enabled = false` and restarts the dashboard
- **THEN** the loader SHALL remove the `dashboard-flows-anthropic-bridge` key from `dashboardPluginBridges`
- **AND** SHALL remove the matching path from `packages[]`
- **AND** SHALL atomic-write the file
- **AND** SHALL NOT touch any other entry.

#### Scenario: Pre-existing dashboardPluginBridges entry with mismatched path triggers warning

- **WHEN** `~/.pi/agent/settings.json#dashboardPluginBridges["dashboard-foo"]` already points at a stale path different from the plugin's current resolved path
- **THEN** the loader SHALL log a warning, leave the existing entry in place (including the matching `packages[]` entry if present), mark plugin "foo" failed in `/api/health` with an error message identifying the path mismatch, and continue loading other plugins.

#### Scenario: Migration of legacy dashboardPluginBridges-only state

- **WHEN** the dashboard starts on a system that has `dashboardPluginBridges` entries but no corresponding `packages[]` entries (a prior dashboard version only wrote one place)
- **THEN** the loader SHALL idempotently add the missing `packages[]` entries on startup
- **AND** SHALL NOT add a `packages[]` entry that already exists (under any key/index).

### Requirement: Bridge entries auto-register as pi extensions

If a plugin manifest declares a `bridge` entry, the dashboard server SHALL on startup write the plugin's bridge path into `~/.pi/agent/settings.json#packages[]` (NOT `extensions[]`, which is not a real settings.json key in `pi-coding-agent`) so the bridge loads on every pi session start.

The dashboard SHALL remove the entry on plugin disable. The dashboard SHALL never overwrite `packages[]` entries owned by other tools or by the user.

A plugin SHALL be considered "loaded as a pi extension" only after `pi-coding-agent`'s extension loader has successfully `jiti.import`-ed the bridge file. The dashboard SHALL surface load failures via `/api/health.plugins[].bridgeStatus = "unreachable"` (see "Plugin bridge unreachable surfaces in /api/health" requirement below).

#### Scenario: Plugin bridge appears in pi packages[]

- **WHEN** flows-anthropic-bridge plugin declares `"bridge": "./src/bridge/index.ts"` and the dashboard starts
- **THEN** `~/.pi/agent/settings.json#packages` SHALL contain an entry equal to the absolute resolved path of that file.

#### Scenario: Disabling plugin removes packages[] entry

- **WHEN** the user disables flows-anthropic-bridge plugin via settings
- **THEN** the dashboard SHALL remove the bridge path from `packages[]` on next restart.

#### Scenario: User-owned packages[] entries are preserved

- **WHEN** the user has manually added `"../my-local-plugin"` to `packages[]`
- **THEN** the dashboard SHALL only touch entries it manages (recognized by exact-path match against current `dashboardPluginBridges` values); user-owned entries SHALL remain untouched.

## ADDED Requirements

### Requirement: Bridge plugin peer probe falls back to pi install layout

The bridge plugin's peer-probe SHALL try multiple resolution tiers before reporting a peer missing:

1. **Tier 1 — Node `node_modules` walk** anchored at `process.cwd()` via `createRequire(`${cwd}/_`).resolve(spec)`.
2. **Tier 2 — pi git cache** by scanning `~/.pi/agent/git/<host>/<owner>/<package-basename>/package.json` for the requested package. The basename SHALL be derived from the spec (e.g. `@scope/foo` → look for `foo` directory).
3. **Tier 3 — pi npm cache** by scanning `~/.pi/agent/npm/.../node_modules/<spec>/package.json` and the global npm root.
4. **Tier 4 — behavioural detection** (already supported for `pi-flows`): if a peer registers a well-known event listener (e.g. `flow:register-agent-extension`) on the shared `pi.events` bus, the peer is considered present regardless of module resolvability.

A peer SHALL be considered resolvable if ANY tier succeeds. When tier 2 or 3 succeeds, the probe SHALL return `{ ok: true, via: "pi-cache", absPath, entry }` where `entry` is the path to load via dynamic import (read from `package.json#exports["."]`, `package.json#main`, or `package.json#pi.extensions[0]` in that order).

A peer SHALL be considered missing only when ALL four tiers fail.

#### Scenario: Tier 1 (node_modules) resolves bare specifier

- **WHEN** `@pi/anthropic-messages` is installed in `<dashboard cwd>/node_modules/@pi/anthropic-messages/` with a valid `package.json#exports` field
- **THEN** the probe SHALL return `{ ok: true, via: "node_modules" }` from tier 1 and SHALL NOT scan tiers 2–4.

#### Scenario: Tier 1 fails but Tier 2 (pi git cache) finds peer

- **WHEN** `@pi/anthropic-messages` is NOT in `<cwd>/node_modules` but IS installed at `~/.pi/agent/git/github.com/BlackBeltTechnology/pi-anthropic-messages/`
- **THEN** tier 1 SHALL fail with `MODULE_NOT_FOUND`
- **AND** tier 2 SHALL find the package by scanning `~/.pi/agent/git/<host>/<owner>/pi-anthropic-messages/package.json`
- **AND** the probe SHALL return `{ ok: true, via: "pi-cache", absPath: "<install path>", entry: "./extensions/index.ts" }`.

#### Scenario: All tiers fail produces diagnostic

- **WHEN** neither peer is installed anywhere and no behavioural signal is present
- **THEN** the probe SHALL return `{ ok: false, reason: "<diagnostic>" }`
- **AND** the diagnostic message SHALL list which tiers were attempted and what each returned (MODULE_NOT_FOUND vs. no matching path under pi cache, etc.) so the user can fix the missing install.

#### Scenario: Bridge imports via absolute path when tier 2 succeeds

- **WHEN** the probe returns `{ via: "pi-cache", absPath: "/.../pi-anthropic-messages", entry: "./extensions/index.ts" }`
- **THEN** the bridge SHALL execute `await import(path.join(absPath, entry))` instead of `await import("@pi/anthropic-messages")`
- **AND** the imported module's default export SHALL be invoked against the parent `pi` AND emitted as a factory through `flow:register-agent-extension`.

### Requirement: Plugin bridge unreachable surfaces in /api/health.plugins[].bridgeStatus

For every plugin declaring a `bridge` entry, `/api/health.plugins[]` SHALL include a `bridgeStatus` field with one of: `"probing" | "waiting_peers" | "active" | "degraded" | "unreachable"`.

- `probing` — bridge file is being loaded by pi but no status broadcast received yet.
- `waiting_peers` — bridge file ran its probe but one or more peers are missing.
- `active` — bridge file ran and successfully wired both peers; subagents inherit the bridge.
- `degraded` — bridge file ran successfully but a peer was lost on a subsequent re-probe.
- `unreachable` — bridge file path does not exist on disk OR pi-coding-agent failed to load it (the bridge code never ran).

The `unreachable` state SHALL also set `/api/health.plugins[].error` to a diagnostic message explaining the gap (e.g. "bridge path missing from settings.json#packages[]" or "pi-coding-agent failed to load the bridge file: <jiti error>").

When status is `waiting_peers` for > 30 seconds the health response SHALL also include an `error` field with a hint on which peer is missing and what tiers were tried.

#### Scenario: Bridge loaded and active

- **WHEN** the bridge plugin probe returns `bothPresent: true` and emits `status: "active"`
- **THEN** `/api/health.plugins[]` SHALL show `bridgeStatus: "active"` for that plugin and no error.

#### Scenario: Bridge path missing from packages[]

- **WHEN** the dashboard's `plugin-bridge-register.ts` wrote the bridge to `dashboardPluginBridges` but failed to add it to `packages[]` (or a user manually removed the entry)
- **THEN** the bridge code never runs in any pi session
- **AND** `/api/health.plugins[].bridgeStatus` SHALL be `"unreachable"` for that plugin
- **AND** `/api/health.plugins[].error` SHALL be a message identifying the missing `packages[]` entry.

#### Scenario: Both peers missing surfaces in health

- **WHEN** the bridge code runs but neither `@pi/anthropic-messages` nor `pi-flows` resolves via any tier
- **THEN** the bridge emits `status: "waiting_peers"` with diagnostic reasons per peer
- **AND** after 30 s the health endpoint SHALL include `bridgeStatus: "waiting_peers"` and an `error` field listing each missing peer.
