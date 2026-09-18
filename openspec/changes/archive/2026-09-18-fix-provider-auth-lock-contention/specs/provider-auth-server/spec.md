## MODIFIED Requirements

### Requirement: auth.json atomic write with locking
All writes to `auth.json` SHALL use a lockfile (`auth.json.lock`) with retry logic. If the file does not exist, it SHALL be created with `0600` permissions. Existing owner permission bits SHALL be preserved on update, with group/world bits always cleared (normalized to owner-only), so a legacy wider mode cannot persist. The staged `auth.json.tmp` SHALL have its mode explicitly enforced before the rename, because `writeFileSync`'s `mode` argument applies only at file creation. See change: fix-corrupt-auth-json-500.

The lock helper's own placeholder create — the empty `{}` file written so the lockfile has a target to lock — SHALL also use mode `0600`. Writing it without an explicit mode yields `0666 & ~umask` (typically `0644`), which `writeAuthJson`'s permission-preservation then carries forward to every subsequent write, leaving the credential file group- and world-readable.

Lock acquisition SHALL retry only the lock-already-held condition, for a bounded window of at most 2 seconds, and SHALL then fail. Any other lock or I/O failure (permissions, missing target, unreadable directory) SHALL propagate immediately without consuming the retry window. Waiting for the lock SHALL NOT block the server's event loop: while a write waits, the server SHALL continue to serve HTTP requests and WebSocket frames. See change: fix-provider-auth-lock-contention.

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
- **WHEN** the `auth.json` lock stays held for longer than the bounded window during a credential write
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

### Requirement: Credential removal reports a refusal to the client
`DELETE /api/provider-auth/:provider` SHALL map any write failure — a refusal to clobber un-backed-up bytes, or an exhausted lock-contention window — to a JSON body carrying an `error` string describing the reason, matching the shape `PUT /api/provider-auth/api-key` already returns, so the Settings UI can display why the operation failed instead of a generic fallback. The response SHALL NOT fall through to the framework's generic `Internal Server Error` body, and the `error` string SHALL NOT contain credential material. See change: fix-provider-auth-lock-contention.

#### Scenario: Refused delete surfaces a reason
- **WHEN** a client sends `DELETE /api/provider-auth/anthropic` and the write refuses because the bytes could not be backed up
- **THEN** the response SHALL be `500` with a body including an `error` string naming the reason
- **AND** the body SHALL NOT contain credential material

#### Scenario: Lock-contention exhaustion surfaces a reason
- **WHEN** a client sends `DELETE /api/provider-auth/anthropic` and the lock stays held past the bounded window
- **THEN** the response SHALL be `500` with an `error` string identifying lock contention as the cause — the underlying lock error's own message SHALL be passed through rather than replaced by a generic phrase
- **AND** the body SHALL NOT be the framework's generic `Internal Server Error` message
- **AND** the body SHALL NOT contain credential material
