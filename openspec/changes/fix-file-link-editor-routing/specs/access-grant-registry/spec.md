## MODIFIED Requirements

### Requirement: A pending access request is recorded per plane and subject

The server SHALL maintain a registry of pending access requests. Each entry
SHALL be keyed by the triple of its **plane**, its **action** (`read` or `write`,
default `read`) and its **normalised subject**, never by the subject alone. Each plane SHALL own the normalisation of its own subjects,
and a filesystem subject SHALL be normalised to the same canonical form the
persisted grant store uses, so a verdict and the grant it produces cannot refer
to different things.

#### Scenario: Two planes with the same subject string do not collide

- **GIVEN** a pending request on one plane whose subject string equals a subject string on another plane
- **WHEN** a verdict settles one of them
- **THEN** the other SHALL remain pending

#### Scenario: A repeat denial coalesces

- **WHEN** a denial arrives for a plane and subject that already has a pending entry
- **THEN** it SHALL join the existing entry rather than creating a second one
- **AND** at most one dialog SHALL be outstanding for that plane and subject

#### Scenario: An unknown-cwd denial does not join a path-grant entry

- **GIVEN** a pending path-grant request for a directory
- **WHEN** an unknown-working-directory denial arrives naming the same directory
- **THEN** it SHALL be recorded as a separate entry, so the verdict applies the correct remedy

#### Scenario: Concurrent writes coalesce and allow-once admits only the first

- **GIVEN** a held write for `/out/a.md` and a second write for `/out/b.md` (same directory subject) joined onto the same entry
- **WHEN** the operator answers allow-once
- **THEN** only the request that raised the prompt SHALL be admitted, the joined request SHALL be refused (`403`, as a coalesced read is today), no grant SHALL be persisted, and a later write SHALL prompt again
- **WHEN** the operator answers allow-always instead
- **THEN** both held requests SHALL be released and re-evaluated against the persisted write grant

#### Scenario: A write denial does not join a read entry

- **GIVEN** a pending read request for a directory
- **WHEN** a write denial arrives naming the same directory
- **THEN** it SHALL be a separate entry, and a verdict on the read entry SHALL NOT release or grant the write
