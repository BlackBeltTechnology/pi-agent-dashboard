## ADDED Requirements

### Requirement: Ending a session SHALL terminate its process for every spawn strategy

Ending a session — via the browser WebSocket `shutdown` message, the REST
shutdown route, or force-kill — SHALL terminate the operating-system process
backing that session, regardless of the strategy that spawned it
(`PI_SPAWN_STRATEGY`: `headless` or `tmux`).

Termination SHALL use one shared escalation ladder (SIGTERM → grace → SIGKILL),
not a per-strategy reimplementation. A strategy whose processes are not tracked
in the headless PID registry SHALL still be terminated through its own handle —
for tmux, the window/pane hosting the session — and the session's process
identity SHALL be recorded at spawn time so it is recoverable at shutdown.

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
