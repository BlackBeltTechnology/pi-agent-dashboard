## MODIFIED Requirements

### Requirement: Unattended reclamation SHALL terminate the session process for every spawn strategy

Every UNATTENDED server-initiated termination of a session SHALL terminate the
session's `pi` process regardless of the strategy that spawned it, on every host
where the process identity it signals can be verified (see *An unattended kill
SHALL verify process identity before signalling*). The recorded pid SHALL be
probed and signalled only when its resolved target is `host` (*A recorded pid is
used only in its resolved pid target*). Any other target SHALL be refused BEFORE
any liveness probe, and reported as a failed reclaim that is not retried. On a
Windows server the start time of a host-target non-headless process cannot be
determined, so such a session SHALL also be refused. Headless sessions are
terminated through the registry (`headless-spawn`).

This requirement concerns the session's `pi` process itself. It does not assert
descendant termination.

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

#### Scenario: A WSL pid on a Windows server is never reported dead from the Windows table

- **WHEN** an unattended reclaim targets a session whose pid target is WSL on a Windows server
- **THEN** no Windows liveness probe SHALL run for that pid
- **AND** the reclaim SHALL be reported as failed and SHALL NOT be reported as a confirmed termination

#### Scenario: A remote-origin session is refused before any probe

- **WHEN** an unattended reclaim targets a session with `originDeviceId` set
- **THEN** its recorded pid SHALL NOT be probed or signalled as a local process, and the reclaim SHALL be reported as failed
- **AND** the headless registry rung SHALL still run for any registry entry linked to the session by token

### Requirement: Force kill process escalation
When the server receives a `force_kill` message for a session whose pid target is `host`, or `unknown` on a Windows server (*A recorded pid is used only in its resolved pid target*), it SHALL terminate the session's process using the platform-provided `killProcess(pid, { timeoutMs: 2000 })` helper, so that the entire process subtree is terminated on every supported OS. For any other target, the force-kill SHALL be refused: no signal, no WebSocket close, the session not marked ended, and `success: false` with a message stating that the process is not on this host. On Windows this delegates to `taskkill /F /T /PID <pid>` (immediate tree kill). On POSIX this sends `SIGTERM`, waits up to 2 seconds, and sends `SIGKILL` if the process is still alive. The server SHALL NOT call `process.kill(pid, …)` directly.

The PID used for kill resolution SHALL come from the session's stored `pid` field (`DashboardSession.pid`), populated from `session_register.pid`. The PID stored on the session SHALL have been correlated to the session via the three-tier link in `headlessPidRegistry` (`linkByToken` → `linkByPid` → `linkSession`), so that for sessions registered with a `spawnToken`, the kill target is unambiguously the pi process matching that token rather than the first unsessioned entry in the cwd. This eliminates the prior race where a sibling spawn in the same cwd could be killed by mistake.

`headlessPidRegistry.killBySessionId(sessionId)` SHALL look up the entry by `sessionId` set during link, and SHALL kill the `pid` recorded on that entry. When called for a session whose registry entry was linked via `linkByToken` or `linkByPid`, the kill SHALL target the strongly-correlated PID. When linked only via cwd-FIFO (legacy), behavior SHALL match pre-change semantics.

#### Scenario: Windows tree kill via taskkill
- **WHEN** the server handles a `force_kill` on `process.platform === "win32"` for a session with a known PID and a `host` pid target (or `unknown` on Windows)
- **THEN** it SHALL invoke `killProcess(pid, { timeoutMs: 2000 })` from `@blackbelt-technology/pi-dashboard-shared/platform/process.js`
- **AND** the platform helper SHALL execute `taskkill /F /T /PID <pid>` so that descendant processes are also terminated

#### Scenario: POSIX SIGTERM sent first
- **WHEN** the server handles a `force_kill` on `process.platform === "linux"` or `"darwin"` for a session with a known PID and a `host` pid target (or `unknown` on Windows)
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

#### Scenario: Force-kill of a remote-origin session is refused
- **WHEN** an operator force-kills a live session registered from a remote device (`originDeviceId` set)
- **THEN** no local process SHALL be signalled, the bridge WebSocket SHALL stay open, the session SHALL NOT be marked ended
- **AND** `force_kill_result` SHALL carry `success: false` with a message that the process is not on this host

#### Scenario: Force-kill of a WSL session on a Windows server never uses taskkill
- **WHEN** an operator force-kills a session whose pid target is WSL on a Windows server
- **THEN** `taskkill` SHALL NOT be invoked for its pid and the force-kill SHALL be refused

### Requirement: Ending a session SHALL terminate its process for every spawn strategy

Ending a session — via the browser WebSocket `shutdown` message, the REST
shutdown route, or force-kill — SHALL terminate the operating-system process
backing that session, regardless of the strategy that spawned it
(`PI_SPAWN_STRATEGY`: `headless` or `tmux`), when that process is on this host.
A session whose pid target is not local (*A recorded pid is used only in its
resolved pid target*) SHALL NOT be signalled. Its shutdown is an unconfirmed
termination under *A removal SHALL never imply a termination the server did not
verify*, and its force-kill is refused.

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

#### Scenario: Shutdown of a remote-origin session is an unconfirmed termination
- **WHEN** an operator shuts down a session registered from a remote device
- **THEN** no local process SHALL be signalled
- **AND** the removal SHALL be reported as unconfirmed, with the orphan signal alongside `session_removed`

### Requirement: Bridge WebSocket force-closed after kill
After sending SIGTERM, the server SHALL force-close the bridge WebSocket connection for that session. A refused force-kill of a non-local pid target SHALL NOT close it.

#### Scenario: WebSocket closed on force kill
- **WHEN** the server handles a `force_kill` that is not refused
- **THEN** it SHALL close the bridge WebSocket for that session via the pi-gateway

### Requirement: Session marked ended after force kill
After force-killing a process, the server SHALL mark the session as "ended" and broadcast a `session_updated` message. A refused force-kill SHALL NOT change the session's status. The session SHALL NOT be removed from the session list.

#### Scenario: Session status updated to ended
- **WHEN** a force kill completes (process killed or WS closed)
- **THEN** the session status SHALL be set to "ended"
- **AND** a `session_updated` broadcast SHALL be sent to all browser clients

#### Scenario: Session remains in sidebar
- **WHEN** a force kill completes
- **THEN** the session SHALL still appear in the session list (not removed)
- **AND** the session SHALL be resumable via fork or continue

#### Scenario: A refused force-kill leaves the session live
- **WHEN** a force-kill is refused because the session's pid target is not local
- **THEN** the session status SHALL remain unchanged and no `session_updated` broadcast SHALL report it ended

## ADDED Requirements

### Requirement: A recorded pid is used only in its resolved pid target

Before any probe, signal or pid-based link, the server SHALL resolve the recorded pid's target (`host`, WSL `D`, `legacy-wsl`, `foreign` or `unknown`) with one shared helper, in the rule order of the resolution scenarios below. Only `host` SHALL be probed or signalled locally, except that on a Windows server an operator shutdown or force-kill MAY signal `unknown`. The terminator SHALL resolve once, before its registry rung. A repo test SHALL enforce this.

#### Scenario: Resolution 1 — a remote-origin session is foreign
- **WHEN** the session has `originDeviceId` set
- **THEN** the target SHALL be `foreign`, whatever the bridge reported

#### Scenario: Resolution 2 — a report from another platform
- **WHEN** the reported platform differs from the server's
- **THEN** the target SHALL be `foreign`, except a WSL report to a Windows server, which SHALL be WSL `D`

#### Scenario: Resolution 3 — a report to a Linux server
- **WHEN** a Linux server receives a report from a Linux bridge
- **THEN** the target SHALL be `unknown` if either side lacks `hostId` or `nsId`, `foreign` if `hostId` or `nsId` differs, and `host` otherwise

#### Scenario: Resolution 4 — a report to a macOS or Windows server
- **WHEN** a macOS or Windows server receives a same-platform host report
- **THEN** the target SHALL be `unknown` if either side lacks `hostId`, `foreign` if `hostId` differs, and `host` otherwise

#### Scenario: Resolution 5 — no report
- **WHEN** the bridge reported no namespace
- **THEN** the target SHALL be `host` if the pid equals this session's own linked headless registry entry; on a Windows server, `legacy-wsl` for a POSIX-style cwd and `unknown` otherwise; `host` on any other server

#### Scenario: A dashboard inside the same WSL distribution treats its own sessions as host
- **WHEN** a Linux server in WSL distribution `D` receives a WSL report for `D` with its own `hostId` and `nsId`
- **THEN** the target SHALL be `host`

#### Scenario: A Linux bridge on another machine is foreign
- **WHEN** a Linux server receives a report with the same `nsId` but a different `hostId`
- **THEN** the target SHALL be `foreign`

#### Scenario: A non-host pid is not fed to the idle-reaper probe
- **WHEN** the idle reaper assembles signals for a session whose target is not `host`
- **THEN** it SHALL NOT probe a local process for that pid and SHALL treat the probe as unavailable

#### Scenario: A legacy WSL session on a Windows server is never signalled
- **WHEN** an operator force-kills a session on a Windows server with no reported namespace and a cwd starting with `/`
- **THEN** no Windows process SHALL be signalled and the force-kill SHALL be refused

#### Scenario: An unknown target on a POSIX server is not signalled by an operator
- **WHEN** an operator force-kills a session on a Linux or macOS server whose pid target is `unknown`
- **THEN** no local process SHALL be signalled and the force-kill SHALL be refused

#### Scenario: A new unresolved pid consumer fails the repo test
- **WHEN** a server file passes a session-derived pid to a process probe or signal helper without resolving its target
- **THEN** the repo-level enforcement test SHALL fail naming the file
