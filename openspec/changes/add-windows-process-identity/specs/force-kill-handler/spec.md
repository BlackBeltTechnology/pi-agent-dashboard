## MODIFIED Requirements

### Requirement: Unattended reclamation SHALL terminate the session process for every spawn strategy

Every UNATTENDED server-initiated termination of a session SHALL terminate the
session's `pi` process regardless of the strategy that spawned it, on every host
where the process identity it signals can be verified (see *An unattended kill
SHALL verify process identity before signalling*). The recorded pid SHALL be
probed and signalled only in its resolved target (*A recorded pid is used only in
its resolved pid target*).
- A `host` target on a Windows server SHALL be checked against its creation time
  and tree-killed in ONE invocation (`verifyAndKillWindows`).
- A WSL target SHALL be checked and killed in ONE invocation inside its
  distribution (`verifyAndKillWsl`), with liveness read by `wslLiveness`.
- `legacy-wsl`, `foreign` and `unknown` targets SHALL be refused BEFORE any
  liveness probe, and reported as a failed reclaim that is not retried.

A result of `error` from either helper SHALL be reported as a failed reclaim,
never as a confirmed termination: it SHALL be `unconfirmed`, which the existing
bounded give-up retries. A `mismatch` SHALL be `refused-identity`, which is
terminal. An `absent` or `killed` result SHALL be confirmed only after a liveness
re-check. A WSL target whose liveness reads `unknown` SHALL be `unconfirmed`, and
`verifyAndKillWsl` SHALL NOT run. A host or WSL target with no recorded
`pidRecordedAt` SHALL be `refused-identity`. Headless sessions are
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
  server whose pid target is `unknown` or `legacy-wsl`, or whose probe returned
  `error` or timed out
- **THEN** no signal SHALL be sent to that process
- **AND** the reclaim SHALL be reported as a failed reclaim stating that the
  identity was unverifiable
- **AND** the session's `pi` process MAY remain resident
- **AND** an `error` or timed-out probe SHALL be `unconfirmed` and retried up to the give-up bound, while `unknown` and `legacy-wsl` SHALL be `refused-identity` and not retried

#### Scenario: The unattended paths share one terminator

- **WHEN** the server's unattended reclaim paths and the session-shutdown path
  are inspected
- **THEN** each SHALL resolve its target through the one shared terminator
- **AND** a path that terminates only via the headless PID registry SHALL fail a
  test rather than silently orphan its process

#### Scenario: A WSL session is reclaimed inside its distribution

- **WHEN** an unattended reclaim targets a session whose pid target is WSL `D` on a Windows server
- **AND** the process's age measured inside `D` shows it started no later than the identity's recording time plus the tolerance
- **THEN** it SHALL be terminated inside `D`, and no Windows process with the same numeric pid SHALL be probed or signalled

#### Scenario: A wedged WSL never yields a confirmed termination

- **WHEN** `wsl.exe` fails or times out while checking a WSL-target pid
- **THEN** the liveness SHALL read as unknown and the reclaim SHALL NOT be reported as a confirmed termination
- **AND** the outcome SHALL be `unconfirmed` and `verifyAndKillWsl` SHALL NOT be run

#### Scenario: A WSL age bound is computed on the server

- **WHEN** an unattended reclaim of a WSL target runs
- **THEN** `verifyAndKillWsl` SHALL receive `minAgeMs = max(0, now − (pidRecordedAt + tolerance))`, never an absolute time
- **AND** an operator shutdown or force-kill SHALL pass no `minAgeMs`

#### Scenario: A transient helper failure is retried within the bound

- **WHEN** `verifyAndKillWindows` or `verifyAndKillWsl` returns `error` on an unattended reclaim
- **THEN** the outcome SHALL be `unconfirmed` and the session SHALL be attempted again on later sweeps until the give-up bound of 3 attempts

#### Scenario: A creation-time mismatch is terminal

- **WHEN** a helper returns `mismatch`
- **THEN** the outcome SHALL be `refused-identity`, the process SHALL NOT be signalled, and the reclaim SHALL NOT be retried

#### Scenario: An absent process is confirmed only after a re-check

- **WHEN** a helper returns `absent`, or `killed`
- **THEN** the outcome SHALL be `confirmed-dead` only if the liveness re-check also reads absent
- **AND** a re-check that reads alive or unknown SHALL give `unconfirmed`

#### Scenario: A verified Windows-terminal session is reclaimed

- **WHEN** an unattended reclaim targets a `wt` session whose pid target is `host` on a Windows server
- **AND** its creation time is no later than the identity's recording time plus the tolerance
- **THEN** its process tree SHALL be terminated, with the check and the kill in one invocation

#### Scenario: A remote-origin session is refused before any probe

- **WHEN** an unattended reclaim targets a session with `originDeviceId` set
- **THEN** its recorded pid SHALL NOT be probed or signalled as a local process, and the reclaim SHALL be reported as failed
- **AND** the headless registry rung SHALL still run for any registry entry linked to the session by token

### Requirement: Force kill process escalation
When the server receives a `force_kill` message for a session whose pid target is `host`, or `unknown` on a Windows server (*A recorded pid is used only in its resolved pid target*), it SHALL terminate the session's process using the platform-provided `killProcess(pid, { timeoutMs: 2000 })` helper, so that the entire process subtree is terminated on every supported OS. For a WSL target it SHALL terminate the process inside its distribution with `verifyAndKillWsl`, with no start-time condition because this is an operator path, and SHALL NOT invoke `taskkill`. When that call returns `error`, `force_kill_result` SHALL be `success: false` with a "not terminated" message, the WebSocket SHALL stay open and the session SHALL NOT be marked ended; `absent` SHALL be `success: true`, already gone. For any other non-local target, the force-kill SHALL be refused: no signal, no WebSocket close, the session not marked ended, and `success: false` with a message stating that the process is not on this host. On Windows this delegates to `taskkill /F /T /PID <pid>` (immediate tree kill). On POSIX this sends `SIGTERM`, waits up to 2 seconds, and sends `SIGKILL` if the process is still alive. The server SHALL NOT call `process.kill(pid, …)` directly.

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

#### Scenario: Force-kill of a WSL session on a Windows server kills inside the distribution
- **WHEN** an operator force-kills a session whose pid target is WSL `D` on a Windows server
- **THEN** the process SHALL be terminated inside `D` and `taskkill` SHALL NOT be invoked for its pid

#### Scenario: Force-kill of a WSL session whose helper errors is not a termination
- **WHEN** `verifyAndKillWsl` returns `error` for an operator force-kill
- **THEN** `force_kill_result` SHALL carry `success: false` and a message containing "not terminated"
- **AND** the bridge WebSocket SHALL stay open and the session SHALL NOT be marked ended

#### Scenario: Force-kill of an already-gone WSL process succeeds
- **WHEN** `verifyAndKillWsl` returns `absent` for an operator force-kill
- **THEN** `force_kill_result` SHALL carry `success: true` with a message that the process was already gone

### Requirement: Ending a session SHALL terminate its process for every spawn strategy

Ending a session — via the browser WebSocket `shutdown` message, the REST
shutdown route, or force-kill — SHALL terminate the operating-system process
backing that session, regardless of the strategy that spawned it
(`PI_SPAWN_STRATEGY`: `headless` or `tmux`), when that process is on this host.
A session whose pid target is WSL `D` on a Windows server SHALL be terminated
inside `D` with `verifyAndKillWsl` (no start-time condition on these operator
paths). Any other non-local target (*A recorded pid is used only in its resolved
pid target*) SHALL NOT be signalled. Its shutdown is an unconfirmed
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

#### Scenario: Shutdown of a WSL session on a Windows server terminates inside the distribution
- **WHEN** an operator shuts down a session whose pid target is WSL `D` on a Windows server
- **THEN** the process SHALL be terminated inside `D` and no Windows process SHALL be signalled

#### Scenario: Shutdown of a WSL session whose helper errors is an unconfirmed termination
- **WHEN** `verifyAndKillWsl` returns `error` during an operator shutdown
- **THEN** the removal SHALL be reported as unconfirmed, with the orphan signal alongside `session_removed`
- **AND** an `absent` result SHALL be a confirmed removal

### Requirement: A recorded pid is used only in its resolved pid target

Before any probe, signal or pid-based link, the server SHALL resolve the recorded pid's target (`host`, WSL `D`, `legacy-wsl`, `foreign` or `unknown`) with one shared helper, in the rule order of the resolution scenarios below. Only `host` SHALL be probed or signalled locally, except that on a Windows server an operator shutdown or force-kill MAY signal `unknown`. A WSL `D` target SHALL be probed and signalled only inside `D` through the platform module's WSL helpers, with the target passed as `{ kind: "wsl", distro }` (a host target as `{ kind: "host" }`). The terminator SHALL resolve once, before its registry rung. A repo test SHALL enforce this.

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
