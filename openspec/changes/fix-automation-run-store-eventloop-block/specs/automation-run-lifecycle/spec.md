## ADDED Requirements

### Requirement: Run-record storage SHALL NOT block the dashboard server

Reading or writing automation run records SHALL NOT stop the dashboard server from serving other requests, however slow the underlying file system is. This covers the stale-run reaper, run finalization, user Stop, the runs listing and the run-by-session lookup. A slow run store (for example an iCloud Drive folder whose files must be downloaded first) SHALL delay only the operation that is waiting on it.

#### Scenario: Slow run store does not stall the server during a sweep

- **GIVEN** an automation scope whose run records take minutes to read (a cloud file system downloading evicted files)
- **WHEN** the stale-run reaper sweeps that scope
- **THEN** the dashboard health endpoint SHALL keep responding within its normal latency while the sweep is pending
- **AND** the sweep SHALL still reap every run that is past the maximum age once the reads complete.

#### Scenario: Finalizing or stopping a run on a slow scope does not stall the server

- **GIVEN** an automation scope whose run records are slow to read and write
- **WHEN** a run in that scope finishes, is reaped, or is stopped by the user
- **THEN** other HTTP requests and session WebSocket traffic SHALL continue to be served while its record is being persisted.

#### Scenario: Runs listing on a slow scope does not stall other requests

- **GIVEN** an automation scope whose run records are slow to read
- **WHEN** clients request the runs listing for that scope
- **THEN** other HTTP requests and session WebSocket traffic SHALL continue to be served while the listing is pending
- **AND** each listing response SHALL contain the same runs and the same computed fields as with fast storage.

#### Scenario: Unreadable record is skipped, not fatal

- **GIVEN** a run directory whose record cannot be read or parsed
- **WHEN** the reaper or the runs listing reads that scope
- **THEN** that directory SHALL be skipped
- **AND** the other run records in the scope SHALL still be read.

### Requirement: Run finalization SHALL stay exactly-once under asynchronous persistence

A run SHALL be finalized at most once, and its spawned session SHALL receive at most one termination attempt from finalization, even when its record is still being persisted while another finalize path (session end, user Stop, the reaper) fires. Writes to one run record SHALL take effect in the order they were issued.

#### Scenario: Stop during a pending reaper sweep

- **GIVEN** a stale running run whose scope listing is still pending in a reaper sweep
- **WHEN** the user stops that run before the sweep reaches it
- **THEN** the run SHALL end with the Stop outcome only
- **AND** the reaper SHALL NOT finalize it again or make a second termination attempt on its session.

#### Scenario: Record writes apply in order

- **GIVEN** a run whose start, session id and terminal status are written in that order
- **WHEN** the writes are persisted asynchronously
- **THEN** the stored record SHALL reflect the terminal status together with the session id.

### Requirement: Reaping live runs SHALL NOT depend on the run store

A live run that the server is tracking and that is past the maximum age SHALL be reaped, and its concurrency slot freed, on every reaper sweep without waiting for any run-store read. A slow or unresponsive file system can then never wedge a live automation's schedule. A run's age SHALL be evaluated against the time the sweep started.

#### Scenario: Live overdue run is reaped while storage hangs

- **GIVEN** a live tracked run past the maximum age, in a scope whose run store does not respond
- **WHEN** the reaper sweep fires
- **THEN** the run SHALL be finalized as `error` and its concurrency slot freed in that sweep.

### Requirement: A user Stop SHALL get a grace period before the reaper intervenes

The reaper SHALL NOT reap a live run whose user Stop started less than a fixed grace period ago. A Stop that has not completed within the grace period SHALL NOT keep the run from being reaped.

#### Scenario: A run being stopped is left to the Stop

- **GIVEN** a live run past the maximum age whose user Stop started within the grace period
- **WHEN** the reaper sweep fires
- **THEN** the reaper SHALL NOT finalize it or attempt to terminate its session.

#### Scenario: A hung Stop does not hold the slot forever

- **GIVEN** a live run past the maximum age whose user Stop started longer ago than the grace period and has not completed
- **WHEN** the reaper sweep fires
- **THEN** the run SHALL be finalized as `error` and its concurrency slot freed.

### Requirement: Reaping stored orphan runs SHALL be single-flight per scope and observable

Reaping stale runs that only exist on disk (left by a previous server process) SHALL have at most one pass per scope in flight. When a scope's pass is still pending at the next scheduled sweep, that scope SHALL be skipped, and the server log SHALL record that its pass is still pending, with its elapsed time and the scope base path. Other scopes SHALL be swept normally. An orphan parent whose last running child is reaped SHALL be finalized in the same pass.

#### Scenario: Pending scope is skipped and reported

- **GIVEN** a scope whose previous orphan pass is still pending when the next sweep interval elapses
- **WHEN** the next scheduled sweep fires
- **THEN** no second pass of that scope SHALL start
- **AND** the server log SHALL contain a still-pending warning naming the elapsed time and the scope base path.

#### Scenario: A slow scope does not delay other scopes

- **GIVEN** two automation scopes, one whose orphan pass is pending on slow storage
- **WHEN** a scheduled sweep fires
- **THEN** the other scope SHALL be swept and its overdue orphan runs reaped.

#### Scenario: Orphan parent finalizes in the same pass as its last child

- **GIVEN** an orphan parent whose only running child is stale
- **WHEN** the orphan pass reaps that child
- **THEN** the parent SHALL be finalized in the same pass.

### Requirement: Slow run-record storage operations SHALL be logged

A run-store operation (a read, write, listing or prune) that is still pending when a fixed threshold has elapsed since it started its storage work SHALL produce exactly one server log warning for that scope and operation, at the moment the threshold is crossed, naming the threshold and the scope base path. A stall is then visible from the server log while it is happening.

#### Scenario: Slow read is logged

- **GIVEN** a run-store operation on a scope is still pending when the slow-operation threshold elapses
- **WHEN** the threshold is crossed, and later the read completes
- **THEN** the server log SHALL contain exactly one slow-operation warning for that operation, naming the scope base path, emitted while it was pending.

#### Scenario: Fast read is not logged

- **GIVEN** a run-store operation completes before the slow-operation threshold elapses
- **WHEN** the operation completes
- **THEN** no slow-operation warning SHALL be logged.
