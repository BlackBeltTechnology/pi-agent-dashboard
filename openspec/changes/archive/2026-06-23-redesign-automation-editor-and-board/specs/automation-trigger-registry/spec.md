# automation-trigger-registry — delta

## ADDED Requirements

### Requirement: Two-level trigger taxonomy (category → event types)

Triggers SHALL be organized into a two-level taxonomy: an event **category** (e.g. `scheduled`, `openspec`, `file`, `git`, `webhook`) and, within a category, one or more event **types** (e.g. for `openspec`: `change.created`, `change.archived`, `change.validated`, `tasks.completed`, `spec.updated`). The on-disk `automation.yaml` SHALL encode the category as `on.kind` and, for categories with multiple selectable types, the chosen types as `on.events: string[]`. The `scheduled` category SHALL retain its single kind-specific field (`on.cron`) and SHALL NOT require an `events` array.

This SHALL be backward compatible: an existing `on: { kind: schedule, cron }` file SHALL remain valid with no migration, because `schedule` maps to the `scheduled` category whose single type is the cron schedule.

#### Scenario: Existing schedule file remains valid

- **WHEN** an `automation.yaml` contains `on: { kind: schedule, cron: "0 9 * * 1" }`
- **THEN** it SHALL parse and arm unchanged, with no `events` array required.

#### Scenario: Multi-event OpenSpec automation parses

- **WHEN** an `automation.yaml` contains `on: { kind: openspec, events: [change.archived, change.validated] }`
- **THEN** it SHALL parse with two selected event types under the `openspec` category and arm a trigger that fires on either event.

#### Scenario: Category with no selected events is invalid

- **WHEN** a multi-type category is chosen with an empty `events` array
- **THEN** validation SHALL reject the config with an error naming the missing event selection.

### Requirement: Trigger taxonomy exposed to client as category+event descriptors

The plugin SHALL expose the trigger taxonomy to the client as read-only descriptors so the editor can render a two-level picker. Each category descriptor SHALL carry `category`, a human `label`, a `status` (`enabled` | `planned`), and an `events` list of event descriptors; each event descriptor SHALL carry `event`, a human `label`, and a `status`. Registered/handled categories and events SHALL be `enabled`; advertised-but-unwired ones SHALL be `planned`. A newly registered category or event SHALL appear as `enabled` automatically with no client component change. The descriptor exposure SHALL NOT change the on-disk format.

#### Scenario: scheduled category advertised as enabled

- **WHEN** the client requests the trigger taxonomy descriptors
- **THEN** the list SHALL include a `scheduled` category with `status: "enabled"`.

#### Scenario: Planned category advertised as disabled

- **WHEN** `git` is advertised but not wired
- **THEN** the taxonomy SHALL include a `git` category with `status: "planned"` and the editor SHALL render its tab disabled ("coming soon").

#### Scenario: Planned event within an enabled category

- **WHEN** the `openspec` category is enabled but its `proposal.added` event is not yet wired
- **THEN** the `openspec` descriptor SHALL list `proposal.added` with `status: "planned"` and the editor SHALL render that checklist entry disabled.

#### Scenario: Newly registered event lights up without client change

- **WHEN** a future event type registers under an existing enabled category
- **THEN** its descriptor SHALL report `status: "enabled"` and the editor checklist SHALL allow selecting it, with no change to the picker component code.

### Requirement: Editor renders the two-level picker by descriptor

The editor SHALL render event categories as a level-1 selector (tab strip) and the selected category's event types as a level-2 multi-select (checklist), both driven by the descriptors. Selecting the `scheduled` category SHALL replace the level-2 checklist with the cron helper. A `planned` category SHALL render no level-2 controls and SHALL prevent submission; a `planned` event SHALL render disabled within its category.

#### Scenario: OpenSpec category shows multi-select event checklist

- **WHEN** the user selects the `openspec` category
- **THEN** the editor SHALL render its enabled event types as a multi-select checklist and SHALL write the checked types to `on.events`.

#### Scenario: Scheduled category shows cron helper not a checklist

- **WHEN** the user selects the `scheduled` category
- **THEN** the editor SHALL render the cron helper (with next-run preview and raw-cron escape hatch) instead of an event checklist, and SHALL write `on.cron`.

#### Scenario: Planned category blocks submission

- **WHEN** the user selects a `planned` category
- **THEN** the editor SHALL render no level-2 controls and SHALL disable the Create action for that selection.

### Requirement: Explicit update path distinct from create

The plugin SHALL provide an explicit update operation for an existing automation that overwrites its `automation.yaml` (and `prompt.md`) only when the caller intends an update. The create operation SHALL NOT silently overwrite an existing automation of the same name; it SHALL either reject the collision or require an explicit update flag. The update operation SHALL target an automation by scope + name and SHALL fail if that automation does not exist.

#### Scenario: Create rejects an existing name

- **WHEN** a create request targets a scope + name that already exists
- **THEN** the operation SHALL NOT silently overwrite; it SHALL return a collision error (or require an explicit update flag).

#### Scenario: Update overwrites an existing automation

- **WHEN** an update request targets an existing scope + name
- **THEN** that automation's `automation.yaml` (and `prompt.md`) SHALL be overwritten in place.

#### Scenario: Update of a missing automation fails

- **WHEN** an update request targets a scope + name that does not exist
- **THEN** the operation SHALL fail with a not-found error rather than creating a new automation.
