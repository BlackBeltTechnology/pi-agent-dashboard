## Purpose

Defines how the blackhole plugin presents the `pi-blackhole` extension's observation-memory
ledger entries in the chat transcript, so a high-volume stream of `om.*` records reads as
compact, meaningful rows instead of raw JSON blobs.

## ADDED Requirements

### Requirement: The plugin SHALL claim the observation-memory entry types

The blackhole plugin SHALL claim the `custom-entry-renderer` slot for `om.observations.recorded`,
`om.reflections.recorded`, and `om.observations.dropped`. It SHALL NOT claim any other
`customType`, so entry types the plugin does not understand keep the generic fallback rendering.

#### Scenario: Claimed type renders through the plugin

- **WHEN** the chat renders a custom row whose `customType` is one of the three claimed types
- **THEN** the blackhole renderer SHALL render it

#### Scenario: Unclaimed om type keeps the fallback

- **GIVEN** a custom row whose `customType` is an `om.*` value the plugin does not claim
- **WHEN** the chat renders it
- **THEN** the generic fallback card SHALL render it

#### Scenario: Compaction-borne fold metadata is not a chat row

- **GIVEN** a session containing compaction entries carrying `om.folded` metadata
- **WHEN** the chat renders
- **THEN** no custom row SHALL be produced for that metadata
- **AND** the plugin SHALL NOT claim `om.folded`

### Requirement: Claimed rows SHALL render collapsed by default

Each claimed row SHALL render as a single compact line identifying the kind of ledger event,
with an affordance to expand. The collapsed line SHALL be derived from the chat row alone and
SHALL NOT require the full payload.

#### Scenario: Collapsed line identifies the event

- **WHEN** a claimed row renders without being expanded
- **THEN** it SHALL occupy a single line identifying the ledger event kind
- **AND** it SHALL offer an expand affordance

#### Scenario: Parseable body yields a count

- **GIVEN** a claimed row whose stored body is complete and parseable
- **WHEN** it renders collapsed
- **THEN** the line MAY report the number of records the event carries

#### Scenario: Truncated body omits the count

- **GIVEN** a claimed row whose stored body was truncated
- **WHEN** it renders collapsed
- **THEN** the line SHALL omit any record count rather than report a partial one

### Requirement: Expanded rows SHALL present the ledger records structurally

On expansion, the renderer SHALL present the event's records as discrete items rather than one
JSON blob: recorded observations and reflections SHALL show their content, and dropped
observations SHALL show which records were dropped. All record text SHALL render as plain text,
never markdown-interpreted or linkified, because it is extension-authored input.

#### Scenario: Observations expand as discrete records

- **WHEN** the user expands an `om.observations.recorded` row
- **THEN** each observation SHALL render as its own item showing its content
- **AND** the content SHALL render as plain text

#### Scenario: Reflections expand as discrete records

- **WHEN** the user expands an `om.reflections.recorded` row
- **THEN** each reflection SHALL render as its own item showing its content

#### Scenario: Dropped observations identify what was dropped

- **WHEN** the user expands an `om.observations.dropped` row
- **THEN** it SHALL identify the dropped observation records

#### Scenario: Record text is never interpreted

- **GIVEN** a record whose content contains markdown syntax or a URL
- **WHEN** it renders expanded
- **THEN** it SHALL appear verbatim as plain text
- **AND** SHALL NOT be rendered as markdown or turned into a link
