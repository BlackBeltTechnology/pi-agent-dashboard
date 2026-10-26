## ADDED Requirements

### Requirement: Records encrypted at rest with an unchanged API
The plugin credential file SHALL be stored in the encrypted envelope defined by `credential-at-rest-encryption`. `get`, `list`, `snapshot`, `set`, `remove` and `update` SHALL keep their signatures and results, and encryption SHALL be transparent to plugins. While the file is locked, or a write is refused because no data key is available, the operation SHALL reject with a `PluginCredentialError` of code `store_locked`. That error SHALL carry the non-secret reason and no stored content.

#### Scenario: Plugin round-trip unchanged
- **WHEN** a plugin calls `set("a@x.com", { token: "t-123456" })` and then `get("a@x.com")`
- **THEN** it receives `{ token: "t-123456" }` and the file on disk is in the encrypted format

#### Scenario: Locked store rejects reads and writes
- **WHEN** the file is locked with reason `key_mismatch` and a plugin calls `get` or `set`
- **THEN** each call rejects with code `store_locked` and reason `key_mismatch`
- **AND** the file's bytes are unchanged

## MODIFIED Requirements

### Requirement: Storage file isolation and permissions
Plugin credentials SHALL be persisted to `~/.pi/agent/plugin-credentials.json`, separate from `~/.pi/agent/auth.json`. The file SHALL be created with owner-only (0600) permissions. Its content SHALL be in the encrypted format of `credential-at-rest-encryption`. Writing plugin credentials SHALL NOT modify `auth.json`.

#### Scenario: First write creates a 0600 file
- **WHEN** a plugin calls `set` and no `plugin-credentials.json` exists
- **THEN** the file is created with mode 0600 and contains the record under the plugin's namespace

#### Scenario: auth.json untouched
- **WHEN** a plugin writes and removes credentials
- **THEN** the bytes of `auth.json` are unchanged

#### Scenario: Record not readable from the raw file
- **WHEN** a plugin calls `set` with a record holding `tok-Z4mW8qN2xV6c`
- **THEN** the raw file bytes do not contain `tok-Z4mW8qN2xV6c`, and decrypting the file yields the record under the plugin's namespace

### Requirement: Corrupt file handling
If `plugin-credentials.json` is not valid JSON and is not in the encrypted format, the store SHALL first back it up byte-exact to a `plugin-credentials.json.corrupt-<stamp>` sibling with 0600 permissions. Only then SHALL a write proceed. A write SHALL be refused if that backup cannot be made. A backup made for one credential file SHALL NOT count as a backup of any other file. A file whose first line starts with `pi-dashboard-encrypted:` is never corrupt. If it cannot be decrypted, or its envelope is damaged, it is locked: it SHALL NOT be backed up as corrupt or overwritten, and every write SHALL be refused.

#### Scenario: Corrupt file quarantined before overwrite
- **WHEN** the file contains invalid JSON and a plugin calls `set`
- **THEN** a byte-exact 0600 backup exists and the new file holds only valid JSON

#### Scenario: Identical corruption in both files
- **WHEN** `auth.json` and `plugin-credentials.json` contain identical corrupt bytes and both are written
- **THEN** each file has its own byte-exact backup before being overwritten

#### Scenario: Undecryptable file is not treated as corrupt
- **WHEN** the file is in the encrypted format, cannot be decrypted with the available key, and a plugin calls `set`
- **THEN** the call is refused, no `.corrupt-*` copy is made, and the file's bytes are unchanged

#### Scenario: Damaged envelope is not treated as corrupt
- **WHEN** the file's first line is `pi-dashboard-encrypted:v1`, its second line is not valid JSON, and a plugin calls `set`
- **THEN** the call is refused with `store_locked` and reason `envelope_damaged`, no `.corrupt-*` copy is made, and the file's bytes are unchanged
