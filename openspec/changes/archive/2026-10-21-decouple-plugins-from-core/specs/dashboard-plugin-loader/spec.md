## MODIFIED Requirements

### Requirement: Plugin runtime is a separate workspace package

The plugin runtime SHALL live in its own monorepo workspace package `packages/dashboard-plugin-runtime/`. The package SHALL export at minimum the following entry points:

- `@blackbelt-technology/dashboard-plugin-runtime` — the public host UI API defined in `src/public.ts` (see `plugin-host-api`), which includes the client-side `PluginContext` API (`useSessionState`, `useAllSessions`, `usePluginConfig`, `usePluginSend`, `usePluginRouter`, `usePluginLogger`). For one package minor release it SHALL also re-export the `./host` names, marked deprecated. The loader moved behind `./server`; the slot registry, slot consumer components and `PluginContextProvider` moved behind `./host`.
- `@blackbelt-technology/dashboard-plugin-runtime/host` — shell-only names: the slot registry factory, slot consumer components, `PluginContextProvider` and the other shell providers and stores. Consumed by `packages/client`, and by plugin tests only.
- `@blackbelt-technology/dashboard-plugin-runtime/context` — deprecated alias kept for one minor release: it re-exports the plugin-facing `PluginContext` hooks (now in the public root) and the shell names it exported before (now in `./host`).
- `@blackbelt-technology/dashboard-plugin-runtime/sdk` — side-effect-free helpers bundled into plugins.
- `@blackbelt-technology/dashboard-plugin-runtime/test-support` — `__reset*ForTests` helpers.
- `@blackbelt-technology/dashboard-plugin-runtime/server` — server-side `ServerPluginContext` factory and `loadServerEntries`.
- `@blackbelt-technology/dashboard-plugin-runtime/bridge` — the bridge-entry helpers.
- `@blackbelt-technology/dashboard-plugin-runtime/embedded-app` — the embedded-app component.
- `@blackbelt-technology/dashboard-plugin-runtime/manifest-validator` — the pure manifest validator.
- `@blackbelt-technology/dashboard-plugin-runtime/vite-plugin` — Vite plugin used by `packages/client/vite.config.ts`, and the SDK preset for runtime bundles.

Plugins SHALL import from the public root, `./context` (deprecated), `./sdk`, `./server`, `./bridge`, `./embedded-app`, `./manifest-validator`, `./vite-plugin` and `./test-support` only; plugin test files MAY also import `./host`. Plugins SHALL NOT import from `./host` in non-test source, nor from `packages/server` or `packages/client` directly. Only the public root, `./embedded-app` (Phase 6) and the React specifiers are import-mapped; the other subpaths are build-time only. The repo's lint suite SHALL fail when a plugin source file imports from any internal-only path.

#### Scenario: Legacy context import keeps compiling

- **WHEN** a plugin's client source declares `import { usePluginConfig } from "@blackbelt-technology/dashboard-plugin-runtime/context"` during the deprecation release
- **THEN** the build SHALL resolve the import successfully, the lint suite SHALL pass, and the type checker SHALL report the subpath as deprecated.

#### Scenario: Plugin imports from public runtime entry point

- **WHEN** a plugin's client source declares `import { usePluginConfig } from "@blackbelt-technology/dashboard-plugin-runtime"`
- **THEN** the build SHALL resolve the import successfully and the lint suite SHALL pass.

#### Scenario: Plugin imports from internal path triggers lint failure

- **WHEN** a plugin's source contains `import { ... } from "@blackbelt-technology/pi-dashboard-client/App"`
- **THEN** the lint suite SHALL fail with an error directing the author to use `@blackbelt-technology/dashboard-plugin-runtime`.

#### Scenario: Plugin production source imports ./host

- **WHEN** a plugin's non-test source imports `createSlotRegistry` from `@blackbelt-technology/dashboard-plugin-runtime/host`
- **THEN** the lint suite SHALL fail naming the file and the `./host` subpath.

### Requirement: Loader caches plugin discovery for both Vite and server startup

The loader SHALL implement a single discovery routine. Its cache SHALL be keyed by the effective set of discovery roots plus a digest of the served build's `bundledPluginIds` (a fixed key when undeclared), and each key SHALL glob its manifest set once per process. The server SHALL hand the declared ids to the loader before its first discovery call and re-read them on every refresh. The Vite plugin (build-time/dev-time) and the server-side `loadServerEntries` (runtime) SHALL both consume discovery output for their roots. The loader SHALL NOT glob the same root set twice on a single startup. An explicit refresh (`clearDiscoveryCache()` followed by discovery) SHALL clear every key and re-glob.

#### Scenario: Discovery runs once per process

- **WHEN** the dashboard starts in dev mode (Vite + server in the same process)
- **THEN** the manifest glob SHALL execute exactly once per distinct root set and every consumer of that root set SHALL read the same in-memory result.

#### Scenario: Explicit-root and default calls do not share a result

- **WHEN** `discoverPlugins(repoRoot)` runs and then `discoverPlugins()` runs in the same process
- **THEN** the second call SHALL scan its own root set, and neither call SHALL return the other's result.

#### Scenario: Refresh re-globs

- **WHEN** `clearDiscoveryCache()` is called and discovery runs again
- **THEN** the manifest glob SHALL execute again for that root set.

#### Scenario: Declared ids are part of the key

- **WHEN** the served build declaration changes its `bundledPluginIds` and the server restarts or runs `refreshPluginDiscovery()`
- **THEN** discovery SHALL run under the new key and pick winners for the new ids, and SHALL NOT return the result cached for the old ids

#### Scenario: Discovery is deterministic

- **WHEN** discovery runs twice with the same package set on disk
- **THEN** the resulting plugin order SHALL be identical (sorted by `priority` ascending, then `id` ascending).

### Requirement: Client-side plugin entries are bundled by Vite

A custom Vite plugin (`vite-plugin-dashboard-plugins`) SHALL discover plugin manifests at build (and dev-server) time and generate `packages/client/src/generated/plugin-registry.tsx`. The generated registry SHALL contain static imports for each **bundle-eligible** plugin's client entry plus a typed registry export, and SHALL carry `{ id, displayName, eventTypes }` for each of them.

A plugin SHALL be bundle-eligible when it declares a `client` entry and is discovered under `<repo>/packages` (with the build's fixture policy applied). A production build SHALL record the bundle-eligible ids as `bundledPluginIds` in its build declaration. Plugins discovered only at other roots SHALL NOT be bundled; they are delivered at runtime per `plugin-runtime-client-loading`.

The Vite plugin SHALL also generate `packages/client/src/generated/plugin-sources.css` before CSS processing, holding one Tailwind `@source` directive per client-bearing plugin directory under `<repo>/packages` (fixture or not, so the file does not depend on the fixture policy) and per claim `module` directory outside it, in sorted order. Like `plugin-registry.tsx`, the file SHALL be tracked in git (a `.gitignore` negation), so a fresh checkout and a build whose vite plugin failed still resolve the import; its content SHALL be a pure function of the manifests, so regeneration changes it only when the set of client-bearing plugins or claim modules changes. `packages/client/src/index.css` SHALL import that file instead of listing plugin directories by hand.

The generated registry SHALL also carry, per bundled plugin, the client entry's optional `sessionEventReducer` and `toolRowFinalizers` exports, which the shell registers on the plugin's behalf.

The Vite plugin SHALL run before the React plugin, and the bundler SHALL tree-shake unused exports. The named-import, build-artifact-scan and `vite.config.ts` invocation rules (including the deferred dynamic-import fallback) of "Vite plugin generates a static plugin registry" SHALL keep applying unchanged.

#### Scenario: Generated registry imports plugin clients
- **WHEN** `packages/openspec-plugin/dist/client/index.js` exists and is referenced in the manifest
- **THEN** the generated registry SHALL contain a static import of that path and a registry entry for the plugin.

#### Scenario: Disabled plugins still bundled but inert
- **WHEN** a plugin is disabled in config
- **THEN** the build SHALL still include its client bundle (the build cannot read runtime config), but the runtime registry SHALL filter it out before slot consumers see it.

#### Scenario: Hot reload regenerates on manifest change
- **WHEN** a plugin manifest changes during `vite dev`
- **THEN** the Vite plugin SHALL regenerate the registry and trigger HMR.

#### Scenario: Runtime-root plugin is not bundled
- **WHEN** a plugin is discovered only under `~/.pi/dashboard/plugins`
- **THEN** the generated registry SHALL NOT import it, and its id SHALL NOT appear in `bundledPluginIds`

#### Scenario: Plugin styles are scanned without hand-written lines
- **WHEN** a new bundled plugin is added under `packages/`
- **THEN** `generated/plugin-sources.css` SHALL gain its `@source` line in the same commit, and `index.css` SHALL need no edit

#### Scenario: Unchanged plugin set causes no churn
- **WHEN** the vite plugin regenerates `generated/plugin-sources.css` in dev or production mode and no client-bearing plugin was added or removed
- **THEN** `git status` SHALL show no change to that file

#### Scenario: Fresh checkout resolves the stylesheet import
- **WHEN** a fresh checkout runs a client test or Tailwind pass before any vite build
- **THEN** `@import "./generated/plugin-sources.css"` SHALL resolve to the committed file and SHALL NOT fail

### Requirement: Shell consumes the generated plugin registry

The dashboard shell (`packages/client/src/App.tsx` or its successor entry component) SHALL import `PLUGIN_REGISTRY` from `./generated/plugin-registry`. It SHALL populate the `SlotRegistry` instance passed to `<PluginContextProvider>` with every claim from every entry. If it does not, slot consumers in the shell render zero contributions even when the generated registry is populated.

The shell SHALL also add claims for admitted runtime-delivered plugins after module load, per `plugin-runtime-client-loading`. Each such addition SHALL bump the slot-claims version.

#### Scenario: Empty registry produces empty slot consumers
- **WHEN** `PLUGIN_REGISTRY` is `[]` (committed stub state, fresh checkout, or runtime not built) and no runtime plugin is admitted
- **THEN** `<PluginContextProvider registry={_pluginRegistry}>` SHALL receive an empty registry
- **AND** every slot consumer (`<SettingsSectionSlot>`, `<SessionCardBadgeSlot>`, etc.) SHALL render zero contributions
- **AND** the shell SHALL render normally with all legacy direct imports intact (no error, no fallback UI required).

#### Scenario: Populated registry threads claims to slot consumers
- **WHEN** `PLUGIN_REGISTRY` contains `[{ manifest: { id: "demo", … }, claims: [{ slot: "settings-section", component: DemoSettings, tab: "general" }] }]`
- **THEN** `<SettingsSectionSlot tab="general">` SHALL render `<DemoSettings>` wrapped in the runtime's `SlotErrorBoundary`
- **AND** `<SettingsSectionSlot tab="servers">` SHALL render zero contributions (no claim for `tab: "servers"`).

#### Scenario: Co-tenancy with legacy direct imports
- **WHEN** the shell renders `<SessionCardBadgeSlot session={s}/>` AND a plugin claims `session-card-badge` for a component that the shell **also** imports directly via legacy JSX
- **THEN** the result is duplicate rendering of that component
- **AND** the migration plan SHALL remove the legacy direct import in the same change that populates the registry, OR keep the slot empty until the legacy import is removed in a follow-up
- **AND** a regression test SHALL verify no double-render exists for the migrated cases (`FlowActivityBadge`, `SessionFlowActions`).

#### Scenario: Registry populated only at module load
- **WHEN** the shell module first loads
- **THEN** the `_pluginRegistry` SHALL be populated synchronously from `PLUGIN_REGISTRY`
- **AND** subsequent edits to plugin source code during `vite dev` SHALL trigger HMR through vite's normal module graph (not via registry mutation)
- **AND** subsequent edits to plugin manifests SHALL trigger registry regeneration via the vite plugin, which produces a new `generated/plugin-registry.tsx` and HMR-replaces the App module.

#### Scenario: Runtime claims are added after load
- **WHEN** the runtime client listing returns an admitted plugin after the shell has mounted
- **THEN** its claims SHALL be added to the same registry, and mounted slot consumers SHALL re-render to include them

### Requirement: Server-side plugin discovery SHALL NOT depend on `process.cwd()`

The `discoverPlugins()` function SHALL discover plugin manifests from stable locations, independent of where the server process was launched.

The discovery mechanism SHALL look in these sources, in priority order:
1. The repo root determined by `import.meta.url` resolution from `dashboard-plugin-runtime/src/server/loader.ts`, when the runtime package is installed in a monorepo (`source: "workspace"`).
2. `~/.pi/dashboard/plugins/`, for user-installed plugins (`source: "installed"`).
3. Bundled plugins in the dashboard's own `resources/`, for a production install (`source: "bundled"`).
4. Package directories resolved from `~/.pi/agent/settings.json#packages[]` by the shared `listPiPackages({ scope: "user" })` resolver (`source: "pi-package"`). The resolver yields only entries whose install path exists; discovery adds no second resolution.

When the same plugin id appears in more than one source, the earliest source SHALL win, and only the winner SHALL be loaded. One exception keeps the two plugin halves from the same copy: when the served client build declares `bundledPluginIds` (`served-client-build-coherence`) and the id is in it, the copy the build was made from SHALL win: the `workspace` copy if one exists, otherwise the `bundled` (`resources/plugins`) copy if one exists; if neither exists, the earliest source wins. Whether a monorepo root resolves SHALL NOT decide this, because Electron's server bundle resolves one that holds only some plugins. When the served build declares no bundled ids, the plain priority order SHALL apply. Server and client SHALL use the same winner. Each losing copy SHALL be recorded on the winner's status as a `shadowed` entry `{ source, packageDir }` and logged at warn level naming both paths. A shadowed copy's server entry, bridge and client SHALL NOT be loaded.

Entries of source 4 SHALL be skipped silently when they resolve to a file or to a directory without a plugin manifest. A failure to read `settings.json` SHALL be logged at warn level and SHALL NOT abort discovery of the other sources.

#### Scenario: Dashboard installed via npm-global discovers plugins
- **GIVEN** dashboard is installed at `~/.pi-dashboard/node_modules/@blackbelt-technology/pi-dashboard-server/`
- **AND** the server is started with `pi-dashboard start` from any directory
- **WHEN** `discoverPlugins()` runs at server boot
- **THEN** plugin discovery SHALL find every installed plugin package (bundled in `resources/`, installed via `~/.pi/dashboard/plugins/`, or listed in `settings.json#packages[]`)
- **AND** `/api/health.plugins[]` SHALL list every discovered plugin with its loaded state and `source`
- **AND** each enabled, `hostApi`-admitted plugin's server entry SHALL be activated, ready to broadcast intents, except a `pi-package` entry without a server-trust grant ("`pi-package` server entries require operator trust")

#### Scenario: Installed copy of a bundled id is shadowed on an npm-global host
- **WHEN** an npm-global host serves a build whose `bundledPluginIds` contains `flows`, and `flows` exists both under `resources/plugins` and under `~/.pi/dashboard/plugins` at another version
- **THEN** the `resources/plugins` copy SHALL win with `source: "bundled"`, its server entry SHALL be loaded, and the `~/.pi/dashboard/plugins` copy SHALL appear in `shadowed` with `source: "installed"`

#### Scenario: Electron winner is chosen by existing copy
- **WHEN** an Electron host resolves a monorepo root at its server bundle, the served build declares `goal` and `mcp-client`, `goal` exists only under `resources/plugins`, and `mcp-client` exists under the bundle's `packages/`
- **THEN** `goal` SHALL win with `source: "bundled"` and `mcp-client` with `source: "workspace"`

#### Scenario: npm-global host has no build copy
- **WHEN** an npm-global host (no `resources/plugins`) serves a build declaring `goal`, and `goal` exists only under `~/.pi/dashboard/plugins`
- **THEN** that copy SHALL win by plain priority with `source: "installed"`, even at another version

#### Scenario: Undeclared build keeps the plain priority order
- **WHEN** the served build has no `bundledPluginIds` and `flows` exists under both `~/.pi/dashboard/plugins` and `resources/plugins`
- **THEN** the `~/.pi/dashboard/plugins` copy SHALL win, as before this change

#### Scenario: pi-installed plugin is discovered
- **WHEN** `~/.pi/agent/settings.json#packages[]` contains `"npm:@acme/pi-dashboard-quota"`, it resolves to `~/.pi/agent/npm/node_modules/@acme/pi-dashboard-quota`, and that `package.json` declares `pi-dashboard-plugin`
- **THEN** discovery SHALL include the plugin with `source: "pi-package"` and that `packageDir`

#### Scenario: pi extension without a manifest is skipped
- **WHEN** a `packages[]` entry resolves to a package without a plugin manifest
- **THEN** discovery SHALL skip it without a log line

#### Scenario: Workspace copy shadows a pi-installed copy
- **WHEN** id `subagents` is declared both under `<repo>/packages/subagents-plugin` and by a `packages[]` entry at another version
- **THEN** exactly one status entry SHALL exist for `subagents`, with `source: "workspace"` and `shadowed: [{ source: "pi-package", packageDir: <path> }]`
- **AND** only the workspace copy's server entry SHALL be loaded

### Requirement: `GET /api/plugins` SHALL list every discovered plugin

The endpoint `GET /api/plugins` SHALL return every plugin returned by `discoverPlugins()` with full manifest summary and status (id, displayName, enabled, loaded, error, claims, requirements, missingRequirements, bridgeLoadedFrom, lastProbe, `dependsOn`, `dependents`, `firstParty`, and the additive fields `source`, `shadowed`, `restartRequired`, `hostApi`, `client`, `serveApp`). The rules of "`GET /api/plugins` SHALL include computed `dependents` per row" SHALL keep applying to every row, including runtime-delivered, removed-but-loaded and local-detected rows. The endpoint SHALL be auth-gated through the same Fastify chain as `POST /api/config/plugins/:id`.

The endpoint SHALL additionally return:
- a row for a plugin whose server entry is still loaded although its package disappeared from discovery, with `restartRequired: true`, until the server restarts;
- a row with `source: "local-detected"` for each local-scope plugin detected in an active session's cwd whose id has no other row.

The endpoint SHALL NOT return any other entry for an id absent from `discoverPlugins()` results, and SHALL NOT return a separate row for a shadowed copy.

The unauthenticated `/api/health.plugins[]` SHALL NOT carry `client.sha256`, `shadowed` or local-detected rows; only the guarded endpoint and `plugins_changed` carry them.

#### Scenario: Endpoint returns every discovered plugin

- **WHEN** discovery finds four plugins `builtins`, `flows`, `roles`, `demo`
- **THEN** `GET /api/plugins` SHALL return all four entries with their manifest summary and status.

#### Scenario: Endpoint requires authentication

- **WHEN** an unauthenticated request is made to `GET /api/plugins` on a non-loopback bind
- **THEN** the server SHALL reject the request with the same auth response `POST /api/config/plugins/:id` returns under the same conditions.

#### Scenario: Dependency fields survive on new rows

- **WHEN** runtime plugin `quota-ui` declares `dependsOn: ["quota"]` and both are discovered
- **THEN** the `quota` row SHALL carry `dependents: ["quota-ui"]` and the `quota-ui` row `dependsOn: ["quota"]`, `dependents: []`

#### Scenario: Health exposes no paths or hashes

- **WHEN** an unauthenticated caller reads `/api/health` while a plugin has a `shadowed` copy, a runtime client hash, and a local-detected row exists
- **THEN** `plugins[]` SHALL contain no `packageDir`, no `sha256` and no local-detected row, while `GET /api/plugins` SHALL contain all three

#### Scenario: Removed loaded plugin stays listed

- **WHEN** a loaded plugin's package is removed and discovery is refreshed
- **THEN** `GET /api/plugins` SHALL still return its row with `restartRequired: true` until the next server start

### Requirement: `POST /api/plugins/:id/toggle` SHALL persist enable/disable

The endpoint `POST /api/plugins/:id/toggle` SHALL accept a body `{ enabled: boolean }` and SHALL:

- write `plugins.<id>.enabled` to `~/.pi/dashboard/config.json`,
- broadcast `plugin_config_update` for the affected id,
- then broadcast one `plugins_changed` with the updated status snapshot (also for cascades and a restore),
- return 200 `{ restartRequired: true }`,
- return 404 when the id is not present in `discoverPlugins()` results.

The dependency-graph rules of "`POST /api/plugins/:id/toggle` SHALL honour the dependency graph" (409 on blockers, atomic cascade enable/disable, one `plugin_config_update` per affected id, the `cascade` response field) SHALL keep applying; cascaded ids follow every rule below exactly like the target id.

The endpoint SHALL NOT change which server entries are loaded in the running process; the new enabled set takes effect for server entries on the next server start. A discovery refresh loads server entries of newly discovered ids only, so re-enabling an already-discovered plugin whose server entry is not loaded SHALL still need a restart. Client-side claim visibility SHALL follow the persisted value immediately: the build-time enable filter through `plugin_config_update`, and runtime client admission on the next listing. A runtime client whose server entry is not loaded, or one of whose `dependsOn` ids is not loaded, SHALL NOT be admitted until those entries load. The endpoint SHALL be auth-gated through the same Fastify chain as `POST /api/config/plugins/:id`.

#### Scenario: Toggle persists and broadcasts

- **WHEN** an authenticated client posts `{ "enabled": false }` to `/api/plugins/demo/toggle` and `demo` is in the discovered set
- **THEN** the server SHALL set `plugins.demo.enabled = false` in `~/.pi/dashboard/config.json`, SHALL broadcast a `plugin_config_update` message with `id = "demo"` followed by one `plugins_changed`, and SHALL return 200 `{ restartRequired: true }`.

#### Scenario: Toggle of unknown id returns 404

- **WHEN** an authenticated client posts `{ "enabled": false }` to `/api/plugins/nonexistent/toggle` and `nonexistent` is not in the discovered set
- **THEN** the server SHALL return 404 and SHALL NOT modify config.

#### Scenario: Disabling a runtime plugin hides it without restart

- **WHEN** an admitted runtime plugin is toggled off
- **THEN** the next runtime listing SHALL omit it, its status SHALL report `refusedReason: "disabled"`, and its server entry SHALL stay loaded until the next server start

#### Scenario: Cascade disable reaches a runtime dependent

- **WHEN** runtime plugin `quota-ui` declares `dependsOn: ["quota"]`, both are enabled and admitted, and `quota` is toggled off
- **THEN** the response SHALL carry `cascade.disable: ["quota-ui"]`, and the next runtime listing SHALL omit `quota-ui` with `refusedReason: "disabled"`

#### Scenario: Re-enabling a discovered plugin needs a restart

- **WHEN** a discovered runtime plugin whose server entry was never loaded (it was disabled at start) is toggled on
- **THEN** the response SHALL be `{ restartRequired: true }`, a discovery refresh SHALL NOT load its server entry, and its client SHALL stay refused until the server restarts

### Requirement: Slot registry SHALL filter claims of disabled plugins on the client

The client-side `SlotRegistry` SHALL accept `setEnabledSet(ids: ReadonlySet<string>)`. After it is called at least once, every `getClaims(slotId)` SHALL omit claims whose `pluginId` is not in the enabled set. Before it is called, `getClaims` SHALL return all claims (preserving existing behaviour for default / SSR-style use).

The registry SHALL also expose `getAllPluginsForActivationUi()` that returns the unfiltered manifest summary plus current status, used by the Plugins tab and by the shell's event-type ownership lookup. The summary SHALL include each plugin's `id`, `displayName` and `eventTypes`, regardless of the enabled set.

The client SHALL call `setEnabledSet` from the value of `/api/health.plugins[]` on first connect, on every `plugin_config_update` broadcast, on every `plugins_changed` broadcast, and after it registers runtime-delivered plugins.

#### Scenario: Newly installed runtime plugin is in the enabled set

- **WHEN** a runtime plugin is installed, trusted and registered after the first `/api/health` read
- **THEN** the client SHALL recompute the enabled set after the `plugins_changed` broadcast and after the registration, and the plugin's claims SHALL render without a reload

#### Scenario: Disabled plugin contributes no slot

- **WHEN** plugin `demo` is in the build-time registry but `setEnabledSet` was last called with a set that does not include `demo`
- **THEN** every `getClaims(slotId)` call SHALL return zero entries for `demo`, including but not limited to `settings-section`, `session-card-badge`, `command-route`, and `tool-renderer`.

#### Scenario: Activation UI sees disabled plugins

- **WHEN** plugin `demo` is disabled via `setEnabledSet`
- **THEN** `getAllPluginsForActivationUi()` SHALL still include `demo` in its result so the Plugins tab can render it.

#### Scenario: Default behaviour shows all claims

- **WHEN** `setEnabledSet` has never been called on the registry
- **THEN** `getClaims(slotId)` SHALL return every registered claim regardless of plugin id.

#### Scenario: Disabled owner keeps its event-type metadata

- **WHEN** the subagents plugin is disabled via `setEnabledSet`
- **THEN** `getAllPluginsForActivationUi()` SHALL still return `{ id: "subagents", displayName, eventTypes: ["subagent_*"] }`, so the shell can name it in the absent-owner row

### Requirement: Client runtime provides a slot-claims invalidation store

The client-side plugin runtime SHALL provide a module-level slot-claims version store with an exported `bumpSlotClaimsVersion(): void`.

These SHALL subscribe to the store (via `useSyncExternalStore`):
- `useSlotHasClaimsForSession`;
- every exported slot consumer component;
- every exported hook that reads claims from the registry;
- every shell component outside the runtime that reads claims from the registry directly (for example the chat `tool-renderer` lookup in `ToolCallStep`).

As a result, a bump re-evaluates every gate and re-reads every claim list, including for sessions that emit no further broadcasts. The shell SHALL bump the store whenever it adds claims to the registry after mount.

#### Scenario: Bump re-evaluates gates without a session broadcast
- **WHEN** a plugin's late-arriving global signal resolves and the plugin calls `bumpSlotClaimsVersion()`
- **THEN** every mounted gate wrapper SHALL re-invoke `shouldRender`
- **AND** this SHALL occur for idle and ended sessions that will never emit `session_updated`

#### Scenario: Unbumped store changes nothing
- **WHEN** no plugin ever calls `bumpSlotClaimsVersion()` and no claim is added after mount
- **THEN** gate evaluation behaviour SHALL be identical to the pre-change behaviour

#### Scenario: `shouldRender` stays synchronous
- **WHEN** a gate is re-evaluated after a bump
- **THEN** `shouldRender` SHALL still be called synchronously during render
- **AND** the store SHALL NOT introduce an async gate path

#### Scenario: Late overlay route matches on a cold deep link
- **WHEN** the browser cold-loads `/s6/sub`, and the runtime plugin claiming `shell-overlay-route` `/s6/*?` registers after the shell mounted
- **THEN** `ShellOverlayRouteSlot`, `useShellOverlayRouteMatched`, `useShellOverlayRoutePresentation` and `useShellOverlayRouteDepth` SHALL re-evaluate and render the route

#### Scenario: Late tool renderer replaces Generic
- **WHEN** a chat row for tool `quota_check` already rendered with `GenericToolRenderer`, and a runtime plugin claiming `tool-renderer` `{toolName:"quota_check"}` registers afterwards
- **THEN** the row SHALL re-resolve and render the plugin's renderer

### Requirement: The client-side enable filter SHALL default-allow build-time-known plugin ids

The client hook that drives `registry.setEnabledSet(...)` from `/api/health.plugins[]` SHALL compute the enabled set as:

```
enabled = (every plugin id present in registry.getAllPluginsForActivationUi(),
           including runtime-registered plugins)
          ∪ (server-reported plugin ids with enabled !== false)
          \ (server-reported plugin ids with enabled === false)
```

This prevents a misconfigured or incomplete server-side discovery (empty `/api/health.plugins[]`) from hiding every claim the build-time `PLUGIN_REGISTRY` embedded into the client. The hook SHALL recompute the set on first connect, on every `plugin_config_update`, on every `plugins_changed`, and after the shell registers runtime-delivered plugins.

#### Scenario: Empty server discovery does not hide build-time claims

- **WHEN** the build-time `PLUGIN_REGISTRY` contains claims for plugin `flows` and `/api/health.plugins[]` returns `[]`
- **THEN** `registry.getClaims(slotId)` SHALL still return `flows`'s claims (the build-time id is not on the explicitly-disabled list).

#### Scenario: Server-disabled plugin remains hidden

- **WHEN** the build-time `PLUGIN_REGISTRY` contains claims for plugin `flows` and `/api/health.plugins[]` reports `{ id: "flows", enabled: false }`
- **THEN** `registry.getClaims(slotId)` SHALL exclude `flows`'s claims for every slot id.

#### Scenario: Runtime-registered plugin is allowed after registration

- **WHEN** the shell registers runtime plugin `quota-ui` after the last `/api/health` read, and the server reports it `enabled: true`
- **THEN** the recomputed enabled set SHALL include `quota-ui`, and its claims SHALL render

### Requirement: Slot consumers SHALL accept BOTH refs-registry claims AND intent broadcasts

The slot consumer pattern (e.g. `ContentViewSlot`, `SessionCardActionBarSlot`, etc.) SHALL render both static refs-registry claims (`claim.Component` from the generated plugin-registry.tsx, or registered at runtime for an operator-trusted plugin) AND server-broadcast intent contributions from the IntentStore. The two pathways are coextensive. For slots with `multiplicity: "many"`, both are rendered. For `multiplicity: "one-active"` slots, intent broadcasts take precedence over legacy claims when both are present from the same plugin.

The primitive registry serves both callers: trusted plugin client code calls `useUiPrimitive` directly (`plugin-ui-primitive-registry`), and the shell-side IntentRenderer resolves intents through the same registry. This replaces the earlier rule from `add-plugin-ui-primitive-registry` and `plugin-intent-protocol` that the expected caller moves from plugin code to the IntentRenderer.

#### Scenario: Slot consumer renders both legacy claim and intent contribution

- **GIVEN** the legacy refs-registry has a claim for slot "session-card-action-bar" from plugin "automation"
- **AND** the IntentStore has an intent for slot "session-card-action-bar" from plugin "flows" (which has migrated)
- **WHEN** `SessionCardActionBarSlot` renders for the session
- **THEN** the slot consumer SHALL render both contributions: the legacy claim's React component AND the intent-driven IntentRenderer output
- **AND** the rendering order SHALL follow each contribution's pluginId priority

#### Scenario: Plugin that has fully migrated registers no refs-registry claims

- **GIVEN** plugin "flows" has migrated all 12 claims to intent broadcasts
- **WHEN** the plugin's manifest is scanned by the vite-plugin at build time
- **THEN** the plugin's manifest claims have empty `"claims": []` (or no longer include `component` fields)
- **AND** the legacy refs-registry path renders nothing for "flows" (it has no registered claims)
- **AND** the intent path renders everything for "flows" (driven by server broadcasts)

#### Scenario: Same plugin uses both paths on a one-active slot

- **GIVEN** plugin "goal" has a refs-registry claim and a broadcast intent for the same `one-active` slot and session
- **WHEN** the slot consumer renders
- **THEN** only the intent contribution SHALL render

## ADDED Requirements

### Requirement: Discovery refreshes after successful package operations

The server SHALL provide `refreshPluginDiscovery()`. It SHALL:

1. re-read the served declaration, clear the discovery cache, rediscover;
2. load server entries of new, enabled, `hostApi`-admitted (for `pi-package`: server-trusted) plugins only;
3. recompute local detection, probes and status;
4. broadcast one `plugins_changed`.

Concurrent requests SHALL coalesce into one follow-up. The completion listener SHALL invoke it after every successful non-local package operation.

#### Scenario: New plugin loads after install without restart
- **WHEN** a global `npm:` install of a package with a plugin manifest completes successfully
- **THEN** the plugin SHALL appear in `/api/plugins` without a server restart, with `loaded: true` if it is enabled, `hostApi`-admitted and, for a `pi-package` source, server-trusted; otherwise with `loaded: false` and the reason


#### Scenario: Failed operation changes nothing
- **WHEN** a package operation completes with `success: false`
- **THEN** discovery SHALL NOT be refreshed and no `plugins_changed` SHALL be broadcast

#### Scenario: Two completions in quick succession
- **WHEN** a second operation completes while a refresh is running
- **THEN** exactly one follow-up refresh SHALL run after the first finishes

### Requirement: `plugins_changed` broadcast

The browser protocol SHALL include `plugins_changed { plugins: PluginStatus[] }`, carrying the full current status snapshot. The server SHALL broadcast it once per discovery refresh, and whenever a plugin's enable state, load result, trust or client admission changes. Clients that do not know the type SHALL ignore it.

#### Scenario: Plugins tab updates live
- **WHEN** a plugin is installed in another browser
- **THEN** an open Plugins tab SHALL show the new row from the broadcast, without polling

### Requirement: PluginStatus reports source, shadowing, restart and delivery

`PluginStatus` on `GET /api/plugins` and `plugins_changed` SHALL gain `source` (`workspace|installed|bundled|pi-package|local-detected`), `shadowed?: {source, packageDir}[]`, `restartRequired?`, `hostApi?: {range, compatible}`, `client?: {delivery: bundled|runtime|refused|none, refusedReason?, sha256?}`, `serveApp?: mounted|refused`. `/api/health.plugins[]` SHALL gain them minus `shadowed`, `client.sha256`. Existing fields (`displayName`, `dependsOn`, `dependents`…) keep meaning; one row per id.

#### Scenario: Bundled plugin reports bundled delivery
- **WHEN** the demo plugin is bundled and enabled
- **THEN** its status SHALL include `source: "workspace"` and `client.delivery: "bundled"`

#### Scenario: Older client ignores new fields
- **WHEN** a client that predates this change reads `/api/plugins`
- **THEN** it SHALL still parse each row, because every new field is optional or additive

#### Scenario: Plugins tab renders the new fields
- **WHEN** a status row carries `source`, `restartRequired` and a client refusal
- **THEN** the Plugins tab SHALL show the source, the restart hint, and the refusal with its reason

#### Scenario: Shadowed copy is a sub-line, not a row
- **WHEN** a plugin's status carries one `shadowed` entry
- **THEN** the Plugins tab SHALL render one row for that id, with the shadowed source and path under it

### Requirement: Loaded plugin changes mark restart required

When a refresh finds that a plugin whose server entry is already loaded has a changed package or has disappeared, the server SHALL keep its status row with `restartRequired: true`. Its routes and handlers remain registered until the server restarts.

When a plugin is newly added, it SHALL NOT be marked restart-required.

#### Scenario: Update marks restart required
- **WHEN** a loaded plugin's package is updated through the package manager
- **THEN** the next `plugins_changed` snapshot SHALL carry `restartRequired: true` for it

#### Scenario: Removal keeps a restart-required row
- **WHEN** a loaded plugin's package is removed
- **THEN** its row SHALL remain with `restartRequired: true` until the server restarts

### Requirement: Install, removal and load failure are reflected in status

After a refresh the status snapshot SHALL reflect each package change:

- a newly installed plugin SHALL appear with its load result;
- a removed plugin whose server entry was never loaded (disabled, refused or failed) SHALL disappear from the snapshot;
- a server entry that throws while loading SHALL be recorded with `loaded: false` and its error message, the refresh SHALL continue with the other plugins, and the snapshot SHALL be broadcast.

#### Scenario: Removed unloaded plugin disappears
- **WHEN** a disabled plugin's package is removed and the operation succeeds
- **THEN** the next `plugins_changed` snapshot SHALL NOT contain the plugin

#### Scenario: Failing server entry is visible
- **WHEN** a newly installed plugin's server entry throws during load
- **THEN** the next `plugins_changed` snapshot SHALL contain the plugin with `loaded: false` and the error text, and other newly installed plugins SHALL still load

### Requirement: Local-scope plugins are detected and reported, never loaded

For each active session cwd the server SHALL resolve `listPiPackages({ scope: "project", cwd })` and report each manifest-bearing package as `source: "local-detected"`, `enabled: false`, `loaded: false`, with an install-globally error; an id with a row SHALL get a `shadowed` entry instead. No part of it SHALL be executed, bridged, listed or slotted. Detection SHALL rerun on each refresh, each new session cwd and each session end ("Session end reruns local detection").

#### Scenario: Local-installed plugin appears as a warning row
- **WHEN** session "abc" has cwd `/proj/A` and `/proj/A/.pi/settings.json#packages[]` includes a package whose manifest declares id `quota`
- **THEN** `/api/plugins` SHALL contain `{ id: "quota", source: "local-detected", enabled: false, loaded: false, error: "Local-scope plugins are not loaded in this release. Install globally with --scope global to enable." }`
- **AND** no slot consumer SHALL render its components

#### Scenario: Same plugin global and local
- **WHEN** the same plugin id is installed globally (loaded) and locally in an active session's cwd
- **THEN** one row SHALL exist for the id, from the global source, with a `shadowed` entry `{ source: "local-detected", packageDir: <local path> }`

### Requirement: Session end reruns local detection

When a session ends, the server SHALL rerun local-scope detection for that session's cwd. It SHALL broadcast one `plugins_changed` only when the local-detected set changed, and `GET /api/plugins` SHALL reflect the result as soon as the rerun completes.

#### Scenario: Session ends (pruning)
- **WHEN** the last active session with cwd `/proj/A` ends
- **THEN** `GET /api/plugins` SHALL no longer contain the local-detected row for `/proj/A`
- **AND** exactly one `plugins_changed` without that row SHALL be broadcast

#### Scenario: Session end with no local change
- **WHEN** a session with cwd `/proj/A` ends while another active session keeps cwd `/proj/A`
- **THEN** the local-detected row SHALL remain and no `plugins_changed` SHALL be broadcast

### Requirement: `pi-package` server entries require operator trust

A `pi-package` plugin's server entry SHALL NOT load, and its bridge SHALL NOT be auto-registered, unless `auth.trustedPlugins` holds `{ id, server: true }` for it, granted only through the local-operator trust endpoint. Until then its status SHALL be `loaded: false` with error `server-untrusted`. A grant SHALL load the entry on the following refresh if it never loaded in this process; a revoke SHALL set `restartRequired`. `workspace`, `bundled` and `installed` sources SHALL load as before.

#### Scenario: Untrusted pi-package server entry is not loaded
- **WHEN** a pi-package plugin with a server entry and a bridge is installed and has no server grant
- **THEN** its status SHALL show `loaded: false` with `server-untrusted`, and no server code or bridge of it SHALL run

#### Scenario: First-party id does not bypass the gate
- **WHEN** a pi-package copy declares id `goal` and no build copy of `goal` exists on disk
- **THEN** its server entry SHALL stay unloaded until granted

#### Scenario: Local grant loads without restart
- **WHEN** a local operator grants server trust to that plugin
- **THEN** the next `plugins_changed` SHALL show it `loaded: true`, without a server restart

#### Scenario: Remote operate device cannot grant
- **WHEN** a paired remote device with an `operate` bearer posts a server grant
- **THEN** the server SHALL refuse it, and the entry SHALL stay unloaded

### Requirement: Local-scope package operations rerun local detection

After a successful local-scope package operation the completion listener SHALL rerun local-scope detection only, without a discovery refresh, and broadcast one `plugins_changed`. The requirement-probe refresh that runs on every successful `package_operation_complete` ("The loader SHALL run requirement probes for every discovered plugin") SHALL still run for both scopes.

#### Scenario: Local install is detected without a restart
- **WHEN** a local-scope install of a manifest-bearing package into an active session's cwd completes successfully
- **THEN** one `plugins_changed` SHALL carry its `local-detected` row, and no server entry SHALL load

#### Scenario: Local operation still refreshes requirement probes
- **WHEN** a local-scope package operation completes successfully
- **THEN** the requirement probes SHALL be refreshed as for a global operation, and `plugin_config_update` SHALL be broadcast for each id whose `missingRequirements` changed

### Requirement: Plugin installation and trust model are documented

`README.md` SHALL document:
- global-scope plugin installs: via the Packages tab shown live, via a terminal `pi install` shown after a restart;
- local-scope installs are detected, not loaded;
- a `pi-package` plugin's server code runs only after a local server-trust grant; other sources run with pi-extension trust;
- a runtime-loaded plugin's client code needs operator trust, pinned to its content hash, granted from the dashboard host itself.

#### Scenario: README states the trust model
- **WHEN** a reader opens the README's plugin section
- **THEN** it SHALL state both trust rules, the install command, and that a terminal `pi install` appears after a dashboard restart

### Requirement: Installs outside the dashboard appear after a restart

A plugin installed through the dashboard (Packages tab or `POST /api/packages/install`) SHALL appear live. A global `pi install` run from a terminal reaches no dashboard completion listener; the dashboard SHALL NOT refresh discovery for it, and the plugin SHALL appear in `/api/plugins` after the next dashboard restart.

#### Scenario: Terminal install appears after restart
- **WHEN** `pi install` adds a global-scope plugin package from a terminal while the dashboard runs
- **THEN** no `plugins_changed` SHALL be broadcast for it, and after `POST /api/restart` `GET /api/plugins` SHALL contain its row

### Requirement: Plugins register session event reducer slices

A plugin's client entry MAY export `sessionEventReducer: { eventTypes, reduce }`. The shell SHALL register it for the plugin: from the generated registry for a bundled plugin, from the entry module for a runtime plugin. The session event reducer SHALL apply, before its default branch, the slices of enabled plugins whose `eventTypes` match an event; a matched event SHALL NOT reach the default branch. A slice SHALL write only its designated `SessionState` field (`subagents` for subagents).

#### Scenario: Subagent events reduced by the plugin
- **WHEN** the subagents plugin is enabled and a `subagent_started` event arrives
- **THEN** `SessionState.subagents` SHALL be updated by the plugin's slice, and no raw-event row SHALL be added

#### Scenario: Disabled plugin's slice does not run
- **WHEN** the subagents plugin is disabled through the enabled set and a `subagent_started` event arrives
- **THEN** its slice SHALL NOT run, and the event SHALL reach the default branch as a plugin-owned event

#### Scenario: Registration needs no import side effect
- **WHEN** a plugin's client entry exports `sessionEventReducer` and performs no registration call
- **THEN** the slice SHALL still be registered, including in a test that builds its registry from that entry

### Requirement: Tool-renderer claims own tool-row behaviour

A `tool-renderer` claim MAY declare `expandWhileRunning: boolean` and `resultPending` (the name of an exported sync predicate). The shell SHALL use these fields, not hard-coded tool names, for auto-expansion and pending-result detection. With no matching claim the shell SHALL fall back to the built-in renderer, then `GenericToolRenderer`.

#### Scenario: Agent rows without the plugin
- **WHEN** the subagents plugin is disabled and an `Agent` tool call is rendered
- **THEN** the row SHALL render with `GenericToolRenderer` and SHALL NOT auto-expand

### Requirement: Plugins finalize their own tool rows; generic heals stay in core

A client entry MAY export `toolRowFinalizers: { toolName, onToolExecution, onSessionEvent }[]`, registered like reducer slices and gated by the enabled set. Where the reducer finalizes a tool row or touches plugin-owned state on a tool event, it SHALL call that finalizer, and apply its generic heal when none is registered or it declines. Core SHALL keep no writer of `SessionState.subagents`.

#### Scenario: Plugin finalizes its rows
- **WHEN** the subagents plugin is enabled and `subagent_completed` arrives for a running Agent call
- **THEN** the plugin's finalizer SHALL mark the row completed with the subagent's outcome, and core SHALL contain no subagent-outcome backfill code

#### Scenario: Subagent status writers are plugin hooks
- **WHEN** the subagents plugin is enabled
- **THEN** `onToolExecution` SHALL write `running` from an Agent `tool_execution_update` and `completed`/`failed` from an Agent `tool_execution_end` (including the `/resume` backfill), `onSessionEvent` SHALL write `completed`/`failed` from `subagent_completed|failed`, each under both the `agentId` and `agentSessionId` keys

#### Scenario: Declining finalizer falls back
- **WHEN** the registered finalizer declines a row at turn settle
- **THEN** the shell SHALL apply the generic neutral heal to that row

### Requirement: Tool-row finalizers keep the session-end heal guards

A finalizer SHALL finalize only a `running` row and SHALL NOT overwrite a real terminal row. On a synthesized (`healedBy`) event it SHALL NOT change a subagent that is already `completed` or `failed`. Core SHALL reopen a `session_ended`-healed row on a live `tool_execution_update`, then call `onToolExecution`; the plugin SHALL reopen the linked subagent only when its terminal state came from that `session_ended` heal (`session-end-orphan-heal`).

#### Scenario: Synthesized end does not flip a completed subagent
- **WHEN** subagent `ag-1` is `completed` and a synthesized `tool_execution_end{healedBy:"session_ended", details:{agentId:"ag-1"}}` reduces with the subagents plugin enabled
- **THEN** `ag-1` SHALL stay `completed`

#### Scenario: Live tick reopens row and subagent
- **WHEN** an Agent row and subagent `ag-1` were healed `session_ended`, and a live `tool_execution_update` for that row arrives with the plugin enabled
- **THEN** core SHALL restore the row to `running` and the plugin SHALL restore `ag-1` to `running`

#### Scenario: Live tick reopens the row without the plugin
- **WHEN** the same tick arrives with the subagents plugin disabled
- **THEN** core SHALL restore the row to `running`, and no subagent state SHALL change

### Requirement: Generic orphan tool-row heals stay in core

The shell SHALL keep the generic orphan heals in core: a synthesized `tool_execution_end` carrying `healedBy` terminates the row, and a row still running when its turn settles is stopped with the neutral sentinel body and `resultMissing`. The server SHALL keep synthesizing terminal events for open tool calls on session end. Neither heal SHALL require a plugin.

#### Scenario: Orphan Agent row heals without the plugin
- **WHEN** the subagents plugin is disabled and a session ends while an Agent tool call is running
- **THEN** the row SHALL stop spinning and show the session-ended error from the synthesized `tool_execution_end`
- **AND** the synthesized `subagent_failed` event SHALL fold into the absent-owner row

#### Scenario: Turn settles without the plugin
- **WHEN** the subagents plugin is disabled and a turn settles while an Agent row is still running
- **THEN** the row SHALL stop spinning with the neutral sentinel body and `resultMissing: true`

### Requirement: Plugin-owned events are grouped by the reducer

`PluginManifest` SHALL accept optional `eventTypes: string[]` (exact names or `prefix_*`). The shell SHALL know ownership for every bundled plugin, disabled or not, and every registered runtime plugin; it SHALL hard-code no plugin prefix. An owned event in the default branch SHALL update one `rawEvent`-role group row per type per session, at the type's first event, with owner id, in-place count and the last 50 payloads. An unowned event SHALL add today's raw-event row.

#### Scenario: Flow events follow the flows manifest
- **WHEN** the flows plugin declares `eventTypes: ["flow_*"]` and a `flow_step` event reaches the default branch
- **THEN** the event SHALL update the `flow_step` group row, and the reducer SHALL contain no `flow_` prefix literal

#### Scenario: Count updates in place
- **WHEN** a session already has a `subagent_entry` group row and another `subagent_entry` event reaches the default branch
- **THEN** that row's count SHALL increase by one, and no new row SHALL be added

#### Scenario: Group row payloads are bounded
- **WHEN** 60 `flow_step` events reach one group row
- **THEN** the row's count SHALL be 60 and it SHALL hold only the last 50 payloads

#### Scenario: Group row does not break the retry pill
- **WHEN** an `ask_user` error `toolResult`, then a `subagent_entry` group row, then a complete `ask_user` `toolResult` are in the message stream
- **THEN** the error SHALL still collapse into the "failed — retried" pill

#### Scenario: Unowned event type keeps the raw row
- **WHEN** an event of a type no known manifest declares in `eventTypes` arrives
- **THEN** the shell SHALL render it as today's expandable raw-event row

### Requirement: Owner availability is decided at render time

The reducer SHALL NOT read owner availability (enabled, loaded, not refused). A client store fed by `/api/health.plugins[]`, `plugins_changed` and the runtime listing SHALL hold it; group rows SHALL re-render when it changes. A group row SHALL render nothing for an available owner or before the first status read, else one collapsed row naming plugin and count, whatever the debug-tools setting; payloads show on expand. Plain raw-event rows keep that gate.

#### Scenario: Disabled subagents plugin does not spam chat
- **WHEN** the subagents plugin is disabled and a session replays 40 `subagent_entry` events
- **THEN** the chat SHALL show one collapsed row "40 subagent_entry events — Subagents plugin unavailable" and no 40 JSON blocks
- **AND** expanding the row SHALL show the raw payloads

#### Scenario: Replay before the first status read
- **WHEN** a session replays plugin-owned events before `/api/health` has answered, and the owner turns out enabled and loaded
- **THEN** no group row SHALL ever render for those events

#### Scenario: Owner becomes unavailable later
- **WHEN** an owner of rendered group rows is reported disabled by a later `plugins_changed`
- **THEN** its group rows SHALL render collapsed without re-reducing the session

### Requirement: Late-registered owners regroup earlier raw rows

When a runtime plugin registers `eventTypes` after events of those types were reduced as unowned, the shell SHALL apply a pure regroup step to every loaded session state, replacing those raw rows with one group row per type at the position of the type's first row.

#### Scenario: Runtime owner registers after replay
- **WHEN** a session replayed 5 `quota_tick` events as raw rows, and then runtime plugin `quota-ui` registers `eventTypes: ["quota_*"]`
- **THEN** the 5 raw rows SHALL be replaced by one `quota_tick` group row with count 5 at the first row's position

### Requirement: Plugin lifecycle is verified on a dist-only install

The plugin lifecycle SHALL be verified end to end on an npm-global install, which has no monorepo root, not only in the docker harness, whose `/app` is a full workspace. Electron does not qualify: its server bundle resolves a monorepo root. The verification SHALL cover: a global-scope install through the dashboard appearing live, local-scope detection, uninstall, and a failing server entry.

#### Scenario: Global install appears live on a clean install
- **WHEN** a clean dist-only install receives, through `POST /api/packages/install` with global scope, a local packed fixture plugin directory (an absolute-path entry in `~/.pi/agent/settings.json#packages[]`) while the dashboard runs
- **THEN** `/api/plugins` and the next `plugins_changed` SHALL show the plugin with `source: "pi-package"` without a server restart
- **AND** its server entry SHALL stay unloaded with `server-untrusted` until a local operator grants server trust, then load without a restart

#### Scenario: Local install is only detected
- **WHEN** the same package is installed with local scope into an active session's cwd
- **THEN** the Plugins tab SHALL show the `local-detected` row and none of its code SHALL load

#### Scenario: Uninstall of an unloaded plugin
- **WHEN** a disabled, never-loaded plugin package is removed
- **THEN** its row SHALL disappear from the next `plugins_changed` snapshot

#### Scenario: Failing server entry on install
- **WHEN** an installed package's server entry throws on load
- **THEN** its row SHALL show `loaded: false` with the error, and the dashboard SHALL keep serving

### Requirement: Dist-only lifecycle fixture needs no registry

The dist-only lifecycle verification SHALL install its fixture plugin from a local packed directory, as a global-scope absolute-path entry in `~/.pi/agent/settings.json#packages[]`, through `POST /api/packages/install`. It SHALL NOT need an npm registry. `npm:` source resolution SHALL stay covered by the `pi-package-resolver` unit tests.

#### Scenario: Fixture installs from a local path
- **WHEN** the clean-VM verification installs the fixture plugin
- **THEN** the install source SHALL be an absolute local directory path, and the discovered row SHALL report `source: "pi-package"`
