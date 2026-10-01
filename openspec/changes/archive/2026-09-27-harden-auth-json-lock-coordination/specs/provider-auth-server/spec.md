## MODIFIED Requirements

### Requirement: auth.json atomic write with locking
All writes to `auth.json` SHALL use a lockfile (`auth.json.lock`) with retry logic. If the file does not exist, it SHALL be created with `0600` permissions. Existing owner permission bits SHALL be preserved on update, with group/world bits always cleared (normalized to owner-only), so a legacy wider mode cannot persist. The staged `auth.json.tmp` SHALL have its mode explicitly enforced before the rename, because `writeFileSync`'s `mode` argument applies only at file creation. See change: fix-corrupt-auth-json-500.

The lock helper's own placeholder create — the empty `{}` file written so the lockfile has a target to lock — SHALL also use mode `0600`. Writing it without an explicit mode yields `0666 & ~umask` (typically `0644`), which `writeAuthJson`'s permission-preservation then carries forward to every subsequent write, leaving the credential file group- and world-readable.

Lock acquisition SHALL retry only the lock-already-held condition, for a bounded window of at most 2 seconds for interactive credential writes and removals, and SHALL then fail. The internal OAuth refresh path's lock waits are bounded separately, by "OAuth refresh SHALL coordinate with other auth.json writers" in `model-proxy-credential-routing`. Any other lock or I/O failure (permissions, missing target, unreadable directory) SHALL propagate immediately without consuming the retry window. Waiting for the lock SHALL NOT block the server's event loop: while a write waits, the server SHALL continue to serve HTTP requests and WebSocket frames. See change: fix-provider-auth-lock-contention.

The lock's staleness threshold SHALL be no shorter than the threshold pi uses for the lock it holds across an OAuth network refresh (30 seconds as of pi 0.86.1), and SHALL be defined once in production code and pinned by a test. Liveness is judged from the lockfile mtime only. The dashboard SHALL NOT treat as stale, and SHALL NOT remove, a lock whose mtime is newer than that threshold. A holder that fails to refresh its mtime within the threshold, for example because its event loop stalls, can still be taken over. A compromised lock SHALL NOT raise an uncaught exception or terminate the server process, whenever the compromise is reported. A locked operation that observes its lock compromised before it writes SHALL fail with an error identifying the compromise and SHALL leave `auth.json` unmodified. Any log line about a compromise SHALL carry the error code only. The lock SHALL be held only across a synchronous read-modify-write, and this SHALL be enforced by the lock helper's type, so that an asynchronous callback fails to compile. See change: harden-auth-json-lock-coordination.

#### Scenario: Concurrent write protection
- **WHEN** two write operations occur simultaneously
- **THEN** one SHALL acquire the lock and complete; the other SHALL retry after a delay and then complete without data loss

#### Scenario: Held lock resolves within the bounded window
- **WHEN** a separate process holds the `auth.json` lock while a credential removal is waiting, and releases it early enough that a further retry attempt falls inside the bounded window
- **THEN** that attempt SHALL acquire the lock and the removal SHALL complete successfully, with the credential absent from `auth.json`
- **AND** no error SHALL be surfaced to the caller

#### Scenario: Waiting for the lock leaves the server responsive
- **WHEN** a credential write is waiting for a lock held by another process
- **THEN** the server SHALL answer `GET /api/health` while that wait is still in progress, at p95 under 200 ms
- **AND** the wait SHALL yield to the event loop between attempts rather than blocking it

#### Scenario: Bounded window is exhausted
- **WHEN** the `auth.json` lock stays held for longer than the bounded window during an interactive credential write
- **THEN** the write SHALL fail without modifying `auth.json`

#### Scenario: Non-contention lock errors are not retried
- **WHEN** lock acquisition fails for a reason other than the lock being held — for example the lock directory is not writable
- **THEN** the operation SHALL fail immediately, without consuming the retry window

#### Scenario: New file creation
- **WHEN** `auth.json` does not exist and a credential is saved
- **THEN** the file SHALL be created with mode `0600` (owner read/write only)

#### Scenario: Lock placeholder create is 0600
- **WHEN** `auth.json` does not exist and any locked operation runs, causing the lock helper to pre-create the file
- **THEN** the pre-created file SHALL have mode `0600`
- **AND** the credential file written afterwards SHALL retain mode `0600`

#### Scenario: A lock held across a slow pi refresh is not stolen
- **WHEN** another process holds the `auth.json` lock and its lockfile mtime is between 10 and 30 seconds old, as during a pi OAuth refresh that has not yet reached its next mtime update
- **THEN** a dashboard credential write SHALL treat the lock as held, not stale
- **AND** the lockfile SHALL still exist, owned by the other process, after the dashboard write fails its bounded window

#### Scenario: A genuinely orphaned lock is reclaimed
- **WHEN** the `auth.json` lockfile mtime is older than the staleness threshold and no process is refreshing it
- **THEN** the next dashboard credential write SHALL take the lock over and complete

#### Scenario: Lock compromise reported after release does not crash
- **WHEN** proper-lockfile reports the dashboard's lock compromised from its update timer after the locked operation has already completed
- **THEN** no uncaught exception or unhandled rejection SHALL be raised and the server process SHALL keep running
- **AND** the completed operation's result SHALL stand

#### Scenario: Lock compromise fails the write without crashing
- **WHEN** the dashboard's lock is reported compromised after acquisition but before its read-modify-write runs
- **THEN** that operation SHALL reject with an error identifying the compromise
- **AND** `auth.json` SHALL be byte-identical to its prior content
- **AND** no uncaught exception or unhandled rejection SHALL be raised, and the server process SHALL keep running
