## ADDED Requirements

### Requirement: A work-source vends leased handles through a generic fenced contract

The automation engine SHALL obtain concrete work items only through an injected
**work-source** identified by a registered `on.source` id. The work-source SHALL
expose a competing-consumers contract that returns **leased handles**, not bare
items, so acknowledgement can be fenced:

- `next(n)` SHALL return up to `n` distinct handles, each `{ item, leaseToken }`,
  with the item atomically **leased**.
- `ack(leaseToken)` SHALL drop the item permanently, **conditional on the token
  still being the current lease**; an `ack` presented with a stale or expired
  token SHALL be a no-op.
- `nack(leaseToken)` SHALL return the item to the available pool, **also
  conditional on the token being current**; a stale-token `nack` SHALL be a no-op
  so a slow child cannot recall an item already re-vended to another child.
  Lease expiry returns the item independently of any `nack`.

The engine SHALL contain no domain-specific item vocabulary — what an item is,
and how availability is enumerated, SHALL live entirely behind the work-source.

#### Scenario: Engine source is domain-free

- **WHEN** the automation engine source is inspected
- **THEN** it contains no domain literals such as `invoiceId` or `invoicebot`
- **AND** all item resolution flows through the injected work-source contract

#### Scenario: next vends distinct leased handles

- **WHEN** the engine calls `next(3)` against a source with 3 available items
- **THEN** it receives 3 distinct handles, each carrying an item and a lease token
- **AND** no item is returned more than once

#### Scenario: A stale-token ack does not double-drop

- **WHEN** an item's lease expires and the item is re-vended to another child, and
  the original child then calls `ack` with its now-stale token
- **THEN** the stale `ack` is a no-op
- **AND** the item's current lease (held by the second child) is unaffected

#### Scenario: A stale-token nack does not recall a re-vended item

- **WHEN** an item's lease expires and is re-vended, and the original child then
  calls `nack` with its now-stale token
- **THEN** the stale `nack` is a no-op
- **AND** the item remains leased to the second child

### Requirement: Leasing is single-flight — at most one valid lease per item

At any instant an item SHALL have **at most one valid lease**. An item with a
valid lease SHALL NOT be resolvable or leasable to any other child of the same,
concurrent, or subsequent fire while that lease is held. Resolution SHALL exclude
items that currently hold a valid lease. This does NOT forbid the same item id
being re-vended AFTER its lease expires (the crash-recovery path); it forbids two
**concurrently-valid** leases.

#### Scenario: No two concurrently-valid leases

- **WHEN** a fire resolves items and spawns multiple concurrent children
- **THEN** each child is bound to a distinct item under its own valid lease
- **AND** no item held under a valid lease is assigned to another child

#### Scenario: Concurrent fires cannot double-lease

- **WHEN** two fires of the same automation overlap and would resolve the same available item
- **THEN** the first fire's lease wins and the second fire does not resolve that item
- **AND** the item is processed by exactly one child across both fires

#### Scenario: In-flight items are excluded from later resolution

- **WHEN** items `a` and `b` are leased and running, and a new fire resolves
- **THEN** the new fire does not resolve `a` or `b`
- **AND** it resolves only items not currently leased

### Requirement: The engine injects a stable idempotency key; exactly-once requires an idempotent action

The engine SHALL deliver **at-least-once** processing and SHALL inject a **stable
per-item idempotency key** (derived from the item identity / lease) into the
child alongside its item, so the action can forward it to its downstream
resource. The engine SHALL NOT claim exactly-once for an opaque action it cannot
fence: because actions are fully detached, the engine cannot atomically bind the
action's external side effect to the lease. Exactly-once SHALL be achieved by the
action being **idempotent on the injected key** (checked atomically at the
side-effect resource). Where an action is neither idempotent nor fenceable, the
residual double-fire window SHALL be documented for that source.

#### Scenario: Same item redelivered carries the same idempotency key

- **WHEN** an item's lease expires and the item is re-vended on a later fire
- **THEN** the redelivered child receives the SAME stable idempotency key as the
  original delivery
- **AND** an action idempotent on that key processes the item's effect only once

### Requirement: Acknowledgement is driven by terminal run status

The engine SHALL acknowledge a child's lease from that child's terminal run
status: a child reaching status **`done`** SHALL `ack` its item (drop it); a child
reaching **`error`** or **`stopped`**, or dying before a terminal status, SHALL
`nack` its item (return it to the pool). Release SHALL be wired into every
finalize path — normal completion, stop, session death, spawn failure, and the
stale-run reaper — not only the success path.

#### Scenario: Successful child acks, failed child nacks

- **WHEN** one child finishes its item with terminal status `done` and a sibling
  finishes with status `error`
- **THEN** the `done` child's item is dropped via `ack`
- **AND** the `error` child's item is returned to the pool via `nack`

### Requirement: A leased item is released for redispatch on failure, death, or expiry

If a child fails to spawn, dies before completing, or its lease visibility
timeout expires without an `ack`, the engine SHALL release that item's lease so a
later fire can redispatch it. A crash or stop SHALL NOT strand an item as
permanently leased-but-unprocessed.

#### Scenario: Dead child releases its item

- **WHEN** a child bound to item `a` dies before completing
- **THEN** item `a`'s lease is released
- **AND** a subsequent fire may resolve and reprocess `a`

#### Scenario: Spawn failure releases the item

- **WHEN** a child fails to spawn after its item was leased
- **THEN** that item's lease is released
- **AND** the item remains available for the next fire

### Requirement: Empty resolution fast-fails without spawning

When the work-source vends zero available items for a fire, the engine SHALL
spawn no child, settle the fire immediately, and record it as a no-op. A fire
SHALL NOT spawn an idle child that would find nothing to do.

#### Scenario: No available work, no spawn

- **WHEN** a fire resolves and the work-source reports zero available items
- **THEN** no child session is spawned
- **AND** the fire settles as a completed no-op

### Requirement: A source resolution error settles the fire without leasing

When a work-source's `next` fails (e.g. the underlying collection is unreadable),
the engine SHALL settle the fire as errored, SHALL spawn no child, and SHALL
leave no item leased. A resolution failure SHALL NOT strand a partial lease.

#### Scenario: next throws, nothing leased

- **WHEN** a fire calls the work-source and `next` throws
- **THEN** no child is spawned and the fire is recorded as errored
- **AND** no item is left in a leased state

### Requirement: A scheduled batch trigger fans out one child per leased item

An `automation.yaml` SHALL accept `on.kind: schedule.batch` with a `cron`
expression and an `on.source` naming a registered work-source. On each tick the
trigger SHALL lease up to the effective bound of available items and fan out
**one child per leased item** (dynamic width). The legacy `count` field SHALL NOT
govern width for this kind. Existing `schedule` and `file` trigger kinds SHALL be
unaffected.

A `schedule.batch` automation SHALL declare exactly one `action:`. An `actions:`
list or a `count` on a `schedule.batch` automation SHALL fail validation, since
one item maps to one child running the single action. An unknown `on.source` id
SHALL isolate the automation as invalid (mirroring an unknown trigger kind).
A manual "run now" of a `schedule.batch` automation SHALL resolve and lease from
the same `on.source` (up to the bound), not spawn an item-less child.

#### Scenario: Dynamic width equals items vended

- **WHEN** a `schedule.batch` automation fires with 3 available items under a bound of 4
- **THEN** exactly 3 children are spawned, each bound to a distinct leased item
- **AND** no child enumerates or scans the source

#### Scenario: actions or count on a batch automation is rejected

- **WHEN** a `schedule.batch` automation declares `actions:` or a `count`
- **THEN** parsing SHALL fail with a validation error
- **AND** the automation SHALL be isolated as invalid

#### Scenario: Manual run of a batch automation vends from the source

- **WHEN** a `schedule.batch` automation is run manually and the source has 2 available items
- **THEN** the manual run leases and spawns children for those items (up to the bound)
- **AND** it does not spawn a child without an injected item

#### Scenario: New arrival is drained on a later fire

- **WHEN** item `c` arrives after a fire has resolved `[a, b]` and is running
- **THEN** the current fire does not process `c`
- **AND** a subsequent fire resolves `c` (given `a`/`b` are no longer available) and processes it exactly once
