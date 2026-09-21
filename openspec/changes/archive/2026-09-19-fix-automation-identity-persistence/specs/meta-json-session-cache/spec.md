## ADDED Requirements

### Requirement: Session classification and run identity are durable

A session's plugin classification and its plugin run identity SHALL be durable:
once stored, they SHALL survive any subsequent save of any unrelated field, and
they SHALL be restored when the session is read back on cold start.

Storing a value when the session is created is not sufficient. The durability
obligation is on the routine save path, because that path replaces the stored
record wholesale rather than merging into it, and on the restore path, because
a stored value that is never read back is indistinguishable from a lost one.

Both SHALL remain optional: a session carrying neither SHALL produce a stored
record byte-identical to one produced before this requirement existed.

#### Scenario: Classification survives an unrelated save

- **WHEN** a session carrying a plugin classification and a run identity has an
  unrelated field changed and its record is saved
- **THEN** the stored record SHALL still carry the classification and the run
  identity with their original values

#### Scenario: Run identity is restored on cold start

- **WHEN** a session carrying a run identity is read back after a restart
- **THEN** the restored session SHALL carry that run identity

#### Scenario: Restored classification keeps a hidden run off the board

- **WHEN** a classified run whose effective board visibility is hidden is
  restored after a restart
- **THEN** it SHALL be filtered off the session board, as it was before the
  restart

#### Scenario: Unclassified session gains no bytes

- **WHEN** a plain user session's record is written
- **THEN** it SHALL carry no classification and no run identity
