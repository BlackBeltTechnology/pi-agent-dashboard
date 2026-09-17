## Purpose

Persists a session's human owner as `(iss, sub)`, assigns it only through trusted spawn roads, and enforces exact owner equality on every session read and write road — HTTP and WebSocket, list and detail, bootstrap and replay, subscribe and mutate — so a principal reaches only sessions it owns.

## ADDED Requirements

### Requirement: Session owner is persisted

The system SHALL persist an optional `principalOwner: { iss, sub }` in session metadata and expose it on session summaries. Equality SHALL be exact field comparison (`iss` and `sub` string-equal); the system SHALL NOT normalize, fall back to `email`, or use object identity.

#### Scenario: Owner persisted and surfaced
- **WHEN** a session is created with an owner principal
- **THEN** its metadata records `principalOwner` and summaries expose it

### Requirement: Ownership is assigned only through trusted roads

The system SHALL set `principalOwner` only from: a browser `spawn_session` (stamping `ws.principal`), a host HTTP spawn (stamping `request.principal`), or a trusted policy plugin passing the current request principal through the trusted owned-spawn API. An untrusted plugin SHALL NOT set an owner. Automation, scheduler, and legacy sessions SHALL remain ownerless.

#### Scenario: Browser spawn stamps the socket principal
- **WHEN** a principal-bearing socket spawns a session in multi-user mode
- **THEN** the new session's owner is that socket's principal

#### Scenario: Untrusted plugin cannot set an owner
- **WHEN** an untrusted plugin supplies an owner field on spawn
- **THEN** the owner is ignored and the session is ownerless unless a trusted road set it

#### Scenario: Automation session is ownerless
- **WHEN** a scheduler tick spawns a session with no originating principal
- **THEN** the session has no `principalOwner`

### Requirement: Owner equality gates every session read and write road

The system SHALL require exact owner equality before serving or mutating a session on every road: HTTP detail/transcript/mutation; WebSocket bootstrap session snapshot; list and pagination results; subscribe; replay/backfill; and inbound session commands (prompt, abort, retry, kill, rename, archive, metadata, and the like). A socket or request with no principal SHALL be refused every owned session. List and snapshot roads SHALL filter per item, never authorize the container and then return other owners' sessions.

#### Scenario: Owner streams their own session
- **WHEN** a principal equal to a session's owner subscribes or replays
- **THEN** the operation is accepted

#### Scenario: Non-owner is refused on every road
- **WHEN** a principal not equal to a session's owner subscribes, replays, reads detail, or sends a session command
- **THEN** each operation is refused identically and no frames or data are delivered

#### Scenario: List is filtered per item
- **WHEN** a principal requests a session list or page
- **THEN** only sessions it owns are returned, not the full registry

#### Scenario: Principal-less socket is refused an owned session
- **WHEN** a socket with `ws.principal === null` accesses an owned session on any road in multi-user mode
- **THEN** the access is refused

### Requirement: Ownerless sessions are hidden from human principals

The system SHALL treat an ownerless session as owned by no human, so no principal-bearing socket may read, stream, or mutate it via owner equality in multi-user mode. Adoption/backfill of ownerless sessions SHALL be a deliberate operator action, not an implicit email or cwd match.

#### Scenario: Ownerless session not reachable by a human
- **WHEN** a principal-bearing socket accesses a session that has no owner
- **THEN** the owner-equality check fails and access is refused
