## Purpose

Give dashboard plugins locked, owner-only, per-plugin credential persistence without importing server internals or touching LLM provider credentials.

## ADDED Requirements

### Requirement: Namespaced plugin credential store
The host SHALL provide each server plugin a credential store bound to the plugin's manifest id, with these operations:
- `get(key)` returns a copy of the record;
- `list()` returns keys only, never record contents;
- `snapshot()` returns a copy of all of the calling plugin's own records from a single read;
- `set(key, record)`;
- `remove(key)`;
- `update(key, fn)` applies `fn` to the current record atomically with respect to all other writers.

A plugin SHALL NOT be able to read, list or modify another plugin's records through this API.

#### Scenario: Plugin reads only its own records
- **WHEN** plugin `gmail` has stored key `a@x.com` and plugin `other` calls `list()`
- **THEN** `other` receives no entry for `a@x.com`

#### Scenario: Namespace comes from the manifest
- **WHEN** a plugin passes a key containing a different plugin id or path separators
- **THEN** the record is stored under the calling plugin's manifest-id namespace only, with the key treated as an opaque string

#### Scenario: List exposes no secrets
- **WHEN** a plugin calls `list()`
- **THEN** the result contains keys only

#### Scenario: Returned records are copies
- **WHEN** a plugin mutates a record returned by `get`
- **THEN** the stored record is unchanged

### Requirement: Storage file isolation and permissions
Plugin credentials SHALL be persisted to `~/.pi/agent/plugin-credentials.json`, separate from `~/.pi/agent/auth.json`. The file SHALL be created with owner-only (0600) permissions. Writing plugin credentials SHALL NOT modify `auth.json`.

#### Scenario: First write creates a 0600 file
- **WHEN** a plugin calls `set` and no `plugin-credentials.json` exists
- **THEN** the file is created with mode 0600 and contains the record under the plugin's namespace

#### Scenario: auth.json untouched
- **WHEN** a plugin writes and removes credentials
- **THEN** the bytes of `auth.json` are unchanged

### Requirement: Concurrent-safe writes
Writes SHALL be serialized with the same cross-process lock semantics as `auth.json`: the lock is retried only while held, within a bounded window, and every other failure is surfaced immediately. The file SHALL be replaced atomically so a reader never observes a partial file.

#### Scenario: Parallel writers do not lose updates
- **WHEN** two writers concurrently `set` different keys
- **THEN** both records are present afterwards

#### Scenario: Atomic read-modify-write on one record
- **WHEN** two writers concurrently `update` the same key, each changing a different field
- **THEN** both field changes are present afterwards

#### Scenario: Reads do not create the file
- **WHEN** a plugin calls `get`, `list` or `snapshot` and no credential file exists
- **THEN** the call returns empty results and no file is created

#### Scenario: Permission error is not retried
- **WHEN** acquiring the lock fails with a permission error
- **THEN** the write fails immediately with that error instead of waiting out the retry window

### Requirement: Key and record validation
The store SHALL reject each of the following with a typed error and without writing:
- keys that are empty, longer than 200 characters, or equal to `__proto__`, `constructor` or `prototype`;
- records that are not plain JSON objects;
- records larger than 64 KiB serialized;
- writes that would exceed 256 keys or 2 MiB for the plugin's namespace.

#### Scenario: Oversized record rejected
- **WHEN** a plugin calls `set` with a 100 KiB record
- **THEN** the call rejects and the file is unchanged

#### Scenario: Prototype key rejected
- **WHEN** a plugin calls `set("__proto__", {...})`
- **THEN** the call rejects and no prototype is modified

### Requirement: Corrupt file handling
If `plugin-credentials.json` is not valid JSON, the store SHALL first back it up byte-exact to a `plugin-credentials.json.corrupt-<stamp>` sibling with 0600 permissions. Only then SHALL a write proceed. A write SHALL be refused if that backup cannot be made. A backup made for one credential file SHALL NOT count as a backup of any other file.

#### Scenario: Corrupt file quarantined before overwrite
- **WHEN** the file contains invalid JSON and a plugin calls `set`
- **THEN** a byte-exact 0600 backup exists and the new file holds only valid JSON

#### Scenario: Identical corruption in both files
- **WHEN** `auth.json` and `plugin-credentials.json` contain identical corrupt bytes and both are written
- **THEN** each file has its own byte-exact backup before being overwritten

### Requirement: auth.json behaviour preserved
Moving the lock and atomic-write implementation into a shared module SHALL NOT change any observable behaviour of provider credential reads, writes, removals or quarantine on `auth.json`.

#### Scenario: Existing provider-auth storage tests pass unchanged
- **WHEN** the provider-auth storage test suite runs against the refactored code
- **THEN** every test passes without modification
