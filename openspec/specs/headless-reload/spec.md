## Purpose

Server-side handling of `/reload` for headless-spawned pi sessions. One entry point, `dispatchReload(sessionId)`, resolves every reload: refuse a busy session → kill-and-respawn a session with a registered PID → forward to the bridge for a terminal-hosted session → otherwise an honest terminal error. Accumulated session state (tokens, cost, context usage, attached proposal) survives the respawn's re-registration, and exactly one truthful terminal `command_feedback` keyed `/reload` is emitted per reload.

Kill-and-respawn is the default for a headless session: it also rescues a session whose bridge has died. The server has no in-process path. pi's RPC `{type:"prompt"}` performed no slash-command dispatch when measured (a `/__dashboard_reload` written to the keeper, and pi's own built-in `/help`, arrived at the model as an ordinary user prompt), so the server never writes a reload to a keeper. See change: fix-out-of-band-reload.

A terminal-hosted session reloads in-process. The server forwards `/reload` to the bridge. The bridge self-dispatches its `/__dashboard_reload <token>` command via `sendUserMessage({expandPromptTemplates: true})` (pi ≥ 0.84.2), which hands the handler a fresh `ExtensionCommandContext` with `reload()`. No TUI bootstrap is needed, and every reload works. The bridge instance loaded by the reload reports `completed`; the requesting instance reports failures. The server allows one forwarded reload in flight per session and backstops the bridge's feedback with a 75 s deadline. See change: fix-terminal-session-dashboard-reload.

## Requirements

### Requirement: Server intercepts `/reload` for headless sessions
When the server receives a `send_prompt` whose `text` equals `/reload` exactly and which carries no
images, it SHALL route the reload through `dispatchReload` instead of forwarding the prompt to the
bridge. The arg-form gate (`isBareReloadCommand`) SHALL NOT consider the session's shape; choosing
the delivery path is `dispatchReload`'s responsibility. A session with **no** registered PID SHALL
NEVER be respawned — doing so would spawn a second pi process against a terminal-hosted session's
file.

#### Scenario: `/reload` sent to active headless session
- **WHEN** the server receives `send_prompt` with `text === "/reload"` for an idle session that has
  a PID in `headlessPidRegistry`
- **THEN** the server SHALL NOT forward the prompt to the bridge via `piGateway.sendToSession`
- **AND** SHALL kill and respawn the pi process

#### Scenario: `/reload` sent to active non-headless (tmux / wt / wsl-tmux) session
- **WHEN** the session has no PID in `headlessPidRegistry`
- **THEN** the server SHALL forward the prompt to the bridge unchanged
- **AND** SHALL NOT respawn it, even when its bridge connection is momentarily absent

#### Scenario: `/reload` carries images or leading whitespace
- **WHEN** the text has surrounding whitespace, is `"/reload anything-else"`, or carries a
  non-empty `images` array
- **THEN** the interception SHALL NOT apply and the message SHALL be forwarded to the bridge
  unchanged

### Requirement: Kill-then-respawn ordering
The server SHALL issue the SIGTERM before calling `spawnPiSession` and SHALL NOT await the old
process's exit in a blocking way. The order SHALL be: `killBySessionId(sessionId)` → immediately
proceed to `spawnPiSession(...)`. The new pi process creates its own file handle and reads the
session file fresh.

#### Scenario: Spawn proceeds immediately after SIGTERM
- **WHEN** the server has called `killBySessionId` successfully
- **THEN** the server SHALL call `spawnPiSession` on the next await tick without polling for exit
- **AND** the server SHALL NOT hold back any other inbound messages while waiting

### Requirement: Preserve accumulated session state on respawn
The respawned pi process SHALL re-register with the same `sessionId` as the original (because `--session <file>` re-hydrates the same session), and the server’s `memorySessionManager.register` SHALL carry over the previous session’s `tokensIn`, `tokensOut`, `cacheRead`, `cacheWrite`, `cost`, `attachedProposal`, `contextTokens`, and `contextWindow`.

#### Scenario: Same session file resumes with same sessionId
- **WHEN** the server calls `spawnPiSession(..., {sessionFile: <file>, mode: "continue"})`
- **THEN** the spawned pi process SHALL read the session header from `<file>` and adopt its `id`
- **AND** the bridge in the new process SHALL send `session_register` with that same `id`

#### Scenario: Accumulated state preserved across respawn
- **WHEN** a session with `tokensIn=1000`, `cost=0.02`, and `attachedProposal="my-change"` is reloaded via respawn
- **THEN** after the new process re-registers, the server SHALL retain all of those fields on the registered session

### Requirement: Spawn failure leaves session ended
If `spawnPiSession` returns `success: false`, the server SHALL NOT attempt to resurrect the session, SHALL leave its status as `ended` (or set it to `ended` if it was `active`), SHALL broadcast a `session_updated` with the new status, and SHALL log the spawn error to the server log. The user SHALL be able to recover by sending any prompt, which triggers the existing `auto-resume-on-prompt` flow.

#### Scenario: spawnPiSession returns failure
- **WHEN** `spawnPiSession` rejects or returns `{success: false, message}`
- **THEN** the server SHALL mark the session `status: "ended"` and `endedAt: <now>`
- **AND** the server SHALL broadcast `session_updated`
- **AND** the server SHALL log `[dashboard] headless reload spawn failed: <message>` to stderr

### Requirement: Idempotency and concurrent reloads
Concurrent reloads SHALL NOT double-respawn a session. The server SHALL check
`isProcessAlive(headlessPidRegistry.getPid(sessionId))` before issuing SIGTERM; if the process is
already gone and no replacement is registered, it SHALL skip the kill and still call
`spawnPiSession`.

#### Scenario: Two `/reload` messages arrive within the respawn window
- **WHEN** a respawn is in flight and a second `/reload` arrives before the new PID is registered
- **THEN** the second call SHALL observe either the original PID (kill+spawn) or no PID (spawn
  only)
- **AND** in neither case SHALL two competing pi processes be left running

### Requirement: `/reload` on streaming headless session is rejected
A reload SHALL NOT be delivered to a session that is streaming or compacting. The server SHALL
emit `command_feedback {status:"error"}` mirroring pi's own TUI wording ("Wait for the current
response to finish before reloading"). The refusal SHALL NOT apply to a session with no live
bridge connection whose `status` is merely a stale `streaming`: such a session may be pinned there
because its bridge died before `agent_end`, and it remains respawnable.

#### Scenario: `/reload` during streaming
- **WHEN** a `/reload` arrives for a streaming session with a live bridge connection
- **THEN** the server SHALL NOT kill or respawn the pi process
- **AND** SHALL emit `command_feedback` with `command: "/reload"` and `status: "error"` telling the
  operator to wait for the current response to finish

#### Scenario: Reload requested during compaction
- **WHEN** a `/reload` arrives while the session is compacting
- **THEN** the server SHALL refuse it with the same error feedback

#### Scenario: `/reload` for a bridge-dead session stuck at streaming
- **WHEN** a `/reload` arrives for a session with a headless PID, no live bridge connection, and a
  last-known `status: "streaming"`
- **THEN** the server SHALL respawn it
- **AND** the stale `streaming` status SHALL NOT cause the reload to be refused

### Requirement: Server-side reload dispatch
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
by dispatching its own reload command in-process with command handling enabled. It SHALL do this
only when the running pi honours command dispatch from extension-sent messages (pi ≥ 0.84.2).
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
- **AND** the running pi is ≥ 0.84.2
- **THEN** the server SHALL forward `/reload` to the bridge
- **AND** the session SHALL reload in-process (pi emits `session_start` with reason `reload`)
- **AND** no user message SHALL be added to the transcript and no model turn SHALL start
  (a pi that reports a missing or unparseable version is treated as ≥ 0.84.2, matching
  extension slash dispatch)

#### Scenario: Repeated reloads of the same terminal-hosted process
- **WHEN** a terminal-hosted session has already been reloaded from the dashboard
- **AND** a second reload is requested from the dashboard
- **THEN** the session SHALL reload again
- **AND** no "stale ctx" error SHALL be reported

#### Scenario: Terminal-hosted session on pi older than 0.84.2
- **WHEN** a reload is forwarded to a bridge whose running pi reports a version older than 0.84.2
- **THEN** the bridge SHALL NOT send any text to pi
- **AND** SHALL emit a terminal `command_feedback` with `status: "error"` whose message names the
  minimum pi version

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

### Requirement: Reload feedback is truthful, singular, and keyed `/reload`
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

#### Scenario: Bridge reload with no available path
- **WHEN** the bridge receives `/reload` and the running pi cannot dispatch commands in-process
  (older than 0.84.2)
- **THEN** it SHALL emit `status: "error"` naming the minimum pi version
- **AND** it SHALL NOT emit `completed`

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

### Requirement: Enumerated reload trigger sources
The reload trigger sources are: (1) the reload button / `/reload` in the composer, (2)
`scripts/reload-all.sh`, (3) the pi retry-policy settings save (`server.ts`
`reloadConnectedSessions`), (4) package install/remove (`setReloadSessions`), (5) pi-core update
completion (`piCoreUpdater.onAllComplete`), and (6) `POST /api/resources/reload`. Sources 1–4 and 6
SHALL route through `dispatchReload` and produce the same observable outcome. Source 5 is a runtime
swap and is specified separately. A fan-out SHALL NOT restrict itself to
`piGateway.getConnectedSessionIds()`; a session with a headless PID but no bridge connection SHALL
still be targeted.

#### Scenario: Settings save fans out a reload
- **WHEN** a pi retry-policy settings save triggers the reload fan-out
- **THEN** each targeted session SHALL be reloaded via `dispatchReload`
- **AND** each SHALL produce exactly one terminal `command_feedback` for `/reload`

#### Scenario: Fan-out reaches a bridge-dead session
- **WHEN** a fan-out runs and a session has a headless PID but no bridge connection
- **THEN** that session SHALL still be targeted and reloaded through the respawn path

#### Scenario: Package install fans out a reload
- **WHEN** the post-package-operation reload runs
- **THEN** each targeted session SHALL take the same path as a reload-button click

### Requirement: pi-core update requires a runtime swap
A reload SHALL NOT be treated as sufficient for a pi-core binary update. When a pi-core update
completes, sessions with a headless PID SHALL be restarted via the kill-and-respawn path —
including connected and streaming sessions, since a runtime swap cannot be satisfied in-process —
and sessions that cannot be swapped SHALL report `error`, never success.

#### Scenario: pi-core update completes with headless sessions connected
- **WHEN** `piCoreUpdater.onAllComplete` runs and headless sessions are connected
- **THEN** those sessions SHALL be respawned

#### Scenario: pi-core update on a streaming headless session
- **WHEN** the session is streaming at the time of the swap
- **THEN** the respawn SHALL still proceed (the process is being replaced, not reloaded under an
  active runner)
- **AND** the streaming guard SHALL NOT convert it into an error

#### Scenario: pi-core update on a session that cannot be swapped
- **WHEN** a session has no `sessionFile`, or is not headless
- **THEN** a terminal `command_feedback` with `status: "error"` SHALL be emitted for it

### Requirement: Compaction is observable to the server
The server SHALL be able to tell that a session is compacting. The bridge SHALL report compaction
start and end for its session, and the server SHALL track that state on the session record so the
busy-session refusal can be evaluated. The signal SHALL be cleared when compaction ends and when
the session ends, so a stale compacting flag cannot permanently block reloads.

#### Scenario: Compaction start and end are reported
- **WHEN** a session begins compacting
- **THEN** the server SHALL observe the session as compacting
- **AND** when compaction ends, the server SHALL observe it as no longer compacting

#### Scenario: Session ends while compacting
- **WHEN** a session ends while its compacting flag is set
- **THEN** the flag SHALL not survive onto a later registration of that session
