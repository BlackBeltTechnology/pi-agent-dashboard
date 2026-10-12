## MODIFIED Requirements

### Requirement: Custom rows SHALL render as a bounded generic fallback
The chat SHALL resolve a `role: "custom"` row's renderer as a chain: a matching
`custom-entry-renderer` plugin claim first, then the generic fallback card. The generic
fallback SHALL show the `customType` as a label and the payload as PLAIN TEXT (never
markdown-interpreted, never linkified), with the display body truncated to the same last-200-lines form the
event store already enforces. When the display body is untruncated and parses as a JSON object,
that plain text SHALL be laid out as a bounded key/value view (see the structured-view
scenarios); every other body SHALL render as a single plain-text block. Rendering SHALL be gated by the effective visibility of the
custom event group that the row's `customType` resolves to (first-match-wins, falling back to
the catch-all `other` group), applied at render time only. The same gate SHALL be applied
consistently at every site that decides whether a custom row is visible, so a hidden row is
excluded from row-visibility computations as well as from rendering, INCLUDING when the row has
been absorbed into a tool burst. The gate SHALL apply to plugin-claimed rows exactly as it
applies to fallback rows.

#### Scenario: payload renders as plain text
- **WHEN** a `role: "custom"` row renders via the generic fallback and its body is not an untruncated JSON object
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

#### Scenario: plugin claim wins over the fallback
- **GIVEN** a plugin claims `custom-entry-renderer` for a row's `customType`
- **WHEN** that row renders
- **THEN** the plugin's component SHALL render it
- **AND** the generic fallback card SHALL NOT render for that row

#### Scenario: hidden group suppresses a claimed row too
- **GIVEN** a `role: "custom"` row that a plugin claims, whose group visibility is `false`
- **WHEN** the chat renders
- **THEN** the plugin's component SHALL NOT render
- **AND** the row SHALL be excluded from row-visibility computations

#### Scenario: gate holds for a row absorbed into a burst
- **GIVEN** a claimed custom row absorbed into a tool burst
- **WHEN** the burst is EXPANDED and that row's group visibility is `false`
- **THEN** the absorbed row SHALL render nothing inside the expanded burst

#### Scenario: absorbed row survives an empty container
- **GIVEN** a claimed custom row absorbed into a tool burst whose tool members are all hidden by
  the per-tool call visibility preference
- **WHEN** the chat renders and that row's own custom event group is visible
- **THEN** the row SHALL still render
- **AND** the container SHALL NOT suppress it merely because no tool member survived the
  per-tool gate

#### Scenario: absorbed row still renders when its group is visible
- **GIVEN** a claimed custom row absorbed into a tool burst
- **WHEN** the burst is EXPANDED and that row's group visibility is `true`
- **THEN** the plugin's component SHALL render for that row inside the expanded burst
- **AND** it SHALL offer the same collapsed presentation and expand affordance it offers at top
  level, so absorption changes a row's POSITION and never its content

#### Scenario: untruncated object body renders as key/value list
- **GIVEN** a fallback row whose body is `{"cause":"cap","inFlight":2,"reason":"Refused…"}`
- **WHEN** the row renders
- **THEN** the card SHALL show the `customType` label and one entry per key: `cause`, `inFlight`, `reason`
- **AND** each key and value SHALL be shown as plain text

#### Scenario: nested values render compactly
- **GIVEN** a fallback row whose object body has a key whose value is an array or object
- **WHEN** the row renders
- **THEN** that value SHALL render as compact serialized JSON text under its key
- **AND** it SHALL NOT be passed through markdown rendering or linkification

#### Scenario: line-truncated body keeps the plain-text form
- **GIVEN** a fallback row whose body begins with the `«N earlier lines hidden»` marker
- **WHEN** the row renders
- **THEN** the card SHALL render the body as plain text
- **AND** it SHALL NOT attempt a structured view

#### Scenario: character-capped body keeps the plain-text form
- **GIVEN** a fallback row whose body was cut to the display character ceiling, even if the remaining tail parses as a JSON object
- **WHEN** the row renders
- **THEN** the card SHALL render the body as plain text
- **AND** it SHALL NOT attempt a structured view

#### Scenario: non-object body keeps the plain-text form
- **GIVEN** a fallback row whose body is prose, a JSON array, a JSON scalar, `null`, or unparseable text
- **WHEN** the row renders
- **THEN** the card SHALL render the body as plain text

#### Scenario: key count is bounded
- **GIVEN** a fallback row whose object body has more than 50 top-level keys
- **WHEN** the row renders
- **THEN** only the first 50 keys SHALL be listed
- **AND** the card SHALL show how many further keys were omitted

#### Scenario: HTML-looking values stay inert
- **GIVEN** a fallback row whose object body has a value `"<img src=x onerror=alert(1)>"` or `"[x](javascript:alert(1))"`
- **WHEN** the row renders
- **THEN** the value SHALL appear as literal text
- **AND** no element, link, or script SHALL be created from it

#### Scenario: hostile body never breaks the transcript
- **GIVEN** a fallback row whose body is pathologically nested or otherwise makes parsing or serialization fail
- **WHEN** the row renders
- **THEN** the card SHALL render the body as plain text
- **AND** surrounding rows SHALL render normally
