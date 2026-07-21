# invoicebot-app-level-events Specification

## Purpose
TBD - created by archiving change surface-invoice-domain-events-app-level. Update Purpose after archive.
## Requirements
### Requirement: App-level domain-event channel

The server SHALL rebroadcast forwarded InvoiceBot lifecycle domain events
(stable renamed `ib_*` types) to every connected browser on an app-level
channel — a dedicated `ServerToBrowser` message type — independent of any
per-session subscription. The app-level frame SHALL carry the originating
`sessionId` and the event payload verbatim. The existing per-session event
stream SHALL be preserved unchanged (this behaviour is additive).

#### Scenario: Domain event reaches an unsubscribed browser

- **WHEN** a lifecycle `ib_*` domain event is forwarded for some session
- **AND** a browser is connected but NOT subscribed to that session
- **THEN** the browser SHALL receive the event on the app-level channel

#### Scenario: Frame carries the originating sessionId

- **WHEN** an app-level domain-event frame is broadcast
- **THEN** it SHALL carry the `sessionId` of the session that produced the event
- **AND** it SHALL carry the event's renamed type and payload verbatim

#### Scenario: Per-session stream preserved

- **WHEN** a lifecycle `ib_*` domain event is forwarded for a session that has
  subscribers
- **THEN** those subscribers SHALL still receive the event on the per-session
  stream
- **AND** the app-level broadcast SHALL be in addition to, not instead of, the
  per-session fan-out

### Requirement: App-level channel is reconnect-safe and delta-only

The app-level channel SHALL stream live deltas. A newly (re)connecting browser
SHALL begin receiving current domain events without a per-session subscribe. The
server SHALL NOT replay historical domain events on connect and SHALL NOT be
responsible for baseline snapshots (the client re-syncs its baseline out of
band). A dropped browser connection SHALL NOT corrupt server state.

#### Scenario: Reconnecting client resumes the live stream

- **WHEN** a browser disconnects and reconnects
- **THEN** it SHALL begin receiving subsequently-forwarded domain events on the
  app-level channel
- **AND** the server SHALL NOT replay events emitted while it was disconnected

#### Scenario: Disconnect does not corrupt state

- **WHEN** a subscribed browser's connection drops mid-stream
- **THEN** the server SHALL continue broadcasting to the remaining browsers
  without error

### Requirement: App-level broadcast is headless-safe and non-blocking

The app-level broadcast SHALL be a no-op when no browser is connected and SHALL
NOT throw. A malformed or payload-less domain event SHALL be skipped without
crashing the gateway.

#### Scenario: No browser connected

- **WHEN** a lifecycle domain event is forwarded and no browser is connected
- **THEN** the app-level broadcast SHALL be a no-op and SHALL NOT error

#### Scenario: Malformed event does not crash the gateway

- **WHEN** a forwarded domain event is malformed or missing its payload
- **THEN** the app-level rebroadcast SHALL skip it without throwing
- **AND** subsequent well-formed domain events SHALL still be broadcast

