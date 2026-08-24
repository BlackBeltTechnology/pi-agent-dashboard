## Purpose

Server-side handling of `/reload` for headless-spawned pi sessions. One entry point, `dispatchReload(sessionId)`, resolves every reload: refuse a busy session → kill-and-respawn a session with a registered PID → forward to the bridge for a terminal-hosted session → otherwise an honest terminal error. Accumulated session state (tokens, cost, context usage, attached proposal) survives the respawn's re-registration, and exactly one truthful terminal `command_feedback` keyed `/reload` is emitted per reload.

Kill-and-respawn is the default because it is the ONLY mechanism that reloads a headless session. pi-coding-agent exposes `reload()` only on `ExtensionCommandContext`, and the bridge-side capture path (`/__dashboard_reload` typed in pi's TUI) never fires for a dashboard-spawned session. The server cannot reach it either: pi's RPC `{type:"prompt"}` performs no slash-command dispatch — measured in the docker harness, a dispatched `/__dashboard_reload` (and pi's own built-in `/help`) arrived at the model as an ordinary user prompt. Reaching `ctx.reload()` without a TUI bootstrap needs an upstream pi change. See change: fix-out-of-band-reload.
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

There is **no in-process dispatch path**. pi's RPC `{type:"prompt"}` performs no slash-command
dispatch: a `/__dashboard_reload` line written to a session's keeper is delivered to the model as
an ordinary user prompt, producing a full agent turn and no reload. The server SHALL NOT deliver a
reload via `headlessPidRegistry.writeRpc`, nor via `pi.sendUserMessage` (which skips pi's command
handling), nor via the bridge's `tryDispatchExtensionCommand` (whose `__`-prefix gate rejects the
reload command).

#### Scenario: Reload on a headless session
- **WHEN** a reload is requested for an idle session with a PID in `headlessPidRegistry`
- **THEN** the server SHALL kill and respawn the pi process
- **AND** SHALL NOT write any line to that session's RPC keeper

#### Scenario: Reload on a terminal-hosted (tmux / wt / wsl-tmux) session
- **WHEN** a reload is requested for a session with no headless PID but a live bridge
- **THEN** the server SHALL forward `/reload` to the bridge
- **AND** the bridge SHALL invoke a captured `globalThis[RELOAD_KEY]` when present, else emit a
  terminal `command_feedback` with `status: "error"` naming the session shape as the reason

#### Scenario: No path available
- **WHEN** a reload is requested for a session with no headless PID and no live bridge
- **THEN** a terminal `command_feedback` with `status: "error"` SHALL be emitted
- **AND** no pi process SHALL be spawned

### Requirement: Reload feedback is truthful, singular, and keyed `/reload`
Exactly one terminal `command_feedback` (`completed` XOR `error`) SHALL be emitted per reload, and
its `command` field SHALL be `/reload` regardless of which internal path resolved it. The bridge
SHALL NOT emit an unconditional `completed` for `/reload` independent of the outcome;
`BridgeCommandOptions.reload` SHALL report whether a reload actually ran, including when a
captured reload function throws **synchronously** because its runner was invalidated by an earlier
reload.

#### Scenario: Reload that cannot be delivered
- **WHEN** no reload path is available for a session, or every attempted path fails
- **THEN** a terminal `command_feedback` with `command: "/reload"`, `status: "error"` and a reason
  SHALL be emitted
- **AND** no `completed` event for the same reload SHALL be emitted

#### Scenario: Bridge reload with no available path
- **WHEN** the bridge receives `/reload` and has no captured reload function
- **THEN** it SHALL emit `status: "error"`
- **AND** it SHALL NOT emit `completed`

#### Scenario: Bridge reload whose captured function throws synchronously
- **WHEN** the captured reload function throws synchronously (single-use runner already consumed)
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

