## ADDED Requirements

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

## MODIFIED Requirements

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
