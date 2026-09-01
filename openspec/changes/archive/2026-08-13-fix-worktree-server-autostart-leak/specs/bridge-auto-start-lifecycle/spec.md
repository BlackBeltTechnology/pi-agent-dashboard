# bridge-auto-start-lifecycle — delta

## ADDED Requirements

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
