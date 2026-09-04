## MODIFIED Requirements

### Requirement: Custom rows SHALL render as a bounded generic fallback
The chat SHALL render `role: "custom"` rows with a generic card showing the `customType` as a label and the payload as PLAIN TEXT (never markdown-interpreted), with the display body truncated to the same last-200-lines form the event store already enforces. Rendering SHALL be gated by the effective visibility of the custom event group that the row's `customType` resolves to (first-match-wins, falling back to the catch-all `other` group), applied at render time only. The same gate SHALL be applied consistently at every site that decides whether a custom row is visible, so a hidden row is excluded from row-visibility computations as well as from rendering.

#### Scenario: payload renders as plain text
- **WHEN** a `role: "custom"` row renders
- **THEN** the card SHALL show the `customType` label and the payload body as plain text
- **AND** the body SHALL NOT be passed through markdown rendering or linkification

#### Scenario: body is truncated to the display ceiling
- **WHEN** a custom payload exceeds 200 lines
- **THEN** the rendered body SHALL be the last 200 lines prefixed by the `«N earlier lines hidden»` marker, identical for live and replayed rows

#### Scenario: preference suppresses the fallback
- **GIVEN** a `role: "custom"` row whose `customType` resolves to group `memory`
- **WHEN** the effective visibility of `memory` is `false`
- **THEN** that row SHALL render nothing
- **AND** toggling the group back on SHALL make it visible again without a replay

#### Scenario: groups are independently gated
- **GIVEN** rows whose `customType` values resolve to different groups
- **WHEN** one group's visibility is `false` and another's is `true`
- **THEN** only the rows belonging to the hidden group SHALL be suppressed
- **AND** rows belonging to the visible group SHALL continue to render

#### Scenario: ungrouped type follows the catch-all
- **GIVEN** a `role: "custom"` row whose `customType` matches no configured group
- **WHEN** the effective visibility of the `other` group is `false`
- **THEN** that row SHALL render nothing

### Requirement: flow-event entries keep their dedicated rendering
`customType: "flow-event"` entries SHALL continue down their existing dedicated path (seq-sorted flow-card reduction on replay, flow reducer live) and SHALL never be claimed by the generic custom-entry fallback, and SHALL never be gated by a custom event group toggle.

#### Scenario: flow-event is not double-rendered
- **WHEN** state replay encounters a persisted `type: "custom"` entry with `customType: "flow-event"`
- **THEN** it SHALL synthesize the flow events per the existing seq-sorted behavior
- **AND** it SHALL NOT emit a `custom_entry` event for it

#### Scenario: flow cards ignore group visibility
- **GIVEN** every custom event group is toggled off
- **WHEN** the chat renders a flow card
- **THEN** the flow card SHALL still render

## ADDED Requirements

### Requirement: Custom event group toggles SHALL appear in both display surfaces
Both display-preference surfaces — the global settings panel and the per-session chat view menu — SHALL render one
toggle per configured custom event group, labelled with the group's configured label, in the configured group order,
including the catch-all `other` group. No additional surface (inline click-to-hide, per-`customType` control) SHALL be
introduced. The per-session surface SHALL show its existing "overridden" indicator when a group's value comes from the
session override rather than the global value.

#### Scenario: Both surfaces list every configured group
- **WHEN** either the global settings panel or the per-session chat view menu renders its display-preferences section
- **THEN** it SHALL list one toggle per configured group, including `other`, in configured order

#### Scenario: Global toggle applies with no session selected
- **GIVEN** no session is selected
- **WHEN** the user toggles a group off in the global settings panel
- **THEN** the change SHALL persist globally
- **AND** SHALL apply to sessions that have no override for that group

#### Scenario: Per-session toggle overrides only that group
- **GIVEN** a global value for group `memory`
- **WHEN** the user toggles `memory` in the per-session chat view menu
- **THEN** only that session's effective `memory` visibility SHALL change
- **AND** every other group in that session SHALL continue to follow the global value
- **AND** the surface SHALL indicate that the value is overridden for this session

#### Scenario: Legacy single custom-entry toggle is gone
- **WHEN** either surface renders its display-preferences section after upgrade
- **THEN** no single combined "custom entries in chat" toggle SHALL be present
- **AND** its behavior SHALL be reachable through the `other` group toggle
