## ADDED Requirements

### Requirement: Skill cards SHALL carry a provenance badge

Provenance SHALL be conveyed by a per-card badge and a filter value, consistent with the flat card grid this capability already mandates. It SHALL NOT introduce stacked sections, groups, or nesting.

A skill card SHALL indicate one of: loaded by the session, present for this folder but not loaded, or loaded by the session from outside this folder.

#### Scenario: Active skill

- **GIVEN** a skill with status `active`
- **WHEN** the surface renders its card
- **THEN** no provenance badge SHALL be shown

#### Scenario: Loaded from outside this folder

- **GIVEN** a skill with status `loaded-elsewhere`
- **WHEN** the surface renders its card
- **THEN** the card SHALL carry a badge marking it as loaded by the session but not found for this folder
- **AND** the card SHALL show the path the session reported

#### Scenario: Present but not loaded

- **GIVEN** a skill with status `not-loaded`
- **WHEN** the surface renders its card
- **THEN** the card SHALL carry a badge marking it as present for this folder but not loaded

#### Scenario: Provenance does not introduce grouping

- **WHEN** cards of differing provenance are rendered
- **THEN** they SHALL remain in one flat grid
- **AND** no provenance section header, group header, or chevron SHALL be introduced

#### Scenario: Provenance is filterable

- **WHEN** the user narrows the grid by provenance
- **THEN** the grid SHALL show only cards carrying the selected provenance

### Requirement: A not-loaded card SHALL NOT assert an unverifiable cause

Because discovery already omits paths that fail pi's load gate, a skill reaching `not-loaded` status has a valid description by construction. The surface SHALL therefore report the status without asserting a cause.

#### Scenario: No cause is fabricated

- **GIVEN** a skill with status `not-loaded`
- **WHEN** the surface renders its card
- **THEN** it SHALL report only that the session did not load it
- **AND** it SHALL NOT assert a specific cause

#### Scenario: Differing session scope is surfaced

- **GIVEN** a `not-loaded` skill and a contributing session whose working directory differs from the scanned folder
- **WHEN** the surface renders the card
- **THEN** the differing working directory SHALL be shown as context

### Requirement: Scan-only and degraded states SHALL be visible rather than implied

When no session has reported, when several sessions have reported, or when the scan came from the degraded filesystem fallback, the surface SHALL say so and SHALL NOT present the list as a session's loaded skill set.

#### Scenario: Scan-only payload

- **GIVEN** a payload marked scan-only
- **WHEN** the surface renders the skills grid
- **THEN** it SHALL indicate that no single session is reporting skills
- **AND** no card SHALL display a `not-loaded` badge

#### Scenario: Degraded payload

- **GIVEN** a payload marked degraded because pi's resolver was unavailable or returned a contradicted empty result
- **WHEN** the surface renders the skills grid
- **THEN** it SHALL indicate that the list is a fallback and may not match the session
- **AND** no card SHALL display a `not-loaded` badge
