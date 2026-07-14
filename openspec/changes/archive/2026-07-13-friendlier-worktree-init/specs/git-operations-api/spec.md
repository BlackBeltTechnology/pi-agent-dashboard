## ADDED Requirements

### Requirement: Active worktree-inits endpoint
The server SHALL expose `GET /api/git/worktree/active-inits` returning the current
worktree-init runs known to the cwd-keyed registry: all `running` entries plus any terminal
entries still within their retention TTL.

#### Scenario: Reports a running run
- **WHEN** an init run for `cwd` is in flight and `GET /api/git/worktree/active-inits` is called
- **THEN** the response SHALL include an entry for `cwd` with `phase: "running"`, `startedAt`, and the latest `lastLine` when available

#### Scenario: Reports a recent terminal run
- **WHEN** a run for `cwd` finished within the retention TTL
- **THEN** the response SHALL include an entry for `cwd` with `phase: "done"` or `phase: "failed"` (with `code` on failure)

#### Scenario: Omits expired and absent runs
- **WHEN** no run for a `cwd` is running and none finished within the TTL
- **THEN** the response SHALL NOT include an entry for that `cwd`

### Requirement: Worktree-init progress channel is cwd-addressable
The worktree-init progress channel SHALL accept subscriptions addressed by `cwd` in addition
to the existing client-minted `requestId`, and progress/done/failed messages SHALL carry the
run's `cwd`. The existing `requestId`-addressed delivery SHALL continue to work for
back-compat.

#### Scenario: cwd subscription receives events
- **WHEN** a client sends `worktree_init_subscribe` addressed by `cwd`
- **THEN** the server SHALL deliver subsequent progress/done/failed events for that run to the subscriber
- **AND** each message SHALL include the run's `cwd`

#### Scenario: requestId subscription still works
- **WHEN** a client subscribes by the legacy `requestId`
- **THEN** the server SHALL still deliver that run's events to the requestId subscriber
