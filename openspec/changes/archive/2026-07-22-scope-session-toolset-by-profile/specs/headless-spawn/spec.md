## ADDED Requirements

### Requirement: Headless spawn forwards a caller-supplied environment

A headless spawn SHALL accept an optional caller-supplied environment map and
forward it into the spawned process's environment. This caller env SHALL be
merged with the guard environment such that neither source overwrites the other's
distinct keys, and on any key collision the guard environment SHALL take
precedence over the caller-supplied value. When no caller env is supplied, the
spawned process environment SHALL be byte-identical to the environment produced
without this feature.

#### Scenario: Caller env reaches the spawned process

- **WHEN** a headless spawn is requested with a caller-supplied environment map
- **THEN** each supplied key SHALL be present with its supplied value in the
  spawned process's environment

#### Scenario: Guard env wins on key collision

- **WHEN** a guarded headless spawn is requested with a caller-supplied env whose
  key also appears in the guard environment
- **THEN** the spawned process SHALL receive the guard environment's value for
  that key, not the caller-supplied value

#### Scenario: No caller env is a no-op

- **WHEN** a headless spawn is requested without a caller-supplied env
- **THEN** the spawned process environment SHALL be unchanged from prior behavior
