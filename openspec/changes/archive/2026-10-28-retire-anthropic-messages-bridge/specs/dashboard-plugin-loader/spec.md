# Spec Delta

## MODIFIED Requirements

### Requirement: Bridge auto-register uses dashboard- key prefix

The plugin loader SHALL extend the existing `~/.pi/agent/settings.json` writer (`packages/shared/src/plugin-bridge-register.ts`) so that every plugin declaring a `bridge` entry is registered under a managed key with the prefix `dashboard-<plugin-id>` in TWO places, atomically:

1. `dashboardPluginBridges["dashboard-<plugin-id>"] = "<absolute-bridge-path>"` — retained for forward compatibility when pi-coding-agent grows native support.
2. `packages[]` — a new entry of shape `{ path: "<absolute-bridge-path>", _dashboardOwned: "dashboard-<plugin-id>" }` (or the same path string with a documented ownership marker mechanism). This is the key that pi-coding-agent actually reads, so this write makes the bridge load in real pi sessions.

The loader SHALL NEVER write or delete entries in `packages[]` that lack the `_dashboardOwned` marker (or equivalent ownership mechanism). User-added entries SHALL remain untouched on plugin disable.

On server start the loader SHALL run a one-shot reconciliation: for each entry in `dashboardPluginBridges`, ensure a matching `packages[]` entry exists with the same ownership marker; missing entries SHALL be added with a log line. This heals existing installs that pre-date this change without requiring plugin reinstall.

The loader SHALL detect when a `dashboard-<plugin-id>` entry already exists with a path that does not match the plugin's resolved bridge path; in that case the loader SHALL log a warning, skip the registration for that plugin, and surface the conflict via `/api/health.plugins[].error`.

The atomic write helper used by the existing dashboard-bridge entry SHALL be reused — the loader SHALL NOT re-implement file writes.

An environment variable `PI_DASHBOARD_DISABLE_PLUGIN_BRIDGE_PACKAGES_WRITE=1` SHALL skip the `packages[]` write (rollback escape hatch for one minor release).

#### Scenario: Plugin bridge entry registered in both registries

- **WHEN** plugin "flows" declares a `bridge` field and the dashboard starts
- **THEN** `~/.pi/agent/settings.json` SHALL contain `dashboardPluginBridges["dashboard-flows"]` pointing at the absolute bridge path
- **AND** `packages[]` SHALL contain an entry for the same path marked `_dashboardOwned: "dashboard-flows"`

#### Scenario: pi loads the bridge from packages[] on next session

- **WHEN** after the dual write completes, a pi session starts
- **THEN** the bridge file SHALL be imported by pi-coding-agent's extension loader (which reads `packages[]`)
- **AND** the bridge's `activate()` function SHALL execute, run its peer probe, and (when peers resolve) emit `flow:register-agent-extension`

#### Scenario: One-shot reconciliation heals pre-existing installs

- **WHEN** the server starts and `dashboardPluginBridges` contains an entry without a matching `packages[]` entry
- **THEN** the loader SHALL add the missing `packages[]` entry with the same ownership marker and log an info line naming the plugin id

#### Scenario: User-owned entries preserved

- **WHEN** the user has manually added a `packages[]` entry without an ownership marker
- **THEN** the loader SHALL leave that entry untouched and SHALL NOT delete it on plugin disable

#### Scenario: Disable removes managed entries from both registries

- **WHEN** the user sets `plugins.<id>.enabled = false` and restarts the dashboard
- **THEN** the loader SHALL remove BOTH the `dashboardPluginBridges["dashboard-<id>"]` key AND the matching ownership-marked `packages[]` entry, atomic-write the file, and SHALL NOT touch any other entry

#### Scenario: Escape-hatch env var disables packages[] write

- **WHEN** `PI_DASHBOARD_DISABLE_PLUGIN_BRIDGE_PACKAGES_WRITE=1` is set in the server env
- **THEN** the loader SHALL write only to `dashboardPluginBridges` and SHALL NOT touch `packages[]` (rollback parity with the pre-change behavior)

### Requirement: `/api/health.plugins[]` field is populated with one entry per discovered plugin

The dashboard `GET /api/health` response SHALL include a `plugins` array. Each discovered plugin (regardless of enable state or load success) SHALL produce exactly one entry of shape:

```ts
{
  id: string,
  enabled: boolean,
  loaded: boolean,
  error?: string,
  claims: number,
  bridgeLoadedFrom: "packages[]" | "dashboardPluginBridges" | "none",
  lastProbe?: { status: "probing"|"waiting_peers"|"active"|"degraded", peers: object, at: number }
}
```

The `bridgeLoadedFrom` field SHALL be computed by re-reading `~/.pi/agent/settings.json` at health-check time and matching the plugin's resolved bridge path against entries in both registries. The `lastProbe` field SHALL be populated from the plugin's forwarded status events kept in the server's per-PID status map (when the plugin is a status-emitting bridge plugin); for non-status-emitting bridges this field SHALL be omitted.

#### Scenario: Health reports bridge loaded from packages[]

- **WHEN** plugin "flows" has a `packages[]` entry with matching ownership marker and the plugin loaded successfully
- **THEN** `GET /api/health` SHALL return `plugins[*]` with `id: "flows", bridgeLoadedFrom: "packages[]", loaded: true`

#### Scenario: Health reports active bridge probe

- **WHEN** the bridge has reported `{status: "active"}` for a pi session
- **THEN** the corresponding `/api/health.plugins[]` entry SHALL include `lastProbe.status: "active"` and an `at` timestamp within the past 60 s

#### Scenario: Health reports legacy bridge without packages[] entry

- **WHEN** a plugin's bridge is registered only in `dashboardPluginBridges` (e.g. escape-hatch env var was set) AND no matching `packages[]` entry exists
- **THEN** `GET /api/health` SHALL report `bridgeLoadedFrom: "dashboardPluginBridges"` and `loaded: false` for that plugin (pi won't import it)

### Requirement: First-party monorepo plugins SHALL ship inside the Electron bundle

`bundle-server.mjs` SHALL copy every first-party plugin listed in `packages/server/package.json#piDashboard.bundledPlugins` (each a `pi-dashboard-plugin` package under `packages/`) into `<bundle>/resources/plugins/<id>/`, EXCEPT plugins whose manifest declares `fixture: true`. The runtime `findBundledPluginsDir()` SHALL locate the resulting directory at `~/.pi-dashboard/resources/plugins/` after extraction.

The bundled set SHALL include at minimum: `roles-plugin`, `flows-plugin`. Fixture-only plugins (e.g. `demo-plugin`) SHALL be excluded.

Every package in a bundled plugin's `dependencies` (first-party and third-party; `peerDependencies` and `optionalDependencies` excluded) SHALL be resolvable from `<bundle>/resources/plugins/<id>/` inside the bundle, so a bundled plugin's server entry never fails to load because a declared dependency is absent.

#### Scenario: Bundled plugins land under resources/plugins

- **WHEN** `npm run electron:bundle-server` completes
- **THEN** `packages/electron/resources/server/resources/plugins/` SHALL contain a subdirectory per bundled plugin id, each with a valid `package.json` carrying a `pi-dashboard-plugin` manifest.

#### Scenario: Fresh Electron install discovers bundled plugins

- **WHEN** a fresh `~/.pi-dashboard/` is populated from the bundle and the server starts
- **THEN** `discoverPlugins()` SHALL return at least the bundled set, AND `/api/plugins` SHALL list them with their manifest summaries.

#### Scenario: Bundled plugin third-party imports resolve

- **WHEN** a fresh Electron install starts the bundled server with `gmail-plugin` enabled
- **THEN** the plugin's server entry SHALL load without `Cannot find module 'oauth4webapi'`
- **AND** `/api/plugins` SHALL report `gmail` as loaded with no error
