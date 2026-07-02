## ADDED Requirements

### Requirement: Plugin-registered automation actions

The automation plugin SHALL expose an action registry that any in-process dashboard plugin can register actions into at server startup. Each registered action SHALL declare a namespaced id of the form `<source>.<verb>`, a human label, an `available(cwd)` predicate, a `payloadSchema`, and a `dispatch` handler. The registry SHALL be a single shared instance referenced by both the create-automation dialog's action-list source and the engine's run-dispatch path.

The built-in `prompt` and `skill` actions SHALL be registered as `core.prompt` and `core.skill`. A bare `action.kind: prompt` or `skill` in an existing `automation.yaml` SHALL normalize to the corresponding `core.*` id (backward compatible).

A source SHALL register at most 12 actions; registrations beyond the cap SHALL be rejected with a logged warning and SHALL NOT abort the registering plugin.

#### Scenario: Plugin registers an action at startup

- **WHEN** a plugin that declares `dependsOn: ["automation"]` consumes the action registry and registers `{ id: "flows.run", available, payloadSchema, dispatch }`
- **THEN** `flows.run` SHALL be resolvable by the engine and SHALL appear in the dialog's action list for any cwd where `available(cwd)` returns true.

#### Scenario: Built-in actions remain available

- **WHEN** no plugins register actions
- **THEN** `core.prompt` and `core.skill` SHALL still be present, and an existing `automation.yaml` with `action.kind: prompt` SHALL parse and dispatch unchanged.

#### Scenario: Per-plugin cap enforced

- **WHEN** a single source attempts to register a 13th action
- **THEN** the 13th registration SHALL be rejected with a logged warning and the first 12 SHALL remain registered.

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
