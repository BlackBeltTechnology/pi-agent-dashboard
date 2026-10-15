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

The form of that verification depends on the path. On the operator force-kill
path the command-line check below applies (unchanged by this change). On an
UNATTENDED reclaim path (idle reaper, caps reclaim, automation run termination)
targeting a process identity the server RECORDED from registration, the
verification SHALL be the start-time identity guard of *An unattended kill SHALL
verify process identity before signalling*, and it SHALL run before ANY signal of
the ladder, not only before SIGKILL. The start-time guard replaces the
command-line check there because it is strictly stronger for this purpose: a
command-line match on "pi" or "node" accepts any unrelated node process that
reused the pid, whereas a process that started after the identity was recorded
cannot be the session's process.

#### Scenario: PID verified on macOS/Linux
- **WHEN** the server is about to send SIGKILL on the operator force-kill path
- **THEN** it SHALL check the process command line contains "pi" or "node"
- **AND** skip SIGKILL if the command line doesn't match

#### Scenario: PID check failure is non-fatal
- **WHEN** the PID verification command fails (process already exited)
- **THEN** the server SHALL treat the process as already dead and report success

#### Scenario: An unattended reclaim verifies identity by start time

- **WHEN** an unattended reclaim is about to signal a process identity recorded
  from the session's registration
- **THEN** it SHALL apply the start-time identity guard before the first signal
- **AND** a command-line match SHALL NOT be accepted in its place

### Requirement: Ending a session SHALL terminate its process for every spawn strategy

Ending a session — via the browser WebSocket `shutdown` message, the REST
shutdown route, or force-kill — SHALL terminate the operating-system process
backing that session, regardless of the strategy that spawned it
(`PI_SPAWN_STRATEGY`: `headless` or `tmux`).

Termination SHALL use one shared escalation ladder (SIGTERM → grace → SIGKILL),
not a per-strategy reimplementation. The ladder is the shared platform kill
primitive (`killProcess`). The shutdown paths and every unattended reclaim invoke
it through one shared session terminator (see *Unattended reclamation SHALL
terminate the session process for every spawn strategy*), which tries the
headless PID registry first and then the recorded process identity. Force-kill
invokes the same primitive directly and in the opposite order — the recorded
process identity FIRST, then the registry — and keeps its own no-identity branch;
it is deliberately not routed through the terminator, because flipping its order
would change the keeper-mode signal order on an operator-facing path. A strategy whose processes are not tracked
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

#### Scenario: A session whose PID was never recorded

- **WHEN** a session is ended and the server holds no pid for it
- **THEN** the universal-termination guarantee SHALL NOT apply, because there is
  no process identity to act on
- **AND** the server SHALL degrade to closing the bridge connection and
  releasing the record, reporting that rather than claiming a kill
- **AND** the spawn-register watchdog SHALL be the reclaiming mechanism ONLY
  while the spawn has not registered: registering clears its watchdog entry, so
  a session that holds a record but no pid is reported, not reclaimed (an
  automation run stopped before registering is reclaimed by its spawn
  correlation token instead)

#### Scenario: No spawn strategy is left without a teardown path

- **WHEN** the server's session-termination code is inspected
- **THEN** every supported spawn strategy SHALL have a termination path
- **AND** a strategy without one SHALL fail a test rather than silently orphan
  its processes

### Requirement: A removal SHALL never imply a termination the server did not verify

`session_removed` means the SESSION RECORD was released. It does NOT assert that
the process was terminated, and clients SHALL NOT read it as that assertion.

The server SHALL attempt to confirm the session's process is gone. When
termination cannot be confirmed, the server SHALL surface a diagnostic
identifying the session and its surviving process, AND SHALL emit an explicit
orphan signal to clients alongside `session_removed`. An unconfirmed termination
is therefore distinguishable from a confirmed one by the presence of that signal
— which is the whole point, since their indistinguishability is what hid the
leak.

When the server holds NO process identity for the session, there is no
surviving pid to name and the orphan signal (which carries the pid) cannot be
emitted. In that case the server SHALL instead log a diagnostic naming the
session and stating that termination was NOT verified, and SHALL NOT report the
removal as a confirmed termination. A pid-less orphan signal would be a protocol
change and is not required; the absence of a pid is itself the unverifiable
case, and the diagnostic keeps it from being silent.

The record is still released. Retaining it would wedge the session in the UI
with no way to clear it but force-kill, and stall consumers that await
`session_removed` per session (notably the E2E reap), so a failed termination is
deliberately non-blocking. What must never happen is the SILENT case: a kill that
never happened being indistinguishable from one that succeeded.

#### Scenario: Failed termination is visible rather than silent

- **WHEN** a session's process survives the full escalation ladder
- **THEN** the server SHALL log a diagnostic naming the session id and the
  surviving process
- **AND** SHALL broadcast an orphan signal carrying the session id and the
  surviving pid, alongside `session_removed` rather than instead of it
- **AND** SHALL NOT report the shutdown as a clean success

#### Scenario: The client surfaces an unconfirmed termination

- **WHEN** a client receives the orphan signal
- **THEN** it SHALL surface the surviving pid to the user rather than presenting
  an ordinary successful close

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

#### Scenario: Removal of a session with no process identity is logged

- **WHEN** a session for which the server holds no pid is shut down
- **THEN** the server SHALL log a diagnostic naming the session and stating that
  termination was not verified
- **AND** SHALL broadcast `session_removed`
- **AND** SHALL NOT broadcast an orphan signal, which requires a pid

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

### Requirement: Unattended reclamation SHALL terminate the session process for every spawn strategy

Every UNATTENDED server-initiated termination of a session SHALL terminate the
session's `pi` process regardless of the strategy that spawned it, on every host
where the process identity it signals can be verified (see *An unattended kill
SHALL verify process identity before signalling*). On a Windows server the start
time of a non-headless session's process cannot be determined, so such a session
SHALL be refused and reported as a failed reclaim rather than terminated;
headless sessions on Windows are terminated through the registry as before.

This requirement concerns the session's `pi` process itself. It does not assert
that the process's descendants (MCP servers, tool subprocesses) terminate: no
termination path signals a process group on Unix today, which is a pre-existing
gap against *Process group kill for headless agents* and is tracked as a
follow-up, not changed here.

The unattended terminations are: the idle reaper's reclaim gears, the
active-session caps reclaim, and the termination of an automation run's spawned
session on stop or on completion.

Those paths, together with the session-shutdown path (the browser `shutdown`
message and the REST shutdown route), SHALL terminate through the SAME shared
escalation ladder (SIGTERM → grace → SIGKILL) keyed on the process identity the
server already holds for the session, so termination stays strategy-agnostic by
construction rather than by enumerating strategies. A termination path that can
only act on processes tracked in the headless PID registry SHALL NOT be
considered a termination path: a session spawned by any other mechanism is
unreachable through it.

The operator force-kill path is NOT routed through the shared terminator: it
invokes the same kill primitive by the session's recorded process identity, in a
deliberately different signal order, as stated in the modified *Ending a session
SHALL terminate its process for every spawn strategy* requirement.

Termination SHALL be idempotent: a path that finds the process already gone SHALL
report success and SHALL NOT signal an unrelated process.

#### Scenario: An unattended reclaim terminates a non-headless session

- **WHEN** the idle reaper, the caps gate, or an automation stop reclaims a
  session that was spawned by a mechanism the headless PID registry does not
  track, on a host where the session's recorded process identity can be verified
- **THEN** that session's `pi` process SHALL no longer be resident
- **AND** the hard kill SHALL have been attempted on the session's recorded
  process identity, not only on a registry entry

#### Scenario: A headless session's reclaim is unchanged

- **WHEN** an unattended reclaim targets a session spawned headlessly
- **THEN** the registry kill SHALL run first exactly as before this change,
  including the existing keeper-PID escalation
- **AND** the terminator SHALL then probe the process's liveness, and SHALL
  signal it again through the shared ladder only if it is still alive
- **AND** no additional signal SHALL be sent to a process that has already exited

#### Scenario: A non-headless session on a Windows server is refused, not killed

- **WHEN** an unattended reclaim targets a non-headless session on a Windows
  server, where the start time of its recorded process cannot be determined
- **THEN** no signal SHALL be sent to that process
- **AND** the reclaim SHALL be reported as a failed reclaim stating that the
  identity was unverifiable
- **AND** the session's `pi` process MAY remain resident

#### Scenario: The unattended paths share one terminator

- **WHEN** the server's unattended reclaim paths and the session-shutdown path
  are inspected
- **THEN** each SHALL resolve its target through the one shared terminator
- **AND** a path that terminates only via the headless PID registry SHALL fail a
  test rather than silently orphan its process

### Requirement: A termination SHALL be reported only when it is confirmed

A termination path SHALL distinguish a kill that was ISSUED from a process that
is GONE. Reporting success SHALL require a post-kill liveness check of a known
process identity; the return value of a kill primitive SHALL NOT by itself be
treated as proof of termination.

A liveness check that cannot determine the answer — in particular, a probe
refused because the server does not own the process — SHALL be treated as
"still alive", never as "terminated".

When no process identity is held for the session, no termination SHALL be
claimed. The outcome SHALL be reported as a failed reclaim. The spawn-register
watchdog SHALL NOT be cited as the fallback for such a session: a session that
holds a record has registered, and registering clears its watchdog entry.

#### Scenario: An issued kill is not a confirmed kill

- **WHEN** a reclaim's kill primitive reports that it acted, but the target
  process is still alive afterwards
- **THEN** the reclaim SHALL be reported as failed
- **AND** no reap or admission SHALL be counted on the strength of it

#### Scenario: A liveness probe the server may not perform does not mean dead

- **WHEN** the liveness check for a target process is refused for lack of
  permission
- **THEN** the process SHALL be treated as still alive
- **AND** the reclaim SHALL be reported as unconfirmed, including when the kill
  primitive declined to send any signal because of that same refusal

#### Scenario: A session whose PID was never recorded degrades, it does not lie

- **WHEN** an unattended reclaim targets a session for which the server holds no
  process identity
- **THEN** no termination SHALL be claimed
- **AND** the outcome SHALL be reported as a failed reclaim
- **AND** the reclaim SHALL NOT be retried indefinitely for that session

#### Scenario: Shutting down a session with no process identity is reported

- **WHEN** an operator shuts down a session for which the server holds no
  process identity
- **THEN** the server SHALL release the record as before
- **AND** it SHALL log a diagnostic stating that termination was not verified
- **AND** it SHALL NOT report the shutdown as a confirmed termination

### Requirement: An unattended kill SHALL verify process identity before signalling

Before signalling a process identity the server RECORDED from the session's
registration, an unattended reclaim SHALL verify that the live process at that identity
is still the session's process. The verification SHALL be that the process
started no later than the moment the server recorded the identity (allowing a
small clock tolerance); a command-line pattern match SHALL NOT be sufficient on
its own.

A process that is already gone SHALL be reported as terminated without being
signalled; only a LIVE process that fails verification is a refusal.

When the identity cannot be verified — the platform offers no start-time probe,
the probe fails, or no recording time is held — the unattended reclaim SHALL NOT
signal the process. It SHALL report the reclaim as failed with a diagnostic
stating that the identity was unverifiable. The operator shutdown and force-kill
paths are not subject to this requirement.

Processes reached through the headless PID registry are NOT subject to this
requirement. That covers a child process the server spawned and still holds
(its pid cannot be recycled while the server holds it) AND an entry the registry
restored from disk after a server restart; a restored entry is signalled exactly
as the registry signals it today, without a start-time check. This exemption is
explicit and pre-existing, not a guarantee: a restored entry's pid can have been
recycled while the server was down.

#### Scenario: A reused PID is not signalled

- **WHEN** an unattended reclaim finds the session's recorded process identity
  alive but held by a process that started after the identity was recorded
- **THEN** no signal SHALL be sent
- **AND** the reclaim SHALL be reported as failed with a diagnostic naming the
  identity reuse
- **AND** that session SHALL NOT be retried on later sweeps

#### Scenario: An already-exited process is not a refusal

- **WHEN** an unattended reclaim finds the session's recorded process identity
  no longer exists
- **THEN** no signal SHALL be sent
- **AND** the reclaim SHALL be reported as a confirmed termination

#### Scenario: An unverifiable identity is refused, not guessed

- **WHEN** an unattended reclaim targets a live recorded process identity on a
  host where its start time cannot be determined
- **THEN** no signal SHALL be sent
- **AND** the reclaim SHALL be reported as failed with a diagnostic stating the
  identity was unverifiable
- **AND** that session SHALL NOT be retried on later sweeps
