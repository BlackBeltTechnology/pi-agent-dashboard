## ADDED Requirements

### Requirement: Plugin discovery scans pi-installed global packages

In addition to globbing `packages/*/package.json` in the dashboard repo root, the loader SHALL read `~/.pi/agent/settings.json#packages[]` and resolve each entry to a filesystem path using the same resolution rules as `pi-resource-scanner.resolvePackagePath()`:

- `npm:<name>[@version]` → `$(npm root -g)/<name>` (resolved via cached `npm root -g` probe).
- `git:<url>` / `https://...` / `http://...` / `ssh://...` → `~/.pi/agent/git/<host>/<path>` (with `.git` suffix and version refs stripped).
- absolute path → as-is.
- relative path → resolved against the directory of the global `settings.json`.

For each resolved package directory, the loader SHALL look for `pi-dashboard-plugin` in `package.json` (or an adjacent `dashboard-plugin.json`, which takes precedence). Packages without that field SHALL be skipped silently. The single discovery routine SHALL deduplicate so a plugin appearing in both the workspace and pi packages registry produces exactly one resolved candidate (see "Workspace plugins shadow pi-installed plugins of the same id" below).

#### Scenario: npm-installed plugin is discovered

- **WHEN** `~/.pi/agent/settings.json#packages[]` contains `"npm:@blackbelt-technology/pi-dashboard-subagents"`, `npm root -g` returns `/usr/local/lib/node_modules`, and `/usr/local/lib/node_modules/@blackbelt-technology/pi-dashboard-subagents/package.json` declares a `pi-dashboard-plugin` field
- **THEN** `discoverPlugins()` SHALL include the plugin in its result with `packageDir` resolved to `/usr/local/lib/node_modules/@blackbelt-technology/pi-dashboard-subagents`.

#### Scenario: Git-installed plugin is discovered

- **WHEN** `settings.json#packages[]` contains `"https://github.com/acme/foo-plugin"` and the resolved path `~/.pi/agent/git/github.com/acme/foo-plugin/package.json` declares the manifest
- **THEN** discovery SHALL include the plugin.

#### Scenario: Pi-installed package without manifest is skipped

- **WHEN** `settings.json#packages[]` lists `"npm:some-pi-extension"` whose `package.json` has no `pi-dashboard-plugin` field
- **THEN** discovery SHALL skip the package silently (it is a pi extension, not a dashboard plugin).

#### Scenario: Unresolvable entry produces a warning, not a crash

- **WHEN** `settings.json#packages[]` contains `"npm:nonexistent-package"` and `$(npm root -g)/nonexistent-package` does not exist
- **THEN** discovery SHALL log a `warn` with the entry, omit it from results, and continue scanning other entries.

### Requirement: Workspace plugins shadow pi-installed plugins of the same id

When the same plugin id is declared by both a workspace package under `<dashboard-cwd>/packages/*` and a pi-installed package in `settings.json#packages[]`, the workspace version SHALL win. The pi-installed version SHALL appear in `/api/health.plugins[]` with `loaded: false` and `error: "Shadowed by workspace plugin of the same id."`.

#### Scenario: Workspace plugin shadows pi-installed plugin

- **WHEN** `packages/subagents-plugin/package.json` declares `"id": "subagents"` AND `~/.pi/agent/settings.json#packages[]` includes a pi-installed `@blackbelt-technology/pi-dashboard-subagents` whose plugin manifest also declares `"id": "subagents"`
- **THEN** `discoverPlugins()` SHALL produce one loaded entry for the workspace plugin, the pi-installed plugin SHALL appear in status with `loaded: false` and the shadowing error, and a `warn`-level log SHALL name both source paths.

### Requirement: Local-scope plugin installs are detected and surfaced as warnings, not loaded

The loader SHALL inspect the registered cwd of every active pi session known to the dashboard. For each cwd, it SHALL read `<cwd>/.pi/settings.json#packages[]` (when present) and resolve each entry to identify packages that declare a `pi-dashboard-plugin` manifest. Each such local-scope plugin SHALL be added to `/api/health.plugins[]` with `source: "local-detected"`, `loaded: false`, `enabled: false`, and `error: "Local-scope plugins are not loaded in this release. Install globally with --scope global to enable."`.

The loader SHALL NOT execute the local plugin's server entry, register its bridge, include its claims in the slot registry, or surface its components in any slot.

#### Scenario: Local-installed plugin appears as warning in status

- **WHEN** session "abc" has cwd `/proj/A` and `/proj/A/.pi/settings.json#packages[]` includes `"npm:@blackbelt-technology/pi-dashboard-subagents"` whose manifest is detected
- **THEN** `/api/health.plugins[]` SHALL contain `{ id: "subagents", source: "local-detected", enabled: false, loaded: false, error: "Local-scope plugins are not loaded in this release. Install globally with --scope global to enable.", claims: <count> }` AND no slot consumer SHALL render its components.

#### Scenario: Same plugin installed both globally and locally produces one loaded + one warning

- **WHEN** the same plugin id is installed both globally (loaded) and locally in an active session's cwd
- **THEN** the global entry SHALL be `{ source: "global", loaded: true, ... }` and a separate entry SHALL appear with `{ source: "local-detected", ... }` so the user understands the local install is redundant and inert.

### Requirement: `/api/health.plugins[]` entries include a `source` field

Each entry in the `plugins` array SHALL include a `source` field with one of: `"workspace"` (under `<dashboard-cwd>/packages/*`), `"global"` (resolved from `~/.pi/agent/settings.json#packages[]`), or `"local-detected"` (detected in an active session's cwd but not loaded).

The `source` field SHALL be additive; clients that ignore it SHALL still parse correctly. The existing `{ id, enabled, loaded, error?, claims }` fields SHALL remain unchanged.

#### Scenario: Workspace plugin reports source

- **WHEN** the demo plugin under `packages/demo-plugin/` loads successfully
- **THEN** its status entry SHALL include `source: "workspace"`.

#### Scenario: Global plugin reports source

- **WHEN** a pi-installed plugin loads successfully
- **THEN** its status entry SHALL include `source: "global"`.

#### Scenario: Local-detected plugin reports source

- **WHEN** a local-scope plugin manifest is detected
- **THEN** its status entry SHALL include `source: "local-detected"`.

### Requirement: Plugin discovery cache is cleared on package mutation

The loader SHALL export a `clearDiscoveryCache()` helper from `@blackbelt-technology/dashboard-plugin-runtime/server`. The dashboard's `/api/packages/install`, `/api/packages/remove`, and `/api/packages/update` route handlers SHALL call this helper after a successful global-scope operation, then re-run `discoverPlugins()` and `loadServerEntries()` so newly installed plugins activate without a process restart.

The helper SHALL invalidate both the in-memory `_discoveryCache` and any per-cwd memoization. Subsequent calls to `discoverPlugins()` SHALL re-execute the full scan.

#### Scenario: New plugin loads after install without restart

- **WHEN** the user runs `POST /api/packages/install` with `{ source: "npm:@blackbelt-technology/pi-dashboard-subagents", scope: "global" }` and the operation succeeds
- **THEN** the dashboard SHALL invoke `clearDiscoveryCache()`, re-run discovery + server-entry load, and the plugin's `settings-section` claim SHALL appear in the next `/api/health` response without restarting the server process.

#### Scenario: Removed plugin disappears from status without restart

- **WHEN** a plugin previously loaded with `source: "global"` is uninstalled via `POST /api/packages/remove` and the operation succeeds
- **THEN** the dashboard SHALL re-run discovery; the plugin SHALL no longer appear in `/api/health.plugins[]`.

#### Scenario: Updated plugin code requires restart

- **WHEN** a plugin previously loaded is reinstalled with new code via `POST /api/packages/update`
- **THEN** the dashboard SHALL re-run discovery and surface a `restartRequired: true` flag on the plugin's status entry, because the React client registry is build-time and cannot hot-swap module code in the running process.

### Requirement: Plugin status broadcast on discovery change

The dashboard server SHALL broadcast a `plugins_changed { plugins: PluginStatus[] }` browser-protocol message to all subscribed clients whenever the discovery cache is invalidated and re-populated, OR whenever a single plugin's status changes (load failure, enable/disable). The payload SHALL contain the full current `PluginStatus[]` snapshot so clients can replace their cached view atomically.

`plugins_changed` SHALL be additive to the existing browser-protocol union; older clients SHALL ignore the unknown type.

#### Scenario: All clients receive the snapshot on plugin install

- **WHEN** a global-scope plugin is installed and `loadServerEntries()` re-runs
- **THEN** the server SHALL broadcast `plugins_changed { plugins: [...] }` to every subscribed browser exactly once per discovery cycle.

#### Scenario: Plugin failure broadcasts updated status

- **WHEN** a previously loaded plugin's server entry begins throwing on the next load (e.g. after an update)
- **THEN** the server SHALL broadcast `plugins_changed` with the updated entry containing `loaded: false` and `error: "<message>"`.

### Requirement: Settings → General hosts a `<PluginsSection>` for plugin status and control

The Settings panel's General tab SHALL render a Plugins section listing every entry from `/api/health.plugins[]` (subscribed via the new `plugins_changed` event). Each row SHALL display:

- plugin `displayName` (or `id` as fallback),
- a status badge: `loaded` (green), `failed` (red), `disabled` (grey), `local-detected` (amber warning),
- claim count,
- error text when `error` is present,
- a `restartRequired` hint when applicable,
- a per-plugin enable/disable toggle that writes `plugins.<id>.enabled` via the existing plugin-config write endpoint.

The section SHALL handle empty state ("No plugins installed.") and partial-failure (some plugins loaded, others failed) without breaking layout.

#### Scenario: Healthy plugin row renders loaded status

- **WHEN** plugin "subagents" is `{ loaded: true, claims: 1, source: "global" }`
- **THEN** the row SHALL show its display name, a green "loaded" badge, "1 claim", no error text, and an enabled toggle.

#### Scenario: Failed plugin shows error inline

- **WHEN** plugin "x" is `{ loaded: false, error: "Bridge path conflict: ...", claims: 2 }`
- **THEN** the row SHALL show a red "failed" badge and the error text directly under the plugin name.

#### Scenario: Local-detected plugin shows warning with actionable copy

- **WHEN** a plugin entry has `source: "local-detected"`
- **THEN** the row SHALL show an amber "local-detected" badge and the error message instructing the user to install globally.

#### Scenario: Toggle disables plugin and persists

- **WHEN** the user toggles plugin "subagents" off
- **THEN** the client SHALL POST `plugins.subagents.enabled = false` to the existing plugin-config write endpoint, the server SHALL persist it, and the next `plugins_changed` broadcast SHALL show `{ enabled: false, loaded: false }` for that plugin.

#### Scenario: Empty state

- **WHEN** `/api/health.plugins[]` is empty
- **THEN** the section SHALL render the heading and a single line "No plugins installed." with no table rows.
