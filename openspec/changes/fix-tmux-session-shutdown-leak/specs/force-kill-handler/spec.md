## ADDED Requirements

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
