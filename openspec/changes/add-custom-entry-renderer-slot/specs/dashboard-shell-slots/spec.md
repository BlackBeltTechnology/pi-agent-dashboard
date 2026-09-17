## ADDED Requirements

### Requirement: `custom-entry-renderer` slot

The system SHALL expose a `custom-entry-renderer` slot allowing a plugin to own the rendering
of a chat custom entry, keyed by the entry's `customType`. The slot SHALL accept many
contributions, SHALL accept React payloads only, and SHALL take no predicate input (gating is
via `shouldRender` only), matching the `tool-renderer` slot's classification.

#### Scenario: Claim declares a customType

- **WHEN** a plugin manifest declares a claim with `slot: "custom-entry-renderer"`
- **THEN** the claim SHALL require a non-empty `customType` string and a `component`
- **AND** a claim missing either SHALL be rejected with a manifest validation error naming the
  plugin and the claim index

#### Scenario: Claim matches by exact customType

- **GIVEN** a plugin claims `custom-entry-renderer` for `customType` `"om.reflections.recorded"`
- **WHEN** the chat renders a custom row whose `customType` is `"om.reflections.recorded"`
- **THEN** the plugin's component SHALL render that row
- **AND** a row whose `customType` is `"om.reflections"` or `"om.reflections.recorded.v2"` SHALL
  NOT match that claim

#### Scenario: Two plugins claim the same customType

- **WHEN** plugin A and plugin B both claim `custom-entry-renderer` for the same `customType`
- **THEN** exactly one claim SHALL render, selected by the slot system's existing precedence
  (priority, then plugin id)
- **AND** the losing claim SHALL NOT render alongside it

#### Scenario: shouldRender gates the claim fail-closed

- **GIVEN** a `custom-entry-renderer` claim declaring a `shouldRender` gate
- **WHEN** the gate returns false, or throws
- **THEN** the claim SHALL NOT render
- **AND** resolution SHALL continue to the next claim, then to the generic fallback
