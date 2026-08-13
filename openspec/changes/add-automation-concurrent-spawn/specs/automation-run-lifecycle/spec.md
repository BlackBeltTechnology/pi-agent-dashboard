## ADDED Requirements

### Requirement: A fire produces a parent run with child runs

A trigger fire SHALL create one parent run record for the occurrence and one child run record per resolved child. Each child SHALL carry its own status, spawned session id, timestamps, and the action specification it was dispatched with. The parent SHALL reference its children.

#### Scenario: Parent and children recorded

- **WHEN** a fire resolves 3 children
- **THEN** one parent run record SHALL exist referencing 3 child records
- **AND** each child record SHALL carry its own `status`, `sessionId`, and action label

#### Scenario: Single-action fire still yields one child

- **WHEN** a legacy single-`action:` automation without `count` fires
- **THEN** the parent run SHALL reference exactly one child

### Requirement: Each child dispatches, captures, and finalizes independently

Dispatch (prompt seed or configured event), result capture, session-death finalization, and stale reaping SHALL apply per child, keyed by that child's own run id and session. A child failing to spawn, erroring, or dying SHALL NOT change the status of any sibling.

#### Scenario: One child errors, siblings continue

- **WHEN** child 2 of 3 fails to spawn
- **THEN** child 2 SHALL be finalized `error` with the spawn failure reason
- **AND** children 1 and 3 SHALL continue running and finalize on their own signals

#### Scenario: Per-child result file

- **WHEN** a child completes and produced assistant output
- **THEN** its output SHALL be captured to that child's own `result.md` under the parent run directory
- **AND** no child's output SHALL overwrite another's

#### Scenario: A child record is addressable by its own run id

- **WHEN** a child's run record or result is requested by that child's run id
- **THEN** it SHALL be resolved and returned, without the caller supplying the parent run id

#### Scenario: Child session dies before a terminal event

- **WHEN** a child's session ends without a terminal event
- **THEN** only that child SHALL be finalized (buffered output → `done`, otherwise `error`)

### Requirement: A parent run finalizes when all its children are terminal

A parent run SHALL remain `running` while any child is `running`. When every child reaches a terminal state, the parent SHALL finalize exactly once, aggregating child outcomes: `error` when any child errored; otherwise `stopped` when every child was stopped; otherwise `done`. The parent SHALL carry a total findings count summed across children. Parent finalization SHALL be idempotent.

#### Scenario: All children succeed

- **WHEN** all 3 children finalize `done` with findings 2, 0, and 5
- **THEN** the parent SHALL finalize `done` with a total findings count of 7

#### Scenario: One child errors

- **WHEN** children finalize `done`, `error`, `done`
- **THEN** the parent SHALL finalize `error`

#### Scenario: Every child stopped

- **WHEN** every child of a fire is stopped by the user and none errored
- **THEN** the parent SHALL finalize `stopped`

#### Scenario: Some stopped, some done

- **WHEN** children finalize `stopped`, `done` and none errored
- **THEN** the parent SHALL finalize `done`

#### Scenario: Parent stays running until the last child

- **WHEN** 2 of 3 children have finalized
- **THEN** the parent SHALL still report `running`

#### Scenario: Parent finalization is idempotent

- **WHEN** a further child termination signal arrives after the parent finalized
- **THEN** the parent record SHALL be unchanged and no duplicate finalization SHALL occur

#### Scenario: The fire slot is released only when the parent finalizes

- **WHEN** an automation with `concurrency: queue` has a fire whose first child finalizes while siblings are still running
- **THEN** the queued next fire SHALL NOT start
- **AND** it SHALL start only after every child of the current occurrence is terminal

### Requirement: A live occurrence SHALL survive retention and stale reaping

Retention pruning SHALL NOT delete an occurrence that is still running. Stale-run reaping SHALL apply to child records and SHALL NOT force-finalize a parent that still has running children.

#### Scenario: Retention does not prune a running occurrence

- **WHEN** retention pruning runs while an occurrence is still `running`
- **THEN** that occurrence and its child records SHALL be retained

#### Scenario: A stale child is reaped without finalizing live siblings

- **WHEN** one child exceeds the stale-run age while a sibling is still running
- **THEN** only the stale child SHALL be finalized
- **AND** the parent SHALL remain `running` until the sibling terminates

### Requirement: Stopping a parent run stops every live child

A user stop targeting a parent run SHALL terminate every child session that is still live — including children spawned but not yet bound to a session id — then finalize each stopped child and the parent once. A stop targeting a single child SHALL terminate only that child.

#### Scenario: Stop cascades to all children

- **WHEN** the user stops a parent run with 3 running children
- **THEN** all 3 child sessions SHALL be terminated
- **AND** each child SHALL be finalized as stopped
- **AND** the parent SHALL finalize once

#### Scenario: Stopping one child leaves siblings running

- **WHEN** the user stops child 2 only
- **THEN** child 2 SHALL be terminated and finalized
- **AND** children 1 and 3 SHALL keep running
- **AND** the parent SHALL remain `running`

#### Scenario: Stop is idempotent against concurrent termination

- **WHEN** a stop races a child's own session-end
- **THEN** each child SHALL be finalized exactly once and the parent exactly once

### Requirement: Parent and child runs are visible in the UI

The Automation view SHALL render a parent run as one entry that discloses its children, showing per child the action label, status, findings count, and a link to monitor that child's session. Board visibility SHALL be decided once per occurrence and applied to every child of that fire.

#### Scenario: Children listed under the parent

- **WHEN** a parent run with 3 children is viewed
- **THEN** the parent entry SHALL show aggregate status and be expandable to 3 child rows, each with its own action label, status, and session link

#### Scenario: Visibility applies to the whole occurrence

- **WHEN** the effective visibility for a fire is `hidden`
- **THEN** neither the parent nor any child SHALL appear on the board
