# auto-shutdown Specification

## Purpose

Lets a dashboard server that nobody is using exit on its own instead of lingering forever: it shuts down when no pi sessions are connected and the idle window elapses. Requires the heartbeat timeout to be sleep-aware so a laptop suspend is not mistaken for an idle timeout.

## Requirements

### Requirement: Idle shutdown when no pi sessions connected
The server SHALL automatically shut down after a configurable idle period when no pi extension WebSocket connections exist AND no terminal PTY sessions are alive. Before exiting, the idle timer callback SHALL verify that (1) no pi connections currently exist, (2) no terminal PTYs are alive (`terminalManager.list().length === 0`), and (3) real wall-clock time since the last connection is at least `shutdownIdleSeconds`. If any check fails, the timer SHALL restart instead of exiting.

A user-spawned terminal running a long process (e.g. `cargo build`, `npm install`, `tail -f`) without an attached pi session SHALL keep the server alive — the terminal counts as user activity for idle-shutdown purposes.

#### Scenario: Last pi session disconnects cleanly
- **WHEN** the last pi extension sends `session_unregister` and no connections remain
- **THEN** the server SHALL start an idle countdown of `shutdownIdleSeconds` seconds

#### Scenario: Last pi session disconnects dirty (crash/network)
- **WHEN** the last pi extension WebSocket closes without `session_unregister`
- **THEN** the server SHALL start the idle countdown after the heartbeat timeout clears the connection

#### Scenario: Idle countdown expires with no pi sessions and no terminals
- **WHEN** the idle countdown reaches zero with no new pi connections and `terminalManager.list().length === 0`
- **THEN** the server SHALL verify no connections exist, no terminal PTYs are alive, and real elapsed idle time >= `shutdownIdleSeconds` before shutting down

#### Scenario: New pi session connects during countdown
- **WHEN** a new pi extension connects while the idle countdown is running
- **THEN** the server SHALL cancel the idle countdown

#### Scenario: Server starts with no sessions
- **WHEN** the server starts and no pi sessions connect
- **THEN** the server SHALL start the idle countdown immediately

#### Scenario: Browser connections do not prevent shutdown
- **WHEN** browser clients are connected but no pi sessions exist and no terminal PTYs are alive
- **THEN** the server SHALL still shut down after the idle period

#### Scenario: Active terminal prevents shutdown
- **WHEN** the idle countdown fires and one or more terminal PTYs are alive
- **THEN** the server SHALL NOT shut down
- **THEN** the idle timer SHALL restart and re-check on the next tick

#### Scenario: Terminal exits during countdown
- **WHEN** the last terminal PTY exits while the idle countdown is running and no pi sessions are connected
- **THEN** the idle countdown SHALL continue and SHALL be allowed to expire normally

#### Scenario: Sleep/wake false idle prevention
- **WHEN** the idle countdown fires after laptop wake and a pi session has reconnected since the timer was started
- **THEN** the server SHALL restart the idle countdown instead of exiting

### Requirement: Sleep-aware heartbeat timeout
The pi-gateway heartbeat timeout SHALL detect when the system has been sleeping. When the heartbeat timeout fires and the elapsed real time since the timer was set exceeds twice the expected timeout duration, the server SHALL reset the heartbeat timer once instead of unregistering the session, giving the extension time to reconnect.

#### Scenario: Normal heartbeat timeout (no sleep)
- **WHEN** a heartbeat timeout fires and elapsed real time is within 2× the expected duration
- **THEN** the server SHALL unregister the session (existing behavior)

#### Scenario: Heartbeat timeout after sleep
- **WHEN** a heartbeat timeout fires and elapsed real time exceeds 2× the expected duration (indicating system sleep)
- **THEN** the server SHALL reset the heartbeat timer for one more cycle instead of unregistering

#### Scenario: Session fails to reconnect after grace period
- **WHEN** the heartbeat timer was already reset once for sleep detection and the session still hasn't sent a heartbeat
- **THEN** the server SHALL unregister the session (no infinite retries)
