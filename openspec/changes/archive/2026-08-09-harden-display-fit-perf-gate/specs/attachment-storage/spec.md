## MODIFIED Requirements

### Requirement: Fitting SHALL NOT block the server

Image fitting SHALL run off the main event loop. Ingesting an attachment SHALL NOT stall
event processing for other sessions.

Event-loop responsiveness SHALL be verified against a **derived** budget, not an
arbitrary one. The budget SHALL sit above the measured worst-case contention of a
saturated test run and below the smallest measured regression signal, and the
derivation SHALL be recorded alongside the assertion so it can be re-derived
rather than guessed. Both scenarios below SHALL have automated coverage.

#### Scenario: A large paste does not stall the event loop

- **WHEN** a 10 MB attachment is ingested
- **THEN** maximum event-loop lag SHALL remain within the derived budget for the duration
- **AND** other sessions' events SHALL continue to be processed

#### Scenario: Concurrent pastes queue without stalling

- **WHEN** several large attachments are ingested in quick succession
- **THEN** maximum event-loop lag SHALL remain within the same derived budget
- **AND** they SHALL be processed without blocking unrelated event traffic

#### Scenario: The gate fails when the offload regresses

- **WHEN** the worker path is forced to fall back in-process at the production
  pool size, modelling a silent offload regression
- **THEN** the assertion SHALL fail
- **AND** the fallback SHALL be modelled at the pool size production uses, not
  the library default, so the check is anchored to a workload production runs
