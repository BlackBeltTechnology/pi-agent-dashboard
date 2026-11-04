# subagent-queue-state Specification

## Purpose
Defines how the dashboard presents a subagent that is waiting for a concurrency slot. A waiting subagent must be clearly different from a working one, and the user can see its queue position, the slot usage and the wait time.

## Requirements

### Requirement: Queued subagent card is visually distinct from a running one

A card whose details status is `queued` SHALL NOT show the running spinner, the running border colour or a run timer. It SHALL show a static waiting icon, neutral severity tokens and the wait time. With `queuePosition` present it SHALL read `#<queuePosition> in queue`, and otherwise `Queued`. An `activeSlots/maxConcurrent` reading SHALL appear only when both are present and `maxConcurrent > 0`. The popout SHALL be disabled while queued.

#### Scenario: Queued with producer queue info
- **WHEN** the card receives `status: "queued"`, `queuePosition: 2`, `activeSlots: 4`, `maxConcurrent: 4`
- **THEN** the card shows `#2 in queue`, a 4/4 slot reading and the wait time, and no spinner

#### Scenario: Older producer
- **WHEN** the card receives `status: "queued"` with no queue fields
- **THEN** the card shows `Queued` and the wait time, with no slot reading and no spinner

#### Scenario: Position update
- **WHEN** the same card next receives `queuePosition: 1`
- **THEN** it shows `#1 in queue`

### Requirement: Wait time is not shown as run time

While queued, the elapsed time SHALL be presented as wait time. Once running, run time SHALL count from `slotGrantedAt` when present, and otherwise as before this change.

#### Scenario: Slot granted
- **WHEN** a subagent waited 1m 40s and then reports `running` with `slotGrantedAt`
- **THEN** its run timer counts from `slotGrantedAt`, not from 1m 40s ago

#### Scenario: Running without slotGrantedAt
- **WHEN** a running snapshot has no `slotGrantedAt`
- **THEN** run time is shown as before this change

### Requirement: Queued chat row does not spin

The chat timeline row of an `Agent` call whose subagent is queued SHALL show a static waiting glyph and `queued`, with `· #<queuePosition>` when known, and the wait time, instead of the running spinner and elapsed run time.

#### Scenario: Row for a queued subagent
- **WHEN** an `Agent` row's subagent reports `queued` with `queuePosition: 1`
- **THEN** the row shows a waiting glyph and `queued · #1` with the wait time, and no spinner

#### Scenario: Subagents plugin disabled
- **WHEN** the subagents plugin is disabled
- **THEN** the `Agent` row renders exactly as before this change
