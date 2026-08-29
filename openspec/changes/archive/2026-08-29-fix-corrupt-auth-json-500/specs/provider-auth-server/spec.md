## ADDED Requirements

### Requirement: auth.json corrupt-content recovery
Reading `auth.json` SHALL NOT fail because of its *content*. When the file's bytes are readable but do not parse as a JSON **plain object** — empty file, truncated JSON, `null`, an array, or a scalar — the server SHALL treat the credential set as empty (`{}`) and SHALL quarantine the bad bytes.

A leading UTF-8 BOM SHALL be stripped before parsing, so a BOM-prefixed but otherwise valid file is NOT classified as corrupt.

Quarantine SHALL copy the bad bytes to `auth.json.corrupt-<stamp>` in the same directory and SHALL NOT rename, move, truncate, or delete `auth.json`. `<stamp>` SHALL be `YYYYMMDDTHHMMSSsssZ` with no `:` character, so the name is valid on NTFS. The copy SHALL be created with the exclusive `wx` flag and mode `0600`; on `EEXIST` a numeric `-1`, `-2`, … suffix SHALL be appended so an existing backup is never overwritten.

The server SHALL log one line naming the quarantine path and the reason. The log line, the backup filename, and any HTTP error body SHALL NOT contain credential material.

Failures to *read the bytes at all* (`EACCES`, `EISDIR`, `EMFILE`, Windows `EPERM`/`EBUSY`) are NOT corrupt-content conditions and SHALL still throw. `ENOENT` SHALL keep its existing meaning: `{}`, no quarantine, no log.

#### Scenario: Empty auth.json yields an empty credential set
- **WHEN** `auth.json` exists and is zero bytes
- **THEN** the read SHALL return `{}` without throwing
- **AND** a copy of the file SHALL be written to `auth.json.corrupt-<stamp>` with mode `0600`
- **AND** `auth.json` SHALL still exist with its original bytes

#### Scenario: Truncated JSON is quarantined
- **WHEN** `auth.json` contains `{"anthropic": {"type": "oauth", "refr`
- **THEN** the read SHALL return `{}` without throwing
- **AND** the quarantine copy SHALL contain those exact bytes

#### Scenario: Valid JSON that is not a plain object is corrupt
- **WHEN** `auth.json` contains `null`, `[]`, or `42`
- **THEN** the read SHALL return `{}` without throwing and SHALL quarantine the bytes

#### Scenario: BOM-prefixed valid JSON is not corrupt
- **WHEN** `auth.json` contains a UTF-8 BOM followed by `{"openai":{"type":"api_key","key":"sk-x"}}`
- **THEN** the read SHALL return the `openai` credential
- **AND** no quarantine file SHALL be created

#### Scenario: Quarantine filename contains no colon
- **WHEN** any quarantine occurs
- **THEN** the created filename SHALL match `auth.json.corrupt-<stamp>` where `<stamp>` contains no `:` character

#### Scenario: Existing backup is never overwritten
- **WHEN** a quarantine target name already exists on disk
- **THEN** the server SHALL create `auth.json.corrupt-<stamp>-1` (then `-2`, …) instead of overwriting it

#### Scenario: Unreadable file still throws
- **WHEN** `readFileSync` on `auth.json` fails with `EACCES`
- **THEN** the read SHALL throw and SHALL NOT create a quarantine file

#### Scenario: Missing file is not a corruption
- **WHEN** `auth.json` does not exist
- **THEN** the read SHALL return `{}`, SHALL NOT create a quarantine file, and SHALL NOT log a quarantine line

#### Scenario: Quarantine is deduplicated by content
- **WHEN** the same corrupt bytes are read repeatedly within one process
- **THEN** exactly one quarantine copy SHALL be created for those bytes
- **AND** dedup identity SHALL be a hash of the bytes, not the file's size and mtime

#### Scenario: A failed quarantine copy is retried, not latched
- **WHEN** a quarantine copy fails and the same corrupt bytes are read again
- **THEN** the server SHALL attempt the copy again

#### Scenario: Read path swallows a quarantine failure
- **WHEN** the bytes are corrupt and the quarantine copy cannot be written
- **THEN** the read SHALL still return `{}` without throwing

### Requirement: Credential writes refuse to clobber un-backed-up bytes
A credential write (`writeCredential`, `removeCredential`) SHALL re-read `auth.json` while holding the lock, using a checked read that reports whether the content was corrupt and whether a recoverable copy exists on disk.

When the content is corrupt AND no recoverable copy exists, the write SHALL throw and SHALL persist nothing — the only path that can destroy the bytes is the only path allowed to fail. When the content is corrupt AND a recoverable copy exists, the write SHALL proceed against an empty credential set.

A quarantine **dedup hit** SHALL count as a recoverable copy existing: the flag means "a backup of these exact bytes is on disk", NOT "this call performed the copy". Otherwise the repair flow deadlocks — the mount-time read quarantines the bytes, and every later write, re-reading the still-corrupt file, would refuse forever.

#### Scenario: Write refuses when the backup could not be made
- **WHEN** `auth.json` is corrupt and the quarantine copy fails
- **AND** a client saves an API key
- **THEN** the write SHALL throw, `auth.json` SHALL be byte-identical to before, and no credential SHALL be persisted

#### Scenario: Write proceeds when the backup exists
- **WHEN** `auth.json` is corrupt and a quarantine copy was written successfully
- **AND** a client saves an API key for `openai`
- **THEN** `auth.json` SHALL be replaced with a file containing only the `openai` credential
- **AND** the pre-corruption bytes SHALL remain readable in the quarantine file

#### Scenario: Repair flow is not deadlocked by a dedup hit
- **GIVEN** a prior read already quarantined the corrupt bytes and recorded them as backed up
- **WHEN** a client saves an API key and the write re-reads the same still-corrupt `auth.json`
- **THEN** the write SHALL proceed (the dedup hit counts as backed up) and SHALL NOT throw

#### Scenario: Quarantine happens under the lock on the write path
- **WHEN** a write encounters corrupt content that no prior read had quarantined
- **THEN** the quarantine copy SHALL be attempted while the write lock is held, before any replacement of `auth.json`

### Requirement: Credential removal reports a refusal to the client
`DELETE /api/provider-auth/:provider` SHALL map a write refusal to a JSON body carrying an `error` string describing the reason, matching the shape `PUT /api/provider-auth/api-key` already returns, so the Settings UI can display why the operation failed instead of a generic fallback.

#### Scenario: Refused delete surfaces a reason
- **WHEN** a client sends `DELETE /api/provider-auth/anthropic` and the write refuses because the bytes could not be backed up
- **THEN** the response body SHALL include an `error` string naming the reason
- **AND** the body SHALL NOT contain credential material

## MODIFIED Requirements

### Requirement: auth.json atomic write with locking
All writes to `auth.json` SHALL use a lockfile (`auth.json.lock`) with retry logic. If the file does not exist, it SHALL be created with `0600` permissions. Existing file permissions SHALL be preserved on update.

The lock helper's own placeholder create — the empty `{}` file written so the lockfile has a target to lock — SHALL also use mode `0600`. Writing it without an explicit mode yields `0666 & ~umask` (typically `0644`), which `writeAuthJson`'s permission-preservation then carries forward to every subsequent write, leaving the credential file group- and world-readable.

#### Scenario: Concurrent write protection
- **WHEN** two write operations occur simultaneously
- **THEN** one SHALL acquire the lock and complete; the other SHALL retry after a delay and then complete without data loss

#### Scenario: New file creation
- **WHEN** `auth.json` does not exist and a credential is saved
- **THEN** the file SHALL be created with mode `0600` (owner read/write only)

#### Scenario: Lock placeholder create is 0600
- **WHEN** `auth.json` does not exist and any locked operation runs, causing the lock helper to pre-create the file
- **THEN** the pre-created file SHALL have mode `0600`
- **AND** the credential file written afterwards SHALL retain mode `0600`

### Requirement: Credential status API
The server SHALL expose `GET /api/provider-auth/status` returning the authentication status of all providers. For each provider it SHALL return: `id`, `name`, `flowType`, `authenticated` (boolean), and for OAuth providers the `expires` timestamp if authenticated. For API-key providers the response MAY include `envVar` (string, name of the env variable pi-ai consults for this provider) and `ambient` (boolean, true when the provider is configured via an ambient credential chain such as AWS profile or Google ADC). The server SHALL NOT return tokens or secrets.

The endpoint SHALL answer `200` with a JSON array whenever `auth.json`'s bytes are readable but are not a JSON plain object; corrupt credential content SHALL NOT produce a `5xx`. Every provider SHALL then be reported `authenticated: false`, which is truthful — no credential is readable.

#### Scenario: Mixed authenticated and unauthenticated providers
- **WHEN** `auth.json` contains credentials for `anthropic` and `openai` but not `github-copilot`
- **THEN** the status response SHALL show `authenticated: true` with `expires` for `anthropic`, `authenticated: true` for `openai` (API key, no expiry), and `authenticated: false` for `github-copilot`

#### Scenario: API-key row carries envVar hint
- **WHEN** the catalogue's `mistral` entry has `envVar: "MISTRAL_API_KEY"` and `auth.json` has no `mistral` entry
- **THEN** the `mistral` row in the status response SHALL include `envVar: "MISTRAL_API_KEY"` and `authenticated: false`

#### Scenario: Corrupt auth.json returns 200 with all providers unauthenticated
- **WHEN** `auth.json` is empty or truncated and a client requests `GET /api/provider-auth/status`
- **THEN** the server SHALL respond `200` with a JSON array
- **AND** every row SHALL report `authenticated: false`
