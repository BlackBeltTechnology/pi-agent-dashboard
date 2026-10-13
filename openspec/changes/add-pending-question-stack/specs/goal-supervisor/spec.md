## ADDED Requirements

### Requirement: Goal driver sessions wait indefinitely for answers

Goal driver sessions, including respawned drivers, SHALL be spawned with the
per-session ask_user timeout override set to infinite wait (`extensionConfig: {
"pi-dashboard": { askUserPromptTimeoutSeconds: "0" } }`), so a driver's question
stays answerable until answered or the driver session ends.

#### Scenario: Driver question outlives the global timeout

- **GIVEN** the global ask_user timeout is 300 seconds
- **WHEN** a goal driver asks a question and nobody answers for 10 minutes
- **THEN** the question SHALL still be pending

#### Scenario: Respawned driver keeps the override

- **WHEN** the supervisor respawns a driver
- **THEN** the new driver session SHALL also carry the infinite-wait override
