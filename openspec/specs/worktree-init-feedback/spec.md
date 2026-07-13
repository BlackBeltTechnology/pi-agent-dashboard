# worktree-init-feedback Specification

## Purpose
Track worktree-init runs server-side by `cwd` and surface their progress with friendly,
opt-in-log feedback shared by the manual button, auto-on-spawn, and post-refresh paths:
running status chip, sticky retryable failure, success flash, boot rehydration via
`GET /api/git/worktree/active-inits`, and a concurrent-run stack.
## Requirements
### Requirement: Init runs are tracked server-side by cwd
The server SHALL track each worktree-init run in a registry keyed by the run's `cwd`,
holding at least `{ phase: "running" | "done" | "failed", startedAt, lastLine?, logTail?, code? }`.
A run's entry SHALL be created when the run starts and updated on progress and on exit.

#### Scenario: Run registers on start
- **WHEN** `POST /api/git/worktree/init` starts a run for `cwd`
- **THEN** the registry SHALL hold an entry for `cwd` with `phase: "running"` and `startedAt`

#### Scenario: Terminal state retained with TTL
- **WHEN** a run for `cwd` exits (success or failure)
- **THEN** the entry SHALL transition to `done` or `failed` (with `code` on failure)
- **AND** the entry SHALL be retained for a bounded TTL, then evicted

#### Scenario: One run per cwd
- **WHEN** an init is already running for `cwd`
- **THEN** the registry SHALL treat `cwd` as the single-run key (no duplicate concurrent entry for the same `cwd`)

### Requirement: Progress is deliverable by cwd
Worktree-init progress, done, and failed events SHALL be deliverable to subscribers keyed by
`cwd`, independent of the client-minted `requestId`. A late or reconnecting subscriber that
subscribes by `cwd` SHALL receive subsequent events for that run.

#### Scenario: Subscribe by cwd after reconnect
- **WHEN** a client subscribes to init events by `cwd` while a run for that `cwd` is in flight
- **THEN** it SHALL receive subsequent progress/done/failed events for that run

#### Scenario: Cross-tab delivery
- **WHEN** two clients are subscribed by the same `cwd`
- **THEN** both SHALL receive the same progress/terminal events

### Requirement: Boot rehydration of active runs
On load the client SHALL fetch the active runs and render the correct feedback state per
`cwd` without user interaction, re-subscribing to still-running runs.

#### Scenario: Refresh mid-run rehydrates running
- **WHEN** a page load occurs while an init run for `cwd` is in flight
- **THEN** the client SHALL render the running feedback for `cwd` and continue streaming progress

#### Scenario: Refresh just after failure shows the failure
- **WHEN** a page load occurs within the terminal TTL after a run for `cwd` failed
- **THEN** the client SHALL render the failed feedback (summary + Retry + opt-in log) for `cwd`

### Requirement: Feedback replaces raw terminal output
Init feedback SHALL present a one-line status (label + elapsed) with the last log line as a
muted preview; the full log SHALL be opt-in behind a collapsed disclosure, not rendered
inline by default.

#### Scenario: Running shows status not a wall of output
- **WHEN** a run is in flight
- **THEN** the client SHALL show a status chip with elapsed time and the last log line
- **AND** the full log SHALL be hidden until the user opens the disclosure

#### Scenario: Success confirmation then collapse
- **WHEN** a run completes successfully
- **THEN** the client SHALL briefly show a success confirmation, then collapse the feedback

#### Scenario: Failure is sticky and retryable
- **WHEN** a run fails
- **THEN** the client SHALL show a plain-language failure summary with a Retry action
- **AND** the failure feedback SHALL NOT auto-dismiss on a timer

### Requirement: Auto-init on spawn is not silent
When a trusted hook auto-runs after a worktree spawn, the client SHALL surface its running
and terminal states (via the cwd registry), including a visible, retryable failure.

#### Scenario: Auto-init failure is visible
- **WHEN** an auto-init run triggered by spawn fails
- **THEN** the client SHALL render a visible failed state with Retry (not a silent no-op)

### Requirement: Concurrent runs surface together
When multiple init runs are active, the client SHALL present them in a single grouped
surface summarizing counts, with each `cwd` shown independently.

#### Scenario: Multiple runs stack
- **WHEN** two or more init runs are active for different cwds
- **THEN** the client SHALL show a grouped surface with one row per `cwd` and a summary count
- **AND** the surface SHALL remain while any run is still running or failed-unacknowledged

