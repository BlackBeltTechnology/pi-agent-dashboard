## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Closed versioned payload primitive set with client fallback

The client-facing `ActionDescriptor.payloadSchema` SHALL be pure serializable JSON: automation SHALL flatten each collected contribution, evaluating `available(cwd)` to a boolean and resolving `enum` field `options(cwd)` to a `string[]`, and SHALL drop all functions. `ActionPayloadField.type` SHALL be a CLOSED, versioned union (`string | multiline | text | enum`). The dialog SHALL render exactly one control per known primitive and SHALL fall back to a plain text input for an unrecognized `type` (forward compatibility with a newer contributor), never failing to render. Adding a new primitive SHALL be a single versioned extension to the shared union plus one client renderer. Payload validation SHALL remain server-authoritative at `/create`; the client performs only declarative light-validation.

#### Scenario: Known primitives render their controls

- **WHEN** a descriptor's `payloadSchema` contains `enum`, `multiline`, and `string` fields
- **THEN** the dialog SHALL render a select, a textarea, and a text input respectively, with enum options taken from the resolved `options` array.

#### Scenario: Unknown field type degrades to text

- **WHEN** a descriptor contains a field whose `type` the client does not recognize
- **THEN** the client SHALL render a plain text input for it and SHALL NOT crash, and the entered value SHALL be submitted under `action.payload` for server-side validation.
