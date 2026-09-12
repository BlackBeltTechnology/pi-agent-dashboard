## MODIFIED Requirements

### Requirement: Model fallback chains are editable as ordered lists

The settings section SHALL render `model`, `observerModel` + `observerFallbackModels`, `reflectorModel` + `reflectorFallbackModels`, and `dropperModel` + `dropperFallbackModels` as per-worker ordered chains, where list position determines resolution order. Entries SHALL be addable to any chain, and a chain entry's model SHALL be chosen from the dashboard's live model registry rather than typed.

#### Scenario: Chain order maps to array order

- **WHEN** the observer chain shows primary `A` then fallbacks `B`, `C`
- **THEN** `observerModel` SHALL be `A` and `observerFallbackModels` SHALL be `[B, C]` in that order

#### Scenario: Promoting a fallback to primary

- **WHEN** the user moves the first fallback above the primary
- **AND** saves
- **THEN** the former fallback SHALL be written as `observerModel`
- **AND** the former primary SHALL be written as the first entry of `observerFallbackModels`

#### Scenario: Reordering is operable from the keyboard

- **WHEN** a chain entry is focused
- **THEN** move-up, move-down, and remove SHALL each be reachable and activatable by keyboard alone
- **AND** each SHALL expose an accessible name identifying the model it acts on

#### Scenario: Boundary controls are disabled, not absent

- **WHEN** an entry is first in its chain
- **THEN** its move-up control SHALL be present and disabled

#### Scenario: A worker chain cannot be emptied

- **WHEN** a worker chain contains only its primary entry
- **THEN** that entry SHALL NOT offer a remove control
- **AND** the primary SHALL be changeable only by editing it or by promoting a fallback above it

#### Scenario: Adding an entry to a non-empty chain

- **WHEN** the user activates the chain's add control and picks a model from the registry
- **THEN** a new entry with that `provider` and `id` SHALL be appended as the last fallback
- **AND** the add control SHALL be reachable and activatable by keyboard alone with an accessible name identifying the worker
- **AND** dismissing the add control without picking SHALL leave the chain unchanged

#### Scenario: Adding an entry to an empty chain

- **WHEN** a worker chain has no entries in the loaded configuration
- **THEN** the chain SHALL render an empty state stating that the worker currently resolves to the base/session tail only
- **AND** the add control SHALL be present
- **AND** the first added entry SHALL be written as `<worker>Model` on save

#### Scenario: Model is chosen from the live registry

- **WHEN** a chain entry is expanded
- **THEN** its model SHALL be selectable through the shared dashboard model picker listing the registry's available models
- **AND** picking a model SHALL set both `provider` and `id` from the picked registry row, including when the row's `id` itself contains `/`
- **AND** picking a model SHALL clear the entry's `contextWindow`
- **AND** no free-text input for `provider` or `id` SHALL be offered
- **AND** the entry's picker SHALL expose an accessible name identifying the worker and the entry's position

#### Scenario: Thinking level uses the shared level picker

- **WHEN** a chain entry is expanded and its thinking override is enabled
- **THEN** its `thinking` SHALL be selectable through the shared thinking-level picker
- **AND** levels offered SHALL be limited to `off`, `minimal`, `low`, `medium`, `high`, `xhigh`
- **AND** when the registry reports the picked model as non-reasoning only `off` SHALL be offered
- **AND** disabling the thinking override SHALL write `thinking` as absent

#### Scenario: Inherited thinking is distinguishable from `off`

- **WHEN** a loaded entry has no `thinking` key
- **THEN** its thinking override SHALL render as disabled with the level picker not shown
- **AND** enabling the override SHALL stage `thinking` as `off` until another level is picked

#### Scenario: Picking a non-reasoning model drops an incompatible level

- **WHEN** an entry with `thinking` other than `off` is changed to a model the registry reports as non-reasoning
- **THEN** `thinking` SHALL be cleared
- **AND** a per-entry notice SHALL state that the level was dropped

#### Scenario: Per-model fields are editable

- **WHEN** a chain entry is expanded
- **THEN** `provider` and `id` SHALL be editable together through the model picker, `thinking` through the level picker, and `cooldownHours` and `contextWindow` as numbers
- **AND** an empty `contextWindow` SHALL be written as absent, meaning inherit from pi

#### Scenario: Entry not present in the registry is still shown

- **WHEN** a loaded entry's `provider/id` does not match any registry model
- **THEN** the entry SHALL still render with its stored `provider` and `id` and remain reorderable and removable
- **AND** the picker SHALL show the stored value as current without discarding it until the user picks another model

#### Scenario: Implicit tail is shown but not editable in place

- **WHEN** a worker chain is rendered
- **THEN** the resolution tail `base model → session model` SHALL be displayed
- **AND** SHALL NOT be presented as an entry of that worker's chain

#### Scenario: Session-model tail reflects `sessionFallback`

- **WHEN** `sessionFallback` is `false`
- **THEN** the session-model tail SHALL be rendered as excluded

## ADDED Requirements

### Requirement: Base model is editable through the model picker

The settings section SHALL let the user set, change, and clear the shared base `model` through the same registry-backed picker used for chain entries.

#### Scenario: Setting the base model

- **WHEN** no base `model` is configured and the user picks a model in the base-model control
- **AND** saves
- **THEN** `model` SHALL be written with the picked `provider` and `id`
- **AND** every worker chain's displayed tail SHALL name that model

#### Scenario: Clearing the base model

- **WHEN** a base `model` is configured and the user activates its clear control
- **AND** saves
- **THEN** `model` SHALL be written as absent

### Requirement: Recommended defaults can be staged in one action

The settings section SHALL offer a single "use recommended defaults" action that stages a resilient configuration into the unsaved draft, derived from the live model registry, without writing to disk until the user saves.

#### Scenario: Defaults are staged, not written

- **WHEN** the user activates the recommended-defaults action and the staged result differs from the saved configuration
- **THEN** the draft SHALL be marked dirty and the host save control enabled
- **AND** the configuration file SHALL be unchanged until the user saves

#### Scenario: Staged content

- **WHEN** the registry contains at least one candidate model
- **THEN** the action SHALL stage the same ordered chain (at most three entries, no duplicate `provider/id`, each with `cooldownHours` 1) for the observer, reflector, and dropper workers
- **AND** SHALL stage `debug` and `debugLog` as `true`
- **AND** SHALL leave every other key untouched

#### Scenario: Candidates come from the registry only

- **WHEN** the recommended chain is computed
- **THEN** every entry SHALL be a `provider/id` present in the live registry
- **AND** entries SHALL be ranked by a stated preference over the model id (`flash`, then `haiku`, then `mini`), preserving registry order within a rank
- **AND** a provider not yet present in the chain SHALL be preferred over a higher-ranked model of an already-present provider, filling remaining slots by rank only when fewer than three distinct providers qualify

#### Scenario: No candidate available

- **WHEN** the registry yields no model matching the preference ranking
- **THEN** the action SHALL be disabled
- **AND** an explanation SHALL be visible stating that no flash-, haiku- or mini-class model is available in the registry

#### Scenario: Existing chains are replaced only on confirmation

- **WHEN** any worker chain already has entries and the user activates the action
- **THEN** the user SHALL be asked to confirm before those chains are replaced in the draft
- **AND** declining SHALL leave the draft unchanged

### Requirement: Registry unavailability degrades visibly

When the dashboard model registry cannot be read, the chain editors SHALL remain readable and reorderable but SHALL NOT offer controls that require a registry.

#### Scenario: Registry request fails

- **WHEN** the registry request returns an error, a non-success status, or a malformed body
- **THEN** existing chain entries SHALL still render with their stored `provider` and `id`
- **AND** move, remove, and the per-entry `thinking`, `cooldownHours`, `contextWindow` controls SHALL keep working
- **AND** the add control, the base-model picker, every per-entry model picker, and the recommended-defaults action SHALL be non-interactive
- **AND** a visible message SHALL state that the model registry is unavailable and offer a retry

#### Scenario: Registry lists no models

- **WHEN** the registry request succeeds with an empty model list
- **THEN** the registry-dependent controls SHALL be non-interactive as in the failure case
- **AND** a visible message SHALL state that no credentialed models are available

#### Scenario: Registry request is pending

- **WHEN** the registry request has not yet resolved
- **THEN** the registry-dependent controls SHALL be disabled without showing the unavailable message
