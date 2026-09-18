## MODIFIED Requirements

### Requirement: Custom rows SHALL render as a bounded generic fallback
The chat SHALL resolve a `role: "custom"` row's renderer as a chain: a matching
`custom-entry-renderer` plugin claim first, then the generic fallback card. The generic
fallback SHALL show the `customType` as a label and the payload as PLAIN TEXT (never
markdown-interpreted), with the display body truncated to the same last-200-lines form the
event store already enforces. Rendering SHALL be gated by the effective visibility of the
custom event group that the row's `customType` resolves to (first-match-wins, falling back to
the catch-all `other` group), applied at render time only. The same gate SHALL be applied
consistently at every site that decides whether a custom row is visible, so a hidden row is
excluded from row-visibility computations as well as from rendering, INCLUDING when the row has
been absorbed into a tool burst. The gate SHALL apply to plugin-claimed rows exactly as it
applies to fallback rows.

#### Scenario: payload renders as plain text
- **WHEN** a `role: "custom"` row renders via the generic fallback
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

## ADDED Requirements

### Requirement: A failing plugin renderer SHALL degrade to the generic fallback

A `custom-entry-renderer` component that throws during render SHALL NOT break the transcript.
The system SHALL contain the failure per row and SHALL render the generic fallback card in its
place, so a custom row is never reduced to a blank space or an error screen.

#### Scenario: Throwing renderer falls back

- **GIVEN** a plugin claims a `customType` and its component throws on render
- **WHEN** the chat renders that row
- **THEN** the generic fallback card SHALL render in its place
- **AND** surrounding rows SHALL render normally

### Requirement: Claimed renderers SHALL NOT fetch payloads until expanded

A plugin renderer's collapsed presentation SHALL be derivable from the chat row alone. The
system SHALL NOT issue a payload request for a custom row that is rendered but not expanded, so
a transcript containing thousands of claimed rows costs no additional requests at rest.

#### Scenario: Collapsed rows issue no requests

- **GIVEN** a transcript containing claimed custom rows, none expanded
- **WHEN** the chat renders
- **THEN** no custom-entry payload request SHALL be issued

#### Scenario: Expansion issues exactly one request

- **WHEN** the user expands a single claimed custom row that carries an entry id
- **THEN** exactly one payload request SHALL be issued, for that row's entry

#### Scenario: Row without an entry id offers no expand affordance

- **GIVEN** a claimed custom row carrying no entry id (the reducer does not stamp one on custom
  rows originating from a custom message rather than an appended entry)
- **WHEN** the row renders
- **THEN** the collapsed presentation SHALL render normally
- **AND** the row SHALL NOT offer an expand affordance, rather than offering one whose request
  can never be issued

#### Scenario: Collapsed summary never reports a partial count

- **GIVEN** a claimed custom row carrying an entry id, whose stored body was truncated and cannot
  be parsed as a complete payload
- **WHEN** the collapsed presentation renders
- **THEN** it SHALL NOT display a count or summary derived from the partial body
- **AND** it SHALL still offer the expand affordance

### Requirement: Payload unavailability SHALL degrade to the stored body

When an expanded renderer cannot obtain the structured payload — because the entry was evicted,
or the request failed — the system SHALL present the row's stored truncated body as plain text.
Expansion SHALL therefore never show less than the generic fallback already shows.

#### Scenario: Evicted entry falls back to the stored body

- **GIVEN** a claimed custom row whose entry is no longer retrievable
- **WHEN** the user expands it
- **THEN** the stored truncated body SHALL render as plain text
- **AND** no markdown rendering or linkification SHALL be applied to it
