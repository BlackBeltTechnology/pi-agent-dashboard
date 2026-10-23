## MODIFIED Requirements

### Requirement: Bridges pause auto-start during quiesce window

A pi bridge that receives `server_restarting` SHALL suppress the auto-start spawn step in `server-auto-start.ts` for at least `quiesceMs` milliseconds from receipt, while continuing to perform mDNS discovery and health checks. Reconnection to the new server SHALL use the existing exponential-backoff path.

The bridge SHALL interpret `quiesceMs` as follows, in this order. A value that is not a number, or is `NaN`, SHALL be ignored (no pause is started). A non-integer value SHALL be rounded up (ceiling) to an integer, never down, so the floor below is preserved. A result that is zero or negative SHALL be ignored. A value above 120000 ms (the maximum the bridge honours), including `Infinity`, SHALL be clamped to 120000 rather than honoured in full or dropped. The "at least `quiesceMs`" floor SHALL hold for every accepted value up to and including 120000 ms. The 120000 ms bound and the ignore rules SHALL apply to every request to pause auto-start, regardless of which caller makes it (the `server_restarting` handler, an inbound dispatch path, or any other code path); no caller SHALL be able to pause auto-start beyond the bound. When pauses overlap, the pause deadline SHALL be the later of the existing and the new deadline; a new pause SHALL never shorten an active one.

#### Scenario: bridge does not race the orchestrator

- **GIVEN** a bridge that has just received `server_restarting { quiesceMs: 5000 }`
- **WHEN** its WebSocket closes within the next 5 seconds
- **THEN** the bridge SHALL NOT call `launchServer(...)`
- **AND** the bridge SHALL continue to attempt reconnection via discovery + health check

#### Scenario: auto-start resumes after quiesce expires

- **GIVEN** a bridge whose quiesce window started 6 seconds ago with `quiesceMs: 5000`
- **AND** the dashboard is still not reachable via discovery or health check
- **WHEN** `autoStartServer(...)` is invoked
- **THEN** the auto-start spawn step SHALL execute as today

#### Scenario: Shutdown-sized quiesce is honoured in full

- **GIVEN** a bridge that receives `server_restarting { reason: "shutdown", quiesceMs: 60000 }`
- **WHEN** auto-start is attempted 59 seconds after receipt
- **THEN** the bridge SHALL NOT spawn a server

#### Scenario: Absurdly large quiesce is clamped

- **GIVEN** a bridge that receives `server_restarting { quiesceMs: 1e15 }`
- **WHEN** auto-start is attempted 121 seconds after receipt and the dashboard is still unreachable
- **THEN** the auto-start spawn step SHALL execute

#### Scenario: Infinite quiesce is clamped, not ignored

- **GIVEN** a bridge that receives `server_restarting { quiesceMs: Infinity }`
- **WHEN** auto-start is attempted 121 seconds after receipt and the dashboard is still unreachable
- **THEN** the auto-start spawn step SHALL execute

#### Scenario: Non-integer quiesce is rounded up

- **GIVEN** a bridge that receives `server_restarting { quiesceMs: 5000.2 }`
- **WHEN** auto-start is attempted 5000.5 milliseconds after receipt
- **THEN** the bridge SHALL NOT spawn a server, because the pause is 5001 ms
- **AND** a `quiesceMs` of `-0.5` SHALL start no pause

#### Scenario: Bound applies regardless of caller

- **GIVEN** any caller, other than the `server_restarting` handler, requests an auto-start pause of `1e15` ms or `Infinity`
- **WHEN** auto-start is attempted 121 seconds after the request and the dashboard is still unreachable
- **THEN** the auto-start spawn step SHALL execute
- **AND** a non-positive, `NaN` or non-number pause request from that caller SHALL start no pause

#### Scenario: Overlapping pauses never shorten the deadline
- **GIVEN** a bridge that received `server_restarting { quiesceMs: 60000 }` and then receives `server_restarting { quiesceMs: 5000 }` 1 second later
- **WHEN** auto-start is attempted 30 seconds after the first receipt
- **THEN** the bridge SHALL NOT spawn a server
- **AND** a later, longer pause SHALL extend the deadline to the later value

#### Scenario: Invalid quiesce is ignored

- **WHEN** a bridge receives `server_restarting` with `quiesceMs` of `0`, a negative number, `NaN`, or a non-number
- **THEN** the bridge SHALL NOT start or extend an auto-start pause from that message
