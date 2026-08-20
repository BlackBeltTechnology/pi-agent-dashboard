## ADDED Requirements

### Requirement: Server-side reload dispatch
The server SHALL expose a single reload entry point, `dispatchReload(sessionId)`, that resolves a
reload in this order:
1. The session has a live RPC keeper **and is idle** → the server SHALL write the
   `/__dashboard_reload` pi RPC line to the keeper UDS (`headlessPidRegistry.writeRpc`), which
   runs the registered command handler and calls `ctx.reload()` in the running process.
   A session that is streaming or compacting SHALL be refused, not dispatched — see the
   busy-session requirement below.
2. No keeper but a PID in `headlessPidRegistry` → the kill-and-respawn fallback.
3. Neither → forward `/reload` to the bridge over the session WebSocket (terminal-hosted case).

A dashboard-spawned headless session SHALL reload with no prior `/__dashboard_reload` TUI
invocation and without its pi process being terminated. The server SHALL NOT deliver a reload via
`pi.sendUserMessage`, which skips pi's command handling, nor via the bridge's
`tryDispatchExtensionCommand`, whose `__`-prefix gate rejects the reload command.

#### Scenario: Reload on a headless session never touched in a TUI
- **WHEN** a reload is requested for a session with a live keeper
- **THEN** the server SHALL write the `/__dashboard_reload` RPC line to that session's keeper
- **AND** the pi process SHALL NOT be terminated

#### Scenario: Keeper write fails
- **WHEN** the keeper write returns `false` or throws
- **THEN** the server SHALL take the kill-and-respawn fallback when the session has a headless PID
- **AND** SHALL emit a terminal `command_feedback` with `status: "error"` when it does not

#### Scenario: Reload on a terminal-hosted (tmux / wt / wsl-tmux) session
- **WHEN** a reload is requested for a session with neither a keeper nor a headless PID
- **THEN** the server SHALL forward `/reload` to the bridge
- **AND** the bridge SHALL invoke a captured `globalThis[RELOAD_KEY]` when present, else emit a
  terminal `command_feedback` with `status: "error"` naming the session shape as the reason

### Requirement: Reload feedback is truthful, singular, and keyed `/reload`
Exactly one terminal `command_feedback` (`completed` XOR `error`) SHALL be emitted per reload, and
its `command` field SHALL be `/reload` regardless of which internal command name was dispatched.
The bridge SHALL NOT emit an unconditional `completed` for `/reload` independent of the outcome;
`BridgeCommandOptions.reload` SHALL report whether a reload actually ran. On the keeper path the
server SHALL emit the terminal event.

`completed` on the keeper path means **pi received the reload line**, not that the reload
finished. A failure inside the reload handler after delivery is NOT currently observable: pi
writes `extension_error` to stdout, which the keeper discards, and no consumer reads it.
Consumers SHALL NOT read `completed` as proof the reload completed. This limit SHALL be stated
wherever the event is documented rather than implied away.

#### Scenario: Reload that cannot be delivered
- **WHEN** no reload path is available for a session, or every attempted path fails
- **THEN** a terminal `command_feedback` with `command: "/reload"`, `status: "error"` and a reason
  SHALL be emitted
- **AND** no `completed` event for the same reload SHALL be emitted

#### Scenario: Keeper dispatch feedback key
- **WHEN** the server dispatches the reload by writing `/__dashboard_reload` to the keeper
- **THEN** the emitted terminal `command_feedback` SHALL carry `command: "/reload"`, not
  `/__dashboard_reload`

#### Scenario: Bridge reload with no available path
- **WHEN** the bridge receives `/reload` and has no captured reload function
- **THEN** it SHALL emit `status: "error"`
- **AND** it SHALL NOT emit `completed`

### Requirement: Enumerated reload trigger sources
The reload trigger sources are: (1) the reload button / `/reload` in the composer, (2)
`scripts/reload-all.sh`, (3) the pi retry-policy settings save (`server.ts` `reloadConnectedSessions`),
(4) package install/remove (`setReloadSessions`), (5) pi-core update completion
(`piCoreUpdater.onAllComplete`), and (6) `POST /api/resources/reload`. Sources 1–4 and 6 SHALL
route through `dispatchReload` and produce the same observable outcome. Source 5 is a runtime swap
and is specified separately. A fan-out SHALL NOT restrict itself to
`piGateway.getConnectedSessionIds()`; a session with a live keeper or headless PID but no bridge
connection SHALL still be targeted.

#### Scenario: Settings save fans out a reload
- **WHEN** a pi retry-policy settings save triggers the reload fan-out
- **THEN** each targeted session SHALL be reloaded via `dispatchReload` without being terminated
  when an in-process path exists
- **AND** each SHALL produce exactly one terminal `command_feedback` for `/reload`

#### Scenario: Fan-out reaches a bridge-dead session
- **WHEN** a fan-out runs and a session has a live keeper but no bridge connection
- **THEN** that session SHALL still be targeted and reloaded through the keeper

#### Scenario: Package install fans out a reload
- **WHEN** the post-package-operation reload runs
- **THEN** each targeted session SHALL take the same path as a reload-button click

### Requirement: pi-core update requires a runtime swap
An in-process `ctx.reload()` reloads settings, providers, extensions, skills, prompts and themes
inside the running process; it SHALL NOT be treated as sufficient for a pi-core binary update.
When a pi-core update completes, sessions with a headless PID SHALL be restarted via the
kill-and-respawn path — including connected and streaming sessions, since a runtime swap cannot be
satisfied in-process — and sessions that cannot be swapped SHALL report `error`, never success.

#### Scenario: pi-core update completes with headless sessions connected
- **WHEN** `piCoreUpdater.onAllComplete` runs and headless sessions are connected
- **THEN** those sessions SHALL be respawned rather than reloaded in-process

#### Scenario: pi-core update on a streaming headless session
- **WHEN** the session is streaming at the time of the swap
- **THEN** the respawn SHALL still proceed (a runtime swap cannot be satisfied in-process, and
  the process is being replaced rather than reloaded under an active runner)
- **AND** the streaming guard SHALL NOT convert it into an error

#### Scenario: pi-core update on a session that cannot be swapped
- **WHEN** a session has no `sessionFile`, or is not headless
- **THEN** a terminal `command_feedback` with `status: "error"` SHALL be emitted for it

## MODIFIED Requirements

### Requirement: Server intercepts `/reload` for headless sessions
Kill-and-respawn SHALL be a **fallback**, not the default for headless sessions. When the server
receives a `send_prompt` whose `text` equals `/reload`, it SHALL route the reload through
`dispatchReload`. It SHALL convert the reload into a kill-and-respawn ONLY when no in-process path
is available **and the session has a PID in `headlessPidRegistry`**: no keeper write is possible
AND `piGateway.isSessionConnected(sessionId)` is `false`, OR the forwarding `sendToSession` call
returns `false`. A session with no registered PID SHALL NEVER be respawned — doing so would spawn
a second pi process against a terminal-hosted session's file.

#### Scenario: `/reload` sent to a healthy headless session
- **WHEN** the server receives `send_prompt` with `text === "/reload"` for a session with a live
  keeper
- **THEN** the server SHALL dispatch through the keeper
- **AND** the server SHALL NOT kill or respawn the pi process

#### Scenario: `/reload` sent to a headless session with no keeper and no bridge connection
- **WHEN** the session has a PID in `headlessPidRegistry`, no keeper, and no live bridge
  connection
- **THEN** the server SHALL kill and respawn the pi process
- **AND** SHALL emit a terminal `command_feedback` recording that the respawn fallback ran

#### Scenario: Connection drops between the check and the send
- **WHEN** the connection check passes but `sendToSession` returns `false`
- **THEN** the server SHALL take the respawn fallback rather than dropping the reload silently

#### Scenario: `/reload` sent to active non-headless (tmux / wt / wsl-tmux) session
- **WHEN** the session has no PID in `headlessPidRegistry` and no keeper
- **THEN** the server SHALL forward the prompt to the bridge unchanged
- **AND** SHALL NOT respawn it even when its bridge connection is momentarily absent

#### Scenario: `/reload` carries images or leading whitespace
- **WHEN** the text has surrounding whitespace, is `"/reload anything-else"`, or carries a
  non-empty `images` array
- **THEN** the fallback interception SHALL NOT apply and the message SHALL be forwarded to the
  bridge unchanged

### Requirement: Kill-then-respawn ordering
On the **fallback** branch only, the server SHALL issue the SIGTERM before calling
`spawnPiSession` and SHALL NOT await the old process's exit in a blocking way. The order SHALL be:
`killBySessionId(sessionId)` → immediately proceed to `spawnPiSession(...)`. The new pi process
creates its own file handle and reads the session file fresh. This ordering does not apply to the
keeper-dispatch path, which never terminates a process.

#### Scenario: Spawn proceeds immediately after SIGTERM
- **WHEN** the fallback has called `killBySessionId` successfully
- **THEN** the server SHALL call `spawnPiSession` on the next await tick without polling for exit
- **AND** the server SHALL NOT hold back any other inbound messages while waiting

#### Scenario: Keeper dispatch performs no kill
- **WHEN** a reload resolves to the keeper path
- **THEN** no SIGTERM SHALL be issued for that session

### Requirement: Idempotency and concurrent reloads
Concurrent reloads SHALL NOT double-respawn a session. On the fallback branch, the server SHALL
check `isProcessAlive(headlessPidRegistry.getPid(sessionId))` before issuing SIGTERM; if the
process is already gone and no replacement is registered, it SHALL skip the kill and still call
`spawnPiSession`. On the keeper path, concurrent reloads are ordinary sequential RPC lines and
SHALL NOT be deduplicated by the server.

#### Scenario: Two `/reload` messages arrive within the respawn window
- **WHEN** a fallback respawn is in flight and a second `/reload` arrives before the new PID is
  registered
- **THEN** the second call SHALL observe either the original PID (kill+spawn) or no PID (spawn
  only)
- **AND** in neither case SHALL two new pi processes be spawned

#### Scenario: Two reloads dispatched through the keeper
- **WHEN** two reloads are dispatched to the same keeper in quick succession
- **THEN** both lines SHALL be written and each SHALL produce its own terminal feedback

### Requirement: `/reload` on streaming headless session is rejected
A reload SHALL NOT be delivered to a session that is streaming or compacting, on any path. pi
executes an extension command immediately even mid-run, and `ctx.reload()` invalidates the active
runner — dispatching mid-run destroys in-flight work. The server SHALL instead emit
`command_feedback {status:"error"}` mirroring pi's own TUI wording ("Wait for the current response
to finish before reloading"). The refusal SHALL NOT apply to a session with no live bridge
connection whose `status` is merely a stale `streaming`: such a session may be pinned there
because its bridge died before `agent_end`, and it remains respawnable via the fallback.

#### Scenario: `/reload` during streaming on a keeper-backed session
- **WHEN** a `/reload` arrives for a streaming session with a live keeper
- **THEN** the server SHALL NOT write the reload line to the keeper
- **AND** SHALL NOT kill or respawn the pi process
- **AND** SHALL emit `command_feedback` with `command: "/reload"` and `status: "error"` telling
  the operator to wait for the current response to finish

#### Scenario: Reload requested during compaction
- **WHEN** a `/reload` arrives while the session is compacting
- **THEN** the server SHALL refuse it with the same error feedback

### Requirement: Compaction is observable to the server
The server SHALL be able to tell that a session is compacting. The bridge SHALL report compaction
start and end for its session, and the server SHALL track that state on the session record so the
busy-session refusal above can be evaluated. The signal SHALL be cleared when compaction ends and
when the session ends, so a stale compacting flag cannot permanently block reloads.

#### Scenario: Compaction start and end are reported
- **WHEN** a session begins compacting
- **THEN** the server SHALL observe the session as compacting
- **AND** when compaction ends, the server SHALL observe it as no longer compacting

#### Scenario: Session ends while compacting
- **WHEN** a session ends while its compacting flag is set
- **THEN** the flag SHALL not survive onto a later registration of that session

#### Scenario: `/reload` for a bridge-dead session stuck at streaming
- **WHEN** a `/reload` arrives for a session with a headless PID, no keeper, no live bridge
  connection, and a last-known `status: "streaming"`
- **THEN** the server SHALL take the respawn fallback
- **AND** the stale `streaming` status SHALL NOT cause the reload to be refused

#### Scenario: Fallback refuses a connected streaming session
- **WHEN** the fallback is reached for a session that is still connected and streaming
- **THEN** the server SHALL NOT respawn and SHALL emit `command_feedback` with `status: "error"`
