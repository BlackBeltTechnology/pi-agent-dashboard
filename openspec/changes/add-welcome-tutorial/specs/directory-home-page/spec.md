## ADDED Requirements

### Requirement: Marker page replaces the centered prompt
When the directory has a valid folder home marker, the bare `/folder/:encodedCwd` route SHALL render the marker page in the home frame instead of the centered prompt. When `showPrompt` is true, a compact prompt that spawns in that directory SHALL render below the frame. When the marker is absent or invalid, the existing directory home content SHALL render unchanged.

#### Scenario: Marker present
- **GIVEN** directory `D` has a valid `.pi/home.json`
- **WHEN** the user opens `/folder/<encoded D>`
- **THEN** the marker page SHALL render and the centered prompt SHALL NOT render

#### Scenario: Marker absent
- **GIVEN** directory `D` has no marker
- **WHEN** the user opens `/folder/<encoded D>`
- **THEN** the centered prompt, session list and quick actions SHALL render as before

#### Scenario: Invalid marker fails open
- **GIVEN** `D/.pi/home.json` is malformed
- **WHEN** the user opens `/folder/<encoded D>`
- **THEN** the existing directory home SHALL render and the invalid marker SHALL be logged

#### Scenario: Deeper routes unaffected
- **GIVEN** `D` has a valid marker
- **WHEN** the user opens `/folder/<encoded D>/terminals`
- **THEN** the terminals surface SHALL render
