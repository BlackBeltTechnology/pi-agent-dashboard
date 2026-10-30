# dashboard-plugin-loader Specification

## Purpose

This capability covers the **plugin loader runtime**: monorepo manifest discovery, server-side dynamic-import bootstrap, client-side static-registry generation (Vite plugin), bridge entry auto-register/deregister into pi's `~/.pi/agent/settings.json`, plugin context API (`PluginContext` / `ServerPluginContext`), the `plugins.<id>.*` config namespace with JSON-Schema validation and reactive broadcast, and `/api/health.plugins[]` status reporting.

The requirements below are layered: the design-level (contract) requirements come from change `dashboard-plugin-architecture`, and the implementation-level (runtime) requirements come from change `add-dashboard-shell-slots-runtime`. The motivating design notes live in `openspec/changes/dashboard-plugin-architecture/design.md`.

## Requirements

### Requirement: Emit a configured event into a session

`ServerPluginContext` SHALL expose `emitEventToSession(sessionId: string, eventType: string, data?: Record<string, unknown>): boolean`. It SHALL relay a `plugin_emit_event` control message to the target session over the bridge so the in-session bridge re-emits `eventType` with `data` on `pi.events`. It SHALL be gated to first-party / trusted plugins using the same gate as `spawnSession`/`abortSession`: an untrusted plugin SHALL receive a hook that returns `false` and sends nothing. A non-string or empty `eventType` SHALL return `false` without sending. It SHALL return `true` only when the control message is dispatched to a connected session.

A plugin SHALL emit only event types declared in its manifest `emits` list. The automation plugin's effective allowlist SHALL be computed by the host as its own manifest `emits` UNION the manifest `emits` of every plugin that is the recorded provider (see "Provide records the provider plugin") of an accepted `automation.action.*` registration; a registration is accepted only if its `emits` is a subset of that actual provider's manifest `emits` (see `automation-action-registry`), so the allowlist stays rooted in manifests. The allowlist is derived by the host from manifests and accepted registrations; plugins SHALL NOT be given a runtime channel to widen it. The host SHALL refuse (return `false` and send nothing) any `eventType` that is undeclared, and any `eventType` beginning with a reserved prefix. For an undeclared type it SHALL log at most ONE warning per (plugin, eventType) per server process, naming the plugin, the event type and the missing manifest field (`emits`), so out-of-tree plugins written before this requirement see an actionable message without log flooding. A reserved-prefix emission SHALL get the same once-per-(plugin, eventType) warning, naming the reserved prefix. The warning de-duplication set SHALL be capped at 1000 (plugin, eventType) pairs; beyond the cap a single summary warning SHALL be logged and no further per-pair warnings. The allowlist is computed live: the types of an unloaded provider plugin SHALL leave it. The reserved prefixes are: `roles:`, `role:`, `model:`, `prompt:`, `dashboard:`, `ui:`. Those namespaces carry pi-agent-dashboard's own in-session control listeners (role/provider config writes, follow-up prompt injection, prompt adapters, model resolution, UI invalidation) and SHALL NOT be reachable through plugin emission. The raw `sendExtensionMessage` lane SHALL refuse (return `false`) any message whose `type` is `plugin_emit_event`, so the reserved-prefix check cannot be bypassed.

#### Scenario: Trusted plugin emits an event

- **WHEN** a trusted plugin calls `ctx.emitEventToSession("sess-1", "flow:run", { flowName: "test:x", task: "go" })` for a connected session
- **THEN** a `plugin_emit_event` control message carrying `eventType: "flow:run"` and the data SHALL be dispatched to that session and the call SHALL return `true`.

#### Scenario: Untrusted plugin is denied

- **WHEN** an untrusted plugin (manifest priority > 100) calls `ctx.emitEventToSession(...)`
- **THEN** the call SHALL return `false` and SHALL send nothing.

#### Scenario: Invalid event type

- **WHEN** `emitEventToSession` is called with an empty string `eventType`
- **THEN** it SHALL return `false` and SHALL send nothing.

#### Scenario: Reserved-namespace event refused

- **WHEN** a trusted plugin calls `ctx.emitEventToSession("sess-1", "roles:set", {...})` or `ctx.emitEventToSession("sess-1", "dashboard:enqueue-followup", {...})`
- **THEN** the call SHALL return `false` and SHALL send nothing.

#### Scenario: Raw lane cannot smuggle an event emission

- **WHEN** a trusted plugin calls `ctx.sendExtensionMessage("sess-1", { type: "plugin_emit_event", eventType: "roles:set", data: {} })`
- **THEN** the call SHALL return `false` and SHALL send nothing.

#### Scenario: Declared event type is emitted

- **WHEN** a trusted plugin whose manifest `emits` contains `flow:run` calls `ctx.emitEventToSession("sess-1", "flow:run", {...})`
- **THEN** the event SHALL be dispatched and the call SHALL return `true`.

#### Scenario: Undeclared event type refused and logged once

- **WHEN** a trusted plugin calls `ctx.emitEventToSession("sess-1", "custom:thing", {...})` twice and `custom:thing` is not in its manifest `emits`
- **THEN** both calls SHALL return `false` and send nothing
- **AND** exactly one warning naming the plugin, `custom:thing` and the `emits` manifest field SHALL be logged for the process

#### Scenario: Reserved-prefix emit warns once
- **WHEN** a trusted plugin calls `ctx.emitEventToSession("sess-1", "roles:set", {...})` twice
- **THEN** both calls SHALL return `false`
- **AND** exactly one warning naming the plugin, `roles:set` and the reserved prefix SHALL be logged

#### Scenario: Warning set is capped
- **WHEN** more than 1000 distinct (plugin, eventType) pairs are refused
- **THEN** warnings SHALL stop at 1000 pairs and one summary warning SHALL be logged

#### Scenario: Warning is per plugin and event type
- **WHEN** two plugins each emit the same undeclared type, or one plugin emits two different undeclared types
- **THEN** one warning SHALL be logged for each (plugin, eventType) pair

#### Scenario: Accepted automation action event type is allowed

- **WHEN** the automation plugin emits an event type declared by an automation action registration it accepted, whose `emits` is a subset of its actual provider plugin's manifest `emits`
- **THEN** the event SHALL be dispatched even though it is not in the automation manifest's own `emits`.

#### Scenario: Unloaded provider's types leave the allowlist
- **WHEN** the plugin providing an accepted automation action is unloaded or disabled
- **THEN** the automation plugin SHALL be refused when emitting that action's event types, because they are no longer in the allowlist

#### Scenario: Rejected registration does not widen the allowlist
- **WHEN** an automation action registration declares an `emits` type absent from its actual provider plugin's manifest `emits`
- **THEN** that type SHALL NOT be added to the automation plugin's allowlist and emitting it SHALL be refused.

### Requirement: Prefix enumeration over the service board

`ServerPluginContext` SHALL expose `consumeAll<T = unknown>(prefix: string): Array<{ key: string; value: T; provider: string }>` returning every value published via `provide(name, …)` whose `name` starts with `prefix`, paired with its key and, additively, the `provider` id recorded by the host for that key (see "Provide records the provider plugin"). Entries the host itself set carry `provider: "host"`. It SHALL read the same host-owned in-process service registry as `consume`; values SHALL NOT cross the bridge. Order of results is unspecified. An empty result SHALL be returned (never throw) when no key matches.

`consumeAll` enables publish/collect: a producer `provide`s a namespaced key and a consumer enumerates the namespace lazily, independent of plugin load order.

#### Scenario: Collect all publishers under a namespace

- **WHEN** plugin A calls `provide("automation.action.flows", cA)` and plugin B calls `provide("automation.action.core", cB)`, then a consumer calls `consumeAll("automation.action.")`
- **THEN** the consumer SHALL receive entries for both keys with values `cA` and `cB`.

#### Scenario: Order independence

- **WHEN** a consumer calls `consumeAll(prefix)` after all plugins have loaded
- **THEN** it SHALL observe every matching contribution regardless of the order in which producers and the consumer were loaded.

#### Scenario: No match

- **WHEN** `consumeAll("nope.")` is called and no provided key starts with `nope.`
- **THEN** it SHALL return an empty array and SHALL NOT throw.

#### Scenario: Entries carry the provider
- **WHEN** plugin `flows` provides `automation.action.flows` and the host itself sets another key under the same prefix, then a consumer calls `consumeAll` for that prefix
- **THEN** the first entry SHALL carry `provider: "flows"` and the host-set entry SHALL carry `provider: "host"`

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

### Requirement: Vite plugin generates a static plugin registry

The `vite-plugin-dashboard-plugins` SHALL generate `packages/client/src/generated/plugin-registry.tsx` at dev start and on every build. The generated file SHALL use **named imports** for each claimed component (not `import * as`) so that Vite tree-shakes unused exports from plugin packages.

The generated file SHALL be committed to source control under a `.gitignore` rule for the `generated/` directory and produced fresh on every build.

`packages/client/vite.config.ts` SHALL invoke `viteDashboardPluginsPlugin()` and include its result in the `plugins[]` array. Failure to do so means the generated file is never produced, regardless of the plugin's correctness. The invocation SHALL use a deferred / dynamic import so a fresh checkout (where `dashboard-plugin-runtime` is not yet built) does not break vite startup; in that fallback state the plugin is skipped and the registry stays at its committed-stub initial value.

#### Scenario: Generated file uses named imports

- **WHEN** a plugin claims `{ "slot": "session-card-badge", "component": "OpenSpecBadge" }`
- **THEN** the generated `plugin-registry.tsx` SHALL contain a named import like `import { OpenSpecBadge } from "@blackbelt-technology/openspec-plugin/client"`, not a wildcard `import *`.

#### Scenario: Unused exports tree-shaken from production bundle

- **WHEN** a plugin's client entry exports `Foo` and `Bar`, and only `Foo` is claimed in the manifest
- **THEN** the production bundle SHALL contain `Foo` and SHALL NOT contain `Bar` (asserted by a build artifact scan in the test suite).

#### Scenario: Manifest change regenerates registry and triggers HMR

- **WHEN** a plugin's `package.json#pi-dashboard-plugin` field is edited during `vite dev`
- **THEN** the Vite plugin SHALL detect the change, regenerate `plugin-registry.tsx`, and trigger an HMR update so the client picks up the new manifest without a full reload.

#### Scenario: Plugin source change does not regenerate registry

- **WHEN** a file inside a plugin package's `src/` is edited (no manifest change)
- **THEN** the Vite plugin SHALL NOT regenerate `plugin-registry.tsx`; HMR SHALL flow through Vite's normal module graph.

#### Scenario: vite.config.ts must invoke the plugin

- **WHEN** a workspace plugin manifest exists under `packages/<pkg>/package.json#pi-dashboard-plugin` AND `vite.config.ts` does not register `viteDashboardPluginsPlugin` in `plugins[]`
- **THEN** the generated `plugin-registry.tsx` SHALL remain at its committed-stub state with `PLUGIN_REGISTRY = []` after `vite build`
- **AND** the regression test `packages/client/src/__tests__/plugin-registry-populated.test.ts` SHALL fail (post-build) with a clear message identifying the missing wiring.

#### Scenario: Fresh checkout without runtime built

- **WHEN** `vite dev` is invoked on a clone where `packages/dashboard-plugin-runtime/dist/` does not exist yet
- **THEN** the dynamic import of `viteDashboardPluginsPlugin` SHALL fail silently and vite SHALL start with the committed-stub registry
- **AND** no error SHALL be logged to stderr beyond a single `[plugin-registry] runtime not built — registry empty` info message.

### Requirement: `plugins` is a reserved top-level key in dashboard config

The dashboard config loader (`~/.pi/dashboard/config.json`) SHALL recognize `plugins` as a top-level reserved key. The loader SHALL parse `plugins.<id>` subtrees and expose them via `getPluginConfig<T>(id)` to the runtime.

The loader SHALL NOT touch other top-level keys (`port`, `auth`, `bypassHosts`, `openspec`, etc.). Existing plugin-shaped top-level keys (e.g. legacy `openspec.*`) remain at top-level until each `extract-*-as-plugin` change migrates them via its server entry's auto-migrator.

#### Scenario: Plugin config persists under plugins.<id>

- **WHEN** plugin "demo" calls `pluginContext.updatePluginConfig({ foo: 1 })`
- **THEN** `~/.pi/dashboard/config.json` SHALL contain `plugins: { demo: { foo: 1 } }` (atomically written via tmp + rename).

#### Scenario: Existing top-level keys preserved

- **WHEN** the config file already contains `{ "port": 8000, "openspec": { "pollIntervalSeconds": 30 } }` and plugin "demo" writes its config
- **THEN** the resulting file SHALL contain `{ "port": 8000, "openspec": {...}, "plugins": { "demo": {...} } }` with the legacy `openspec` key untouched.

### Requirement: REST endpoint for plugin config writes is auth-gated

The endpoint `POST /api/config/plugins/:id` SHALL go through the same Fastify auth chain as `POST /api/config`. The endpoint SHALL reject requests that fail the dashboard's `createNetworkGuard` or auth plugin.

#### Scenario: Unauthenticated request rejected

- **WHEN** a non-loopback, non-trusted-network client without auth credentials calls `POST /api/config/plugins/demo`
- **THEN** the server SHALL return 401 (or the same status the existing config endpoint returns for the same request).

#### Scenario: Authenticated request succeeds

- **WHEN** an authenticated client calls `POST /api/config/plugins/demo` with a valid body
- **THEN** the server SHALL persist the config, broadcast `plugin_config_update`, and return 200 with `{ success: true, config: <merged> }`.

### Requirement: `plugin_config_update` broadcast is added to the browser protocol union

The message type `plugin_config_update` SHALL appear in the `ServerToBrowserMessage` union in `packages/shared/src/browser-protocol.ts`. The payload SHALL be `{ type: "plugin_config_update"; id: string; config: unknown }`.

A test SHALL exist asserting that every message type used by the server-to-browser path appears in the union (preventing the recurring esbuild-strips-as-any-cases bug noted in AGENTS.md).

#### Scenario: Message type appears in protocol union

- **WHEN** the project's vitest suite runs the protocol-completeness test
- **THEN** the test SHALL assert that `"plugin_config_update"` is a member of the `ServerToBrowserMessage` union.

#### Scenario: Broadcast contains only the calling plugin's namespace

- **WHEN** plugin A writes to its config and the server broadcasts `plugin_config_update`
- **THEN** the broadcast payload `config` field SHALL contain only the `plugins.A.*` subtree, never any other plugin's namespace, and a unit test SHALL assert this property.

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

### Requirement: Loader does not crash dashboard on plugin failure

A plugin throwing during manifest validation, server-side dynamic import, server-side `registerPlugin` execution, bridge auto-register, or client-side render SHALL NOT prevent the dashboard server from starting or the dashboard client from rendering its core UI.

The loader SHALL catch each failure individually, attribute it to the offending plugin, and continue loading the remaining plugins. The dashboard's core REST and WebSocket endpoints SHALL remain operational.

#### Scenario: Server entry throws during load

- **WHEN** plugin "demo"'s server entry throws synchronously on import
- **THEN** the dashboard server SHALL still complete startup, `/api/health` SHALL show plugin "demo" failed with the error, and core endpoints (`/api/sessions`, `/api/config`) SHALL respond 200.

#### Scenario: Manifest validation fails for one plugin

- **WHEN** plugin "demo"'s manifest references an unknown slot id
- **THEN** the dashboard SHALL log a fatal validation error naming the package and the unknown slot, mark the plugin as failed in `/api/health`, and continue loading all other plugins.

#### Scenario: Bridge auto-register fails for one plugin

- **WHEN** plugin "demo"'s bridge file path does not exist on disk
- **THEN** the loader SHALL log a warning, mark the plugin failed in `/api/health` with an error identifying the missing file, and SHALL still complete loading other plugins and start the server.

### Requirement: Plugin manifest format

A first-party plugin SHALL be a monorepo package with a `pi-dashboard-plugin` field in its `package.json` (or, alternatively, a `dashboard-plugin.json` adjacent to `package.json`). The manifest SHALL conform to the following schema:

```ts
interface PluginManifest {
  id: string;                    // kebab-case, globally unique
  displayName: string;
  priority?: number;             // default 1000; first-party uses 100
  client?: string;               // path to bundled client entry (relative to package root)
  server?: string;               // optional path to server entry
  bridge?: string;               // optional path to pi-extension entry
  configSchema?: string;         // optional path to JSON Schema for config
  claims: PluginClaim[];
}

interface PluginClaim {
  slot: SlotId;                  // must match a known slot id
  component?: string;            // exported component name from client entry (for React slots)
  command?: string;              // for "command-route" slot
  trigger?: string;              // for "anchored-popover" slot
  config?: Record<string, unknown>; // slot-specific config
  predicate?: string;            // optional name of an exported predicate function
                                 // — answers "does this claim apply to this target?"
                                 //   (filters claims at registry level)
  shouldRender?: string;         // optional name of an exported sync function
                                 // — answers "will this claim's component produce
                                 //   visible output for this target?"
                                 //   Used by useSlotHasClaimsForSession (and
                                 //   sibling helpers) to gate the wrapper subcard
                                 //   without speculative rendering.
}
```

The `predicate` and `shouldRender` fields differ in intent:

- `predicate(props): boolean` filters claims at the registry level. Use it when the claim is structurally inapplicable to a target (e.g. wrong cwd, wrong source). A claim that fails its predicate is removed from the slot's claim list entirely and never mounted.
- `shouldRender(props): boolean` runs alongside `predicate` but at the wrapper-gate layer. Use it when the claim's component conditionally returns `null` based on dynamic state (e.g. "extension not installed", "user not authenticated"). A claim whose `shouldRender` returns `false` is NOT mounted inside the slot, AND counts as absent for the purposes of `useSlotHasClaimsForSession` (so the wrapper hides).

Both functions MUST be synchronous. Plugins requiring async state SHALL maintain a sync-readable cache and return a closed-by-default value while the cache is unpopulated.

#### Scenario: Manifest read from package.json

- **WHEN** the loader scans `packages/openspec-plugin/package.json`
- **THEN** it SHALL parse the `pi-dashboard-plugin` field and treat it as the manifest.

#### Scenario: Adjacent dashboard-plugin.json takes precedence

- **WHEN** both `package.json#pi-dashboard-plugin` and `dashboard-plugin.json` exist in the same package
- **THEN** the loader SHALL use `dashboard-plugin.json` and log a warning about the duplication.

#### Scenario: Invalid manifest is rejected at load time

- **WHEN** a manifest references an unknown slot id, missing required fields, or an unparseable schema
- **THEN** the loader SHALL log a fatal validation error naming the package and the violation, mark the plugin as failed, and continue loading other plugins.

#### Scenario: Manifest with shouldRender field is accepted

- **WHEN** a manifest contains a claim with `"shouldRender": "shouldRenderFlowBadge"`
- **AND** the named function is exported from the plugin's client entry
- **THEN** the loader SHALL resolve the string to the function reference and store it on the resolved `ClaimEntry.shouldRender`

#### Scenario: Manifest with shouldRender referencing missing export is rejected

- **WHEN** a manifest contains `"shouldRender": "nonExistent"` and no such export exists on the client entry
- **THEN** the loader SHALL log a validation error and mark the plugin as failed (same severity as missing `component` export)

### Requirement: Plugin discovery scans monorepo packages on startup

On dashboard server startup, the loader SHALL glob `packages/*/package.json` (relative to the dashboard repo root, or to the resolved server install location for production builds) and identify every package that declares a `pi-dashboard-plugin` field.

#### Scenario: Package without manifest is skipped silently

- **WHEN** `packages/some-utility/package.json` has no `pi-dashboard-plugin` field
- **THEN** the loader SHALL not consider it a plugin and SHALL not produce any output.

#### Scenario: Disabled plugin is skipped

- **WHEN** `~/.pi/dashboard/config.json` contains `plugins.<id>.enabled = false`
- **THEN** the loader SHALL skip discovery, server-side load, client bundling, and bridge registration for that plugin, and log a single info-level message.

#### Scenario: Discovery is deterministic

- **WHEN** the loader runs twice with the same set of packages
- **THEN** the resulting plugin order SHALL be identical (by `priority` then alphabetical id).

### Requirement: Server-side plugin entry registration

If a plugin manifest declares a `server` entry, the loader SHALL dynamic-import that module after server bootstrap completes (after Fastify, session manager, and event store are ready). The module SHALL export at minimum a default registration function:

```ts
export default function registerPlugin(ctx: ServerPluginContext): void | Promise<void>;
```

The `ServerPluginContext` SHALL expose:

- `fastify: FastifyInstance` (for REST routes)
- `sessionManager`, `eventStore`, `broadcastToSubscribers`, `directoryService` (read or subscribe to existing dashboard state)
- `registerPiHandler(messageType, handler)` (for handling extension WebSocket messages)
- `registerBrowserHandler(messageType, handler)` (for handling browser WebSocket messages)
- `pluginConfig: T` (typed via plugin's `configSchema`)
- `logger: Logger` (namespaced to the plugin id)

The plugin SHALL register all routes, handlers, and polling within the registration function. The loader SHALL await the function (if async) before proceeding.

#### Scenario: Plugin registers REST routes

- **WHEN** OpenSpec's server entry calls `ctx.fastify.register(routes, { prefix: "/api/openspec" })`
- **THEN** routes SHALL be available at `/api/openspec/*` after server start.

#### Scenario: Plugin registration throws

- **WHEN** a plugin's `registerPlugin` throws or rejects
- **THEN** the loader SHALL log the error with plugin id, mark the plugin as failed, expose the failure via `/api/health`'s `plugins[]` field, and continue loading other plugins.

#### Scenario: Disabled plugin's server entry is not loaded

- **WHEN** `plugins.openspec.enabled = false`
- **THEN** the loader SHALL not import the server entry at all (no side effects, no module evaluation).

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

### Requirement: Bridge entries auto-register as pi extensions

If a plugin manifest declares a `bridge` entry, the dashboard server SHALL on startup write the plugin's bridge path into `~/.pi/agent/settings.json` under the `extensions[]` array (under a path it owns, like `dashboard-<plugin-id>`), so the bridge loads on every pi session start.

The dashboard SHALL remove the entry on plugin disable. The dashboard SHALL never overwrite extension entries owned by other tools or by the user.

#### Scenario: Plugin bridge appears in pi extensions

- **WHEN** OpenSpec plugin declares `"bridge": "./dist/bridge/index.js"` and the dashboard starts
- **THEN** `~/.pi/agent/settings.json` SHALL contain an entry pointing at the absolute resolved path of that file under a managed key like `dashboard-openspec`.

#### Scenario: Disabling plugin removes bridge entry

- **WHEN** the user disables OpenSpec plugin via settings
- **THEN** the dashboard SHALL remove the `dashboard-openspec` entry from `settings.json` on next restart.

#### Scenario: User-owned entries are preserved

- **WHEN** the user has manually added a different extension to `settings.json`
- **THEN** the dashboard SHALL only touch entries it manages (via the `dashboard-<plugin-id>` key prefix); user-owned entries SHALL remain untouched.

### Requirement: Plugin context API for read-only state and action dispatch

Plugins SHALL receive a typed `PluginContext` (client side) and `ServerPluginContext` (server side). Plugins MUST NOT import from internal dashboard paths (`App.tsx`, internal hooks, internal components). The plugin context is the contract; everything else is internal.

The client `PluginContext` SHALL provide at minimum:

- `useSessionState(sessionId): SessionState | undefined` — React hook for current session state.
- `useAllSessions(): DashboardSession[]` — React hook for the full session list.
- `usePluginConfig<T>(): T` — typed config from `~/.pi/dashboard/config.json` `plugins.<id>.*`.
- `send(message: BrowserToServerMessage)` — typed dispatcher.
- `pluginRouter: { open, close }` — open or close the current `content-view` route.
- `logger: Logger` — namespaced to the plugin id.

#### Scenario: Plugin reads session state

- **WHEN** a plugin's `session-card-badge` component calls `pluginContext.useSessionState(session.id)`
- **THEN** it SHALL receive the same reactive session state the shell uses.

#### Scenario: Plugin dispatches a browser-to-server message

- **WHEN** a plugin calls `pluginContext.send({ type: "ui_management", ... })`
- **THEN** the message SHALL be sent over the active WebSocket connection identical to the shell's own dispatches.

#### Scenario: Plugin imports from internal path triggers test failure

- **WHEN** a plugin's source imports from `packages/client/src/App.js` or any internal-only module
- **THEN** the repo's lint suite SHALL fail with an explicit error directing the author to use `pluginContext` instead.

### Requirement: Plugin context exposes per-session event stream

`PluginContextValue` SHALL provide a hook
`useSessionEvents(sessionId: string): readonly DashboardEvent[]` that
returns every event observed for the given session in arrival order.
The hook SHALL be reactive: when a new event arrives for the
subscribed session, the consuming component SHALL re-render with the
extended event list.

The returned array SHALL be referentially stable across renders that
do not change the event list. Plugins MAY use it as a `useMemo`
dependency to recompute derived state only when new events arrive.

The dashboard shell SHALL accumulate per-session events in a parallel
in-memory store sourced from the existing `case "event"` handler in
`useMessageHandler.ts`. The accumulator SHALL be initialized empty on
`session_register`, appended to on each `event`, and cleared on
session unregister.

#### Scenario: Plugin derives state from events

- **GIVEN** a plugin contribution is rendered for session `S`
- **AND** events `[e1, e2, e3]` have been received for session `S`
- **WHEN** the contribution calls `useSessionEvents("S")`
- **THEN** the hook SHALL return an array containing `[e1, e2, e3]` in
  arrival order
- **AND** the array reference SHALL be the same on subsequent renders
  until a new event arrives

#### Scenario: New event triggers re-render

- **GIVEN** a plugin contribution rendered with `useSessionEvents("S")`
  returning `[e1, e2]`
- **WHEN** event `e3` arrives via the `case "event"` handler
- **THEN** the contribution SHALL re-render
- **AND** the hook SHALL return `[e1, e2, e3]` on the new render

#### Scenario: Hook is per-session

- **GIVEN** events `[a1, a2]` for session `A` and `[b1]` for session `B`
- **WHEN** a contribution calls `useSessionEvents("A")`
- **THEN** the hook SHALL return only `[a1, a2]`
- **AND** SHALL NOT include any event from session `B`

### Requirement: ContentViewSlot SHALL filter competing claims by predicate

`ContentViewSlot` SHALL select among multiple `content-view` claims by
invoking each claim's optional `predicate` function and rendering the
first claim (by priority order) whose predicate returns `true`. If no
claim's predicate returns `true`, `ContentViewSlot` SHALL render
nothing (return `null`), allowing the shell's fallback (`??
sessionDetail`) to render the default chat view. The slot is
`multiplicity: "one-active"`, so at most one claim renders at a time.

The `predicate` field on `PluginClaim` is the SAME field used by
session-card-badge and other session-scoped slots. It is a free
JavaScript function name resolved at build time by the vite plugin
against the plugin's client entry exports. The function's body MAY
read any state its module exposes (including plugin-internal
stores); the `session` argument is informational.

The SDK SHALL NOT add a parallel discriminator mechanism (such as a
`route?` field). Plugins compose with the existing predicate slot
field. (Earlier drafts of this change added a `route?` field; it was
removed — see the `pluginize-flows-via-registry` design.md
Decision 3 RECONSIDERED.)

#### Scenario: ContentViewSlot picks the predicate-true claim

- **GIVEN** two `content-view` claims registered:
  - Claim A: `{ component: "FlowAgentDetail", predicate: "isFlowAgentDetailActive" }`
  - Claim B: `{ component: "FlowArchitectDetail", predicate: "isFlowArchitectDetailActive" }`
- **AND** `isFlowAgentDetailActive` returns `true`
- **AND** `isFlowArchitectDetailActive` returns `false`
- **WHEN** the shell mounts `<ContentViewSlot>`
- **THEN** only Claim A SHALL render
- **AND** Claim B SHALL NOT render

#### Scenario: ContentViewSlot renders nothing when all predicates are false

- **GIVEN** content-view claims whose predicates all return `false`
- **WHEN** the shell mounts `<ContentViewSlot>`
- **THEN** the slot SHALL render nothing
- **AND** the shell's `?? sessionDetail` fallback SHALL render the
  chat view

#### Scenario: Multiple true predicates resolve by priority

- **GIVEN** two content-view claims whose predicates both return
  `true`, one at priority 40 and one at priority 60
- **WHEN** the shell mounts `<ContentViewSlot>`
- **THEN** only the lower-priority-value (priority 40) claim SHALL
  render (existing slot `(priority asc, pluginId asc)` ordering)

#### Scenario: Predicate can read plugin-internal state via closure

- **GIVEN** a content-view claim's predicate function is defined in
  the plugin's client entry and closes over a module-level state
  store
- **WHEN** the user triggers a plugin action that updates the store
  (e.g. `setFlowDetailAgent(name)`)
- **THEN** the predicate's next invocation SHALL reflect the new
  state
- **AND** the slot consumer SHALL pick up the change on next render

### Requirement: Plugin settings persist under `plugins.<id>.*` namespace

Plugin settings SHALL be persisted in `~/.pi/dashboard/config.json` under the top-level key `plugins.<id>.*`. The dashboard core SHALL never write to or read from another plugin's namespace; only the owning plugin (matched by manifest `id`) may read or write its own subtree.

If a plugin manifest declares a `configSchema` (JSON Schema 7 file path), the loader SHALL:

1. On read: parse stored config, validate against the schema, apply defaults from the schema for any missing keys.
2. On write: validate the merged config against the schema before persistence; reject the write with a typed error if invalid.
3. On schema change between plugin versions: run any `configMigrations[]` declared in the manifest in order, atomically.

#### Scenario: Default values applied from schema

- **WHEN** a plugin declares `pollIntervalSeconds: { type: "number", default: 30 }` in its `configSchema` and the user has never written that key
- **THEN** `pluginContext.usePluginConfig<T>()` SHALL return `{ pollIntervalSeconds: 30, ... }`.

#### Scenario: Invalid write rejected

- **WHEN** a plugin calls `pluginContext.updatePluginConfig({ pollIntervalSeconds: "not a number" })`
- **THEN** the loader SHALL reject the promise with a `ValidationError`, the on-disk config SHALL remain unchanged, and no `plugin_config_update` SHALL broadcast.

#### Scenario: Cross-plugin namespace access denied

- **WHEN** plugin A attempts to write to `plugins.B.*`
- **THEN** the server SHALL reject with HTTP 403 and log a security warning identifying the offending plugin.

### Requirement: REST endpoint for plugin config writes

The dashboard server SHALL expose `POST /api/config/plugins/:id` accepting a partial config object. The endpoint SHALL:

1. Validate the `:id` matches an installed, enabled plugin.
2. Validate the body against that plugin's `configSchema`.
3. Read existing config, merge the partial, write atomically (tmp + rename). Keys the body omits SHALL keep their stored values: schema defaults SHALL fill only keys absent from the merged result, never overwrite a stored value (validation SHALL NOT inject defaults into the body before the merge).
4. Broadcast `plugin_config_update { id, config }` to all subscribers.
5. Return `{ success: true, config: <merged> }`.

Writes to core config (`auth`, `port`, `bypassHosts`, etc.) continue via the existing `POST /api/config`; the two endpoints are independent and SHALL NOT cross-update.

#### Scenario: Plugin config write succeeds

- **WHEN** a `POST /api/config/plugins/openspec` body `{ "pollIntervalSeconds": 60 }` arrives
- **THEN** the server SHALL persist `plugins.openspec.pollIntervalSeconds = 60`, return 200, and broadcast `plugin_config_update`.

#### Scenario: Partial write keeps omitted keys

- **WHEN** plugin `p` has stored `{ roots: ["/a"], flag: true }` with schema defaults `roots: []`, `flag: false`, and `POST /api/config/plugins/p` arrives with body `{ "throttle": 500 }`
- **THEN** the stored config SHALL be `{ roots: ["/a"], flag: true, throttle: 500 }`
- **AND** a key never stored SHALL receive its schema default

#### Scenario: Unknown plugin id rejected

- **WHEN** `POST /api/config/plugins/no-such-plugin`
- **THEN** the server SHALL return HTTP 404.

#### Scenario: Disabled plugin write rejected

- **WHEN** `POST /api/config/plugins/openspec` arrives but `plugins.openspec.enabled = false`
- **THEN** the server SHALL return HTTP 409 with an explicit "plugin disabled" message.

### Requirement: Reactive plugin config broadcast

When any plugin's config changes (whether via REST endpoint or server-side `updatePluginConfig`), the dashboard server SHALL broadcast `plugin_config_update { id, config }` to all subscribed browsers. The client-side `pluginContext.usePluginConfig<T>()` hook SHALL subscribe to this event and re-render its consumers with the new config within one frame.

The broadcast payload SHALL contain only the calling plugin's namespace, never other plugins' configs.

#### Scenario: All clients receive the update

- **WHEN** plugin A writes its config and three browsers are subscribed
- **THEN** all three browsers SHALL receive `plugin_config_update { id: "A", config }`.

#### Scenario: Hook re-renders on update

- **WHEN** a `usePluginConfig<T>()` hook in plugin A's settings React component is mounted, and a config write happens
- **THEN** the component SHALL re-render with the new config; React state derived from old config SHALL be replaced.

#### Scenario: Cross-plugin config not exposed in broadcast

- **WHEN** plugin A writes its config
- **THEN** the broadcast payload SHALL NOT contain plugin B's namespace; clients can only learn other plugins' configs by subscribing to those plugins (which is not currently supported).

#### Scenario: Server-side updatePluginConfig broadcast carries the plugin id

- **WHEN** plugin A's server entry calls `ctx.updatePluginConfig(partial)`
- **THEN** the server SHALL broadcast `plugin_config_update { id: "A", config }` with the merged, client-redacted config
- **AND** the client SHALL apply it to plugin A's config store (never under an undefined or missing id)

### Requirement: Plugin loader exposes status via `/api/health`

The dashboard `/api/health` endpoint SHALL include a `plugins` array with one entry per discovered plugin:

```ts
interface PluginStatus {
  id: string;
  enabled: boolean;
  loaded: boolean;
  error?: string;
  claims: number;        // count of slots claimed
}
```

#### Scenario: Healthy plugin

- **WHEN** OpenSpec plugin loaded successfully
- **THEN** `/api/health.plugins[].openspec` SHALL be `{ id: "openspec", enabled: true, loaded: true, claims: 7 }`.

#### Scenario: Failed plugin

- **WHEN** a plugin's server entry throws on registration
- **THEN** `/api/health.plugins[].<id>` SHALL be `{ id, enabled: true, loaded: false, error: "<message>", claims: 0 }`.

#### Scenario: Disabled plugin

- **WHEN** a plugin is disabled in config
- **THEN** the entry SHALL be `{ id, enabled: false, loaded: false, claims: 0 }`.

### Requirement: Plugin failure does not crash the shell

A plugin failing to load (server throw, client import error, missing entry) SHALL NOT prevent other plugins or the dashboard shell from working. Failures SHALL be logged with full context and surfaced via `/api/health`. The shell SHALL continue with the failed plugin's slots empty.

#### Scenario: Server-side load failure

- **WHEN** OpenSpec plugin's server entry throws
- **THEN** the dashboard server SHALL still start, OpenSpec slots SHALL render empty, and other plugins SHALL load normally.

#### Scenario: Client-side runtime failure

- **WHEN** a plugin's React component throws on first render
- **THEN** an error boundary in the slot consumer SHALL catch it, render nothing for that contribution, and log to console — the shell SHALL not white-screen.

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

### Requirement: `useSlotHasClaimsForSession` consults `shouldRender`

The runtime helper `useSlotHasClaimsForSession(slotId, session): boolean` (exported from `packages/dashboard-plugin-runtime/src/slot-consumers.tsx`) SHALL return `true` only when at least one claim:

1. matches `slotId`,
2. passes its optional `predicate(session)` (existing behavior), AND
3. passes its optional `shouldRender(session)` (new behavior; claims without `shouldRender` are treated as if `() => true`).

Sibling helpers for other targets (folder, command, etc.) SHALL apply the same rule when introduced.

#### Scenario: Hook returns false when only claim's shouldRender returns false
- **WHEN** a session-card-memory claim is registered with `shouldRender: () => false`
- **AND** no other session-card-memory claim exists
- **THEN** `useSlotHasClaimsForSession("session-card-memory", session)` SHALL return `false`

#### Scenario: Hook returns true when at least one claim's shouldRender returns true
- **WHEN** two session-card-memory claims exist, one with `shouldRender: () => false` and one with `shouldRender: () => true`
- **THEN** `useSlotHasClaimsForSession("session-card-memory", session)` SHALL return `true`

#### Scenario: Hook treats absent shouldRender as pass-through
- **WHEN** a claim has no `shouldRender` declared and passes its predicate
- **THEN** the claim SHALL count toward the hook's `true` result

### Requirement: Slot consumers skip claims whose `shouldRender` returns false

The slot consumer components in `slot-consumers.tsx` (`SessionCardMemorySlot`, `SessionCardBadgeSlot`, `WorkspaceActionBarSlot`, `SessionCardActionBarSlot`, etc. — all session-scoped consumers) SHALL filter the claim list with `shouldRender(session)` (when declared) before rendering. A claim whose `shouldRender` returns `false` SHALL NOT be mounted at all (no `SlotErrorBoundary`, no `CurrentPluginLayer`, no `Component`).

#### Scenario: Slot consumer mounts only claims whose shouldRender returns true
- **WHEN** a slot has two claims, one with `shouldRender: () => false` and one without `shouldRender`
- **AND** the slot consumer renders for a session
- **THEN** only the second claim's component SHALL be mounted in the rendered output

#### Scenario: Slot consumer renders nothing when all claims gated out
- **WHEN** every claim for the slot has `shouldRender: () => false`
- **THEN** the slot consumer SHALL render nothing (no fragment, no boundary)

### Requirement: `ClaimEntry` is generic over `SlotId` with strong predicate input typing

The plugin runtime's `ClaimEntry` interface (in `packages/dashboard-plugin-runtime/src/slot-registry.ts`) SHALL be parameterised by slot id, with `predicate` and `shouldRender` declared using **method-shorthand syntax** so their parameter types are bivariant under TypeScript's `strictFunctionTypes`:

```ts
export interface ClaimEntry<S extends SlotId = SlotId> {
  pluginId: string;
  priority: number;
  slot: S;
  predicate?(input: SlotPredicateInput<S>): boolean;
  shouldRender?(input: SlotPredicateInput<S>): boolean;
  // … remaining fields unchanged
}
```

The method-shorthand syntax SHALL be used (rather than arrow-property syntax `predicate?: (input) => boolean`) because the static-registry generator emits each entry as a `ClaimEntry<"literal-slot-id">` specialization that must be assignable back into a mixed-slot `ClaimEntry[]` array. With arrow-property syntax, parameter contravariance forbids the narrow-to-wide direction. Method shorthand is TypeScript's documented bivariance escape hatch and is sound here because the registry's filter helpers pre-filter claims by slot id before invoking any predicate.

The default type argument `S extends SlotId = SlotId` SHALL be preserved so that existing untyped usages — including `SlotRegistry.getClaims(slotId): ClaimEntry[]`, every filter helper signature, and external `ClaimEntry[]` consumers — continue to compile without source changes.

The change SHALL be non-breaking for external plugins:

- A plugin's predicate previously typed as `(input: unknown) => boolean` SHALL remain assignable to the new method-shape contract for every concrete `S`, by parameter bivariance.
- A plugin's predicate typed narrowly (e.g. `(session: DashboardSession | null | undefined) => boolean`) SHALL be accepted at registration when the entry's `slot` is a session-scoped slot id, and SHALL be rejected by the type-checker when the `slot` is folder-scoped (mismatched concrete input types).
- Predicate registration on a slot whose `SlotPredicateInput<S>` is `never` (e.g. `settings-section`, `tool-renderer`, descriptor-only slots) SHALL compile because of method-shorthand bivariance, but the registered predicate is dead code: filter helpers only invoke predicates on session- and folder-scoped slots.

#### Scenario: Registering a session-shaped predicate on a session slot type-checks

- **WHEN** a registry entry declares `{ slot: "session-card-badge", predicate: (s: DashboardSession | null | undefined) => boolean(s) }`
- **THEN** TypeScript SHALL accept the entry without diagnostics.

#### Scenario: Registering a session-shaped predicate on a folder slot is a compile error

- **WHEN** a registry entry declares `{ slot: "sidebar-folder-section", predicate: (s: DashboardSession | null | undefined) => boolean(s) }`
- **THEN** TypeScript SHALL report a type error indicating the predicate's parameter type is incompatible with `SlotPredicateInput<"sidebar-folder-section">` (which is `FolderDescriptor`).

#### Scenario: Registering a folder-shaped predicate on a session slot is a compile error

- **WHEN** a registry entry declares `{ slot: "session-card-badge", predicate: (f: FolderDescriptor) => boolean(f) }`
- **THEN** TypeScript SHALL report a type error indicating the predicate's parameter type is incompatible with `SlotPredicateInput<"session-card-badge">`.

#### Scenario: Registering an `unknown`-typed predicate on any slot type-checks

- **WHEN** a registry entry declares `{ slot: "session-card-badge", predicate: (p: unknown) => boolean(p) }`
- **THEN** TypeScript SHALL accept the entry without diagnostics (contravariance: `unknown` is wider than the required input type).

#### Scenario: Default-generic `ClaimEntry[]` consumers compile unchanged

- **WHEN** `SlotRegistry.getClaims(slotId)` returns `ClaimEntry[]` (no explicit type argument)
- **AND** `forSession(claims: ClaimEntry[], session: DashboardSession)` invokes `c.predicate(session)`
- **THEN** the call SHALL type-check because `DashboardSession` is assignable to `SlotPredicateInput<SlotId>` (which resolves to `DashboardSession | null | undefined | FolderDescriptor`).

### Requirement: Vite plugin emits literal slot ids in the generated registry

The static-registry generator in `packages/dashboard-plugin-runtime/src/vite-plugin/index.ts` SHALL emit each claim entry in `packages/client/src/generated/plugin-registry.tsx` so that the `slot:` field is a literal type (not widened to `SlotId`). This SHALL allow TypeScript to specialise `ClaimEntry<S>` per entry and type-check the entry's `predicate` and `shouldRender` against the correct `SlotPredicateInput<S>`.

Acceptable implementation strategies SHALL be either (a) relying on TypeScript's natural literal narrowing of the discriminant `slot:` field in object literals, or (b) emitting an explicit `satisfies ClaimEntry<"literal-slot-id">` per entry.

#### Scenario: Generated entry with session-shaped predicate on session slot compiles

- **WHEN** the generator emits an entry `{ pluginId: "flows", … slot: "session-card-badge", predicate: isInFlow }` and `isInFlow` has signature `(s: DashboardSession | null | undefined) => boolean`
- **THEN** TypeScript SHALL accept the generated file without diagnostics.

#### Scenario: Generated entry with mis-shaped predicate is a build error

- **WHEN** a plugin manifest registers a predicate whose runtime signature is incompatible with the slot's `SlotPredicateInput<S>`
- **THEN** TypeScript SHALL emit a type error during `npm run lint` (or any project type-check) naming the offending generated entry.

### Requirement: Plugin runtime exposes UI primitive registry context

The dashboard's React root SHALL be wrapped in a `<UiPrimitiveProvider>` (defined by `plugin-ui-primitive-registry`) so that all plugin slot contributions are descendants of the provider. This SHALL be in addition to the existing `<PluginContextProvider>` already required by `dashboard-plugin-loader`.

The relative ordering SHALL place `<UiPrimitiveProvider>` OUTSIDE `<PluginContextProvider>`. (Both end up wrapping `<App>`; the order matters only in that hooks from one cannot influence the other's setup.)

#### Scenario: Both providers wrap App

- **WHEN** `<App>` is mounted from `packages/client/src/main.tsx`
- **THEN** the React tree SHALL include `<UiPrimitiveProvider value={primitiveRegistry}>` at or above `<PluginContextProvider>`
- **AND** every slot consumer in the tree SHALL be a descendant of both providers

#### Scenario: Plugin contribution can use both registries

- **WHEN** a plugin slot contribution renders inside both providers
- **THEN** it SHALL be able to call `usePluginConfig()` (from PluginContext) AND `useUiPrimitive()` (from UiPrimitiveProvider) in the same component without either failing

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

### Requirement: The Plugins tab SHALL surface plugin errors visibly and copyably

For every plugin row whose `PluginStatus.error` is a non-empty string, the Plugins tab SHALL render the error message inline beneath the row in a panel that satisfies all of:

- the error text is visible without hover, mouse-over, or expansion (no tooltip-only surfaces),
- the text content is rendered in a monospace block preserving whitespace,
- a clearly labelled copy button writes the error text to the clipboard via `navigator.clipboard.writeText`,
- the panel's foreground / background / border colours use Tailwind class pairs that resolve to readable contrast on both light and dark themes (e.g. `text-red-700 dark:text-red-300` plus matching background and border).

Transient errors from `POST /api/plugins/:id/toggle` and section-level fetch failures from `GET /api/plugins` SHALL use the same panel component and colour pairs.

#### Scenario: status.error renders inline with a copy button

- **WHEN** `/api/plugins` returns a plugin row with `status.error = "Bridge path conflict: existing=/a, new=/b"`
- **THEN** the row in the Plugins tab SHALL render the full message in a monospace block beneath the row header, AND a `[Copy]` button that copies the message to the clipboard when clicked.

#### Scenario: error panel is readable on light themes

- **WHEN** the dashboard is rendered with a light theme (no `.dark` class on the root)
- **THEN** the error panel's text colour SHALL be `text-red-700` (or equivalent), and the warning pills SHALL use `text-amber-700`, ensuring the foreground/background contrast is readable.

### Requirement: Plugin manifests SHALL support an optional `dependsOn` field

The `PluginManifest` type SHALL accept an optional `dependsOn?: string[]` field that declares other plugin ids this plugin requires to be present AND enabled. Dependencies SHALL be treated as **hard** and **transitive**. The manifest validator SHALL reject:

- non-string entries,
- empty / whitespace-only strings,
- self-references (the plugin's own `id` appearing in its `dependsOn`),
- duplicate entries.

Dependency cycles SHALL NOT be rejected at validate time — they are detected at discovery time by `detectCycles(graph)` and reported via `PluginStatus.error` for every plugin in the cycle. Discovery itself SHALL NOT throw on a cycle (one broken third-party manifest must not brick the dashboard).

#### Scenario: Self-reference rejected

- **WHEN** plugin `foo` declares `dependsOn: ["foo"]`
- **THEN** the manifest validator SHALL throw `ManifestValidationError` and the plugin SHALL NOT be discovered.

#### Scenario: Cycle soft-fails the involved plugins

- **WHEN** plugin `a` declares `dependsOn: ["b"]` and plugin `b` declares `dependsOn: ["a"]`
- **THEN** discovery SHALL NOT throw; it SHALL mark both `a` and `b` with `loaded: false, error: "cycle: a→b→a"` (or the equivalent rotation) and SHALL skip both server entries; other discovered plugins SHALL load normally.

### Requirement: The loader SHALL skip plugins whose dependencies are missing or disabled

When loading server entries, the loader SHALL evaluate each plugin's `dependsOn` against the current enabled set. If any dependency is either absent from discovery OR disabled in config, the loader SHALL:

- record `loaded: false`, `error: "missing/disabled dep: <id>[, <id>...]"`, and `missingDeps: string[]` in the plugin status store,
- skip the plugin's server entry import.

The loader SHALL process plugins in a topologically-sorted order (deps before dependents). Within one topological tier, the existing priority key (ascending priority, ties broken by id) SHALL be the secondary order.

#### Scenario: Plugin with disabled dependency is not loaded

- **WHEN** plugin `b` declares `dependsOn: ["a"]`, both are discovered, `a` is disabled in config
- **THEN** the loader SHALL skip `b`'s server entry and SHALL set `b`'s status to `{ enabled: true, loaded: false, error: "missing/disabled dep: a", missingDeps: ["a"], ... }`.

#### Scenario: Plugin with missing dependency is not loaded

- **WHEN** plugin `b` declares `dependsOn: ["nonexistent"]`
- **THEN** the loader SHALL set `b`'s status to `{ enabled: true, loaded: false, error: "missing/disabled dep: nonexistent", missingDeps: ["nonexistent"], ... }`.

### Requirement: `POST /api/plugins/:id/toggle` SHALL honour the dependency graph

The toggle endpoint SHALL apply `computeToggleImpact(graph, id, target)` (from `dashboard-plugin-runtime`) to the discovered set + current config enabled state:

- When `enabled: true` is requested AND `impact.blockers.length > 0`, the endpoint SHALL return 409 with body `{ success: false, reason: "blockers", blockers: string[] }` and SHALL NOT modify config.
- When `enabled: true` is requested AND `impact.cascadeEnable.length > 0`, the endpoint SHALL set every cascaded id's `enabled = true` in the SAME config write as the target, broadcast `plugin_config_update` once per affected id, and return 200 `{ success: true, restartRequired: true, cascade: { enable: string[] } }`.
- When `enabled: false` is requested AND `impact.cascadeDisable.length > 0`, the endpoint SHALL set every cascaded id's `enabled = false` in the SAME config write as the target, broadcast `plugin_config_update` once per affected id, and return 200 `{ success: true, restartRequired: true, cascade: { disable: string[] } }`.
- When no cascade is needed, the endpoint SHALL behave as before and return 200 `{ success: true, restartRequired: true }`.

#### Scenario: Enabling a plugin with a missing dep returns 409

- **WHEN** plugin `b` declares `dependsOn: ["a"]`, `a` is not in the discovered set, and a request is made with `{ enabled: true }` for `b`
- **THEN** the server SHALL return 409 with body `{ success: false, reason: "blockers", blockers: ["a"] }` and SHALL NOT modify config.

#### Scenario: Cascade enable writes both ids atomically

- **WHEN** plugin `b` declares `dependsOn: ["a"]`, both are disabled, and a request is made with `{ enabled: true }` for `b`
- **THEN** the server SHALL set both `plugins.a.enabled = true` and `plugins.b.enabled = true` in a single config write, broadcast `plugin_config_update` once for each of `a` and `b`, and SHALL return 200 with `cascade.enable: ["a"]`.

#### Scenario: Cascade disable writes both ids atomically

- **WHEN** plugin `b` declares `dependsOn: ["a"]`, both are enabled, and a request is made with `{ enabled: false }` for `a`
- **THEN** the server SHALL set both `plugins.a.enabled = false` and `plugins.b.enabled = false` in a single config write and SHALL return 200 with `cascade.disable: ["b"]`.

### Requirement: `GET /api/plugins` SHALL include computed `dependents` per row

For every row in the response, the server SHALL include:

- `dependsOn: string[]` — verbatim from the manifest (empty when absent),
- `dependents: string[]` — the set of plugin ids that transitively depend on this row, computed by inverting the discovered graph.

#### Scenario: Computed dependents populated

- **WHEN** plugin `b` declares `dependsOn: ["a"]` and both are discovered
- **THEN** `GET /api/plugins` SHALL return the `a` row with `dependents: ["b"]` and the `b` row with `dependsOn: ["a"]`, `dependents: []`.

### Requirement: PluginStatus SHALL include a manifest-derived display name

`PluginStatus` SHALL include `displayName: string`, populated by the loader from `manifest.displayName`. The plugin status store SHALL accept the field and `/api/health.plugins[]` SHALL expose it.

#### Scenario: Status payload includes displayName

- **WHEN** plugin `demo` declares `displayName: "Demo Plugin"` in its manifest
- **THEN** `/api/health.plugins[]` SHALL include an entry whose `id = "demo"` and `displayName = "Demo Plugin"`.

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

### Requirement: Plugin-contributed `settings-section` claims SHALL render ONLY under the owning plugin's row

Every `settings-section` claim SHALL be rendered on the owning plugin's dedicated settings page at `/settings/plugins/<pluginId>`. No other `SettingsPanel` page SHALL render plugin-contributed `settings-section` content.

`SettingsPanel.tsx` SHALL NOT import or render `SettingsSectionSlot` from `dashboard-plugin-runtime`. The legacy `<SettingsSectionSlot tab="..." />` invocations previously fired from every settings page SHALL be removed. `SettingsSectionByPluginSlot` SHALL be the only consumer of `settings-section` claims.

A `settings-section` claim MAY carry an optional `nav` hint `{ group: string, label: string, description?: string, order?: number }` asking the host to PROMOTE the owning plugin's page into a settings nav group. The hint SHALL change only where the page's nav entry appears and which chrome variant it gets; the page SHALL still render at `/settings/plugins/<pluginId>` and nowhere else. An invalid `nav` SHALL NOT fail manifest validation (a placement hint must never unload a plugin): the validator SHALL DROP the hint from the normalised claim, emit a warning on the server log naming the plugin id, claim index and offending field, and load the plugin normally. A hint is invalid when it is not a plain object (including `null` and arrays); `label` or `group` is missing, non-string, or empty after trimming; `description` is present and non-string; `label` exceeds 40 or `description` exceeds 200 characters after normalisation; `label` or `description` contains any Unicode control (Cc) or format (Cf) character — covering bidi overrides, zero-width and directional marks, and BOM; or `order` is present and not a finite number. Valid `group`/`label`/`description` SHALL be stored NFKC-normalised and trimmed; a `description` that is empty after trimming SHALL be dropped on its own, keeping the rest of the hint. `nav` on a claim whose slot is not `settings-section` SHALL be dropped without a warning. An unknown `group` value SHALL be accepted (forward-compat) and left to the host to ignore. Whether a hint is honoured (group allowlist, plugin trust) is decided by the host (see settings-panel "Models nav group"), not the validator. `GET /api/plugins` SHALL include the validated `nav` on each projected claim, and a boolean `firstParty` on each row (true iff the plugin's npm package name is in the `@blackbelt-technology/` scope). `nav.label` and `nav.description` SHALL render as plain text, never as markup.

The `claim.tab` field SHALL remain accepted by the manifest validator (preserving backwards-compat for existing manifests) but SHALL be inert at runtime — no consumer SHALL read it, and no value of `tab` SHALL be rejected. The validator SHALL NOT emit any warning when `tab` is present.

`SettingsSectionByPluginSlot` SHALL render BOTH refs-registry claims AND intent broadcasts for `settings-section`, filtered to the owning plugin id, so intent-driven and JSON-Schema-descriptor contributions continue to render after `SettingsSectionSlot` stops consuming the slot.

The plugin's settings page SHALL render host-owned chrome above the plugin's own contribution: display name, plugin id, a status pill only when the plugin is not healthy, an enable switch labelled "Enabled", declared dependencies (`dependsOn`, `dependents`), plus any load error and unsatisfied requirements. Claimed slot ids SHALL render only when the Developer "Show plugin internals" preference is on, inside a collapsed "Plugin internals" disclosure. Status pill words SHALL be human: "Off" (disabled), "Not loaded", "Needs setup" (unsatisfied requirements), "Failed to load" (error), "Status unknown" (none reported). Chrome SHALL be limited to fields `GET /api/plugins` returns; it SHALL NOT require `version`, `description`, `source`, or `icon`, which the plugin row does not carry. The plugin's `settings-section` contributions SHALL be rendered beneath that chrome, ordered by the slot registry's existing comparator (ascending `priority`, default 1000, tie-broken by `pluginId` lexicographic order). A plugin SHALL NOT be able to suppress, replace, or opt out of the host chrome.

For a PROMOTED plugin page the host SHALL render a COMPACT chrome variant instead: `nav.label` as the page title, `nav.description` (when present) as a lede, and a provenance line "Provided by the <displayName> plugin" (with Unicode Cc/Cf characters removed from `displayName` at render) carrying the "Enabled" switch and a disclosure that reveals the plugin id, declared dependencies (`dependsOn`) and dependents; the disclosure SHALL list claimed slot ids only when the Developer "Show plugin internals" preference is on. The status pill SHALL render in the header (never inside the disclosure) only when the plugin is not healthy — `disabled`, `error`, `not loaded`, unknown status (none reported), or unsatisfied requirements — and SHALL be absent when the plugin is enabled, loaded and has every requirement met; load errors and missing-requirement banners SHALL render exactly as in the full chrome. The compact variant is selected by the host from the honoured promotion; the plugin still cannot suppress or replace it.

A plugin's row in the Plugins activation index SHALL display a settings affordance for every plugin. The affordance SHALL be clickable only when that plugin CONTRIBUTES SETTINGS — i.e. at least one `settings-section` refs claim is registered for its id OR a `settings-section` intent is present for it — and SHALL navigate to `/settings/plugins/<pluginId>`; otherwise the affordance SHALL be rendered disabled (reduced opacity, `cursor-not-allowed`, tooltip indicating no settings are available). The activation index SHALL NOT render plugin settings inline.

The settings page of a plugin that is installed but disabled SHALL still resolve. Because the slot-registry enabled-set filter removes a disabled plugin's claims from every consumer, that page SHALL render the host chrome, a notice that the plugin is disabled, and a re-enable affordance, and SHALL NOT render the plugin's settings body. A disabled plugin's settings component SHALL NOT be mounted.

#### Scenario: Plugin settings render on their plugin page only

- **WHEN** plugin `roles` declares a `settings-section` claim and is enabled
- **THEN** navigating to `/settings/plugins/roles` SHALL render the plugin's settings section component beneath the host chrome, and no other settings page SHALL render it

#### Scenario: `tab` field is inert

- **WHEN** plugin `roles` declares `{ slot: "settings-section", tab: "general", component: "RolesSettings" }` and is enabled
- **THEN** the validator SHALL accept the manifest without warning, the `RolesSettings` component SHALL render only on `/settings/plugins/roles`, and the General page SHALL NOT contain any plugin-contributed `settings-section` content

#### Scenario: Unknown `tab` value is accepted and ignored

- **WHEN** plugin `x` declares `{ slot: "settings-section", tab: "nonexistent" }`
- **THEN** manifest validation SHALL succeed, the plugin SHALL load normally, and its section SHALL render on `/settings/plugins/x`

#### Scenario: Disabled plugin page renders chrome without a body

- **WHEN** plugin `demo` declares `{ slot: "settings-section" }` but is disabled in config
- **THEN** `/settings/plugins/demo` SHALL render the host chrome with an "Off" status pill, a notice that the plugin is disabled, and a re-enable affordance
- **AND** the plugin's settings component SHALL NOT be mounted

#### Scenario: Disabling a plugin while its page is open collapses the body

- **WHEN** the user is on `/settings/plugins/flows` and disables the plugin
- **THEN** the enabled-set update SHALL remove the plugin's claims and the page SHALL replace the settings body with the disabled notice without a reload
- **AND** the host chrome SHALL remain rendered

#### Scenario: Intent-driven contribution renders on the plugin page

- **WHEN** a plugin broadcasts a `settings-section` intent rather than registering a refs-registry claim
- **THEN** `/settings/plugins/<pluginId>` SHALL render that contribution beneath the host chrome
- **AND** no other settings page SHALL render it

#### Scenario: Enabled-but-failed plugin page is reachable

- **WHEN** plugin `automation` is enabled and its status is `{ loaded: false, error: "Bridge path conflict: ..." }`
- **THEN** `/settings/plugins/automation` SHALL render the host chrome with a "Failed to load" status pill and the full error text in a copy-on-click block

#### Scenario: SettingsPanel does not import SettingsSectionSlot

- **WHEN** the repo-lint test reads `packages/client/src/components/settings/SettingsPanel.tsx`
- **THEN** the file SHALL NOT contain the string `SettingsSectionSlot`

#### Scenario: Activation index does not render settings inline

- **WHEN** the user opens `/settings/plugins` and clicks the settings affordance on the `roles` row
- **THEN** the client SHALL navigate to `/settings/plugins/roles`
- **AND** no `settings-section` content SHALL be rendered inside the activation list itself

#### Scenario: Valid nav hint is accepted and projected
- **WHEN** plugin `roles` declares `{ slot: "settings-section", component: "BuiltInRolesSettings", nav: { group: "models", label: "Model roles", description: "Pick which model answers each @role." } }`
- **THEN** manifest validation SHALL succeed
- **AND** the plugin's row from `GET /api/plugins` SHALL carry that `nav` on its `settings-section` claim

#### Scenario: Malformed nav hint is dropped, plugin still loads
- **WHEN** a plugin declares `nav: { group: "models", label: "   " }`, `nav: "models"`, `nav: null`, `nav: []`, or a 41-character label
- **THEN** manifest validation SHALL succeed and the plugin SHALL load with all its other claims
- **AND** the normalised claim SHALL carry no `nav`, and one warning SHALL name the plugin id, claim index and field

#### Scenario: Control characters invalidate the hint
- **WHEN** a plugin declares `nav.label` containing U+202E, U+200E, U+200B or a newline
- **THEN** the hint SHALL be dropped with a warning and the plugin SHALL load normally

#### Scenario: Blank description is dropped alone
- **WHEN** a plugin declares `nav: { group: "models", label: "Model roles", description: "  " }`
- **THEN** the normalised claim SHALL carry `nav: { group: "models", label: "Model roles" }` and the plugin SHALL still be promoted

#### Scenario: Unknown nav group is accepted
- **WHEN** a plugin declares `nav: { group: "future-group", label: "X" }`
- **THEN** manifest validation SHALL succeed and the plugin SHALL load normally

#### Scenario: Promoted page renders compact chrome
- **WHEN** `roles` is promoted and healthy and the user opens `/settings/plugins/roles`
- **THEN** the page title SHALL be `Model roles` with the `nav.description` lede
- **AND** a "Provided by the Roles plugin" line SHALL carry the "Enabled" switch
- **AND** no status pill SHALL render, and the plugin id, dependencies and dependents SHALL be visible only after the details disclosure is opened
- **AND** the claimed-slot list SHALL appear in that disclosure only when the Developer "Show plugin internals" preference is on

#### Scenario: Disabled promoted page shows the disabled pill
- **WHEN** `roles` is promoted and disabled and the user opens `/settings/plugins/roles`
- **THEN** the compact chrome SHALL show an "Off" status pill, the disabled notice and a re-enable affordance
- **AND** the plugin's settings component SHALL NOT be mounted

#### Scenario: Promoted page surfaces a load error
- **WHEN** `roles` is promoted, enabled, and its status is `{ loaded: false, error: "..." }`
- **THEN** the compact chrome SHALL show a "Failed to load" status pill and the full error text in a copy-on-click block

#### Scenario: Nav label is rendered as text
- **WHEN** a first-party plugin declares `nav.label` containing `<b>x</b>`
- **THEN** the rail and page title SHALL display the literal characters, not bold markup

#### Scenario: Full chrome hides slot ids by default
- **WHEN** the Developer "Show plugin internals" preference is off and the user opens `/settings/plugins/quota`
- **THEN** the full chrome SHALL show the plugin id and dependencies
- **AND** no claimed slot id SHALL be visible

### Requirement: Plugin manifests SHALL support an optional `requires` field for declarative requirements

The `PluginManifest` type SHALL accept an optional `requires?: PluginRequirements` field, where `PluginRequirements` declares three optional string arrays: `piExtensions` (pi extension package identifiers), `binaries` (executables that must resolve on PATH), and `services` (named service probes from a closed built-in registry). The manifest validator SHALL reject duplicate, empty, or whitespace-only entries in any of the three arrays.

The closed built-in service-probe registry SHALL ship with exactly one entry: `model-proxy`. It SHALL be satisfied iff the dashboard's own model proxy routes were mounted at server boot (`modelProxy.enabled` as read at startup — the same boot-frozen value that gates `/v1/*` registration; a config change after boot takes effect at restart, for the probe and the routes alike); it SHALL NOT perform network I/O and SHALL NOT probe the upstream `@blackbelt-technology/pi-model-proxy` extension. The former name `pi-model-proxy` is NOT an alias and SHALL be reported as an unknown service name. Plugins SHALL NOT register additional service-probe names.

#### Scenario: Valid requires field accepted

- **WHEN** a plugin declares `requires: { piExtensions: ["@blackbelt-technology/pi-dashboard-subagents"], services: ["model-proxy"] }`
- **THEN** the validator SHALL accept the manifest.

#### Scenario: Empty string entries rejected

- **WHEN** a plugin declares `requires: { binaries: [""] }`
- **THEN** the validator SHALL throw `ManifestValidationError`.

#### Scenario: model-proxy service satisfied by dashboard config
- **WHEN** a plugin declares `requires: { services: ["model-proxy"] }` and the server booted with `modelProxy.enabled: true`
- **THEN** the probe runtime SHALL record `{ name: "model-proxy", satisfied: true }` without issuing any HTTP request.

#### Scenario: model-proxy probe never reports unwired in a running server
- **WHEN** a plugin manifest or a recommended-extensions entry declares `requires: { services: ["model-proxy"] }` and its requirements are read via `GET /api/health` (plugin `requirements`), the post-install refresh, or `GET /api/packages/recommended`
- **THEN** the recorded service entry SHALL be `satisfied: true` or `satisfied: false` with a proxy-state reason; it SHALL NOT carry `error: "probe not wired"`.

#### Scenario: model-proxy service unsatisfied when disabled
- **WHEN** a plugin declares `requires: { services: ["model-proxy"] }` and the server booted with `modelProxy.enabled: false`
- **THEN** the probe runtime SHALL record `{ name: "model-proxy", satisfied: false, error: <reason> }` and `missingRequirements` SHALL include `"model-proxy"`.

#### Scenario: Unknown service name rejected at probe time but not at validate time

- **WHEN** a plugin declares `requires: { services: ["unknown-service"] }` and that name is not registered in the built-in service-probe registry
- **THEN** the validator SHALL accept the manifest (string shape is valid), and the probe runtime SHALL record the service as `{ name: "unknown-service", satisfied: false, error: "unknown service name" }`.

### Requirement: The loader SHALL run requirement probes for every discovered plugin

After loading server entries, the loader SHALL invoke `runRequirementProbes(manifest)` for each discovered plugin (including plugins whose server entry failed to load and including plugins disabled in config). The probe result SHALL be written to the plugin status store as `requirements: PluginRequirementReport` plus a flat `missingRequirements: string[]` listing every unsatisfied requirement name.

The loader SHALL NOT block on probe outcome. Probe execution SHALL NOT affect whether `status.loaded` is set to `true`.

The `piExtensions` satisfaction check (`installedMatchesName`) SHALL determine whether a required pi extension is installed by delegating its source comparison to the canonical `sourcesMatch` predicate (capability `package-source-matching`). Consequently a required pi extension that is installed from a git URL or a local path (source kind `git` or `raw`) SHALL be reported as satisfied when it refers to the same package as the manifest-declared requirement name, even though the requirement name is an npm-style identifier.

Probe results SHALL be refreshed:

- once at server start, after `loadServerEntries`,
- on every successful `package_operation_complete` broadcast (a package operation may have changed requirement satisfaction),
- on demand when `/api/health` is fetched and the cached report is older than 30 seconds.

When any plugin's `missingRequirements` changes between two consecutive refreshes, the server SHALL broadcast `plugin_config_update` for the affected id.

#### Scenario: Probe report populated on first boot

- **WHEN** plugin `subagents` declares `requires: { piExtensions: ["@blackbelt-technology/pi-dashboard-subagents"] }` and `@blackbelt-technology/pi-dashboard-subagents` is installed in pi
- **THEN** after server start `/api/health.plugins[]` SHALL include `subagents` with `requirements.piExtensions = [{ name: "@blackbelt-technology/pi-dashboard-subagents", satisfied: true }]` and `missingRequirements = []`.

#### Scenario: Missing requirement surfaces in the status

- **WHEN** plugin `subagents` declares `requires: { piExtensions: ["@blackbelt-technology/pi-dashboard-subagents"] }` and `@blackbelt-technology/pi-dashboard-subagents` is NOT installed in pi
- **THEN** `/api/health.plugins[]` SHALL include `subagents` with `requirements.piExtensions = [{ name: "@blackbelt-technology/pi-dashboard-subagents", satisfied: false }]` and `missingRequirements = ["@blackbelt-technology/pi-dashboard-subagents"]`. The plugin's `loaded` field SHALL remain `true` and routes SHALL still register.

#### Scenario: piExtension installed from a local build satisfies the requirement

- **WHEN** plugin `subagents` declares `requires: { piExtensions: ["@blackbelt-technology/pi-dashboard-subagents"] }` and the extension is installed globally from a local build with source `"/home/dev/pi-dashboard-subagents"`
- **THEN** the probe SHALL report `requirements.piExtensions = [{ name: "@blackbelt-technology/pi-dashboard-subagents", satisfied: true }]` and `missingRequirements = []`

#### Scenario: Successful install refreshes probes and broadcasts

- **WHEN** a `POST /api/packages/install` for `@blackbelt-technology/pi-dashboard-subagents` completes successfully and `subagents` previously reported `missingRequirements = ["@blackbelt-technology/pi-dashboard-subagents"]`
- **THEN** the `package_operation_complete` listener SHALL trigger a probe refresh, the new report SHALL show `missingRequirements = []` for `subagents`, and the server SHALL broadcast `plugin_config_update` with `id = "subagents"`.

#### Scenario: Binary probe resolves via the tool registry

- **WHEN** plugin `demo` declares `requires: { binaries: ["gh"] }` and `gh` resolves on PATH via `ToolRegistry`
- **THEN** the probe SHALL report `{ name: "gh", satisfied: true, resolvedPath: "<absolute-path>" }`.

### Requirement: The Subagents plugin SHALL NOT hard-depend on the Roles plugin

The Subagents plugin manifest SHALL NOT declare `roles` in its `dependsOn` array. The bundled Explore agent's `@fast` model alias SHALL be resolved at spawn time via the standalone `role:resolve-model` event (capability `dashboard-roles-ownership`); when the role is unconfigured, resolution degrades to a structured "not configured yet" error rather than the Subagents plugin failing to load. An empty or disabled Roles plugin SHALL NOT cascade-disable or block loading of the Subagents plugin.

#### Scenario: Subagents loads with Roles empty

- **GIVEN** the Roles plugin is enabled but no role has an assigned model
- **WHEN** the loader processes the Subagents plugin
- **THEN** Subagents SHALL load (`loaded: true`) and its claims SHALL register
- **AND** the loader SHALL NOT record a `missingDeps` entry for `roles` on the Subagents status

#### Scenario: Subagents loads with Roles disabled

- **GIVEN** the Roles plugin is disabled in config
- **WHEN** the loader processes the Subagents plugin
- **THEN** Subagents SHALL still load (`loaded: true`); disabling Roles SHALL NOT cascade-disable Subagents

#### Scenario: Unconfigured `@fast` degrades, does not crash

- **GIVEN** Subagents is loaded and the `fast` role has no assigned model
- **WHEN** the bundled Explore agent is spawned with `model: "@fast"`
- **THEN** the `role:resolve-model` probe SHALL return with `probe.resolved` unset and `probe.reason` naming `fast` as not configured yet, and the harness SHALL surface that reason as a spawn-time error

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

### Requirement: PluginStatus SHALL include requirements and missingRequirements

`PluginStatus` SHALL include optional `requirements?: PluginRequirementReport` and `missingRequirements?: string[]`. The plugin status store SHALL accept and emit both fields. The `/api/health.plugins[]` payload SHALL expose them.

`PluginRequirementReport` SHALL include three arrays: `piExtensions: { name: string; satisfied: boolean }[]`, `binaries: { name: string; satisfied: boolean; resolvedPath?: string }[]`, `services: { name: string; satisfied: boolean; error?: string }[]`.

The flat `missingRequirements` SHALL list the `name` of every unsatisfied entry across all three categories. When every requirement is satisfied or the plugin declares no `requires`, `missingRequirements` SHALL be `[]` (not undefined).

#### Scenario: Mixed-satisfaction report

- **WHEN** plugin `subagents` declares `requires: { piExtensions: ["@blackbelt-technology/pi-dashboard-subagents"], services: ["model-proxy"] }`, `@blackbelt-technology/pi-dashboard-subagents` is installed, and the dashboard model proxy is disabled
- **THEN** `/api/health.plugins[]` SHALL include `subagents` with `requirements.piExtensions = [{ name: "@blackbelt-technology/pi-dashboard-subagents", satisfied: true }]`, `requirements.services = [{ name: "model-proxy", satisfied: false, error: <reason> }]`, and `missingRequirements = ["model-proxy"]`.

### Requirement: `RecommendedExtension` SHALL support a companion-plugin field

The `RecommendedExtension` type in `packages/shared/src/recommended-extensions.ts` SHALL accept an optional `dashboardPlugin?: string` naming the companion dashboard plugin id. The recommended-extensions enricher in `packages/server/src/routes/recommended-routes.ts` SHALL propagate the field and additionally compute `dashboardPluginInstalled: boolean` by looking the id up in the plugin status store.

The shipped `RECOMMENDED_EXTENSIONS` const SHALL set `dashboardPlugin: "subagents"` on the `@blackbelt-technology/pi-dashboard-subagents` entry.

#### Scenario: subagents extension carries dashboardPlugin field

- **WHEN** a client fetches `GET /api/packages/recommended`
- **THEN** the entry with `id: "@blackbelt-technology/pi-dashboard-subagents"` SHALL include `dashboardPlugin: "subagents"`.

#### Scenario: Enricher reports companion-plugin install state

- **WHEN** `@blackbelt-technology/pi-dashboard-subagents` is queried and the `subagents` plugin is present in the plugin status store
- **THEN** the enriched entry SHALL include `dashboardPluginInstalled: true`; when `subagents` is not present, it SHALL include `dashboardPluginInstalled: false`.

### Requirement: The Plugins tab SHALL surface missing requirements with one-click install via the existing installer

For each plugin row in the Plugins tab whose `missingRequirements` is non-empty, the UI SHALL render a warning pill per missing requirement. For unsatisfied `piExtensions` requirements where the missing name matches a `RECOMMENDED_EXTENSIONS.id`, the UI SHALL render an inline `[Install]` button that invokes the existing `usePackageOperations("global").install(source)` with the matching entry's `source` string.

The change SHALL NOT introduce a new install endpoint, a new install hook, or any new browser-protocol message. Plugin requirement installs ride exclusively on the existing `POST /api/packages/install` and the existing `package_progress` / `package_operation_complete` listeners.

For unsatisfied requirements with no matching recommended-extensions entry, the UI SHALL render a `[Install via Packages tab]` link pointing at `/settings?tab=packages`.

#### Scenario: Missing subagents extension renders inline Install button

- **WHEN** plugin `subagents` reports `missingRequirements = ["@blackbelt-technology/pi-dashboard-subagents"]` and `RECOMMENDED_EXTENSIONS` contains an entry with `id: "@blackbelt-technology/pi-dashboard-subagents"` and `source: "npm:@blackbelt-technology/pi-dashboard-subagents"`
- **THEN** the `subagents` row in the Plugins tab SHALL render a warning pill and an inline `[Install]` button; clicking the button SHALL invoke `usePackageOperations("global").install("npm:@blackbelt-technology/pi-dashboard-subagents")`.

#### Scenario: Missing requirement without a recommended-extensions match falls back to a link

- **WHEN** plugin `foo` reports `missingRequirements = ["bar-extension"]` and no `RECOMMENDED_EXTENSIONS` entry has `id: "bar-extension"`
- **THEN** the row SHALL render `[Install via Packages tab]` linking to `/settings?tab=packages` and SHALL NOT render an inline `[Install]` button.

#### Scenario: No new browser-protocol message types are introduced

- **WHEN** the build runs the protocol-completeness test
- **THEN** the `ServerToBrowserMessage` union in `packages/shared/src/browser-protocol.ts` SHALL NOT contain any new variant added by this change; plugin toggles ride on the existing `plugin_config_update` and requirement installs ride on the existing `package_progress` / `package_operation_complete`.

### Requirement: Cross-plugin service seam

`ServerPluginContext` SHALL expose `provide(name: string, value: unknown): void` and `consume<T = unknown>(name: string): T | undefined`, backed by a single host-owned registry shared across all plugins in the process. `provide` SHALL store the value under `name` (last write wins) and SHALL record the calling plugin as that key's provider. `consume` SHALL return the value previously provided under `name`, or `undefined` when none exists. The seam SHALL be in-process only; values SHALL NOT cross the bridge.

For a key of the form `automation.action.<source>`, the provider plugin id MUST equal `<source>`. A `provide` for such a key whose calling plugin id differs from `<source>` SHALL be refused: the value SHALL NOT be stored, any existing value under that key SHALL be left unchanged, and the host SHALL log a warning naming the calling plugin and the key. The `<source>` is the first segment after `automation.action.`; an empty source SHALL be refused as malformed. A refused `provide` SHALL return normally after logging; it SHALL NOT throw. This prevents one plugin from spoofing or overwriting another plugin's action contributions. Host-set entries are exempt.

The loader's existing topological load order (by `manifest.dependsOn`) SHALL guarantee that a provider plugin's `registerPlugin` runs before any plugin that declares it in `dependsOn`, so a dependent's `consume` observes the provided value.

#### Scenario: Consumer observes provider's value

- **WHEN** plugin A calls `ctx.provide("automation.action-registry", registry)` in `registerPlugin`, and plugin B declares `dependsOn: ["A"]` and calls `ctx.consume("automation.action-registry")`
- **THEN** B SHALL receive the same registry instance A provided.

#### Scenario: Missing provider degrades gracefully

- **WHEN** a plugin calls `ctx.consume("absent-service")` and nothing was provided under that name
- **THEN** `consume` SHALL return `undefined` and SHALL NOT throw.

#### Scenario: Action key spoof is refused
- **WHEN** plugin `evil` calls `provide("automation.action.flows", x)` while plugin `flows` has already provided that key
- **THEN** the call SHALL be refused and logged, `consume("automation.action.flows")` SHALL still return the `flows` value, and `consumeAll` SHALL NOT list a `provider: "evil"` entry for it

#### Scenario: Refused provide returns silently
- **WHEN** a refused `provide` for an `automation.action.*` key is made
- **THEN** the call SHALL return without throwing, after logging the warning

#### Scenario: Empty source is refused
- **WHEN** a plugin calls `provide("automation.action.", x)`
- **THEN** the call SHALL be refused as malformed and nothing SHALL be stored

#### Scenario: Matching source segment is accepted
- **WHEN** plugin `flows` calls `provide("automation.action.flows", x)`
- **THEN** the value SHALL be stored with provider `flows`

### Requirement: plugin_action dispatches by pluginId fan-out

The server's browser-gateway SHALL route a `plugin_action` message to the handler
registered by the plugin whose id matches `message.pluginId`, so multiple plugins
can service `plugin_action` concurrently without one shadowing another.

#### Scenario: Two plugins register plugin_action, both reachable

- **GIVEN** `flows-plugin` and `goal-plugin` each register a `plugin_action`
  handler
- **WHEN** a `plugin_action` with `pluginId:"flows"` arrives, then one with
  `pluginId:"goal"` arrives
- **THEN** each SHALL be delivered to its own plugin's handler, regardless of
  plugin load order

#### Scenario: Unknown pluginId errors, never silent-drops

- **WHEN** a `plugin_action` arrives with a `pluginId` that has no registered
  handler
- **THEN** the gateway SHALL surface a structured "no handler for pluginId" error
  to the sender and SHALL NOT silently discard the message

### Requirement: flows, kb, and automation expose working plugin_action handlers

`flows-plugin`, `kb-plugin`, and `automation-plugin` SHALL each register a
production `plugin_action` handler that dispatches to its existing server core.

#### Scenario: flows plugin_action runs a flow

- **WHEN** a `plugin_action` with `pluginId:"flows"`, `action:"flow.run"` and a
  valid payload arrives
- **THEN** flows-plugin SHALL invoke its flow-run path (not a logging stub) and
  report the outcome

#### Scenario: kb and automation mutations reach their cores

- **WHEN** a `plugin_action` targets `kb` (e.g. reindex) or `automation` (e.g. run)
  with a valid payload
- **THEN** the respective plugin SHALL execute the operation through its existing
  server core and return a result

### Requirement: `ServerPluginContext` exposes the in-process model runtime

`ServerPluginContext` SHALL expose an optional `modelRuntime` accessor so a plugin `server` entry
can run model completions through the same in-process seam the dashboard uses internally, without
a loopback HTTP hop to the model proxy:

```ts
modelRuntime?: {
  getModelRegistry(): Promise<LlmModelRegistry | null>;
  streamSimple: LlmStreamFn;
};
```

It SHALL resolve credentials via the shared OAuth/api_key-aware registry (auth.json +
providers.json), identical to the seam `server.ts` passes to core routes today. When the model
proxy is unavailable the accessor SHALL be absent (or resolve null), and the plugin SHALL degrade
gracefully (the same "backend unavailable" path core uses).

#### Scenario: Server-entry plugin runs a completion in-process

- **WHEN** a plugin `server` entry calls `ctx.modelRuntime.getModelRegistry()` then
  `ctx.modelRuntime.streamSimple({ model, messages, … })`
- **THEN** the completion SHALL stream through the dashboard's in-process runtime with
  server-resolved credentials
- **AND** it SHALL NOT require the plugin to call `/v1/chat/completions` over the network

#### Scenario: Model runtime unavailable

- **WHEN** the model proxy/registry is not resolvable
- **THEN** `ctx.modelRuntime` SHALL be absent (or `getModelRegistry()` resolves null)
- **AND** the plugin SHALL surface a degraded/unconfigured state rather than throwing at load

### Requirement: `PluginRequirements` SHALL support a filesystem-path category

`PluginRequirements` SHALL accept an optional `paths?: string[]` category alongside `piExtensions`, `binaries`, and `services`. It expresses dependencies that exist at a known absolute location but do not resolve on `PATH` — for example a CLI bundled inside a macOS `.app`, or a platform binary under a fixed install prefix. `PluginRequirementReport` SHALL gain a matching `paths: { name: string; satisfied: boolean }[]` field.

#### Scenario: Declared path that exists is satisfied

- **WHEN** a plugin declares `requires: { paths: ["/Applications/Example.app/Contents/MacOS/example"] }` and that file exists
- **THEN** the probe report's `paths` array contains that name with `satisfied: true`

#### Scenario: Declared path that is absent is unsatisfied

- **WHEN** a plugin declares a `paths` requirement for a file that does not exist
- **THEN** the probe report's `paths` array contains that name with `satisfied: false`
- **AND** the name appears in the plugin's flattened `missingRequirements`

#### Scenario: Path probe does not execute the target

- **WHEN** the runtime probes a `paths` requirement
- **THEN** it performs an existence check only
- **AND** it does not execute, spawn, or read the contents of the target file

#### Scenario: Declared path is treated as untrusted manifest input

- **WHEN** a plugin declares a `paths` requirement whose value contains shell metacharacters
- **THEN** the value is never interpolated into a shell command and no shell is invoked
- **AND** the probe treats it as an opaque filesystem path

#### Scenario: Legitimate paths containing spaces are not rejected

- **WHEN** a plugin declares a `paths` requirement for an existing file whose absolute path contains spaces
- **THEN** the probe reports it satisfied
- **AND** the value is not rejected by any character denylist

#### Scenario: Non-absolute path is unsatisfied

- **WHEN** a plugin declares a `paths` requirement that is not an absolute path
- **THEN** the probe reports it unsatisfied rather than resolving it relative to any working directory

### Requirement: `paths` entries SHALL support plugin-config interpolation

A `paths` entry MAY contain a single `${<configKey>}` placeholder resolved from the declaring plugin's own validated configuration before probing. This lets one declaration track an operator-configured location, so the requirement pill and the plugin's own status cannot disagree about the same host. Resolution is a configuration read and SHALL NOT invoke a shell.

#### Scenario: Placeholder resolves from plugin config

- **WHEN** a plugin declares `paths: ["${examplePath}"]` and its validated config sets `examplePath` to an existing absolute path
- **THEN** the probe reports the requirement satisfied

#### Scenario: Default config value behaves as a literal

- **WHEN** the declaring plugin's config leaves the referenced key at its schema default
- **THEN** the probe resolves the default and behaves exactly as an equivalent literal declaration would

#### Scenario: Unresolvable placeholder is unsatisfied, not an error

- **WHEN** a `paths` entry references a config key absent from the plugin's schema, or resolving to a non-absolute value
- **THEN** the probe reports the requirement unsatisfied
- **AND** the loader does not throw and the remaining requirement categories are still probed

### Requirement: The `paths` category SHALL be backward compatible

Existing manifests that declare no `paths` SHALL behave exactly as before the category was introduced. The category is additive and optional.

#### Scenario: Manifest without paths is unaffected

- **WHEN** a plugin declares `requires` with only `piExtensions` and `binaries`
- **THEN** its probe report's `paths` array is empty
- **AND** its `missingRequirements` contents and ordering are identical to the pre-existing behaviour

#### Scenario: Plugin with no requires at all is unaffected

- **WHEN** a plugin declares no `requires` field
- **THEN** the loader reports `missingRequirements` as an empty array as before

### Requirement: Missing `paths` requirements SHALL surface in the activation UI

Unsatisfied `paths` requirements SHALL flow through the same `PluginStatus.requirements` / `missingRequirements` channel as the other categories. The activation UI SHALL render the new category alongside the three existing ones; because the client derives its rendered lists per category rather than from the flattened `missingRequirements`, this requires a corresponding client change and is NOT satisfied by the server-side plumbing alone.

#### Scenario: Unsatisfied path renders a warning pill

- **WHEN** a plugin row has an unsatisfied `paths` requirement
- **THEN** the Plugins tab renders a warning pill naming that requirement
- **AND** the missing-requirements block is not rendered empty, which is what would occur if the client derived its rendered lists from only the three pre-existing categories

#### Scenario: Path requirements offer no one-click install

- **WHEN** a plugin row has an unsatisfied `paths` requirement
- **THEN** no inline `[Install]` button is rendered for it, because a filesystem path has no package source to install from
- **AND** the existing non-package fallback affordance is rendered instead

### Requirement: Path probe results SHALL respect the existing probe cache

`paths` probes SHALL participate in the same per-plugin time-to-live cache as the other requirement categories.

#### Scenario: Repeated probes within the window reuse the cache

- **WHEN** a plugin's requirements are probed twice inside the cache window
- **THEN** the second call returns the cached report without re-checking the filesystem

### Requirement: `ServerPluginContext` exposes an installed-extension probe

`ServerPluginContext` SHALL expose `isPiExtensionInstalled?(name: string): Promise<boolean>`, answering whether a pi extension is installed from the host's package registry (`packageManagerWrapper.listInstalled`, union of global and local scopes — deliberately a superset of the `piExtensions` probe's current global-only wiring), matched with the probe's `installedMatchesName` logic (id/name/displayName/source, including `sourcesMatch`). The capability SHALL be optional on the type so contexts constructed without it (older hosts, injected test contexts) remain valid.

#### Scenario: Registry union across scopes

- **WHEN** a plugin calls `isPiExtensionInstalled("pi-blackhole")`
- **THEN** the host SHALL answer from the union of `listInstalled("global")` and `listInstalled("local")`
- **AND** matching SHALL use the same `installedMatchesName` logic as the `piExtensions` requirement probe, not a weaker source-only comparison

#### Scenario: Answer is boolean-only and ungated

- **WHEN** any plugin, trusted or not, invokes the capability
- **THEN** it SHALL receive only a boolean
- **AND** no installed-package records SHALL be exposed through this capability

#### Scenario: A registry scan failure rejects rather than resolving false

- **WHEN** the underlying package-manager scan throws
- **THEN** the capability's promise SHALL reject
- **AND** SHALL NOT resolve `false`, which callers could not distinguish from an authoritative not-installed answer

#### Scenario: Answers are cached

- **WHEN** the capability is invoked repeatedly within the cache window
- **THEN** the host SHALL NOT re-run the package-manager scan on every call
- **AND** the cache duration SHALL be comparable to the requirement-probe cache (~30 s)
- **AND** only successful scans SHALL be cached — a rejection SHALL NOT occupy the cache, so a recovered registry answers on the next call

#### Scenario: Absent capability degrades, never throws

- **WHEN** a plugin runs against a context that does not provide the capability
- **THEN** reading the property SHALL yield `undefined` rather than throwing
- **AND** the calling plugin remains responsible for a fallback

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

### Requirement: Generic session-ownership seam on `ServerPluginContext`

`ServerPluginContext` SHALL expose a generic session-ownership seam so any plugin can stamp its own identity onto a session it spawns, without core naming the plugin. When a plugin spawns a session, it files an opaque `pluginRef` — a plugin-namespaced value core carries but never parses — plus an optional lifecycle declaration `{ recover?: boolean; finalizeOnSocketClose?: boolean; hidden?: boolean; archiveOnEnd?: boolean; close?: { idle?: { afterMs: number }; mode?: "sleep" | "archive" } }` (the `close` block is specified by capability `plugin-session-close-hook`). When the spawned session registers, the host resolves the ref and notifies the owning plugin.

Core SHALL NOT read the interior of `pluginRef`. Core SHALL make lifecycle decisions only from the declared `{ recover, finalizeOnSocketClose, hidden, archiveOnEnd, close }` values, never from the plugin's name, from any field inside `pluginRef`, or from the presence of an owner ref. Core MAY record the declaring plugin's id with a `close` declaration and use it only to route that plugin's session closer and to authorize that plugin's close requests; this routing is not a lifecycle decision and SHALL NOT read `pluginRef`.

The first-party features `automation` and `goal` SHALL each own their identity through this seam as ordinary contributions (built-ins are peers, not privileged): `automation` files `{ kind: "automation", automationRun: {...} }`, `goal` files `{ goalId }`. The emitted `.meta.json`, wire protocol, and `DashboardSession` field names and values SHALL be byte-identical to before this change, except that a session whose owner declares `recover: false` gains that single additive core-owned boolean (see the recovery requirement); user sessions never carry it and stay byte-identical.

`pluginRef` SHALL be boundary-validated on receipt, following the publish/collect doctrine's fail-open rule: core SHALL accept only a plain object, SHALL reject (drop + warn once, without throwing) a malformed ref, and SHALL NOT let a ref overwrite a reserved session field it does not own. A plugin's ref merges only the keys that plugin owns; it cannot set another plugin's `goalId`/`automationRun` or a core-reserved field.

#### Scenario: Trusted plugin ends a session like the Shutdown control

- **WHEN** a trusted plugin (manifest `priority <= 100`) calls `ctx.shutdownSession(sessionId)` for a known session
- **THEN** the host SHALL run the same shutdown the browser `shutdown` message and `POST /api/session/:id/shutdown` run, and resolve `true`
- **AND** an untrusted plugin, or an unknown session, SHALL get `false` with no effect

#### Scenario: Declared hidden keeps the session off the board

- **WHEN** a plugin spawns a session with `lifecycle: { hidden: true }` and the session registers via its spawn token
- **THEN** core SHALL set the session `hidden = true`, broadcast the update, and record the core-owned `pluginHidden` intent
- **AND** core SHALL NOT re-apply it on a later reattach, so the hide survives restarts without overriding an operator's choice

#### Scenario: Malformed ref is dropped fail-open

- **WHEN** a plugin files a non-object or otherwise malformed `pluginRef`
- **THEN** core SHALL drop it and warn once for that key, without throwing
- **AND** the session SHALL register with no owner ref rather than crashing the spawn

#### Scenario: Ref cannot overwrite a field it does not own

- **WHEN** a plugin files a ref containing a reserved key it does not own (e.g. another plugin's `goalId`)
- **THEN** core SHALL NOT apply that key to the session

#### Scenario: Plugin files an opaque ref and is notified on register

- **WHEN** a plugin spawns a session through the seam with a `pluginRef` and the session later registers
- **THEN** the owning plugin SHALL be notified with its own `pluginRef` and the resolved sessionId
- **AND** core SHALL NOT have parsed the interior of that `pluginRef`

#### Scenario: Two plugins own two sessions independently

- **WHEN** two different plugins each spawn a session with their own `pluginRef`
- **THEN** each plugin SHALL be notified only for its own session, with its own ref

#### Scenario: Emitted keys are unchanged

- **WHEN** `automation` files `{ kind: "automation", automationRun }` and `goal` files `{ goalId }` through the seam
- **THEN** the resulting `.meta.json` and `DashboardSession` SHALL carry the same `kind` / `automationRun` / `goalId` field names and values as before this change

#### Scenario: Close declaration routes only to its declaring plugin
- **WHEN** plugin A spawns a session with a `close` declaration and plugin B has registered a session closer
- **THEN** only plugin A's closer SHALL be consulted for that session
- **AND** core SHALL NOT read the session's `pluginRef` to decide this

### Requirement: Core lifecycle decisions read a generic flag, not the plugin name

Core lifecycle decisions SHALL be derived from a generic core-owned flag, never from a hardcoded `kind === "automation"` branch, never from the plugin's name, and never from reading or detecting an owner ref. Core SHALL contain no branch that names a specific plugin, and no branch that reads `pluginRef` or enumerates owner keys, to make a lifecycle decision.

**Recovery (cold start).** Recovery candidacy SHALL be governed by a single core-owned boolean `recover` on the session sidecar, defaulting to `true` when absent. `isRecoveryCandidate` SHALL read `meta.recover !== false`, replacing the `kind !== "automation"` guard. Core SHALL NOT read `pluginRef`, enumerate owner keys, or test for owner-ref presence to make this decision. A plugin that owns a session and does not want it replayed SHALL declare `recover: false`; core persists that resolved boolean onto the sidecar. Because the predicate already requires `live && status !== "ended"`, a session closed normally (not live / `ended`) is never a recovery candidate regardless of `recover`; the persisted `recover: false` only governs the crash window where an owned session is still `live && !ended`. User sessions never carry the field (absent ⇒ recoverable) and stay byte-identical; only an owned session that opts out gains the additive `recover: false` byte. Both first-party features `automation` and `goal` SHALL declare `recover: false` through this same generic field — neither is named in core, and their opt-out is symmetric.

**Socket-close finalization.** A session whose owner declares `finalizeOnSocketClose: true` SHALL be finalized on socket close; a session with no such declaration SHALL NOT be. Core reads the declared value, not the plugin name.

#### Scenario: Owned session in the crash window is not a recovery candidate

- **WHEN** cold-start recovery scans a still-`live`, non-`ended` session whose sidecar carries `recover: false`
- **THEN** `isRecoveryCandidate` SHALL return false for it
- **AND** the decision SHALL read only the core-owned `recover` flag, referencing no plugin name and no owner ref

#### Scenario: Both first-party features opt out through the same flag

- **WHEN** the `automation` and `goal` contributions are inspected
- **THEN** each SHALL declare `recover: false` through the same generic lifecycle field
- **AND** core SHALL treat both identically, naming neither

#### Scenario: Unowned session recovery is unchanged

- **WHEN** cold-start recovery scans a still-`live` session whose sidecar carries no `recover` field
- **THEN** `isRecoveryCandidate` SHALL treat it as `recover !== false` and return the same verdict it returned before this change

#### Scenario: finalizeOnSocketClose:true session finalizes on socket close

- **WHEN** a session whose owner ref declares `finalizeOnSocketClose: true` loses its socket
- **THEN** core SHALL run the finalization path
- **AND** a session that made no such declaration SHALL NOT be finalized on socket close

#### Scenario: No plugin name remains in a core lifecycle branch

- **WHEN** the core recovery and finalization paths are inspected
- **THEN** neither SHALL contain a literal `"automation"` (or any other plugin name) as a lifecycle condition

### Requirement: `automationRun` is removed from the generic plugin API surface

The generic plugin runtime surface (`ServerPluginContext` / `server-context.ts`) SHALL NOT expose an `automationRun` field. Automation-specific identity SHALL travel only inside `automation`'s own `pluginRef`, not on the shared context type every plugin sees.

#### Scenario: automationRun absent from the generic context type

- **WHEN** the `ServerPluginContext` surface is inspected
- **THEN** it SHALL NOT declare an `automationRun` field

### Requirement: Every shipped plugin loads from a published install

No plugin workspace SHALL depend on monorepo-only module resolution. CI SHALL
verify this dynamically: for each workspace whose `pi-dashboard-plugin`
manifest declares a `server` entry, pack the workspace, extract it outside the
repository, install its dependencies, and import the server entry under plain Node with the dashboard's Node-native
TypeScript loader (the same strip-only loader the server uses) and no
repository `tsconfig` reachable, so a plugin whose TypeScript is not erasable
fails here instead of at a user's server boot. The check SHALL assert `typeof mod.default === "function"`, the
same contract the loader enforces.

First-party workspace dependencies SHALL be installed from locally packed
tarballs, not resolved from the registry, so the verified graph is the working
tree. Registry resolution would test a stale published copy and would fail
spuriously on a release-prep PR whose versions are not yet published.

Workspaces whose manifest declares no `server` entry (for example the
`fixture: true` demo plugin) are out of scope for this check.

This check complements `scripts/verify-published-imports.mjs`, which remains
the static gate; it removes the need for that script's per-specifier waivers,
not the script itself.

#### Scenario: Plugin with a monorepo-only specifier fails CI
- **GIVEN** a plugin whose server entry imports a specifier resolvable only via repository `tsconfig` `paths`
- **WHEN** the install-load verification runs
- **THEN** it SHALL exit non-zero naming the plugin and the unresolvable specifier

#### Scenario: Working-tree runtime is the one under test
- **GIVEN** a PR that changes `dashboard-plugin-runtime`
- **WHEN** the install-load verification runs
- **THEN** the extracted plugin SHALL import the packed working-tree runtime, not a registry version

#### Scenario: Server-less plugin is skipped, not failed
- **GIVEN** a workspace whose `pi-dashboard-plugin` manifest declares no `server` entry
- **WHEN** the install-load verification runs
- **THEN** that workspace SHALL be skipped and reported as skipped

#### Scenario: Plugin with non-erasable TypeScript fails CI
- **GIVEN** a plugin whose server entry graph declares an `enum` or a constructor parameter property
- **WHEN** the install-load verification runs
- **THEN** it SHALL exit non-zero naming the plugin and the offending file

### Requirement: Clean-install QA boot proves plugins actually load

The `qa/` clean-install smoke SHALL install the dashboard AND at least one
plugin package into a clean prefix, then prove that plugin loaded. It SHALL
assert, in order:

1. discovery is non-empty and contains the installed plugin id — a clean
   prefix otherwise discovers zero plugins and every later assertion passes
   vacuously;
2. every discovered plugin is enabled in config before the asserted boot —
   plugins may declare `defaultEnabled: false`, so a boot that never attempts
   the broken plugin reports no failures. Since a config cannot be written
   before discovery has run, the smoke SHALL discover first (boot or probe)
   and assert on a subsequent boot;
3. no attempted plugin load failed. The assertion SHALL NOT be
   `loaded == discovered`: the loader legitimately reports `loaded: false`
   for unmet dependencies and unmet declared requirements, which a clean VM
   produces on healthy builds;
4. each loaded plugin's resolved path lies inside the install prefix, because
   discovery walks up from the loader module and can otherwise exercise a
   monorepo checkout present on the same host.

#### Scenario: Empty prefix cannot pass
- **GIVEN** a clean prefix with no plugin installed
- **WHEN** the smoke runs
- **THEN** it SHALL fail on the non-empty-discovery assertion

#### Scenario: Disabled-by-default plugin cannot hide a load failure
- **GIVEN** an installed plugin declaring `defaultEnabled: false` whose server entry is broken
- **WHEN** the smoke runs
- **THEN** it SHALL enable that plugin and SHALL fail

#### Scenario: Dependency-gated plugin does not fail the run
- **GIVEN** a plugin reported `loaded: false` for a missing dependency or unmet requirement
- **WHEN** the smoke evaluates results
- **THEN** that plugin SHALL NOT count as a failure

#### Scenario: Monorepo checkout cannot masquerade as the install
- **GIVEN** a monorepo checkout present on the host
- **WHEN** the smoke boots the installed dashboard
- **THEN** every loaded plugin path SHALL be inside the install prefix

### Requirement: Plugin server TypeScript must be erasable
A dashboard plugin's server entry and everything it imports from TypeScript source SHALL use only syntax accepted by Node's strip-only type stripping (no `enum`, runtime `namespace`, or constructor parameter properties) and SHALL import type-only symbols with `import type`, because the dashboard server loads it with the Node-native strip-only loader. A third-party plugin that violates this SHALL fail to load in isolation, per "Plugin failure does not crash the shell", with the load error naming the offending file.

#### Scenario: Non-erasable third-party plugin is isolated
- **GIVEN** an installed plugin whose server entry declares a class with a constructor parameter property
- **WHEN** the dashboard server boots
- **THEN** the server SHALL start and other plugins SHALL load
- **AND** `/api/health` `plugins[]` SHALL report that plugin with an error naming the file

### Requirement: Manifest `projectTypes` marker rules are validated
A plugin manifest MAY declare `projectTypes: Array<{ type: string; markers: string[] }>` with at most 8 entries.

**Fields**
- `type` SHALL match `^[a-z][a-z0-9-]{0,63}$`.
- `markers` SHALL hold 1 to 16 patterns.

**Pattern grammar.** A marker pattern SHALL be 1 to 3 segments joined by `/`. Each segment SHALL be non-empty, and SHALL be either a literal name or a name containing `*` wildcards. The last segment SHALL contain at least one character other than `*`. A pattern SHALL NOT:
- start or end with `/`;
- contain `\`;
- contain a `.`, `..`, `.git` or `node_modules` segment;
- contain `**`;
- contain any of `?[]{}!`.

**Errors.** A violation SHALL be a fatal manifest error naming the plugin and the offending entry.

**Compatibility and lifetime**
- A manifest without `projectTypes` SHALL validate exactly as before.
- A valid `projectTypes` SHALL be preserved in the validated manifest that discovery returns.
- Rules from a plugin SHALL take part in project detection only while that plugin is enabled.

#### Scenario: Valid rules survive discovery
- **WHEN** a manifest declares `projectTypes: [{ "type": "judo", "markers": ["model/*.judo", "judo.yaml"] }]`
- **THEN** the plugin loads and its discovered manifest carries the same `projectTypes`

#### Scenario: Escaping pattern is fatal
- **WHEN** a manifest declares a marker `../secrets/*.key`
- **THEN** the plugin fails to load with a manifest error naming the plugin and the pattern

#### Scenario: Recursive or wildcard-only pattern is fatal
- **WHEN** a manifest declares a marker `**/pom.xml` or `src/*`
- **THEN** the plugin fails to load with a manifest error naming the plugin and the pattern

#### Scenario: Excluded directory is fatal
- **WHEN** a manifest declares a marker `node_modules/judo/package.json`
- **THEN** the plugin fails to load with a manifest error naming the plugin and the pattern

### Requirement: `ServerPluginContext` exposes resolved pi resources

`ServerPluginContext` SHALL expose an optional `getPiResources?(cwd?: string, opts?: { fresh?: boolean }): Promise<PiResourcesResult>`. It returns the resolved resources from the same cache `GET /api/pi-resources` uses, without the per-session provenance join that route adds:
- a cached result SHALL be returned at once, and a stale one SHALL also trigger one background rescan;
- a cold miss SHALL await a scan;
- an omitted `cwd` SHALL scan relative to the server's working directory, as the route does;
- with `fresh: true` the call SHALL resolve with a scan that started after the call; a scan already running when the call arrives SHALL NOT satisfy it.

The capability SHALL be optional on the type, so contexts built without it remain valid.

#### Scenario: Cached result reused
- **WHEN** a plugin calls `getPiResources("/repo")` twice and the cache entry is fresh
- **THEN** both calls SHALL resolve without a rescan

#### Scenario: Fresh read after invalidation
- **WHEN** the entry for `/repo` was just invalidated and a plugin calls `getPiResources("/repo", { fresh: true })`
- **THEN** the call SHALL resolve only after a rescan and SHALL include a skill added before the invalidation

#### Scenario: In-flight scan does not satisfy a fresh read
- **WHEN** a scan of `/repo` is running, a skill is then added, and a plugin calls `getPiResources("/repo", { fresh: true })`
- **THEN** the call SHALL resolve with a result that includes the added skill

#### Scenario: Stale entry served and refreshed
- **WHEN** the cache entry for `/repo` is stale
- **THEN** the call SHALL resolve with the stale result and exactly one background rescan SHALL start

### Requirement: `ServerPluginContext` signals pi resource invalidation

`ServerPluginContext` SHALL expose an optional `onPiResourcesInvalidated?(handler: (cwd: string | undefined) => void): () => void`. The host SHALL invoke handlers:
- when the pi-resources watcher invalidates a folder (`cwd` set) or the global scope (`cwd` undefined);
- when any session reports its command list, with that session's working directory (nothing is emitted for a session the host does not know).

A throwing handler SHALL NOT affect other handlers or the host. The returned function SHALL unsubscribe.

#### Scenario: Watcher invalidation
- **WHEN** a skill directory is added under `/repo/.pi/skills`
- **THEN** subscribed handlers SHALL be called with `"/repo"`

#### Scenario: Command list arrival
- **WHEN** a session whose cwd is `/repo` sends its command list after a reload
- **THEN** subscribed handlers SHALL be called with `"/repo"`

#### Scenario: Global change
- **WHEN** `~/.pi/agent/settings.json` changes
- **THEN** subscribed handlers SHALL be called with `undefined`

#### Scenario: Unsubscribe
- **WHEN** a plugin calls the function returned by `onPiResourcesInvalidated`
- **THEN** its handler SHALL NOT be called again

### Requirement: Claims MAY name a lazily-loaded component module
A plugin manifest claim that names a `component` MAY also name a `module`: a path, relative to the plugin package root, of a client module that exports that component. For such a claim the generated plugin registry SHALL NOT import the component statically; it SHALL bind the claim's `Component` to a lazily-loaded component that fetches `module` the first time the claim renders, at most once per page. `predicate`, `shouldRender` and `labelComponent` references SHALL always resolve from the plugin's main client entry (they run before a claim renders and stay eager). Claims without `module` keep today's static named import. Every slot consumer that renders a claim `Component` SHALL render it inside a suspense boundary nested within the existing per-claim error boundary, so a pending load renders the slot's fallback (default: nothing) and a failed load is contained to that claim.

Registry generation SHALL fail when a `module` file does not exist or does not export the named `component`, and SHALL fail when the plugin's main client entry also exports that component (a static path would pin the module into the eager bundle and defeat the split).

#### Scenario: Lazy claim stays out of the cold-landing load
- **GIVEN** a plugin claims `{ "slot": "settings-section", "component": "FooSettings", "module": "./src/client/FooSettings.tsx" }`
- **WHEN** the production client is built
- **THEN** `FooSettings` is emitted in a chunk that is not part of the landing graph (entry script, `modulepreload` links and their static imports)

#### Scenario: Lazy claim renders after its module loads
- **WHEN** the Settings view first shows the plugin's settings page
- **THEN** the module is fetched once and `FooSettings` renders after it loads
- **AND** rendering the claim again does not refetch it

#### Scenario: Eager references stay eager
- **GIVEN** a lazy claim with `"predicate": "isFoo"`
- **WHEN** the registry is generated
- **THEN** `isFoo` is imported statically from the plugin's main client entry

#### Scenario: Failed lazy load is contained
- **WHEN** a lazy claim's module request fails
- **THEN** that claim renders its error-boundary state and other claims in the same slot render normally

#### Scenario: Module re-exported from the main entry is rejected
- **WHEN** the plugin's main client entry exports the component named by a claim with `module`
- **THEN** registry generation fails with an error naming the plugin, the component and the module

#### Scenario: Missing module export is rejected
- **WHEN** a claim's `module` does not export the named `component`
- **THEN** registry generation fails with an error naming the plugin, the slot, the component and the module

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

### Requirement: Plugin manifest declares emitted event types
A plugin manifest MAY declare `emits`, an array of non-empty strings naming the event types the plugin may emit into sessions. The loader SHALL reject a manifest whose `emits` is not an array of non-empty strings, lists a type beginning with a reserved prefix (`roles:`, `role:`, `model:`, `prompt:`, `dashboard:`, `ui:`; case-insensitive), has an entry with whitespace, or has over 64 entries or an entry over 128 characters. A plugin with no `emits` SHALL emit no event types.

#### Scenario: Valid emits list is accepted
- **WHEN** a manifest declares `"emits": ["flow:run", "dashboard-flows:report-files"]`
- **THEN** the manifest SHALL be accepted, because neither type begins with a reserved prefix

#### Scenario: Malformed emits is rejected
- **WHEN** a manifest declares `"emits": "flow:run"` or `"emits": [""]`
- **THEN** the manifest SHALL be rejected as invalid

#### Scenario: Reserved prefix is rejected
- **WHEN** a manifest declares `"emits": ["roles:set"]`
- **THEN** the manifest SHALL be rejected as invalid

#### Scenario: Case-variant reserved prefix is rejected
- **WHEN** a manifest declares `"emits": ["Roles:set"]`
- **THEN** the manifest SHALL be rejected as invalid

#### Scenario: Whitespace and size limits are enforced
- **WHEN** a manifest declares an `emits` entry containing whitespace, an entry longer than 128 characters, or more than 64 entries
- **THEN** the manifest SHALL be rejected as invalid
- **AND** a manifest with exactly 64 entries of exactly 128 characters each SHALL be accepted

#### Scenario: No emits means no emission
- **WHEN** a trusted plugin without `emits` calls `ctx.emitEventToSession` with any non-reserved event type
- **THEN** the call SHALL return `false` and send nothing

### Requirement: Provide records the provider plugin
When a plugin publishes a value with `provide`, the host SHALL record the id of the PROVIDER plugin (the plugin whose context made the call) and SHALL expose it on every `consumeAll` entry as the additive `provider` field (host-set entries: `host`). Any host decision that depends on who published a value, such as the emit-allowlist subset check, SHALL use this recorded provider id, never a plugin name embedded in the key.

#### Scenario: Provider id is exposed on consumeAll entries
- **WHEN** plugin `flows` calls `provide("automation.action.flows", ...)` and another plugin calls `consumeAll("automation.action.")`
- **THEN** the entry for that key SHALL carry `provider: "flows"`

#### Scenario: Key segment does not name the provider
- **WHEN** plugin `evil` calls `provide("automation.action.flows", ...)`
- **THEN** the call SHALL be refused and logged under "Cross-plugin service seam"; for any non-`automation.action.*` key the entry SHALL carry provider `evil` and any manifest check SHALL use `evil`'s manifest

### Requirement: Post-start plugin registration failure is contained
A failure while registering a plugin after the server has started SHALL be logged and the plugin marked failed; the server SHALL keep running.

#### Scenario: Registration failure marks the plugin failed
- **WHEN** a plugin's registration throws after server start
- **THEN** the error SHALL be logged and the plugin reported as failed
- **AND** the server and every other plugin SHALL keep running

## Related Capabilities

- `dashboard-shell-slots` — sibling capability defining the slot taxonomy that this loader populates.
- `extension-ui-system` — orthogonal capability for third-party descriptor UI; the loader does not handle descriptor extensions (those flow through `ui:list-modules` probe + `ext_ui_decorator` messages already specified there). The loader manages first-party plugins only.
- `bridge-extension` — historical mechanism for in-pi-process state forwarding; plugins that declare a `bridge` entry get auto-registered through the same mechanism the dashboard's own bridge uses (`extension-register.ts`), under managed `dashboard-<plugin-id>` keys that the dashboard owns.
- `dashboard-server` — host process for the loader. Server bootstrap completes (Fastify, session manager, event store), then the loader runs `loadServerEntries()` to register plugin routes/handlers/polling.
