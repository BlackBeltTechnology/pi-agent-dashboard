# force-kill-handler Specification

## Purpose

Ending a session — force-kill, the browser `shutdown` message, or the REST
shutdown route — SHALL terminate the operating-system process backing it,
for every spawn strategy, and SHALL NOT report a removal it has not
confirmed.
## Requirements
### Requirement: Force kill message type
The browser-to-server protocol SHALL support a `force_kill` message type with a `sessionId` field.

#### Scenario: force_kill message structure
- **WHEN** the browser sends a `force_kill` message
- **THEN** it SHALL contain `type: "force_kill"` and `sessionId: string`

### Requirement: Force kill result message type
The server-to-browser protocol SHALL support a `force_kill_result` message type with `sessionId`, `success`, and optional `message` fields.

#### Scenario: force_kill_result on success
- **WHEN** the server handles a `force_kill` (process killed, already dead, or WS-only close)
- **THEN** it SHALL send a `force_kill_result` with `success: true` and an optional descriptive `message`

#### Scenario: force_kill_result on unknown session
- **WHEN** the server receives a `force_kill` for a session that does not exist
- **THEN** it SHALL send a `force_kill_result` with `success: false` and a descriptive `message`

### Requirement: Server stores session PID
The server SHALL store the `pid` from `session_register` messages on the `DashboardSession` object.

#### Scenario: PID stored on registration
- **WHEN** the server receives a `session_register` with a `pid` field
- **THEN** the corresponding `DashboardSession` SHALL have `pid` set to that value

### Requirement: Force kill process escalation
When the server receives a `force_kill` message, it SHALL terminate the session's process using the platform-provided `killProcess(pid, { timeoutMs: 2000 })` helper so that the entire process subtree is terminated on every supported OS. On Windows this delegates to `taskkill /F /T /PID <pid>` (immediate tree kill). On POSIX this sends `SIGTERM`, waits up to 2 seconds, and sends `SIGKILL` if the process is still alive. The server SHALL NOT call `process.kill(pid, …)` directly.

The PID used for kill resolution SHALL come from the session's stored `pid` field (`DashboardSession.pid`), populated from `session_register.pid`. The PID stored on the session SHALL have been correlated to the session via the three-tier link in `headlessPidRegistry` (`linkByToken` → `linkByPid` → `linkSession`), so that for sessions registered with a `spawnToken`, the kill target is unambiguously the pi process matching that token rather than the first unsessioned entry in the cwd. This eliminates the prior race where a sibling spawn in the same cwd could be killed by mistake.

`headlessPidRegistry.killBySessionId(sessionId)` SHALL look up the entry by `sessionId` set during link, and SHALL kill the `pid` recorded on that entry. When called for a session whose registry entry was linked via `linkByToken` or `linkByPid`, the kill SHALL target the strongly-correlated PID. When linked only via cwd-FIFO (legacy), behavior SHALL match pre-change semantics.

#### Scenario: Windows tree kill via taskkill
- **WHEN** the server handles a `force_kill` on `process.platform === "win32"` for a session with a known PID
- **THEN** it SHALL invoke `killProcess(pid, { timeoutMs: 2000 })` from `@blackbelt-technology/pi-dashboard-shared/platform/process.js`
- **AND** the platform helper SHALL execute `taskkill /F /T /PID <pid>` so that descendant processes are also terminated

#### Scenario: POSIX SIGTERM sent first
- **WHEN** the server handles a `force_kill` on `process.platform === "linux"` or `"darwin"` for a session with a known PID
- **THEN** `killProcess` SHALL send `SIGTERM` to the PID first

#### Scenario: POSIX SIGKILL after timeout
- **WHEN** `killProcess` has sent `SIGTERM` AND the process is still alive after 2 seconds
- **THEN** `killProcess` SHALL send `SIGKILL` to the PID
- **AND** return `{ ok: true, forced: true }`

#### Scenario: Process already dead after SIGTERM
- **WHEN** `killProcess` has sent `SIGTERM` AND the process exits within 2 seconds
- **THEN** `killProcess` SHALL NOT send `SIGKILL`
- **AND** return `{ ok: true, forced: false }`

#### Scenario: No PID available
- **WHEN** a `force_kill` is received for a session with no stored PID
- **THEN** the server SHALL force-close the bridge WebSocket connection
- **AND** return `force_kill_result` with `success: true` and a message indicating WS-only kill

#### Scenario: No direct process.kill in the handler
- **WHEN** the repo-level enforcement test scans `packages/server/src/browser-handlers/session-action-handler.ts`
- **THEN** no `process.kill(` call SHALL be present
- **AND** all termination SHALL go through `killProcess` or `killPidWithGroup`

#### Scenario: Forked session kill does not target parent (token-linked sibling)
- **GIVEN** a parent session P linked to PID 1000 in the same cwd as fork session F linked to PID 1234, both linked via `linkByToken` using their respective spawn tokens
- **WHEN** the user issues `force_kill` for session F
- **THEN** the killed PID SHALL be 1234 (F's PID, by token-correlated linkage)
- **AND** PID 1000 SHALL NOT be signalled
- **AND** session P SHALL remain active

#### Scenario: Forked session kill does not target parent (pid-linked sibling)
- **GIVEN** a parent session P linked to PID 1000 in the same cwd as fork session F linked to PID 1234, both linked via `linkByPid` (legacy bridge sending pid but not token)
- **WHEN** the user issues `force_kill` for session F
- **THEN** the killed PID SHALL be 1234
- **AND** PID 1000 SHALL NOT be signalled

### Requirement: Session marked ended after force kill
After force-killing a process, the server SHALL mark the session as "ended" and broadcast a `session_updated` message. The session SHALL NOT be removed from the session list.

#### Scenario: Session status updated to ended
- **WHEN** a force kill completes (process killed or WS closed)
- **THEN** the session status SHALL be set to "ended"
- **AND** a `session_updated` broadcast SHALL be sent to all browser clients

#### Scenario: Session remains in sidebar
- **WHEN** a force kill completes
- **THEN** the session SHALL still appear in the session list (not removed)
- **AND** the session SHALL be resumable via fork or continue

### Requirement: Bridge WebSocket force-closed after kill
After sending SIGTERM, the server SHALL force-close the bridge WebSocket connection for that session.

#### Scenario: WebSocket closed on force kill
- **WHEN** the server handles a `force_kill`
- **THEN** it SHALL close the bridge WebSocket for that session via the pi-gateway

### Requirement: PID safety check before SIGKILL
Before sending SIGKILL, the server SHALL verify the PID still belongs to a pi-related process.

#### Scenario: PID verified on macOS/Linux
- **WHEN** the server is about to send SIGKILL
- **THEN** it SHALL check the process command line contains "pi" or "node"
- **AND** skip SIGKILL if the command line doesn't match

#### Scenario: PID check failure is non-fatal
- **WHEN** the PID verification command fails (process already exited)
- **THEN** the server SHALL treat the process as already dead and report success

### Requirement: Ending a session SHALL terminate its process for every spawn strategy

Ending a session — via the browser WebSocket `shutdown` message, the REST
shutdown route, or force-kill — SHALL terminate the operating-system process
backing that session, regardless of the strategy that spawned it
(`PI_SPAWN_STRATEGY`: `headless` or `tmux`).

Termination SHALL use one shared escalation ladder (SIGTERM → grace → SIGKILL),
not a per-strategy reimplementation. A strategy whose processes are not tracked
in the headless PID registry SHALL still be terminated, keyed on the process
identity the server already holds for the session, so termination is
strategy-agnostic by construction rather than by enumerating strategies.

Every `session_register` SHALL therefore carry the registering process's pid.
For a non-headless spawn this is the ONLY channel by which the server learns
which process is the session: `tmux new-window` returns tmux's pid, not pi's,
and the pane's command line carries nothing identifying.

Sending an advisory in-session message asking the agent to exit SHALL NOT by
itself be considered termination. It MAY be attempted first, but the outcome
SHALL be verified and escalated when the process survives.

#### Scenario: A tmux-spawned session's process is terminated

- **WHEN** a session spawned under `PI_SPAWN_STRATEGY=tmux` is shut down
- **THEN** its `pi` process SHALL no longer be resident in the container
- **AND** the tmux window or pane that hosted it SHALL no longer exist

#### Scenario: A headless-spawned session is unaffected

- **WHEN** a session spawned under `PI_SPAWN_STRATEGY=headless` is shut down
- **THEN** it SHALL be terminated exactly as before this change
- **AND** the existing keeper-PID escalation behaviour SHALL be unchanged

#### Scenario: Repeated shutdown of an already-dead session is safe

- **WHEN** a session is shut down twice, or shut down after its process already
  exited on its own
- **THEN** the second attempt SHALL be treated as success
- **AND** SHALL NOT report an error or leave the session listed

#### Scenario: No spawn strategy is left without a teardown path

- **WHEN** the server's session-termination code is inspected
- **THEN** every supported spawn strategy SHALL have a termination path
- **AND** a strategy without one SHALL fail a test rather than silently orphan
  its processes

### Requirement: A session SHALL NOT be reported removed until its termination is confirmed

The server SHALL confirm the session's process is gone before broadcasting
`session_removed` and unregistering the session. When termination cannot be
confirmed, the server SHALL surface a diagnostic identifying the session and its
surviving process, rather than reporting a clean removal.

This closes the failure mode that hid the tmux leak: the record was released
unconditionally, so a kill that never happened was indistinguishable from one
that succeeded, and the orphaned process became invisible to every consumer of
the session list.

#### Scenario: Failed termination is visible rather than silent

- **WHEN** a session's process survives the full escalation ladder
- **THEN** the server SHALL log a diagnostic naming the session id and the
  surviving process
- **AND** SHALL NOT report the shutdown as a clean success

#### Scenario: Successful termination reports removal exactly once

- **WHEN** a session is shut down and its process exits
- **THEN** `session_removed` SHALL be broadcast once
- **AND** the session SHALL be absent from the session list afterwards

#### Scenario: An orphaned process is detectable

- **WHEN** resident session processes and the dashboard's session list are
  compared
- **THEN** a process with no corresponding live session SHALL be reportable as
  orphaned
- **AND** this comparison SHALL be available to the E2E harness's memory guard

### Requirement: A spawn that never registers SHALL be reclaimed, not merely reported

When a spawned pi session does not send `session_register` within the
spawn-register timeout, the server SHALL terminate the spawned process, in
addition to emitting the existing timeout diagnostic.

Such a process is unreachable by every other teardown path: with no session
record there is no shutdown, no reap and no idle-reclaim, so it survives until
the host is restarted. The measured case is a tmux pane blocked indefinitely on
pi's interactive "Trust project folder?" prompt for an untrusted directory,
holding ~127 MB with no open sockets.

Reclamation SHALL target only the leaf `pi` process. The spawn correlation token
is an ordinary environment variable and is therefore inherited by the tmux
server, by the dashboard's own process and by intervening shells; a lookup that
does not narrow to `pi` names processes whose termination is catastrophic.

#### Scenario: A pi that never registers is terminated

- **WHEN** a spawned session has not registered within the spawn-register timeout
- **THEN** its process SHALL be terminated with the shared escalation ladder
- **AND** the timeout diagnostic SHALL still be emitted

#### Scenario: A session that registers in time is never targeted

- **WHEN** a spawned session registers before its watchdog fires
- **THEN** no termination SHALL be attempted for that spawn

#### Scenario: Reclamation never targets the dashboard itself

- **WHEN** the correlation lookup returns a process that merely INHERITED the
  spawn token — the tmux server, the dashboard process, an intervening shell
- **THEN** that process SHALL NOT be terminated

#### Scenario: A diagnostic is emitted even with no browser listening

- **WHEN** the originating browser socket has closed before the watchdog fires
- **THEN** the process SHALL still be reclaimed

### Requirement: Each spawn SHALL be individually correlatable

Every spawn SHALL carry a distinct correlation token into the spawned process's
environment, and the session's first `session_register` SHALL echo it back.

`tmux new-window` inherits the environment of the tmux SERVER, not of the client
that invoked it, so passing the token through the invoking process's environment
gave every window after the first the FIRST spawn's token. A shared token
collapses concurrent spawns onto one identity: the spawn watchdog then watches
one of them, reports one timeout for several leaks, and any token-keyed action
addresses the wrong process.

#### Scenario: Concurrent spawns into one directory are each watched

- **WHEN** several sessions are spawned into the same directory and none registers
- **THEN** each spawn SHALL produce its own register-timeout
- **AND** each spawned process SHALL be reclaimed

#### Scenario: Tokens are unique per spawned window

- **WHEN** several tmux windows are spawned in sequence
- **THEN** each SHALL carry a distinct correlation token in its environment

### Requirement: Ending a session SHALL have one implementation

The browser `shutdown` message and `POST /api/session/:id/shutdown` SHALL end a
session through the same code path.

They were parallel implementations and drifted: the REST route omitted the
`closedReason:"manual"` liveness write, so a REST-closed session returned as a
cold-start recovery candidate, and it terminated only through the headless PID
registry, so it leaked a tmux-spawned process after the browser path had been
fixed. Re-synchronising two bodies leaves a third divergence to be found later.

#### Scenario: REST shutdown terminates the process

- **WHEN** a session is ended over `POST /api/session/:id/shutdown`
- **THEN** its process SHALL be terminated for any spawn strategy
- **AND** its liveness marker SHALL record a manual close, so it is not offered
  as a recovery candidate on the next cold start

