## Purpose

Ensures a WebSocket may stream a session's frames only when the socket's principal owns that session, enforced identically on live subscription and on historical replay.

## ADDED Requirements

### Requirement: Owner-equality on subscribe

The system SHALL compare the subscribing socket's `ws.principal` against the target session's owner and SHALL refuse the subscription when they are not equal. A socket with no principal SHALL be refused any owned session.

#### Scenario: Owner subscribes to their own session
- **WHEN** a socket whose `ws.principal` equals a session's owner subscribes to it
- **THEN** the subscription is accepted and live frames flow

#### Scenario: Non-owner is refused
- **WHEN** a socket whose `ws.principal` does not equal a session's owner subscribes to it
- **THEN** the subscription is refused and no frames are delivered

#### Scenario: Principal-less socket is refused an owned session
- **WHEN** a socket with `ws.principal === null` subscribes to a session that has an owner
- **THEN** the subscription is refused

### Requirement: The same guard applies to replay

The system SHALL apply the identical owner-equality check to the replay (backlog) path, so historical frames cannot be obtained by a non-owner that a live subscription would refuse.

#### Scenario: Replay refused for a non-owner
- **WHEN** a non-owner requests replay of a session's backlog
- **THEN** the replay is refused with the same outcome as a refused subscribe
- **AND** no historical frames are delivered

### Requirement: Ownerless sessions are excluded from human sockets

The system SHALL treat a session with no owner (e.g. spawned by an automation tick or before this plane assigns owners) as not owned by any human principal, so no principal-bearing socket may subscribe to it via owner-equality.

#### Scenario: Ownerless session not streamable by a human socket
- **WHEN** a socket with a non-null principal subscribes to a session that has no owner
- **THEN** the owner-equality check fails and the subscription is refused
