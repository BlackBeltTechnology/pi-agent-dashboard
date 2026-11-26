## ADDED Requirements

### Requirement: ResourceLock tool

The plugin SHALL add `ResourceLock {action: "acquire"|"release"|"status", name}` to the teammate list of core's `TEAM_TOOLS_BY_ROLE`, registered only for members whose spawn env carries a profile with resources and answered only for names the profile declares (group: `harness`). `acquire` SHALL return `{granted:true}` when free or held by the caller, else `{granted:false, holder, position}` and enqueue the caller. `release` by a caller that neither holds nor waits SHALL fail `not_holder`.

#### Scenario: Free lock
- **WHEN** `os-a` acquires `harness` and nobody holds it
- **THEN** it receives `granted:true`

#### Scenario: Contended lock
- **WHEN** `os-b` acquires while `os-a` holds it
- **THEN** it receives `granted:false`, `holder:"os-a"` and `position:1`

#### Scenario: Undeclared name
- **WHEN** a member acquires `database`
- **THEN** the call fails `unknown_resource`

#### Scenario: Team without resources
- **WHEN** a member of a plain team or an `openspec-apply` team calls the tool
- **THEN** the server answers `no_resources`

### Requirement: Grant notice and FIFO order

When a lock is released the server SHALL synchronously hand it to the oldest waiter and send that member a waking mail of kind `lock_grant` (registered through the core mail-kind registry, sender `server`). A waiting member SHALL end its turn instead of polling. A member SHALL appear at most once in a queue.

#### Scenario: Handoff
- **WHEN** `os-a` releases and `os-b` and `os-c` wait in that order
- **THEN** `os-b` holds the lock and receives the grant mail

#### Scenario: Grant shown in the Team view
- **WHEN** a `lock_grant` mail is logged
- **THEN** the message log shows it as readable text through the generic fallback (the one-line requirement lives in the ui change)

#### Scenario: Duplicate wait
- **WHEN** `os-b` acquires twice while queued
- **THEN** it stays in one queue position

### Requirement: Automatic release

A lock SHALL be released when its holder calls `release`, reports settled idle (not at `agent_end` before a retry), becomes `gone` or `failed`, completes shutdown, when `openspecLockTtlMs` elapses without a refreshing `acquire`, or when the team closes. A holder that is `disconnected` SHALL keep the lock until reconcile or TTL. Queued members that leave SHALL be removed from queues.

#### Scenario: Holder idles
- **WHEN** the holder's turn ends without a release
- **THEN** the lock is released and the next waiter is granted

#### Scenario: Retry after agent_end
- **WHEN** the holder's turn ends with a provider error and is auto-retried
- **THEN** the lock is not released between the failure and the retry

#### Scenario: TTL
- **WHEN** the holder keeps the lock past the TTL
- **THEN** the lock is released and the lead receives a notice naming the holder

#### Scenario: Holder disconnected briefly
- **WHEN** the holder is `disconnected` during the reconcile grace
- **THEN** the lock stays held

### Requirement: Lock state survives a restart

The server SHALL persist each lock's holder, grant time and queue in the sidecar on every change and reload them at start; holders and waiters that are `gone` or `failed` after reconcile SHALL be dropped and the next waiter granted with a `lock_grant` mail. Waiting members SHALL NOT need to ask again.

#### Scenario: Restart with waiters
- **WHEN** the server restarts while `os-a` holds `harness` and `os-b` waits
- **THEN** the lock is still held by `os-a` and `os-b` is still queued

#### Scenario: Holder gone across the restart
- **WHEN** the holder is `gone` after reconcile
- **THEN** the lock is released and `os-b` receives the grant mail

### Requirement: Limits and honesty

A queue SHALL hold at most `maxTeammates` entries (overflow answers `queue_full`) and a lock name at most 40 characters of `[a-z0-9-]`. A sidecar write failure SHALL fail the operation `sidecar_write_failed` with the lock state unchanged. The lock SHALL be advisory: the briefing SHALL state that it does not stop a direct harness start, and the harness start script's own memory guard remains the hard backstop.

#### Scenario: Bad name
- **WHEN** the name contains a path separator
- **THEN** the call fails `invalid_args`

#### Scenario: Briefing states the limit
- **WHEN** a group teammate is spawned
- **THEN** its briefing says the lock is advisory, to end the turn while waiting and not to end it while holding

#### Scenario: Queue full
- **WHEN** the queue already holds `maxTeammates` entries and another member acquires
- **THEN** the call fails `queue_full`

#### Scenario: Sidecar write fails
- **WHEN** the sidecar write fails during an acquire
- **THEN** the call fails `sidecar_write_failed` and nobody holds the lock because of it

### Requirement: Waiter cancel and non-live waiters

A queued waiter calling `release` SHALL dequeue itself. A handoff SHALL skip waiters that are `gone`, `failed` or `shutdown_pending`; a `disconnected` waiter keeps its position.

#### Scenario: Waiter leaves
- **WHEN** queued `os-b` calls `release`
- **THEN** it is removed from the queue and no `not_holder` error is returned

#### Scenario: Dead waiter skipped
- **WHEN** the oldest waiter is `gone` at handoff
- **THEN** the next live waiter is granted once

### Requirement: Grant redelivery and TTL after restart

The sidecar SHALL record `grantMailed` per holder. At reload the server SHALL re-send `lock_grant` to a holder without it and re-arm the TTL from `grantedAt`, releasing the lock at once when the TTL already elapsed.

#### Scenario: Crash before the grant was mailed
- **WHEN** the server restarts and the holder's `grantMailed` is false
- **THEN** the grant mail is sent again

#### Scenario: TTL elapsed during downtime
- **WHEN** the lock was granted 40 minutes ago and the TTL is 30 minutes
- **THEN** it is released at start and the next waiter is granted

### Requirement: Reserved mail kind

A member `SendMessage` with kind `lock_grant` SHALL be refused `kind_reserved` (or core's generic invalid-kind code when core provides one) and deliver nothing.

#### Scenario: Forged grant
- **WHEN** a member sends a mail of kind `lock_grant`
- **THEN** it is refused, nothing is delivered and the lock state is unchanged
