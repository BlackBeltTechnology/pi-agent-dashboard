## Purpose

Server-side handling of `/reload` for headless-spawned pi sessions. One entry point, `dispatchReload(sessionId)`, resolves every reload: refuse a busy session → kill-and-respawn a session with a registered PID → forward to the bridge for a terminal-hosted session → otherwise an honest terminal error. Accumulated session state (tokens, cost, context usage, attached proposal) survives the respawn's re-registration, and exactly one truthful terminal `command_feedback` keyed `/reload` is emitted per reload.

Kill-and-respawn is the default because it is the ONLY mechanism that reloads a headless session. pi-coding-agent exposes `reload()` only on `ExtensionCommandContext`, and the bridge-side capture path (`/__dashboard_reload` typed in pi's TUI) never fires for a dashboard-spawned session. The server cannot reach it either: pi's RPC `{type:"prompt"}` performs no slash-command dispatch — measured in the docker harness, a dispatched `/__dashboard_reload` (and pi's own built-in `/help`) arrived at the model as an ordinary user prompt. Reaching `ctx.reload()` without a TUI bootstrap needs an upstream pi change. See change: fix-out-of-band-reload.

## Requirements

### Requirement: Server intercepts `/reload` for headless sessions
When the dashboard server receives a `send_prompt` message whose `text` equals `/reload` AND the target session is headless (i.e., `headlessPidRegistry.getPid(sessionId)` returns a defined PID), the server SHALL handle the reload itself by killing and respawning the pi process, instead of forwarding the prompt to the bridge extension. For non-headless sessions (no entry in `headlessPidRegistry`), the existing behavior SHALL be preserved: the prompt is forwarded to the bridge and the bridge’s `command-handler` calls the captured `globalThis[RELOAD_KEY]` function.

#### Scenario: `/reload` sent to active headless session
- **WHEN** the server receives `send_prompt` with `text === "/reload"` for an active session that has a PID in `headlessPidRegistry`
- **THEN** the server SHALL NOT forward the prompt to the bridge via `piGateway.sendToSession`
- **AND** the server SHALL kill the headless pi process by calling `headlessPidRegistry.killBySessionId(sessionId)`
- **AND** the server SHALL spawn a new pi process via `spawnPiSession(cwd, {sessionFile, mode: "continue", strategy: "headless"})` where `cwd` and `sessionFile` come from the existing session record
- **AND** on successful spawn, the server SHALL register the new PID via `headlessPidRegistry.register(pid, cwd, process)`

#### Scenario: `/reload` sent to active non-headless (tmux / wt / wsl-tmux) session
- **WHEN** the server receives `send_prompt` with `text === "/reload"` for a session that does NOT have a PID in `headlessPidRegistry`
- **THEN** the server SHALL forward the prompt to the bridge via `piGateway.sendToSession` unchanged (existing behavior)

#### Scenario: `/reload` carries images or leading whitespace
- **WHEN** the server receives `send_prompt` with `text === "/reload"` exactly (no extra whitespace, no non-empty `images` array)
- **THEN** the interception SHALL apply
- **AND** when the text has surrounding whitespace or is `"/reload anything-else"`, it SHALL be forwarded to the bridge unchanged (bridge handles the variant parsing)

### Requirement: Kill-then-respawn ordering
The server SHALL issue the SIGTERM before calling `spawnPiSession` and SHALL NOT await the old process’s exit in a blocking way that would delay the user. The order SHALL be: `killBySessionId(sessionId)` → immediately proceed to `spawnPiSession(...)`. The existing `spawnDetached` primitive and the pi session manager’s append-only semantics make this safe: the new pi process creates its own file handle, reads the session file fresh, and either loads the persisted tail or overwrites a truncated file if the old process's final flush collided.

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
If two `/reload` messages arrive in rapid succession for the same session, the second SHALL NOT double-respawn. The server SHALL guard against this by checking whether the pi process identified by `headlessPidRegistry.getPid(sessionId)` is still alive via `isProcessAlive(pid)` before issuing SIGTERM; if the process has already been killed and no replacement is registered yet, the server SHALL skip the kill step and still call `spawnPiSession`.

#### Scenario: Two `/reload` messages arrive within the respawn window
- **WHEN** a `/reload` is in flight and a second `/reload` arrives before the new PID is registered
- **THEN** the second call SHALL observe either (a) the original PID (not yet killed — kill+spawn as normal) or (b) no PID (already killed and not replaced — spawn only)
- **AND** in neither case SHALL two new pi processes be spawned

### Requirement: `/reload` on streaming headless session is rejected
If the target headless session is currently streaming (the bridge has sent `agent_start` but not `agent_end`), the server SHALL NOT respawn and SHALL instead broadcast a `command_feedback` with `status: "error"` and a message equivalent to "Wait for the current response to finish before reloading." This matches pi's own TUI `/reload` behavior.

#### Scenario: `/reload` during streaming
- **WHEN** a `/reload` arrives for a headless session with `isAgentStreaming === true`
- **THEN** the server SHALL NOT kill or respawn the pi process
- **AND** the server SHALL broadcast a `command_feedback` event with `command: "/reload"`, `status: "error"`, and message text indicating the session is still streaming
