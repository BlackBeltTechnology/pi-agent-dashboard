## MODIFIED Requirements

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

A child process the server spawned and still holds, reached through the headless PID registry, is NOT subject to this requirement: its pid cannot be recycled while the server holds it. An entry the registry RESTORED from disk after a server restart is NOT exempt. The registry SHALL verify it by start time (`headless-spawn` *Orphan cleanup on server startup*). When the registry refuses it, the unattended reclaim SHALL send no signal to that pid on any rung and SHALL report a failed reclaim that is not retried.

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

#### Scenario: A restored registry entry refused by the registry is not signalled by the terminator

- **WHEN** an unattended reclaim reaches a session whose headless registry entry was restored from disk
- **AND** the registry refuses the entry's pid because its start time is later than the entry's identity anchor
- **THEN** neither the registry nor the terminator SHALL signal that pid
- **AND** the reclaim SHALL be reported as failed with a diagnostic naming the identity reuse, and SHALL NOT be retried on later sweeps

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
terminated through the registry (`headless-spawn`); a restored registry entry the
registry refuses is not signalled and is reported as a failed reclaim.

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
- **AND** a restored entry SHALL first pass `headless-spawn` *A restored entry is verified before every signal*


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

`headlessPidRegistry.killBySessionId(sessionId)` SHALL look up the entry by `sessionId` set during link, and SHALL kill the `pid` recorded on that entry, except a restored entry's pid that fails identity verification (`headless-spawn` *A restored entry is verified before every signal*). When called for a session whose registry entry was linked via `linkByToken` or `linkByPid`, the kill SHALL target the strongly-correlated PID. When linked only via cwd-FIFO (legacy), behavior SHALL match pre-change semantics.

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
