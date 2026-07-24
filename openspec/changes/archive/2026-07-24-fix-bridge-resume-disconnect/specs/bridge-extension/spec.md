## ADDED Requirements

### Requirement: Bridge WebSocket survives session replacement

When pi replaces the current session in-process — `session_shutdown(reason)`
immediately followed by `session_start(reason)` with `reason ∈
{"new","fork","resume"}`, same OS process — the bridge SHALL end that sequence
with a **live** dashboard WebSocket on which the new session is registered. The
bridge SHALL NOT require a fresh `pi` process, a browser refresh, or `/reload` to
recover the connection after an in-TUI resume/switch/fork.

This is an **outcome** contract: it constrains the observable end state (socket
live, new session registered, dashboard shows the session active), not the
internal mechanism by which the bridge achieves it.

For a genuine teardown — `reason: "quit"` (process exiting) — the bridge MAY drop
the socket. For `reason: "reload"`, the connection SHALL be live again after the
reload re-init completes.

The always-run `session_shutdown` cleanup — sending `session_unregister`,
stopping the metrics/heartbeat/git-poll timers, resetting the subagent frame
buffer, and cleaning up per-session ask_user attachments — SHALL run on **every**
`session_shutdown` regardless of reason.

#### Scenario: Resume ends with a live, re-registered connection
- **WHEN** an in-TUI resume fires `session_shutdown(reason: "resume")` followed by `session_start(reason: "resume")` in the same process
- **THEN** within a bounded settle window after the sequence (the socket opens asynchronously via `onopen`, so the assertion SHALL poll `connection.isConnected` rather than read it synchronously at handler return) the bridge's dashboard WebSocket SHALL be connected (`connection.isConnected === true`)
- **AND** the resumed session SHALL be registered with the server (a `session_register` for the resumed session SHALL have been delivered on the live socket)
- **AND** no fresh `pi` process, browser refresh, or `/reload` SHALL be required

#### Scenario: New and fork also end connected and registered
- **WHEN** an in-process `session_start(reason: "new")` or `session_start(reason: "fork")` follows its `session_shutdown`
- **THEN** the bridge SHALL end the sequence with a live WebSocket and the new session registered

#### Scenario: Quit tears down
- **WHEN** `session_shutdown` fires with `reason: "quit"`
- **THEN** the bridge MAY close the WebSocket (the process is exiting)

#### Scenario: Reload ends connected
- **WHEN** `session_shutdown(reason: "reload")` fires and the reload re-init completes
- **THEN** the bridge's WebSocket SHALL be live again and the session registered

#### Scenario: Cleanup runs regardless of reason
- **WHEN** `session_shutdown` fires with any `reason`, including a replacement reason
- **THEN** the bridge SHALL send `session_unregister`, stop the metrics/heartbeat/git-poll timers, reset the subagent frame buffer, and clean up the session's ask_user attachments
