## MODIFIED Requirements

### Requirement: Plugin-registered automation actions

The automation plugin SHALL own the action slots via **publish/collect**, not a shared pushed-into registry. Any in-process plugin contributes actions by publishing an immutable contribution under the namespaced key `automation.action.<source>` (a single contribution or an array). A contribution SHALL declare a namespaced id `<source>.<verb>`, a human label, an optional `available(cwd)` predicate, an optional `payloadSchema`, and exactly one dispatch (`buildPrompt` OR `buildEvent`); a `buildEvent` contribution SHALL also declare a non-empty `emits: string[]`.

The automation plugin SHALL NOT `provide` a mutable registry object. Instead it SHALL COLLECT contributions via `consumeAll("automation.action.")` lazily — at `/actions` request time and at run-dispatch time — building an id-indexed action set on read. Because collection happens after all plugins have loaded, a contribution is observed regardless of load order and with no `dependsOn` between plugins.

For an `automation.action.<source>` key the host SHALL refuse any `provide` whose calling plugin id is not `<source>` (see `dashboard-plugin-loader`, "Cross-plugin service seam"); collection SHALL additionally ignore, with a logged warning, any `consumeAll` entry whose `provider` differs from the `<source>` segment of its key (host-set entries, provider `host`, are exempt). The `<source>` is the first segment after `automation.action.`; an entry with an empty source SHALL be refused as malformed. The seam emit allowlist is the provider's whole manifest `emits` (no runtime channel narrows or widens it), computed live, so the types of an unloaded provider leave it.

The automation plugin SHALL self-publish its built-ins under `automation.action.core` as `core.prompt` and `core.skill`. A bare `action.kind: prompt` or `skill` in an existing `automation.yaml` SHALL normalize to the corresponding `core.*` id (backward compatible).

Collection SHALL reject a malformed id (not `<source>.<verb>`), a duplicate id, a contribution lacking exactly one dispatch, or a `buildEvent` contribution lacking a non-empty `emits`, with a logged warning; a contribution whose `emits` is not a subset of the manifest `emits` of its actual PROVIDER plugin (the plugin that called `provide`, as recorded by the host and exposed on `consumeAll` entries; not the `<source>` segment of the key), with a logged warning naming the provider plugin and the undeclared types; a rejected contribution SHALL NOT abort collection of the others. This subset check SHALL run when a contribution is accepted into the action set, not only at dispatch, and the automation plugin's seam emit allowlist, computed by the host, SHALL be its own manifest `emits` union the manifest `emits` of the providers of accepted contributions. A source SHALL contribute at most 12 actions; entries beyond the cap SHALL be dropped with a logged warning.

An action SHALL appear in the dialog and be dispatchable only when its contributing plugin is active (a plugin publishes only while loaded); a disabled/absent plugin contributes nothing.

#### Scenario: Plugin publishes an action; automation collects it

- **WHEN** a plugin calls `provide("automation.action.flows", { id: "flows.run", available, payloadSchema, emits: ["flow:run"], buildEvent })` in its `registerPlugin`, and later the dialog requests `/actions`
- **THEN** automation SHALL collect it via `consumeAll("automation.action.")`, and `flows.run` SHALL be resolvable by the engine and SHALL appear for any cwd where `available(cwd)` returns true.

#### Scenario: Load order does not matter

- **WHEN** the contributing plugin's `registerPlugin` runs before OR after the automation plugin's
- **THEN** the contribution SHALL still be collected, because collection is lazy at request/dispatch time.

#### Scenario: Inactive plugin contributes nothing

- **WHEN** a contributing plugin is disabled or not loaded
- **THEN** it SHALL publish no contribution and its actions SHALL NOT appear in the dialog or be dispatchable.

#### Scenario: Built-in actions remain available

- **WHEN** no other plugins contribute actions
- **THEN** `core.prompt` and `core.skill` (self-published by automation) SHALL still be present, and an existing `automation.yaml` with `action.kind: prompt` SHALL parse and dispatch unchanged.

#### Scenario: Per-source cap enforced on collect

- **WHEN** a single source contributes a 13th action
- **THEN** the 13th SHALL be dropped with a logged warning and the first 12 SHALL remain.

#### Scenario: Undeclared emits is refused at registration

- **WHEN** a plugin whose manifest `emits` is `["flow:run"]` publishes `automation.action.flows` with a `buildEvent` action declaring `emits: ["flow:run", "custom:thing"]`
- **THEN** collection SHALL reject the action with a logged warning naming `custom:thing`, and the action SHALL NOT be listed or dispatchable

#### Scenario: Key source segment cannot borrow another plugin's emits
- **WHEN** plugin `evil`, whose manifest `emits` is empty, publishes `automation.action.flows` with a `buildEvent` action declaring `emits: ["flow:run"]` while plugin `flows` declares `flow:run`
- **THEN** collection SHALL reject the action, because the check uses the provider `evil`'s manifest

#### Scenario: Provider must equal the key source
- **WHEN** a `consumeAll("automation.action.")` entry for `automation.action.flows` carries `provider: "evil"`
- **THEN** collection SHALL ignore it with a logged warning and its actions SHALL NOT be listed or dispatchable

#### Scenario: Empty source segment is malformed
- **WHEN** a `consumeAll("automation.action.")` entry has the key `automation.action.`
- **THEN** collection SHALL refuse it as malformed with a logged warning

#### Scenario: Allowlist follows the provider's lifetime
- **WHEN** a provider plugin with an accepted action is unloaded
- **THEN** its manifest `emits` types SHALL no longer be in the automation plugin's allowlist

#### Scenario: Emits within the manifest is accepted

- **WHEN** a plugin whose manifest `emits` contains `flow:run` publishes an action with `emits: ["flow:run"]`
- **THEN** the action SHALL be accepted and `flow:run` SHALL join the automation plugin's host-computed allowlist

### Requirement: Event-dispatch actions

A registered action MAY declare `buildEvent(args: { payload, automation }) => { eventType: string; data?: Record<string, unknown> } | null` as an alternative to `buildPrompt`. An action SHALL provide exactly one of `buildPrompt` or `buildEvent`. When an action declares `buildEvent`, the engine SHALL dispatch the run by emitting the returned event into the spawned run session via `emitEventToSession` (instead of seeding a prompt). A `null` return SHALL emit nothing. Prompt-based built-ins (`core.prompt`, `core.skill`) SHALL keep `buildPrompt` and dispatch unchanged.

An action declaring `buildEvent` SHALL also declare `emits: string[]` — the non-empty list of event types it may emit. The registry SHALL reject a `buildEvent` registration with a missing or empty `emits` (logged warning, no throw). At dispatch, the engine SHALL NOT emit an event whose `eventType` is not in the action's `emits`; or whose `eventType` is in a reserved namespace (see `dashboard-plugin-loader`); it SHALL log a warning, emit nothing, and fail the run with an error result (never leaving it pending). This refusal SHALL be decided by the engine before dispatch; delivery semantics of `emitEventToSession` are unchanged. The registry SHALL otherwise remain agnostic to which events exist — the registering plugin owns the `eventType` values and `data` shape, but only within the event types declared in its provider plugin's manifest `emits` (see "Plugin-registered automation actions").

NOTE: the scenario title `Run finalization is unchanged` is retained verbatim because the archiver cannot retire a scenario name inside a MODIFIED requirement; its body is normative and supersedes the previous `agent_end` claim. How a run of an event action FINISHES is NOT specified by this capability. Finalization is governed solely by `automation-run-lifecycle`: a run whose dispatch declared a completion event finalizes on that forwarded event, and every other run finalizes on `agent_end`. This capability SHALL NOT restate or contradict that rule.

#### Scenario: Event action emits its configured event

- **WHEN** an action registered with `emits: ["flow:run"]` and `buildEvent` returning `{ eventType: "flow:run", data: { flowName, task } }` fires
- **THEN** the engine SHALL emit `flow:run` with that data into the run session and SHALL NOT seed a text prompt.

#### Scenario: Prompt action is unaffected

- **WHEN** `core.prompt` fires
- **THEN** the engine SHALL seed its prompt text via `sendToSession` as before.

#### Scenario: Run finalization is unchanged

- **WHEN** an event action's run needs to be finalized
- **THEN** the governing rule SHALL be the one in `automation-run-lifecycle`
- **AND** this capability SHALL assert nothing about `agent_end` versus a declared completion event.

#### Scenario: Event action without emits is rejected

- **WHEN** an action registers `buildEvent` without a non-empty `emits`
- **THEN** `register()` SHALL return `false` and the action SHALL NOT be listed.

#### Scenario: Undeclared event type is not emitted

- **WHEN** an action with `emits: ["flow:run"]` has a `buildEvent` that returns `{ eventType: "roles:set" }`
- **THEN** the engine SHALL NOT call `emitEventToSession`, SHALL log a warning, and SHALL fail the run.
