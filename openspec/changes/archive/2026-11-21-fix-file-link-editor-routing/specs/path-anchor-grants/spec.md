## MODIFIED Requirements

### Requirement: Persisted path-anchor grant store

The system SHALL persist granted filesystem directories at `~/.pi/dashboard/access-grants.json`. Each entry SHALL record the granted directory subject, its scope, the time it was granted, the origin that requested it and, optionally, an access `mode` of `"write"` (absent = read). A missing or malformed store SHALL be treated as empty.

This store is deliberately richer than `worktree-init-trust.json`, which is a flat map of key to `true` carrying no subject, time, or origin — those three fields are required here because the Access tab must display them. Scope SHALL follow the existing `"session" | "project"` convention, where a session-scoped grant lives only in memory and does not survive a restart.

#### Scenario: First grant creates the store

- **GIVEN** no grant store file exists
- **WHEN** a user grants a directory
- **THEN** the store SHALL be created containing that subject

#### Scenario: Malformed store degrades to empty

- **WHEN** the store file is unreadable or not valid JSON
- **THEN** it SHALL be treated as holding no grants
- **AND** containment SHALL fall back to derived anchors only

#### Scenario: Project-scoped grants survive restart

- **GIVEN** a subject was granted at project scope
- **WHEN** the server restarts
- **THEN** the grant SHALL still be in effect

#### Scenario: Session-scoped grants do not survive restart

- **GIVEN** a subject was granted at session scope
- **WHEN** the server restarts
- **THEN** the grant SHALL no longer be in effect

#### Scenario: A pre-change store loads as read-only grants

- **GIVEN** a store written before write mode existed (no `mode` on any entry, `version: 1`)
- **WHEN** it is loaded
- **THEN** every grant SHALL be a read grant and the file SHALL NOT be rewritten

#### Scenario: An unknown mode value loads as read

- **GIVEN** a store entry whose `mode` is anything other than `"write"`
- **WHEN** it is loaded
- **THEN** it SHALL be treated as a read grant

### Requirement: Grants are revocable and revocation takes effect immediately

The system SHALL support removing a grant, optionally by mode. After revocation, paths that were allowed only by that grant SHALL be refused again without requiring a restart. Revoking a subject without a mode SHALL remove every entry for it; revoking with `mode: "write"` SHALL remove only the write entry and leave a read entry for the same subject.

#### Scenario: Revoked anchor stops admitting

- **GIVEN** `/a/b` was granted and a read under it succeeds
- **WHEN** the grant is revoked
- **THEN** a subsequent read under `/a/b` SHALL be refused

#### Scenario: Revoking only the write mode keeps the read grant

- **GIVEN** `/a/b` has both a read grant and a write grant
- **WHEN** the write grant is revoked with `mode: "write"`
- **THEN** a write under `/a/b` SHALL prompt again and a read under `/a/b` SHALL still succeed

## ADDED Requirements

### Requirement: A grant has an access mode and only a write grant admits writes

A grant SHALL be a read grant unless it carries `mode: "write"`. A write grant SHALL admit reads and allowlisted text-document writes under its subtree; a read grant, provisioning and agent-prompt grants, and bound-checkout-root widening SHALL NOT admit a write outside the session cwd. The mode of a new grant SHALL be taken from the server-held denial that produced it, never from a client field.

#### Scenario: Write grant also admits reads

- **GIVEN** a write grant for `/a/b`
- **WHEN** a read under `/a/b` is checked
- **THEN** it SHALL be allowed

#### Scenario: Read grant never admits a write

- **GIVEN** a read grant for `/a/b`
- **WHEN** an out-of-cwd text-document write under `/a/b` is checked
- **THEN** it SHALL not be admitted by that grant

#### Scenario: Client-supplied mode is ignored

- **GIVEN** a grant request carrying `mode: "write"` bound to a read denial
- **WHEN** the grant is recorded
- **THEN** it SHALL be a read grant

#### Scenario: A pre-change build reads a write grant as read

- **GIVEN** a store with a write grant opened by a build that predates write mode
- **WHEN** that build loads it
- **THEN** it SHALL treat the entry as a read grant and preserve its `mode` field when it rewrites the store
