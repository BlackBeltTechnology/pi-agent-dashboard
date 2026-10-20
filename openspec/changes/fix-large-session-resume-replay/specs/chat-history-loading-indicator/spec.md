# Spec Delta

## ADDED Requirements

### Requirement: Heartbeats while a subscriber waits for a bridge replay
When a subscribe waits for a bridge replay instead of loading from disk, the server SHALL send the same empty `event_replay { events: [], isLast: false }` keepalive to that subscriber on the cold-load heartbeat interval. It SHALL stop the keepalive before it sends the replay exit flush or the unregister terminal batch to that subscriber, and when the subscriber leaves. No keepalive SHALL follow a terminal batch.

#### Scenario: Keepalive during a slow bridge replay
- **WHEN** a subscriber waits for a bridge replay that is still running after one heartbeat interval
- **THEN** the server SHALL send it an empty `event_replay { events: [], isLast: false }`

#### Scenario: Keepalive stops before the flush
- **WHEN** the replay exit flush is sent to a waiting subscriber
- **THEN** no empty non-terminal marker SHALL reach that subscriber after the flush's `isLast: true` batch

#### Scenario: Keepalive stops on unregister
- **WHEN** the session is unregistered while a subscriber waits
- **THEN** the keepalive SHALL stop and the subscriber SHALL receive a terminal `event_replay` batch
