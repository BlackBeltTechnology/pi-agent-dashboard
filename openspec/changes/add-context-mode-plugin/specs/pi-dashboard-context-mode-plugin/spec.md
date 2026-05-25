## ADDED Requirements

### Requirement: Plugin discovered as `pi-dashboard-context-mode-plugin` monorepo package

The system SHALL ship a monorepo package at `packages/context-mode-plugin/` published as `pi-dashboard-context-mode-plugin`. The package SHALL contain a `pi-dashboard-plugin` manifest with `id: "context-mode"`, `displayName: "Context Mode"`, `priority: 100`, `client: "./src/client/index.tsx"`, and `requires.piExtensions: ["context-mode"]`. The plugin SHALL be discovered by the existing dashboard plugin loader without loader changes.

#### Scenario: Manifest discovery on dashboard boot

- **WHEN** the dashboard server boots and `packages/context-mode-plugin/` is present in the workspace
- **THEN** the plugin loader reads its `pi-dashboard-plugin` manifest, validates it, and registers its tool-renderer claims
- **AND** the plugin appears in `GET /api/plugins`

#### Scenario: Plugin appears in `/api/health.plugins[]`

- **WHEN** `GET /api/health` is called after dashboard boot
- **THEN** the response includes a `plugins[]` entry with `id: "context-mode"` and a `requirements.piExtensions[]` report containing `{ name: "context-mode", satisfied: <boolean> }`

### Requirement: Plugin auto-activates when `context-mode` pi extension is installed

The plugin SHALL declare `requires.piExtensions: ["context-mode"]` in its manifest. With default-enabled-when-no-config behaviour (`cfg?.enabled !== false` in the loader), installing the `context-mode` pi extension and restarting the dashboard SHALL activate the plugin without a manual toggle.

#### Scenario: User installs context-mode → plugin auto-activates

- **WHEN** the user adds `"npm:context-mode"` to `~/.pi/agent/settings.json#packages[]` and restarts the dashboard
- **THEN** `/api/health.plugins[]` reports the context-mode plugin's `requirements.piExtensions["context-mode"].satisfied === true`
- **AND** the plugin's tool-renderer claims are registered in the slot registry
- **AND** `ctxExtensionPresent()` returns true within one `/api/health` round-trip

#### Scenario: User never installed context-mode → plugin is dormant

- **WHEN** the user has never installed `context-mode` AND the plugin is in the workspace
- **THEN** the plugin loads but every claim's `shouldRender: "ctxExtensionPresent"` returns false
- **AND** all `ctx_*` tool calls fall through to `GenericToolRenderer` per the resolution chain from `wire-tool-renderer-slot`

### Requirement: `ctxExtensionPresent` sync cache mirrors honcho pattern

The plugin SHALL maintain a module-level sync-readable cache `extensionPresentCache` initialized to `false` (closed-by-default). The cache SHALL be refreshed by reading `/api/health.plugins[].requirements.piExtensions["context-mode"].satisfied`. An initial probe SHALL fire at module load. A refresh SHALL fire on every `plugin-config-update` window event.

The exported `ctxExtensionPresent(): boolean` SHALL read this cache synchronously.

#### Scenario: Cold boot — cache starts false

- **WHEN** the plugin module is first imported by the client
- **THEN** `ctxExtensionPresent()` returns false until the initial `/api/health` probe completes (prevents visible-then-hidden flicker)

#### Scenario: Cache flips true on satisfied probe

- **WHEN** `/api/health` returns `{ plugins: [{ id: "context-mode", requirements: { piExtensions: [{ name: "context-mode", satisfied: true }] }}]}`
- **THEN** `ctxExtensionPresent()` returns true after the probe resolves

#### Scenario: Cache refreshes on plugin-config-update

- **WHEN** a `plugin-config-update` window event fires (e.g. user toggles a plugin in Settings ▸ Plugins, or the extension is installed/uninstalled and the server broadcasts the change)
- **THEN** the plugin re-fetches `/api/health` and updates the cache accordingly

#### Scenario: `/api/health` request fails

- **WHEN** the `/api/health` fetch throws or returns non-2xx
- **THEN** the cache SHALL be set to false (fail closed); no exception is propagated; the renderer claims stay hidden

### Requirement: Per-tool React renderers for all 11 ctx_* tools

The plugin SHALL contribute one `tool-renderer` claim per `ctx_*` tool: `ctx_execute`, `ctx_execute_file`, `ctx_index`, `ctx_search`, `ctx_fetch_and_index`, `ctx_batch_execute`, `ctx_stats`, `ctx_doctor`, `ctx_upgrade`, `ctx_purge`, `ctx_insight`. Each claim's `component` SHALL be exported by name from `src/client/index.tsx`.

The three high-value tools — `ctx_execute`, `ctx_batch_execute`, `ctx_search` — SHALL have bespoke renderers tailored to their structure. The remaining 8 SHALL share a `CodeOutputCard` internal primitive owned by the plugin and SHALL NOT export that primitive as a dashboard-level component.

#### Scenario: ctx_execute renders code + output

- **WHEN** a `ctx_execute` tool call is in a chat surface with `args: { language: "javascript", code: "console.log('hi')", intent: "find errors" }` and `result: "stdout text..."`
- **THEN** the renderer shows a language pill labelled "js"
- **AND** a syntax-highlighted code block containing the code
- **AND** a stdout panel containing the result text
- **AND** an "indexed: find errors" badge

#### Scenario: ctx_batch_execute renders commands + queries + results

- **WHEN** a `ctx_batch_execute` tool call is in a chat surface with `args: { commands: [{label: "a", command: "ls"}, {label: "b", command: "pwd"}], queries: ["q1", "q2"], concurrency: 4 }` and a multi-query result
- **THEN** the renderer shows a collapsible list of two `{label, command}` chips
- **AND** a list of two query chips ("q1", "q2")
- **AND** a per-query result accordion
- **AND** a "concurrency: 4" pill

#### Scenario: ctx_search renders queries with hit cards

- **WHEN** a `ctx_search` tool call is in a chat surface with `args: { queries: ["term1", "term2"] }` and a structured result containing hits per query
- **THEN** the renderer shows one chip per query
- **AND** clicking a query expands its hit list as cards with source label and snippet preview

#### Scenario: ctx_purge shows destructive callout

- **WHEN** a `ctx_purge` tool call is in a chat surface with `args: { confirm: true, scope: "project" }`
- **THEN** the renderer shows a red-border destructive callout
- **AND** a "project" scope chip
- **AND** the result text

#### Scenario: CodeOutputCard fallback for simple tools

- **WHEN** a `ctx_upgrade` tool call is in a chat surface with a single-line command result
- **THEN** the renderer shows a "command to run" panel containing the exact command from the result

### Requirement: Graceful fall-through when context-mode is uninstalled

When `ctxExtensionPresent()` returns false (e.g. extension uninstalled, or a session replay surfaces an old `ctx_*` call), the plugin's tool-renderer claims SHALL be filtered out by the `shouldRender` step in the resolution chain (per `wire-tool-renderer-slot`). The chat surface SHALL fall through to `GenericToolRenderer` for that call, with no errors, no console warnings, and no visible flicker.

#### Scenario: Historical ctx_* call after uninstall

- **WHEN** the user has uninstalled `context-mode` AND opens a session whose history contains a `ctx_execute` tool call
- **THEN** the call renders via `GenericToolRenderer` (raw JSON dump)
- **AND** no React error boundaries trip
- **AND** no errors are logged to the console
- **AND** the chat surface remains visually stable (no plugin-card-then-fallback flicker)

### Requirement: No server-side surface

The plugin SHALL NOT ship a server entry, bridge entry, REST routes, or any namespace under `/api/plugins/context-mode/*`. The package is client-only.

#### Scenario: Plugin loader sees no server entry

- **WHEN** the plugin loader inspects the package manifest
- **THEN** `serverEntryPath` is undefined / absent
- **AND** `bridgeEntryPath` is undefined / absent
- **AND** `clientEntryPath` is `./src/client/index.tsx`

#### Scenario: No /api/plugins/context-mode/* routes are mounted

- **WHEN** the dashboard server has booted with the plugin loaded
- **THEN** requests to `/api/plugins/context-mode/<anything>` return 404
