# plugin-manifest-staleness Specification

## Purpose

Detects when a running dashboard server's discovered plugin set differs from the plugin set baked into the currently-loaded client bundle, and surfaces a non-blocking "Refresh to load the latest contributions" banner so users get the new UI without manual coordination.

## Requirements

### Requirement: Build-time manifest hash embedded in client bundle

The Vite plugin SHALL compute a SHA-256 hash of the discovered plugin set at registry-generation time and emit it as a named export `PLUGIN_REGISTRY_HASH` alongside `PLUGIN_REGISTRY` in the generated `plugin-registry.tsx`. The hash input SHALL be a deterministic JSON serialization (sorted keys, lexicographic plugin order) of `{id, version, claims: [{slot, component, predicate?, shouldRender?, command?}]}` for each plugin.

The hashed set SHALL be the **client-registry plugin set**: plugins that contribute a client entry, discovered from a bundle-eligible root, under the build's fixture policy. A production build SHALL record the ids of that set as `bundledPluginIds` in its build declaration. The server SHALL compute its side of the comparison over the discovery winners (`dashboard-plugin-loader`) whose id is in the served build's `bundledPluginIds`, plus — only where a monorepo root is resolvable — the client-contributing plugins discovered under that root's bundle-eligible directory, so the two hashes are never computed over structurally different sets. A plugin that is runtime-delivered (its id not bundled and no monorepo root containing it) SHALL be excluded from both sides, on every host layout including npm-global and Electron installs. The server SHALL re-derive the declared subset only from the build's own copies (`workspace` or `bundled` source). When any declared id has no such copy on disk (npm-global ships no `resources/plugins`), the server SHALL NOT hash another copy; it SHALL use the declaration's `pluginRegistryHash` for the declared subset, so the comparison is against the declaration. On such a host the banner therefore cannot report a version skew between a declared plugin's halves. When the served build declares no `bundledPluginIds`, the server SHALL keep the selection it used before this change.

#### Scenario: Hash is deterministic across rebuilds

- **WHEN** discovery runs twice over the same package set on disk
- **THEN** `PLUGIN_REGISTRY_HASH` SHALL be identical in both generated files

#### Scenario: Hash changes when a claim is added

- **WHEN** a plugin gains a new claim entry in its manifest and the bundle is rebuilt
- **THEN** `PLUGIN_REGISTRY_HASH` SHALL differ from the previous value

#### Scenario: Plugin without a client entry does not enter the hash

- **WHEN** a discovered plugin declares no client entry
- **THEN** it SHALL NOT contribute to `PLUGIN_REGISTRY_HASH`
- **AND** it SHALL NOT contribute to the server-side hash either

#### Scenario: Runtime plugin on an npm-global host does not enter the hash

- **WHEN** the server runs from an npm-global install with no resolvable monorepo root, and a client-contributing plugin is discovered under `~/.pi/dashboard/plugins` whose id is not in the served build's `bundledPluginIds`
- **THEN** it SHALL NOT contribute to the server-side hash
- **AND** `/api/health.bundleHash` SHALL equal the embedded `PLUGIN_REGISTRY_HASH`

#### Scenario: npm-global host compares against the declaration

- **WHEN** an npm-global host (no build copy of the declared plugins on disk) discovers an `installed` copy of declared id `goal` at another version
- **THEN** the server SHALL NOT hash that copy, `/api/health.bundleHash` SHALL equal the declaration's `pluginRegistryHash`, and no staleness banner SHALL appear

#### Scenario: Edited workspace manifest still reports staleness

- **WHEN** a monorepo host's workspace copy of a declared plugin gains a claim after the client was built
- **THEN** the re-derived server hash SHALL differ and staleness SHALL be reported

### Requirement: Server exposes live plugin manifest with current hash

The dashboard server SHALL expose `GET /api/plugins/manifest` returning `{ hash, plugins: [{id, version, claims}] }`. The endpoint SHALL be public (no auth gate) so that any client connected to the server — including remote browsers via tunnel — can probe staleness.

The endpoint hash SHALL be computed by the same deterministic serialization **over the same client-registry plugin set** used at build time: the same client-entry requirement, the same fixture policy, and the bundled set defined above (the served build's `bundledPluginIds`, plus the monorepo bundle-eligible directory where one is resolvable), with the declaration-hash substitution defined above where no build copy exists. The hash surfaced as `/api/health.bundleHash` — which is the surface the client actually compares against — SHALL be computed identically, and every other producer of this hash in the repository SHALL select the set through the same shared selector.

#### Scenario: Endpoint returns live discovery

- **WHEN** a plugin is installed and the server is restarted
- **THEN** `GET /api/plugins/manifest` SHALL return the new plugin in `plugins[]` and a hash matching the new set

#### Scenario: Endpoint hash matches build-time hash when bundle is up to date

- **WHEN** the server is running the same plugin set used to build the client
- **THEN** `GET /api/plugins/manifest`'s `hash` field SHALL equal `PLUGIN_REGISTRY_HASH` exported by the client bundle

#### Scenario: Client-less plugin present does not report staleness

- **WHEN** the discovered set includes a plugin with no client entry and the client bundle was built from that same checkout
- **THEN** `/api/health.bundleHash` SHALL equal the embedded `PLUGIN_REGISTRY_HASH`
- **AND** no staleness banner SHALL be rendered

#### Scenario: Fixture plugin alone does not report staleness

- **WHEN** a fixture plugin that contributes a client entry is discovered and the loaded bundle was built from that same checkout
- **THEN** the comparison SHALL apply one fixture policy to both sides
- **AND** the presence of the fixture plugin alone SHALL NOT produce a hash difference

#### Scenario: Plugin from a runtime-only root does not report staleness

- **WHEN** the server discovers a client-contributing plugin from a root that no build can emit an import for
- **THEN** that plugin SHALL be excluded from the server-side hash
- **AND** its presence alone SHALL NOT render the staleness banner

#### Scenario: Staleness reported only for a genuine set difference

- **WHEN** the server's client-contributing plugin set differs from the set the loaded bundle was built from, on a host where the build's own copies exist on disk (on npm-global the declared subset is taken from the declaration, as defined above)
- **THEN** staleness SHALL be reported
- **AND** when the two sets are equal, staleness SHALL NOT be reported regardless of which root each plugin was discovered from

### Requirement: Client detects staleness on mount and renders banner

The client SHALL fetch `/api/plugins/manifest` on every connection (initial mount and reconnect) and compare the returned hash to the embedded `PLUGIN_REGISTRY_HASH`. When the hashes differ, the client SHALL render a non-blocking banner at the top of the shell with text "Dashboard plugins were updated. Refresh to load the latest contributions." and a "Refresh" button that triggers `window.location.reload()`.

The banner SHALL be dismissible (per-session) and SHALL re-appear on next reconnect if staleness persists.

#### Scenario: Up-to-date bundle hides banner

- **WHEN** client mounts and server hash equals embedded hash
- **THEN** no staleness banner is rendered

#### Scenario: Stale bundle shows banner

- **WHEN** client mounts and server hash differs from embedded hash
- **THEN** the staleness banner is rendered with a "Refresh" button

#### Scenario: Refresh button reloads page

- **WHEN** the user clicks the banner's "Refresh" button
- **THEN** the client SHALL call `window.location.reload()` and the freshly-loaded page SHALL embed the new hash

### Requirement: Server broadcasts manifest changes over WebSocket

When server-side plugin discovery runs after process start (e.g. after `/api/plugins/install` succeeds, or any code path that calls `refreshPluginDiscovery()`) AND the new hash differs from the previous one, the server SHALL broadcast `{ type: "plugin_manifest_changed", hash: string }` to every subscribed browser client over the existing WebSocket.

The client SHALL update its banner state from the broadcast without needing to refetch `/api/plugins/manifest`.

#### Scenario: Plugin install triggers broadcast

- **WHEN** a plugin is installed via `POST /api/plugins/install` and the server completes rescan
- **THEN** every connected client SHALL receive `plugin_manifest_changed` with the new hash and SHALL render the staleness banner without a manual refetch
