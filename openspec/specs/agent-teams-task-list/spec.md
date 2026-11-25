# agent-teams-task-list Specification

## Purpose
TBD - created by archiving change add-agent-teams-core. Update Purpose after archive.

## Requirements

### Requirement: Shared task list per team

Each team SHALL have one shared task list visible to the lead and all members. A task SHALL have a per-team sequential string id, a title, a title (at most 200 characters), a description (at most 2000), a status, an optional owner, a `blockedBy` list, an optional result (at most `maxResultChars`) and timestamps. `maxTasks` (default 50) SHALL cap the non-completed tasks.

#### Scenario: Create a task
- **WHEN** the lead or a teammate calls `TaskCreate {title, description}`
- **THEN** a `pending` unowned task with the next sequential id is stored and returned with its full description

#### Scenario: Task cap
- **WHEN** the list already holds `maxTasks` non-completed tasks
- **THEN** `TaskCreate` fails with `task_cap_reached`

#### Scenario: Completed tasks do not saturate the cap
- **WHEN** 50 tasks are completed and none is open
- **THEN** `TaskCreate` succeeds

#### Scenario: Oversized result is truncated
- **WHEN** a completion result exceeds `maxResultChars`
- **THEN** it is stored truncated with a marker and `TaskList` still succeeds

### Requirement: Dependencies block and auto-unblock

A task SHALL be blocked exactly while any task in its `blockedBy` list is not `completed`; blocked state SHALL be derived, never stored. Dependencies SHALL reference existing tasks and SHALL NOT form a cycle.

#### Scenario: Blocked task cannot be claimed
- **WHEN** a member claims a task whose dependency is `pending`
- **THEN** the claim fails with `blocked`

#### Scenario: Completion unblocks dependents
- **WHEN** the last dependency of a task is completed
- **THEN** the task becomes claimable and the completion result lists it under `unblocked`

#### Scenario: Cycle rejected
- **WHEN** an update would make task 1 depend on task 3 which depends on task 1
- **THEN** the update fails with `dependency_cycle` and nothing changes

### Requirement: Atomic claim

Claiming SHALL be a single synchronous check-and-set on the server store: the task must be `pending`, unblocked and either unowned or owned by the caller; on success it becomes `in_progress` owned by the caller. No two members SHALL ever hold the same task.

#### Scenario: Two members race
- **WHEN** two members claim the same pending task in the same tick
- **THEN** exactly one succeeds and the other fails with `already_claimed`

#### Scenario: Claim returns full description
- **WHEN** a claim succeeds
- **THEN** the result contains the task's complete description and the results of its dependencies, not only its title

### Requirement: Owner assignment is a task field

Only the lead SHALL set or clear `owner` on a `pending` task, to any non-`gone` member name; a teammate's claim sets `owner` to itself. A task with an owner SHALL be claimable and auto-claimable only by that owner. Assigning an owner to an idle member SHALL push a `task_assigned` mail to it.

#### Scenario: Lead assigns before auto-claim
- **WHEN** the lead assigns task 2 to `bob` while `alice` is idle
- **THEN** `alice` is never auto-assigned task 2 and `bob` receives `task_assigned`

#### Scenario: Owner may be a spawning member
- **WHEN** the lead assigns a pending task to a member still `spawning`
- **THEN** the owner is stored and the task is delivered once the member is live

#### Scenario: Teammate cannot assign
- **WHEN** a teammate calls `TaskUpdate` with an `owner` other than itself
- **THEN** the call fails with `owner_not_lead`

#### Scenario: In-progress task is not reassigned
- **WHEN** the lead assigns an owner to an `in_progress` task of another member
- **THEN** the call fails with `invalid_transition`

### Requirement: Completion

A task SHALL be completed only by its owner or the lead, with an optional result text. Completion SHALL be refused for a task that is not `in_progress`, and a member that lost ownership SHALL get `not_owner`.

#### Scenario: Owner completes
- **WHEN** the owner calls `TaskUpdate {status:"completed", result}`
- **THEN** the task is `completed` with the result and dependents are re-evaluated

#### Scenario: Non-owner completes
- **WHEN** a member that does not own the task calls `TaskUpdate {status:"completed"}`
- **THEN** the call fails with `not_owner`

### Requirement: Self-claim and dispatch on idle

When a member reports idle without an error, and when a task is created, unblocked or assigned, the dispatcher SHALL give each `idle` member without an `in_progress` task first its lowest-id `pending` owned task, else the lowest-id unowned unblocked `pending` task, and push the full task as `task_assigned` mail. Members in `shutdown_pending` and orphaned teams SHALL be skipped. `autoDispatch=false` SHALL disable the unowned branch.

#### Scenario: Finish then claim next
- **WHEN** a member completes task 1, settles, and task 4 is unowned and unblocked
- **THEN** the dispatcher claims task 4 for it and delivers `task_assigned` with the full description

#### Scenario: Nothing to claim
- **WHEN** a member settles and no claimable task exists
- **THEN** it stays `idle`, receives no mail, and the lead is notified through the coalesced idle notice

#### Scenario: Error settle does not claim
- **WHEN** a member settles with an API error
- **THEN** no task is auto-claimed for it

### Requirement: Task listing and lookup

`TaskList` SHALL return tasks with full descriptions plus derived `blocked` and `claimable` flags, excluding `completed` tasks unless `includeCompleted` is true; `TaskGet` SHALL return one task including its result.

#### Scenario: Default list hides completed
- **WHEN** a member calls `TaskList` with no arguments
- **THEN** completed tasks are omitted and each listed task carries `blocked` and `claimable`

#### Scenario: Unknown task
- **WHEN** `TaskGet` names a missing id
- **THEN** the call fails with `unknown_task`

### Requirement: Task release on member exit

When a member exits (`gone`, `failed` or approved shutdown), its `in_progress` tasks SHALL return to `pending` with the owner cleared and a note, and every `pending` task it owns SHALL lose its owner. The lead SHALL be told which tasks were released or unowned.

#### Scenario: Approved shutdown releases work
- **WHEN** a member with an `in_progress` task approves shutdown
- **THEN** the task becomes `pending` unowned and the notice to the lead names it

#### Scenario: Assigned-but-unstarted task of a failed spawn
- **WHEN** a `pending` task owned by a `spawning` member is orphaned because the spawn becomes `failed`
- **THEN** the task is unowned, claimable by others, and the lead notice names it

#### Scenario: Respawned name does not inherit tasks
- **WHEN** a `gone` member's name is spawned again
- **THEN** no task is owned by the new member until the lead assigns one

### Requirement: Task state machine edges

Legal transitions SHALL be claim (`pending` to `in_progress`), completion by the owner or the lead, and lead assign or unassign of a `pending` task; every other edge (reopen, self-release, `pending` to `completed`) SHALL fail with `invalid_transition`. Claiming a task owned by another member SHALL fail with `already_claimed`.

#### Scenario: Task owned by another member
- **WHEN** a member claims a pending task owned by another member
- **THEN** the call fails with `already_claimed`

#### Scenario: Self-release refused
- **WHEN** an owner sets its `in_progress` task back to `pending`
- **THEN** the call fails with `invalid_transition`

### Requirement: Assignment to busy and shutting-down members

Assigning an owner to a `busy` member SHALL only store it; the dispatcher SHALL deliver `task_assigned` at that member's next idle. Assigning to a `shutdown_pending` member SHALL fail with `invalid_transition`. A late `busy` report after a dispatcher claim SHALL return the not-yet-acked task to `pending`, keeping at most one `in_progress` task per member.

#### Scenario: Busy assignee
- **WHEN** the lead assigns a task to a `busy` member
- **THEN** the owner is stored and `task_assigned` is delivered when the member next goes idle

#### Scenario: Late busy report
- **WHEN** the dispatcher claimed a task for a member whose `busy` report then arrives
- **THEN** the just-dispatched task returns to `pending` and the member owns at most one `in_progress` task

### Requirement: Launcher-owned tasks

A task created or assigned by the server actor MAY be `ownerLocked`; its owner SHALL be immutable for non-server actors (`owner_locked`). The owner SHALL be set atomically with the name reservation, so a `spawning` name is accepted.

#### Scenario: Lead cannot reassign
- **WHEN** the lead changes the owner of an `ownerLocked` task
- **THEN** the call fails with `owner_locked` and the task is unchanged
