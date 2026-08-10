# viewed-session-unread-gating Specification

## Purpose

Track which WebSocket connections are currently displaying each session's chat panel, and expose a global read-state gate that suppresses unread stamps for any session at least one connected browser is actively watching. Read state is global across browsers: a session counts as viewed when any connected client has it open, so opening the session on one device clears/suppresses unread everywhere.

## Requirements

### Requirement: Per-session viewer registration

The tracker SHALL maintain an in-memory per-session set of the WebSocket connections currently viewing that session, registering and unregistering connections idempotently. State SHALL NOT be persisted.

#### Scenario: Register a viewer

- **WHEN** a connection is marked as viewing a session
- **THEN** the connection is added to that session's viewer set
- **AND** the session becomes reported as viewed

#### Scenario: Idempotent registration

- **WHEN** the same connection is marked as viewing the same session more than once
- **THEN** the connection appears only once in the viewer set
- **AND** the viewer count for that session does not increase beyond one for that connection

#### Scenario: Unregister a viewer

- **WHEN** a connection is marked as no longer viewing a session it was viewing
- **THEN** the connection is removed from that session's viewer set

#### Scenario: Unregister an unknown viewer

- **WHEN** a connection is marked as no longer viewing a session it was never viewing
- **THEN** the tracker leaves state unchanged and takes no further action

### Requirement: Last-viewer cleanup

When the final viewer of a session is removed, the tracker SHALL discard the session's now-empty viewer set so an unviewed session reports zero viewers and is no longer viewed.

#### Scenario: Last viewer leaves

- **WHEN** the only remaining viewer of a session is unregistered
- **THEN** the session's viewer set is discarded
- **AND** the session is reported as not viewed
- **AND** the viewer count for the session is zero

#### Scenario: One of several viewers leaves

- **WHEN** a viewer is unregistered while other connections still view the same session
- **THEN** the session remains reported as viewed
- **AND** the viewer count reflects the remaining viewers

### Requirement: Global viewed query

The tracker SHALL report a session as viewed when at least one connected browser has it open, and SHALL expose the number of viewers for a session.

#### Scenario: Viewed by at least one connection

- **WHEN** the viewed state of a session with one or more viewers is queried
- **THEN** the tracker reports the session as viewed

#### Scenario: Not viewed by anyone

- **WHEN** the viewed state of a session with no viewers is queried
- **THEN** the tracker reports the session as not viewed
- **AND** the viewer count for the session is zero

### Requirement: Disconnect cleanup

When a WebSocket connection closes, the tracker SHALL remove that connection from every session it was viewing so a disconnected browser cannot hold sessions in the viewed state, discarding any viewer set left empty.

#### Scenario: Connection removed from all viewed sessions

- **WHEN** a connection viewing multiple sessions is dropped from all viewed sessions on disconnect
- **THEN** the connection is removed from every session's viewer set
- **AND** any session whose last viewer was that connection is reported as not viewed

### Requirement: Viewing suppresses unread stamping

For a live (non-replay) forwarded event that qualifies as an unread trigger, the system SHALL stamp the session unread and broadcast the update only when no browser is currently viewing the session; when the session is viewed by anyone, the unread stamp SHALL be suppressed.

#### Scenario: Unread trigger on an unwatched session

- **WHEN** a live event qualifies as an unread trigger and no connection is viewing the session
- **AND** the session is not already unread
- **THEN** the session is stamped unread
- **AND** an unread update is broadcast to browsers

#### Scenario: Unread trigger on an actively-watched session

- **WHEN** a live event qualifies as an unread trigger and at least one connection is viewing the session
- **THEN** the unread stamp is suppressed and the session is not marked unread

#### Scenario: Already-unread session

- **WHEN** a live event qualifies as an unread trigger on an unwatched session that is already unread
- **THEN** no redundant unread update is applied or broadcast

### Requirement: Opening a session registers viewing and clears unread

When a browser declares it is displaying a session, the system SHALL register the connection as a viewer of that session and, if the session is currently unread, clear the unread state and broadcast the cleared update. When a browser declares it is no longer displaying the session, the system SHALL unregister the connection.

#### Scenario: Browser opens an unread session

- **WHEN** a browser declares it is displaying a session that is currently unread
- **THEN** the connection is registered as a viewer of the session
- **AND** the session's unread state is cleared
- **AND** a cleared-unread update is broadcast to browsers

#### Scenario: Browser opens an already-read session

- **WHEN** a browser declares it is displaying a session that is not unread
- **THEN** the connection is registered as a viewer of the session
- **AND** no unread update is broadcast

#### Scenario: Browser stops viewing a session

- **WHEN** a browser declares it is no longer displaying a session
- **THEN** the connection is unregistered from that session's viewer set
