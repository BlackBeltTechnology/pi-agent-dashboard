## ADDED Requirements

### Requirement: Server-side reload dispatch without a pi version gate
The server SHALL expose a single reload entry point, `dispatchReload(sessionId)`, that resolves a
reload in this order:
1. The session is **busy** (streaming with a live bridge, or compacting) → refuse, per the
   busy-session requirement below.
2. The session has a PID in `headlessPidRegistry` → kill-and-respawn.
3. No PID but a live bridge connection → forward `/reload` to the bridge over the session
   WebSocket (terminal-hosted case).
4. Neither → a terminal `command_feedback` with `status: "error"` naming the reason.

The **server** has no in-process dispatch path. pi's RPC `{type:"prompt"}` written to a keeper
performed no slash-command dispatch when measured: a `/__dashboard_reload` line was delivered to
the model as an ordinary user prompt, producing a full agent turn and no reload. The server SHALL
NOT deliver a reload via `headlessPidRegistry.writeRpc`, and SHALL NOT route a reload through the
bridge's generic extension-slash dispatch (whose `__`-prefix gate rejects the reload command).

The **bridge**, on receiving a forwarded `/reload`, SHALL reach pi's command-context `reload()`
by dispatching its own reload command in-process with command handling enabled.
The terminal-hosted path SHALL NOT require any prior manual step in the pi TUI. It SHALL keep
working for every subsequent reload of the same process, not just the first.

At most one forwarded reload SHALL be in flight per session. A reload requested while a
forwarded reload for the same session has not yet produced its terminal feedback SHALL be
refused with a terminal `command_feedback` `error`, and SHALL NOT be forwarded to the bridge.

#### Scenario: Reload on a headless session
- **WHEN** a reload is requested for an idle session with a PID in `headlessPidRegistry`
- **THEN** the server SHALL kill and respawn the pi process
- **AND** SHALL NOT write any line to that session's RPC keeper

#### Scenario: Reload on a terminal-hosted (tmux / wt / wsl-tmux) session
- **WHEN** a reload is requested for an idle session with no headless PID but a live bridge
- **THEN** the server SHALL forward `/reload` to the bridge
- **AND** the session SHALL reload in-process (pi emits `session_start` with reason `reload`)
- **AND** no user message SHALL be added to the transcript and no model turn SHALL start

#### Scenario: Repeated reloads of the same terminal-hosted process
- **WHEN** a terminal-hosted session has already been reloaded from the dashboard
- **AND** a second reload is requested from the dashboard
- **THEN** the session SHALL reload again
- **AND** no "stale ctx" error SHALL be reported

#### Scenario: Concurrent reload of a terminal-hosted session is refused
- **WHEN** a reload has been forwarded to a terminal-hosted session's bridge and its terminal
  feedback has not yet arrived
- **AND** a second reload is requested for the same session
- **THEN** a terminal `command_feedback` with `command: "/reload"`, `status: "error"` naming a
  reload already in progress SHALL be emitted for the second request
- **AND** the second request SHALL NOT be forwarded to the bridge
- **AND** the first reload SHALL still produce its own single terminal feedback

#### Scenario: Reload typed in the pi TUI still works
- **WHEN** a human types `/__dashboard_reload` in a terminal-hosted session's TUI
- **AND** no dashboard-requested reload is in flight for that session
- **THEN** the session SHALL reload
- **AND** no dashboard `command_feedback` for `/reload` SHALL be emitted

#### Scenario: Reload typed in the pi TUI while a dashboard reload is in flight
- **WHEN** a human types `/__dashboard_reload` while a dashboard-requested reload for the same
  session is in flight
- **THEN** the TUI SHALL show a warning and SHALL NOT start a second, nested reload

#### Scenario: Reload feedback arriving during a replay window still reaches the client
- **WHEN** a terminal `/reload` `command_feedback` from the bridge arrives while the server is
  skipping replayed-event inserts for that session
- **THEN** the server SHALL persist and broadcast that feedback
- **AND** SHALL settle the forwarded-reload deadline

#### Scenario: No path available
- **WHEN** a reload is requested for a session with no headless PID and no live bridge
- **THEN** a terminal `command_feedback` with `status: "error"` SHALL be emitted
- **AND** no pi process SHALL be spawned

### Requirement: Reload feedback is truthful, singular, and keyed `/reload` without a pi version gate
Exactly one terminal `command_feedback` (`completed` XOR `error`) SHALL be emitted per reload, and
its `command` field SHALL be `/reload` regardless of which internal path resolved it. The bridge
SHALL NOT emit an unconditional `completed` for `/reload` independent of the outcome.

For a terminal-hosted in-process reload, `completed` SHALL be emitted only after pi has actually
re-run `session_start` with reason `reload`. It SHALL be emitted by the bridge instance loaded by
that reload, after it re-registers the session. The requesting bridge instance's connection is
torn down by the reload, so its own events cannot be relied on to arrive. `error` SHALL be emitted
by the requesting bridge when the reload never started, never produced a `session_start`, or did
not finish within a bounded time. In that last case the reloaded instance SHALL NOT also emit
`completed`.

The server SHALL be the backstop for forwarded reloads: when no terminal `/reload`
`command_feedback` arrives from the bridge within a bounded deadline longer than the bridge's own
finish timeout, the server SHALL emit the `error` itself, and SHALL drop a terminal `/reload` feedback that the
bridge sends for that reload afterwards, unless a new reload for the session has since been
forwarded. The deadline SHALL survive the session's unregister and re-register caused by the
reload itself.

#### Scenario: Reload that cannot be delivered
- **WHEN** no reload path is available for a session, or every attempted path fails
- **THEN** a terminal `command_feedback` with `command: "/reload"`, `status: "error"` and a reason
  SHALL be emitted
- **AND** no `completed` event for the same reload SHALL be emitted

#### Scenario: Successful terminal-hosted reload reports completion from the reloaded bridge
- **WHEN** a dashboard-requested terminal-hosted reload runs and pi emits `session_start` with
  reason `reload`
- **THEN** exactly one `command_feedback` `{command: "/reload", status: "completed"}` SHALL reach
  the server for that session
- **AND** it SHALL arrive after the session has re-registered

#### Scenario: Reload command never starts
- **WHEN** the bridge dispatches its reload command but the handler does not start within the
  start timeout
- **THEN** the bridge SHALL emit `status: "error"` with a reason
- **AND** a late-starting handler for that dispatch SHALL NOT reload the session

#### Scenario: pi refuses or fails the reload
- **WHEN** pi's reload returns without emitting `session_start` with reason `reload` (for example,
  pi refused because it is streaming or compacting, or the reload threw)
- **THEN** the requesting bridge SHALL emit `status: "error"` with a reason
- **AND** SHALL NOT emit `completed`

#### Scenario: Reload fails after the requesting bridge disconnected
- **WHEN** a forwarded reload tears down the requesting bridge's connection and no terminal
  `/reload` `command_feedback` reaches the server within the server's forwarded-reload deadline
- **THEN** the server SHALL emit a terminal `command_feedback` with `command: "/reload"`,
  `status: "error"` and a reason
- **AND** a terminal `/reload` feedback arriving from the bridge after that, before any new reload
  is forwarded, SHALL NOT be persisted or broadcast

#### Scenario: Retry after a deadline expiry is not swallowed
- **WHEN** the server's forwarded-reload deadline has expired for a session
- **AND** a new reload is forwarded for that session and its bridge reports a terminal `/reload`
  feedback
- **THEN** that feedback SHALL be persisted and broadcast

#### Scenario: Bridge feedback within the deadline is passed through once
- **WHEN** a forwarded reload's terminal `/reload` `command_feedback` arrives from the bridge
  before the server's deadline
- **THEN** the server SHALL persist and broadcast it unchanged
- **AND** SHALL NOT emit its own deadline `error` for that reload

#### Scenario: Bridge reload whose captured function throws synchronously
- **WHEN** handing the reload command to pi throws synchronously (for example, a stale extension
  API)
- **THEN** the bridge SHALL report `status: "error"` carrying the reason
- **AND** the throw SHALL NOT escape the command handler

## REMOVED Requirements

### Requirement: Server-side reload dispatch

**Reason**: Its pi ≥ 0.84.2 gate is unreachable at the 0.99.1 floor.

**Migration**: See "Server-side reload dispatch without a pi version gate".

### Requirement: Reload feedback is truthful, singular, and keyed `/reload`

**Reason**: Its below-0.84.2 error path is unreachable at the 0.99.1 floor.

**Migration**: See "Reload feedback is truthful, singular, and keyed `/reload` without a pi version gate".
