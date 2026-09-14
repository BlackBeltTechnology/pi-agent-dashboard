# bridge-heartbeat-watchdog Specification

## Purpose

Lets the bridge notice that the dashboard server has gone away rather than holding a dead socket open indefinitely. Tracks the timestamp of the last message received and runs a liveness watchdog that fires when nothing has arrived within the expected window.

## Requirements

### Requirement: Track last message received timestamp
The `ConnectionManager` SHALL track the timestamp of the last message received from the server. This timestamp SHALL be updated on every incoming WebSocket message.

#### Scenario: Message received updates timestamp
- **WHEN** the bridge receives any WebSocket message from the server (including `heartbeat_ack`)
- **THEN** the `lastMessageAt` timestamp SHALL be updated to `Date.now()`

#### Scenario: New connection resets timestamp
- **WHEN** a WebSocket connection is established (onopen fires)
- **THEN** the `lastMessageAt` timestamp SHALL be set to `Date.now()`

### Requirement: Server liveness watchdog timer
The `ConnectionManager` SHALL run a watchdog timer that checks server liveness every 15 seconds. If no message has been received for 60 seconds, the connection SHALL be force-closed to trigger reconnection.

#### Scenario: Server is responsive
- **WHEN** the watchdog timer fires and `Date.now() - lastMessageAt < 60_000`
- **THEN** no action SHALL be taken and the connection SHALL remain open

#### Scenario: Server has gone silent
- **WHEN** the watchdog timer fires and `Date.now() - lastMessageAt >= 60_000`
- **THEN** the `ConnectionManager` SHALL close the WebSocket connection
- **AND** the reconnection logic SHALL be triggered (exponential backoff)

#### Scenario: Watchdog only runs while connected
- **WHEN** `disconnect()` is called on the `ConnectionManager`
- **THEN** the watchdog timer SHALL be cleared

#### Scenario: Watchdog starts on connect
- **WHEN** `connect()` is called on the `ConnectionManager`
- **THEN** the watchdog timer SHALL start with a 15-second interval

### Requirement: Liveness payload on the heartbeat does not affect the watchdog

The `session_heartbeat` message gains an advisory `agentRunning` field. The watchdog's liveness accounting SHALL remain purely message-arrival based: its 15-second check interval, its 60-second silence threshold, and its force-close-and-reconnect action SHALL NOT read, branch on, or be extended by `agentRunning`.

In particular, a long-running turn (`agentRunning: true`) SHALL NOT grant the server extra grace, and an idle session (`agentRunning: false`) SHALL NOT shorten the threshold.

#### Scenario: Silent server with a running agent still force-closes

- **WHEN** the watchdog fires, `Date.now() - lastMessageAt >= 60_000`, and the last heartbeat sent reported `agentRunning: true`
- **THEN** the connection SHALL be force-closed and reconnection triggered, exactly as when no agent was running

#### Scenario: Responsive server with an idle agent stays open

- **WHEN** the watchdog fires, `Date.now() - lastMessageAt < 60_000`, and the last heartbeat sent reported `agentRunning: false`
- **THEN** no action SHALL be taken and the connection SHALL remain open

### Requirement: Watchdog force-close is attributable

A watchdog force-close is indistinguishable from a network drop or a server reap in `server.log` — all three surface as `connection closed` followed by a re-register. The `ConnectionManager` SHALL therefore report the state that triggered the force-close BEFORE tearing the socket down, through an optional `onWatchdogFire(info)` callback.

The report SHALL carry `silentForMs` (age of the last received frame), `watchdogTimeout` (the configured threshold), `readyState` (the socket's state captured before close), `inboundQueueDepth` (parsed frames awaiting handler dispatch), `refusedInbound` (cumulative frames refused for a full queue) and `maxTickDriftMs` (worst observed lateness of the watchdog's own check tick).

The report SHALL NOT change the liveness decision: the 15-second check interval, the 60-second silence threshold and the force-close-and-reconnect action are unchanged. An exception thrown by the callback SHALL NOT prevent the teardown or the reconnect.

#### Scenario: Force-close reports the state that caused it

- **GIVEN** a `ConnectionManager` with `watchdogTimeout` 60 000 ms and an `onWatchdogFire` callback
- **AND** a connection that received a message and then went silent
- **WHEN** the watchdog fires and force-closes the socket
- **THEN** `onWatchdogFire` SHALL be called exactly once
- **AND** `silentForMs` SHALL be at least `watchdogTimeout`

#### Scenario: A silent peer is distinguished from a blocked loop

A blocked event loop produces the same `silentForMs` as a genuinely silent peer, so silence alone cannot attribute the force-close. The watchdog SHALL measure the lateness of its own check tick against its schedule and report the worst value observed.

- **GIVEN** a watchdog whose check ticks fired on schedule
- **WHEN** the watchdog force-closes after the silence threshold
- **THEN** the reported `maxTickDriftMs` SHALL be near zero, attributing the silence to the peer

#### Scenario: A blocked loop is attributed to this process

- **GIVEN** a watchdog whose check tick was delayed well beyond its interval
- **WHEN** the watchdog force-closes
- **THEN** the reported `maxTickDriftMs` SHALL reflect that delay, attributing the silence to local starvation rather than the peer

#### Scenario: A responsive server produces no report

- **GIVEN** a `ConnectionManager` with an `onWatchdogFire` callback
- **WHEN** messages arrive at an interval shorter than `watchdogTimeout`
- **THEN** `onWatchdogFire` SHALL NOT be called
- **AND** the connection SHALL remain open

#### Scenario: Reported readyState predates the teardown

- **GIVEN** a `ConnectionManager` whose socket is OPEN
- **WHEN** the watchdog fires
- **THEN** the reported `readyState` SHALL equal the OPEN value
- **AND** the underlying socket SHALL be CLOSED once teardown completes

#### Scenario: A throwing reporter does not block the reconnect

- **GIVEN** an `onWatchdogFire` callback that throws
- **WHEN** the watchdog fires
- **THEN** the force-close SHALL still occur
- **AND** the reconnect SHALL still be scheduled

#### Scenario: Watchdog without a reporter is unchanged

- **GIVEN** a `ConnectionManager` with no `onWatchdogFire` option
- **WHEN** the watchdog fires
- **THEN** the force-close and reconnect SHALL behave exactly as before this change

### Requirement: Observed silence is confirmed after the poll phase

When the event loop is blocked inside an I/O callback, it re-enters the timers phase BEFORE it can re-enter poll. The watchdog therefore observes a `lastMessageAt` that is stale only because the frames refreshing it are still unread in the socket buffer, and force-closes a connection the peer never stopped serving. Measured: a 1.5 s block inside an `onMessage` handler force-closed a peer that had sent 42 frames, of which 5 had been processed.

On detecting silence past the threshold, the watchdog SHALL defer its decision by one event-loop turn and re-evaluate before closing. It SHALL close only if the silence still holds after pending socket reads have had the opportunity to drain. Deferral SHALL be scheduled at most once per detection, and SHALL be abandoned if the watchdog stops in the meantime.

#### Scenario: A peer that never stopped sending is not closed

- **GIVEN** a peer in a separate process sending every 100 ms
- **AND** a bridge whose event loop is blocked inside an `onMessage` handler for longer than the silence threshold
- **WHEN** the loop unblocks and the watchdog next runs
- **THEN** no force-close SHALL occur
- **AND** the connection SHALL be the same one throughout
- **AND** the buffered frames SHALL be processed

#### Scenario: A genuinely silent peer is still closed

- **GIVEN** a peer that has stopped sending entirely
- **WHEN** the silence passes the threshold and the deferred re-check runs
- **THEN** the force-close and reconnect SHALL proceed as before

### Requirement: Every live connection reports its force-closes

The bridge constructs a `ConnectionManager` for its primary endpoint and a second one for a `/dashboard-connect` move, then rebinds its outbound transport to the move target. Both SHALL report force-closes, because after a move the second manager IS the live connection and an unreported force-close there would silence exactly the connection under observation.

#### Scenario: The move target reports

- **GIVEN** a bridge that has moved to another dashboard via `/dashboard-connect`
- **WHEN** the moved-to connection's watchdog force-closes
- **THEN** a `watchdog_force_close` diagnostic SHALL be produced

### Requirement: The force-close diagnostic is durable

pi's stdout is discarded under the default `keeperLog.capturePiOutput: false`, so a `console.log` record of a force-close does not survive. The diagnostic SHALL travel to the server as a `bridge_diagnostic` message carrying the `watchdog_force_close` event, so the server writes it to its own log.

Because the report is produced BEFORE teardown, the socket is normally still OPEN and the diagnostic flushes immediately; when it is not, the diagnostic SHALL be buffered and flushed on the next successful registration, so a force-close on an already-dead socket is still recorded.

#### Scenario: Reported while the socket is still open

- **GIVEN** a watchdog force-close on a socket that is still OPEN at report time
- **WHEN** the diagnostic is recorded
- **THEN** it SHALL be sent without waiting for a reconnect

#### Scenario: Survives a socket that is already down

- **GIVEN** a watchdog force-close where the diagnostic cannot be sent
- **WHEN** the bridge reconnects and re-registers
- **THEN** the buffered `watchdog_force_close` diagnostic SHALL be flushed to the server
