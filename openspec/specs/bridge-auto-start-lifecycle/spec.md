# bridge-auto-start-lifecycle Specification

## Purpose

Keep the dashboard's asynchronous auto-start flow (`autoStartServer`) safe when
it settles after the extension context that started it has been invalidated.
Covers the lifetime boundary between a long-running auto-start attempt and the
session that owns it: which late accesses must degrade to a no-op, and which
errors must still propagate.

## Requirements

### Requirement: A late auto-start continuation never crashes the pi process

The dashboard auto-start flow (`autoStartServer`) is asynchronous and MAY settle
after the extension context that started it has been invalidated by a session
replacement or reload (`newSession`, `fork`, `switchSession`, `reload`, or
session dispose).

Every `ctx.ui` access reachable from that flow — the progress/failure `notify`
callback, the launch-spinner mount, the spinner teardown, and the terminal
`.then()` / `.catch()` safety net — SHALL tolerate an invalidated context. When
the context is stale the access SHALL become a no-op. It SHALL NOT throw, and it
SHALL NOT surface as an unhandled rejection.

The guard is scoped to UI presentation only. It SHALL NOT swallow errors from
auto-start's own logic (discovery, launching, port reconciliation), which must
continue to propagate to their existing handlers.

#### Scenario: Spinner teardown after session replacement

- **GIVEN** a bridge session whose dashboard auto-start is still in flight
- **AND** the extension context has been invalidated by a session replacement
- **WHEN** the auto-start promise settles and the spinner teardown runs
- **THEN** the teardown SHALL complete without throwing
- **AND** no unhandled rejection SHALL escape
- **AND** the pi process SHALL stay alive

#### Scenario: Auto-start failure notice after session replacement

- **GIVEN** an auto-start attempt that fails with a readiness timeout
- **AND** the extension context has been invalidated before the failure lands
- **WHEN** the failure is reported through the `notify` callback
- **THEN** the notification SHALL be dropped silently
- **AND** the pi process SHALL stay alive

#### Scenario: Spinner mount after session replacement

- **GIVEN** an extension context invalidated before the launch begins
- **WHEN** the auto-start flow mounts its launch spinner
- **THEN** the mount SHALL be skipped without throwing

#### Scenario: A live context is unaffected

- **GIVEN** a bridge session whose extension context is still active
- **WHEN** the auto-start flow mounts the spinner, notifies, and tears the
  spinner down
- **THEN** each call SHALL reach `ctx.ui` exactly as before this change
- **AND** the spinner interval SHALL be cleared

#### Scenario: Auto-start logic errors still propagate

- **GIVEN** an auto-start flow whose own logic throws a non-invalidation error
- **WHEN** that error is raised
- **THEN** it SHALL reach the existing `.catch()` handler
- **AND** SHALL NOT be silently discarded by the UI guard

### Requirement: A prompt round-trip survives the auto-start path

A session that accepts a prompt SHALL deliver the model's answer and remain
alive afterwards, regardless of whether a dashboard auto-start attempt is in
flight or has already failed.

This requirement is scoped to the SESSION, not to the browser client. Whether
the client's optimistic prompt settles and re-enables the composer is governed
by the `optimistic-prompt` capability and is deliberately NOT asserted here.

#### Scenario: Round-trip completes with an auto-start failure in flight

- **GIVEN** a session whose dashboard auto-start attempt has already failed
- **WHEN** the session is sent a prompt whose scripted answer is known
- **THEN** the session SHALL return the answer
- **AND** the session SHALL return to `idle`
- **AND** the session SHALL NOT terminate

### Requirement: Auto-start spawn is single-flight per user and port

Concurrent pi sessions running as the same user SHALL NOT each spawn a dashboard server for the same port. Before the spawn step, `autoStartServer` SHALL acquire an exclusive lock keyed on the target port, and SHALL release it once the spawn has settled (ready, failed, or timed out).

A session that fails to acquire the lock SHALL NOT spawn. It SHALL re-run the health check after the lock holder's spawn readiness budget and attach to the server that came up, or report the server unavailable if none did.

A lock SHALL be treated as stale, and MAY then be broken, when any of the following holds:

- the recorded holder process is no longer alive, and no recorded spawned server process is alive either;
- the recorded holder pid is alive but its process start time is later than the lock's recorded creation time, indicating pid reuse rather than a live holder;
- the lock's age exceeds the spawn readiness budget.

The spawn readiness budget SHALL be defined independently of the health-check timeout and SHALL be large enough to cover a legitimate slow cold start, so that a slow spawn does not cause a concurrent session to break the lock and spawn a second server.

Once the spawned server's process id is known, it SHALL be recorded in the lock, so that staleness reflects the liveness of the detached server and not only of the session that started it.

#### Scenario: Two sessions start simultaneously

- **WHEN** two pi sessions both complete discovery and health check with no reachable dashboard, and both reach the spawn step
- **THEN** exactly one SHALL acquire the lock and spawn a server
- **AND** the other SHALL NOT spawn
- **AND** after the readiness budget the non-spawning session SHALL be connected to the server the winner started

#### Scenario: Holder session dies but its detached server survives

- **WHEN** a session acquires the lock, spawns a server, and the session process dies while the detached server is still starting
- **AND** another session evaluates the lock
- **THEN** the lock SHALL NOT be treated as stale, because the recorded spawned server process is still alive
- **AND** the evaluating session SHALL NOT spawn a second server

#### Scenario: Holder pid was reused

- **WHEN** a lock records a holder pid that is no longer the original process, and a new unrelated process now has that pid
- **AND** that process's start time is later than the lock's recorded creation time
- **THEN** the lock SHALL be treated as stale
- **AND** a subsequent session SHALL be able to break it and proceed

#### Scenario: Slow cold start does not break the lock

- **WHEN** a legitimate spawn takes longer than the health-check timeout but less than the spawn readiness budget
- **THEN** a concurrent session SHALL NOT treat the lock as stale
- **AND** SHALL NOT spawn a second server

#### Scenario: Lock is released after a failed spawn

- **WHEN** the lock holder's spawn fails with a readiness timeout or an early exit
- **THEN** the lock SHALL be released
- **AND** a subsequent session SHALL be able to acquire it without waiting for staleness

### Requirement: A worktree checkout never auto-starts on the shared ports

The dashboard server CLI path is resolved relative to the loaded extension copy, so a session running from a git worktree resolves that worktree's server. `autoStartServer` SHALL refuse to spawn when the resolved server CLI path lies inside a git worktree directory AND either the target dashboard port or the target pi-gateway port is the shared default.

Both ports SHALL be considered, because the pi-gateway listener binds first during startup and capturing it is sufficient to hijack bridge registrations from the real dashboard. A worktree server on a non-default dashboard port but the default gateway port SHALL still be refused.

Refusal SHALL mean: skip the spawn step, attach to a reachable host dashboard if one exists, otherwise report the server as unavailable. Refusal SHALL NOT throw.

The worktree match SHALL be path-segment aware and evaluated on a fully resolved real path, so that a similarly-named sibling directory does not match and a symlinked worktree does not evade the check.

Refusal SHALL be evaluated before the auto-start lock is acquired, so a session that will refuse never contends for the lock.

The refusal SHALL NOT assume the configured dashboard port is still in effect, because an existing isolation guard may already have remapped it to an ephemeral port.

#### Scenario: Worktree session on both shared defaults

- **WHEN** a session's resolved server CLI path lies inside a worktree and both ports are the shared defaults
- **AND** no dashboard is reachable
- **THEN** `autoStartServer` SHALL NOT spawn a server
- **AND** it SHALL report the dashboard unavailable rather than throwing

#### Scenario: Worktree session evades on the dashboard port only

- **WHEN** a session's resolved server CLI path lies inside a worktree, the dashboard port is non-default, but the pi-gateway port is the shared default
- **THEN** `autoStartServer` SHALL still refuse to spawn

#### Scenario: Fully isolated worktree dashboard still starts

- **WHEN** a session's resolved server CLI path lies inside a worktree and both the dashboard port and the pi-gateway port are non-default
- **THEN** `autoStartServer` SHALL spawn normally
- **AND** the isolated worktree dashboard SHALL come up on those ports

#### Scenario: Host install serving a worktree working directory

- **WHEN** a session's working directory is inside a worktree but the resolved server CLI path is the host install
- **THEN** `autoStartServer` SHALL spawn normally, because the refusal keys on the resolved CLI path and not on the working directory

#### Scenario: Similarly-named sibling directory does not match

- **WHEN** the resolved server CLI path lies under a directory whose name merely begins with the worktree directory name rather than matching a whole path segment
- **THEN** the refusal SHALL NOT apply

#### Scenario: Refusal precedes lock acquisition

- **WHEN** a session will be refused under this requirement
- **THEN** it SHALL NOT acquire the auto-start lock
- **AND** a concurrent host session SHALL be able to acquire that lock without contention

#### Scenario: Worktree session attaches to a running host dashboard

- **WHEN** a worktree session would be refused and a host dashboard is already reachable
- **THEN** the session SHALL attach to that dashboard
- **AND** its bridge SHALL register against it

### Requirement: Declined auto-start is recorded in a durable log

When `autoStartServer` declines to spawn, the reason SHALL be appended to a durable log file, so the condition is greppable later without correlating operating-system process state by hand.

A transient user-interface notification SHALL NOT satisfy this requirement, because it does not persist and is not present in headless sessions. The log destination SHALL be the dashboard server log file already written by the server launch primitive.

A worktree refusal SHALL record the resolved server CLI path, the dashboard port, and the pi-gateway port. A lock-acquisition failure SHALL record the holder identity stored in the lock.

#### Scenario: Worktree refusal is durably logged

- **WHEN** auto-start is refused because the resolved CLI path lies in a worktree on a shared default port
- **THEN** the dashboard server log file SHALL contain an entry naming the resolved CLI path and both ports
- **AND** the entry SHALL remain readable after the session ends

#### Scenario: Headless session still produces the log entry

- **WHEN** auto-start is refused in a session with no interactive user interface
- **THEN** the log entry SHALL still be written

#### Scenario: Lock loss is durably logged

- **WHEN** a session fails to acquire the auto-start lock because another session holds it
- **THEN** the dashboard server log file SHALL contain an entry naming the recorded holder

### Requirement: New auto-start exits do not leak the launch spinner

The bridge starts a launch spinner immediately before the spawn step and stops it when the launch ends. The worktree refusal and the lock-acquisition failure SHALL return before the launch-start callback is invoked.

If either path ever runs after the launch-start callback, it SHALL invoke the launch-end callback with a failure result, so the spinner is always stopped.

#### Scenario: Refusal leaves no spinner running

- **WHEN** auto-start is refused for a worktree session
- **THEN** the launch spinner SHALL NOT have been started
- **AND** no spinner SHALL remain visible after `autoStartServer` returns

#### Scenario: Lock loss leaves no spinner running

- **WHEN** a session declines to spawn because it lost the auto-start lock
- **THEN** no spinner SHALL remain visible after `autoStartServer` returns

### Requirement: Auto-start resolves ports with environment precedence

The bridge's auto-start path SHALL resolve the dashboard HTTP port and the pi
gateway port through ONE shared resolver, consumed by both the auto-start
path and the slash-command path, in this precedence order:

1. Environment — HTTP: `PI_DASHBOARD_PORT`, then `DASHBOARD_PORT`; gateway:
   `PI_DASHBOARD_PI_PORT`, then `PI_GATEWAY_PORT`. The first variable of a
   role set to a usable value wins; later variables of that role are ignored.
2. `~/.pi/dashboard/config.json` `port` / `piPort`, when present.
3. The shared defaults (`DEFAULT_DASHBOARD_PORT` 8000 /
   `DEFAULT_GATEWAY_PORT` 9999).

A value is usable when `Number(v)` is finite and > 0 — the parsing of the
existing slash-command resolver, pinned here so the two paths cannot drift.
The resolver SHALL be a separate export in `packages/shared/src/config.ts`;
`loadConfig()` SHALL NOT adopt env precedence — the server's own bind
resolution (`buildConfig` in `packages/server/src/cli.ts`) already reads the
env and MUST keep its current behaviour.

#### Scenario: Non-default port from the environment wins over the config default
- **GIVEN** the dashboard runs with `--port 18697 --pi-port 19697`
- **AND** `config.json` carries no `port` and no `piPort`
- **AND** the session's environment carries `DASHBOARD_PORT=18697` and a
  gateway env (`PI_DASHBOARD_PI_PORT` or `PI_GATEWAY_PORT`)=`19697`
- **WHEN** the bridge resolves its ports for auto-start
- **THEN** it SHALL resolve `18697` / `19697`
- **AND** its health check SHALL find the running dashboard
- **AND** it SHALL NOT launch a second dashboard

#### Scenario: Config value wins when the environment is absent
- **GIVEN** no port env of either role in the environment
- **AND** `config.json` carries `port: 8001`
- **WHEN** the bridge resolves its ports
- **THEN** it SHALL resolve `8001`

#### Scenario: Defaults apply when neither source supplies a port
- **GIVEN** no port in the environment and none in `config.json`
- **WHEN** the bridge resolves its ports
- **THEN** it SHALL resolve `8000` / `9999`

#### Scenario: A non-numeric environment value does not shadow the config
- **GIVEN** `DASHBOARD_PORT` is set to `""`, `"abc"`, or `"0"` (and
  `PI_DASHBOARD_PORT` is unset)
- **AND** `config.json` carries `port: 8001`
- **WHEN** the bridge resolves its ports
- **THEN** it SHALL ignore the unusable environment value
- **AND** SHALL resolve `8001`

#### Scenario: First environment variable of a role wins
- **GIVEN** `PI_DASHBOARD_PORT=8001` and `DASHBOARD_PORT=8002` are both set
- **WHEN** the bridge resolves its ports
- **THEN** it SHALL resolve `8001` (`PI_DASHBOARD_PORT` precedes
  `DASHBOARD_PORT`), never `8002`

### Requirement: A session with a pinned endpoint never starts a competing dashboard

A session whose environment carries `PI_DASHBOARD_URL` or
`PI_DASHBOARD_SOCKET` — the endpoint pins the dashboard server itself
injects into sessions it spawns (`process-manager.ts`) — SHALL NOT execute
the auto-start launch step. Discovery and the health check still run, so the
session attaches to (or rediscovers) its pinned parent.

Accepted trade-off, documented: when the pinned parent later dies, the
session retries the pinned endpoint and never relaunches a replacement;
recovery is restarting the dashboard (or the session). This is deliberate —
a pinned session must never become a competitor-launching session.

#### Scenario: Session spawned by a known parent joins it
- **GIVEN** a session whose environment carries `PI_DASHBOARD_URL` (or
  `PI_DASHBOARD_SOCKET`)
- **WHEN** the bridge's auto-start runs
- **THEN** discovery and the health check still run
- **AND** the launch step SHALL NOT be invoked

#### Scenario: Pinned session whose parent has died does not relaunch
- **GIVEN** a pinned session whose parent gateway no longer answers
- **WHEN** the bridge's auto-start runs
- **THEN** the launch step is still not invoked
- **AND** the skip is recorded in the durable auto-start log, naming the
  pinned endpoint

### Requirement: Auto-start skips and refusals are loud and greppable

Whenever the auto-start path does NOT launch — because a dashboard already
answers on the resolved port, the endpoint is pinned, the worktree refusal
fires, or the resolved port is occupied by another service — the durable
auto-start log (`appendAutoStartLog`) SHALL gain a line naming the ports
involved. When the resolved port serves, auto-start SHALL return it without
consulting discovery, and SHALL NOT emit any port-mismatch record or warning.
A port-mismatch record SHALL arise only on the path where the resolved port was
probed, found silent, and discovery then yielded a verified candidate; that
record SHALL name both ports and raise a warning notification. A line SHALL NOT
assert that the resolved port is silent unless that has been established by a
probe. The post-launch attach path SHALL NOT raise a "resolved port silent"
warning on a transient health miss after a successful launch. Every such line
SHALL be greppable in the server log.

#### Scenario: Attaching to an already-serving dashboard logs the port
- **GIVEN** a dashboard already serving on the resolved port
- **WHEN** auto-start attaches without launching
- **THEN** the auto-start log names the port it attached to
- **AND** records that no launch happened

#### Scenario: Discovery elsewhere while the resolved port is silent warns both ports
- **GIVEN** discovery finds a dashboard serving at port 18697
- **AND** the resolved port 8000 has been probed and answers nothing
- **WHEN** auto-start decides what to do
- **THEN** a warning names both 8000 and 18697
- **AND** no launch happens

#### Scenario: Resolved port serves — discovery is not consulted and nothing is recorded
- **GIVEN** the resolved port 8000 answers `/api/health`
- **WHEN** auto-start decides what to do
- **THEN** the resolved port 8000 SHALL be returned without consulting discovery
- **AND** no port-mismatch record and no warning or toast SHALL be produced

#### Scenario: Transient post-launch health miss raises no silent warning
- **GIVEN** auto-start has successfully launched a server on the resolved port
- **AND** the immediate post-launch health probe misses transiently
- **WHEN** the post-launch attach path evaluates what to return
- **THEN** no "resolved port silent" warning SHALL be raised
- **AND** the resolved port SHALL be preferred once its bootstrap-aware probe answers

#### Scenario: Two servers in one container is detectable end to end
- **GIVEN** the e2e harness container
- **WHEN** its startup completes and a spec spawns a session
- **THEN** exactly one dashboard SHALL answer `/api/health` inside the
  container
- **AND** `tests/e2e/faux-text.spec.ts` SHALL pass, as the canary any other
  E2E verdict depends on

### Requirement: The resolved port's status is established before discovery can win

Auto-start SHALL determine whether the resolved port is serving BEFORE a
discovered candidate may be adopted, in BOTH the pre-launch discovery path and
the post-launch attach path. A discovered dashboard SHALL NOT be returned while
the resolved port answers `GET /api/health`. The resolved-port probe SHALL use
bootstrap-aware settings (a non-default timeout and at least one retry) so a
server that is mid-startup is not misread as silent.

#### Scenario: Resolved port serves and pre-launch discovery finds another
- **GIVEN** the resolved port 8000 answers `/api/health`
- **AND** discovery finds a local dashboard on port 8588
- **WHEN** auto-start decides what to do
- **THEN** the resolved port 8000 SHALL be returned
- **AND** no launch happens

#### Scenario: Resolved port is silent and pre-launch discovery finds another
- **GIVEN** the resolved port 8000 answers nothing after the bootstrap-aware probe
- **AND** discovery finds a local dashboard on port 8588 that answers `/api/health`
- **WHEN** auto-start decides what to do
- **THEN** port 8588 SHALL be returned
- **AND** no launch happens

#### Scenario: Post-launch attach does not adopt a foreign advertiser over the just-launched server
- **GIVEN** auto-start has successfully launched a server on the resolved port 8000
- **AND** the resolved port 8000 answers `/api/health`
- **AND** discovery during the post-launch attach window also finds a local dashboard on port 8588
- **WHEN** auto-start resolves the address to connect to
- **THEN** the resolved port 8000 SHALL be returned
- **AND** the choice SHALL NOT depend on which advertisement arrived first

#### Scenario: Bootstrap-aware probe does not misread a mid-startup server as silent
- **GIVEN** the resolved port's server is mid-startup and its first health probe times out
- **AND** a subsequent retry within the probe budget answers `/api/health`
- **WHEN** auto-start evaluates the resolved port
- **THEN** the resolved port SHALL be treated as serving
- **AND** no discovered candidate SHALL displace it

### Requirement: A discovered candidate is verified before adoption

A candidate obtained from discovery SHALL be adopted only after `GET
/api/health` succeeds at its advertised host and HTTP port. An unverifiable
candidate SHALL NOT suppress the launch step, and its rejection SHALL be
recorded in the durable auto-start log with the candidate endpoint and the
reason.

#### Scenario: Unreachable candidate does not suppress launch
- **GIVEN** the resolved port answers nothing
- **AND** discovery finds a local dashboard whose `/api/health` does not answer
- **AND** `autoStart` is `true`
- **THEN** the candidate SHALL be rejected
- **AND** the rejection SHALL be recorded with the candidate endpoint and the reason
- **AND** auto-start SHALL proceed to the launch step

#### Scenario: Candidate health cannot be determined within the probe timeout
- **GIVEN** the resolved port answers nothing
- **AND** a discovered candidate's health probe does not resolve within its timeout
- **THEN** the candidate SHALL be rejected
- **AND** the rejection SHALL be recorded with the candidate endpoint and the reason

### Requirement: A foreign service on the resolved port does not strand discovery

When the resolved port is occupied by a non-dashboard service (`portConflict`),
auto-start SHALL still consult discovery for a verified relocated dashboard
before refusing to launch. The existing "port occupied by another service"
refusal SHALL apply only after discovery yields no verified candidate.

#### Scenario: Foreign service on the resolved port with a relocated dashboard
- **GIVEN** the resolved port 8000 answers HTTP but is not a dashboard (`portConflict`)
- **AND** discovery finds a local dashboard on port 8588 that answers `/api/health`
- **WHEN** auto-start decides what to do
- **THEN** port 8588 SHALL be returned
- **AND** the port-conflict refusal SHALL NOT fire

#### Scenario: Foreign service on the resolved port with no relocated dashboard
- **GIVEN** the resolved port 8000 answers HTTP but is not a dashboard (`portConflict`)
- **AND** discovery finds no verified local dashboard
- **THEN** auto-start SHALL refuse with the "port occupied by another service" log line
- **AND** no launch happens

### Requirement: Selection among multiple local candidates is deterministic

When discovery returns more than one local dashboard, auto-start SHALL prefer
the candidate whose port equals the resolved port, otherwise the lowest port,
and SHALL break a port tie by host string so the ordering is total. Selection
SHALL NOT depend on the order in which advertisements arrive.

#### Scenario: A candidate matching the resolved port wins
- **GIVEN** discovery returns local dashboards on ports 8588 and 8000
- **AND** the resolved port is 8000
- **THEN** the candidate on port 8000 SHALL be selected

#### Scenario: No candidate matches the resolved port
- **GIVEN** discovery returns local dashboards on ports 8611 and 8588
- **AND** neither matches the resolved port
- **THEN** the candidate on port 8588 SHALL be selected
- **AND** the same input in any arrival order SHALL yield the same selection

#### Scenario: Two candidates share the lowest port
- **GIVEN** discovery returns two local dashboards on the same port with different hosts
- **AND** neither matches the resolved port
- **THEN** selection SHALL be resolved by host string
- **AND** the same input in any arrival order SHALL yield the same selection
