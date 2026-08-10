# async-semaphore Specification

## Purpose

The async-semaphore is a FIFO concurrency limiter that caps how many async tasks run at once. It gates task execution through a `run(fn)` method, admitting at most `max` tasks concurrently and queueing the rest in first-in-first-out order. It supports live reconfiguration of the concurrency limit via `setMax(n)` without interrupting in-flight work. It is used to throttle concurrent `openspec` CLI spawns, where the cap is reconfigurable from user settings.

## Requirements

### Requirement: Construction and Limit Validation

The semaphore SHALL be created with a concurrency limit that must be a positive integer, and SHALL reject invalid limits at construction time and when reconfigured.

#### Scenario: Valid limit accepted
- **WHEN** `createSemaphore(max)` is called with a finite number greater than or equal to 1
- **THEN** a semaphore is returned with its concurrency limit set to `max`
- **AND** a non-integer `max` is floored to the nearest lower integer

#### Scenario: Non-positive or non-finite limit rejected at construction
- **WHEN** `createSemaphore(max)` is called with a value that is not finite or is less than 1
- **THEN** an error is thrown reporting that the max must be a positive integer and including the offending value

#### Scenario: Invalid limit rejected on reconfigure
- **WHEN** `setMax(n)` is called with a value that is not finite or is less than 1
- **THEN** an error is thrown reporting that the max must be a positive integer and including the offending value
- **AND** the current limit is left unchanged

### Requirement: Bounded Concurrent Execution

The semaphore SHALL run at most `limit` tasks concurrently. A task submitted while a free slot exists SHALL start immediately; a task submitted while all slots are occupied SHALL be queued.

#### Scenario: Task starts immediately when a slot is free
- **WHEN** `run(fn)` is called and the number of active tasks is below the limit
- **THEN** a slot is occupied and `fn` is invoked without waiting
- **AND** `run` returns a promise that settles with the resolved value or rejection of `fn`

#### Scenario: Task queued when all slots are occupied
- **WHEN** `run(fn)` is called and the number of active tasks equals the limit
- **THEN** the task is added to the waiter queue and `fn` is not yet invoked
- **AND** the returned promise stays pending until the task is later admitted and its `fn` settles

#### Scenario: Task invocation is deferred to a microtask boundary
- **WHEN** an admitted task is started
- **THEN** `fn` is invoked via a resolved-promise continuation rather than synchronously within the `run` call

### Requirement: FIFO Waiter Ordering

Queued tasks SHALL be admitted in the exact order they were submitted. When a slot frees, the oldest waiting task SHALL be admitted first.

#### Scenario: Waiters admitted in submission order
- **WHEN** multiple tasks are queued while slots are full
- **AND** slots become available one at a time
- **THEN** each freed slot admits the earliest-submitted waiting task before any later-submitted waiting task
- **AND** the queue is drained in order until either the queue is empty or the active count reaches the limit

### Requirement: Slot Release and Draining

When a task settles, its slot SHALL be released and the queue SHALL be drained so that waiting tasks may proceed. Release SHALL occur whether the task resolves or rejects, and each task SHALL release its slot at most once.

#### Scenario: Slot released on successful completion
- **WHEN** an active task's `fn` resolves
- **THEN** the active count is decremented and the returned promise resolves with the task's value
- **AND** the queue is drained on a subsequent microtask, admitting waiting tasks up to the limit

#### Scenario: Slot released on rejection
- **WHEN** an active task's `fn` rejects or throws
- **THEN** the active count is decremented and the returned promise rejects with the error
- **AND** waiting tasks proceed exactly as they would on successful completion

#### Scenario: Draining is scheduled after state settles
- **WHEN** a slot is released
- **THEN** the drain that admits waiting tasks runs on a microtask after the current release completes, so callers observe a stable active count before more tasks start

### Requirement: Live Limit Reconfiguration

The concurrency limit SHALL be adjustable at runtime via `setMax(n)`. Increasing the limit SHALL immediately admit waiting tasks up to the new limit. Decreasing the limit SHALL NOT interrupt in-flight tasks and SHALL take effect only as active tasks release their slots.

#### Scenario: Increasing the limit wakes waiting tasks
- **WHEN** `setMax(n)` is called with a value larger than the current active count while tasks are queued
- **THEN** the queue is drained synchronously within the `setMax` call, admitting waiting tasks until the active count reaches the new limit or the queue empties

#### Scenario: Decreasing the limit does not interrupt in-flight tasks
- **WHEN** `setMax(n)` is called with a value smaller than the current active count
- **THEN** all currently active tasks continue running to completion
- **AND** no new waiting task is admitted until releases bring the active count below the new limit

### Requirement: Size Reporting

The semaphore SHALL report its total outstanding work as the sum of active and queued tasks.

#### Scenario: Size reflects active plus queued
- **WHEN** `size()` is called
- **THEN** it returns the number of currently active tasks plus the number of tasks waiting in the queue
