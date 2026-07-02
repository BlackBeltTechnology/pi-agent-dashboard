# automation-action-registry Specification

## Purpose
TBD - created by archiving change register-plugin-automation-events. Update Purpose after archive.
## Requirements
### Requirement: Plugin-registered automation actions

The automation plugin SHALL own the action slots via **publish/collect**, not a shared pushed-into registry. Any in-process plugin contributes actions by publishing an immutable contribution under the namespaced key `automation.action.<source>` (a single contribution or an array). A contribution SHALL declare a namespaced id `<source>.<verb>`, a human label, an optional `available(cwd)` predicate, an optional `payloadSchema`, and exactly one dispatch (`buildPrompt` OR `buildEvent`).

The automation plugin SHALL NOT `provide` a mutable registry object. Instead it SHALL COLLECT contributions via `consumeAll("automation.action.")` lazily — at `/actions` request time and at run-dispatch time — building an id-indexed action set on read. Because collection happens after all plugins have loaded, a contribution is observed regardless of load order and with no `dependsOn` between plugins.

The automation plugin SHALL self-publish its built-ins under `automation.action.core` as `core.prompt` and `core.skill`. A bare `action.kind: prompt` or `skill` in an existing `automation.yaml` SHALL normalize to the corresponding `core.*` id (backward compatible).

Collection SHALL reject a malformed id (not `<source>.<verb>`), a duplicate id, or a contribution lacking exactly one dispatch, with a logged warning; a rejected contribution SHALL NOT abort collection of the others. A source SHALL contribute at most 12 actions; entries beyond the cap SHALL be dropped with a logged warning.

An action SHALL appear in the dialog and be dispatchable only when its contributing plugin is active (a plugin publishes only while loaded); a disabled/absent plugin contributes nothing.

#### Scenario: Plugin publishes an action; automation collects it

- **WHEN** a plugin calls `provide("automation.action.flows", { id: "flows.run", available, payloadSchema, buildEvent })` in its `registerPlugin`, and later the dialog requests `/actions`
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

### Requirement: Closed versioned payload primitive set with client fallback

The client-facing `ActionDescriptor.payloadSchema` SHALL be pure serializable JSON: automation SHALL flatten each collected contribution, evaluating `available(cwd)` to a boolean and resolving `enum` field `options(cwd)` to a `string[]`, and SHALL drop all functions. `ActionPayloadField.type` SHALL be a CLOSED, versioned union (`string | multiline | text | enum`). The dialog SHALL render exactly one control per known primitive and SHALL fall back to a plain text input for an unrecognized `type` (forward compatibility with a newer contributor), never failing to render. Adding a new primitive SHALL be a single versioned extension to the shared union plus one client renderer. Payload validation SHALL remain server-authoritative at `/create`; the client performs only declarative light-validation.

#### Scenario: Known primitives render their controls

- **WHEN** a descriptor's `payloadSchema` contains `enum`, `multiline`, and `string` fields
- **THEN** the dialog SHALL render a select, a textarea, and a text input respectively, with enum options taken from the resolved `options` array.

#### Scenario: Unknown field type degrades to text

- **WHEN** a descriptor contains a field whose `type` the client does not recognize
- **THEN** the client SHALL render a plain text input for it and SHALL NOT crash, and the entered value SHALL be submitted under `action.payload` for server-side validation.

### Requirement: Event-dispatch actions

A registered action MAY declare `buildEvent(args: { payload, automation }) => { eventType: string; data?: Record<string, unknown> } | null` as an alternative to `buildPrompt`. An action SHALL provide exactly one of `buildPrompt` or `buildEvent`. When an action declares `buildEvent`, the engine SHALL dispatch the run by emitting the returned event into the spawned run session via `emitEventToSession` (instead of seeding a prompt). A `null` return SHALL emit nothing. Prompt-based built-ins (`core.prompt`, `core.skill`) SHALL keep `buildPrompt` and dispatch unchanged.

The registry SHALL remain agnostic to which events exist — the registering plugin owns the `eventType` and `data` shape.

#### Scenario: Event action emits its configured event

- **WHEN** an action registered with `buildEvent` returning `{ eventType: "flow:run", data: { flowName, task } }` fires
- **THEN** the engine SHALL emit `flow:run` with that data into the run session and SHALL NOT seed a text prompt.

#### Scenario: Prompt action is unaffected

- **WHEN** `core.prompt` fires
- **THEN** the engine SHALL seed its prompt text via `sendToSession` as before.

#### Scenario: Run finalization is unchanged

- **WHEN** an event action's run session completes
- **THEN** the run SHALL finalize on `agent_end` exactly as prompt actions do (event actions add no new completion signal).

### Requirement: Action availability gating by cwd

The action list served to the dialog SHALL filter each action by its `available(cwd)` result for the current working directory. An unavailable action's source SHALL be surfaced to the dialog as present-but-disabled with a reason, not omitted, so the capability stays discoverable.

#### Scenario: Unavailable source shown disabled

- **WHEN** the dialog requests actions for a cwd where the `slack` source's `available(cwd)` returns false
- **THEN** the Slack group SHALL appear disabled with a reason and its actions SHALL NOT be selectable.

#### Scenario: Available source selectable

- **WHEN** `available(cwd)` returns true for the `flows` source in the current cwd
- **THEN** the Flows group SHALL be enabled and its actions selectable.

### Requirement: Schema-driven action payload

Each action SHALL declare a `payloadSchema` of typed fields (`string`, `multiline`, `text`, `enum`). For `enum` fields, the registry SHALL resolve option values per cwd and include them in the descriptor sent to the dialog. The dialog SHALL render one control per field and persist entered values into `automation.yaml` under `action.payload`. An action with an empty schema SHALL render no payload form.

#### Scenario: Enum options resolved live per cwd

- **WHEN** the dialog selects `flows.run` in a cwd containing flows `release-checklist` and `nightly-build-and-tag`
- **THEN** the `flow` enum control SHALL list exactly those discovered flows, and the `task` field SHALL render as a multiline input.

#### Scenario: Empty schema renders no form

- **WHEN** the dialog selects an action whose `payloadSchema` is empty (e.g. `git.push`)
- **THEN** no payload form SHALL render and a note SHALL state the action takes no payload.

### Requirement: Grouped searchable action picker

The create-automation dialog SHALL present registered actions as an inline picker grouped by source plugin, with a text filter over action ids/labels and a per-source collapsible group. Selecting an action SHALL render its payload form. The picker SHALL meet WCAG 2.2 (visible focus, ≥24×24 targets, ≥4.5:1 text contrast) and expose the search-as-combobox / list-as-listbox roles per WAI-ARIA APG.

#### Scenario: Filter narrows the list

- **WHEN** the user types `flow` into the picker filter
- **THEN** only actions whose id, label, or source match SHALL remain visible and a live count SHALL update.

#### Scenario: Zero results

- **WHEN** the filter matches no action
- **THEN** a zero-results message SHALL display with example queries and no action SHALL be selectable.

