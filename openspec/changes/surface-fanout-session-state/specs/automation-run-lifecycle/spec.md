## ADDED Requirements

### Requirement: A bounded work-source lease exposes deferred work

When a fire obtains work from a work source, the parent run record SHALL report the number of handles leased by that fire and the number of additional available items left unleased for a later fire. The fire SHALL also emit one operator log entry containing the same leased and deferred counts. A fire with no deferred items SHALL report a deferred count of zero rather than leaving the completion of the lease ambiguous.

#### Scenario: Bound leaves work for a later fire

- **WHEN** a work source has 6 available items and the effective `maxConcurrentSpawns` is 4
- **THEN** the fire SHALL lease and spawn 4 children
- **AND** its parent run record SHALL report `leasedCount: 4` and `deferredCount: 2`
- **AND** an operator log entry SHALL report that 4 items were leased and 2 were deferred

#### Scenario: All available work is leased

- **WHEN** a work source has 4 available items and the effective `maxConcurrentSpawns` is 4
- **THEN** the parent run record SHALL report `leasedCount: 4` and `deferredCount: 0`
- **AND** the operator log SHALL distinguish this fire from one that left work unleased

#### Scenario: Deferred items remain eligible

- **WHEN** a fire reports a non-zero deferred count
- **THEN** the deferred items SHALL remain unleased and eligible for a later fire
- **AND** the observation SHALL NOT classify them as failed, dropped, or truncated children

### Requirement: Run-list polling exposes parent and child lifecycle state

The automation run-list REST response SHALL return each fan-out parent with its `status`, ordered `children` run-id list, and attached `childRuns` records. Each work-source child record SHALL include the stable `workItemKey` of the specific leased item handed to that child, so a consumer can attribute the child and its session to the item being processed. A parent SHALL be visible as `running` before child startup completes; each child appended to the parent SHALL be visible with its current `status`, including `running`. This response SHALL be sufficient for a polling consumer to derive “batch started, N running” and identify which item each child is processing without reading session internals or correlating separate endpoints.

Run-lifecycle WebSocket broadcasts are not part of this contract. A consumer requiring lifecycle updates SHALL poll the run-list route and SHALL converge to the latest persisted parent and child states on the next successful response.

#### Scenario: Consumer observes a batch starting

- **WHEN** a fire has created a `running` parent and appended 4 `running` child records
- **THEN** the next successful run-list response SHALL include that parent with 4 child ids and 4 attached child records whose status is `running`
- **AND** every attached child SHALL carry the `workItemKey` of its distinct leased item
- **AND** a consumer SHALL be able to derive “batch started, 4 running” and map each running child and session to its item from that response alone

#### Scenario: Parent is visible before every child is appended

- **WHEN** a parent exists with `status: running` and child startup is still in progress
- **THEN** the run-list response SHALL include the parent and every child record persisted so far
- **AND** a later poll SHALL include newly appended children

#### Scenario: Polling preserves item attribution through settlement

- **WHEN** one attached child changes from `running` to a terminal status
- **THEN** the next successful run-list response SHALL expose that terminal child status and the current statuses of its siblings
- **AND** each child SHALL retain the same `workItemKey` it had while running

## MODIFIED Requirements

### Requirement: Concurrency policy per automation

The automation's `concurrency` field SHALL govern successive trigger fires for the same automation: `skip` drops an overlapping fire (default), `queue` admits it after the active parent occurrence ends, and `parallel` admits it immediately. The field SHALL NOT limit or serialize children obtained by one admitted fire. Within an admitted work-source fire, every leased handle SHALL be started concurrently, with lease width governed solely by the effective `maxConcurrentSpawns` bound.

#### Scenario: skip drops overlapping fire

- **WHEN** `concurrency: skip` and a parent occurrence is active at the next fire
- **THEN** no new parent occurrence SHALL start and the skipped fire SHALL be logged

#### Scenario: queue defers overlapping fire

- **WHEN** `concurrency: queue` and a parent occurrence is active at the next fire
- **THEN** a new parent occurrence SHALL start after the active parent occurrence ends

#### Scenario: queue does not serialize children within one fire

- **WHEN** one admitted `concurrency: queue` fire leases 4 handles under an effective `maxConcurrentSpawns` of 4
- **THEN** all 4 child starts SHALL be initiated without waiting for an earlier child to finalize
- **AND** `concurrency: queue` SHALL apply only if another fire arrives while that parent occurrence remains active
