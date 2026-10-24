## ADDED Requirements

### Requirement: Explicit key file source
When `PI_DASHBOARD_DATA_KEY_FILE` is set, the dashboard SHALL read its 32-byte credential data key only from that file and SHALL NOT consult the OS keychain. The dashboard server and its CLI SHALL NOT create, rewrite or delete that file.

#### Scenario: Key file takes precedence over the keychain
- **WHEN** `PI_DASHBOARD_DATA_KEY_FILE` names an owner-only file holding a valid key and the keychain also holds a key
- **THEN** the files are encrypted and decrypted with the key file's key
- **AND** the keychain is not read

### Requirement: Key file format and permissions
The key file SHALL hold the base64 encoding of 32 bytes, optionally followed by exactly one trailing newline (`\n` or `\r\n`), and SHALL be owner-only. Otherwise the key state is unavailable with reason `key_file_missing`, `key_file_invalid` or `key_file_insecure`. A directory, an unreadable file (for example `EACCES`) and content that does not decode to 32 bytes are `key_file_invalid`.

#### Scenario: Group-readable key file refused
- **WHEN** `PI_DASHBOARD_DATA_KEY_FILE` names a file with mode `0644` on POSIX
- **THEN** the key state is unavailable with reason `key_file_insecure`
- **AND** the keychain is not consulted as a fallback

#### Scenario: Key file with a CRLF ending is accepted
- **WHEN** `PI_DASHBOARD_DATA_KEY_FILE` names an owner-only file holding a valid key followed by `\r\n`
- **THEN** the key state is ready

#### Scenario: Unusable key file path is invalid
- **WHEN** `PI_DASHBOARD_DATA_KEY_FILE` names a directory, or a file that cannot be read
- **THEN** the key state is unavailable with reason `key_file_invalid`
- **AND** the keychain is not consulted as a fallback

### Requirement: Docker image key file
The Docker image SHALL keep the key file at `/home/pi/.pi-key/data-key` on a volume separate from `/home/pi/.pi`, with mode `0600`, owned by `pi`. Its entrypoint SHALL point `PI_DASHBOARD_DATA_KEY_FILE` at that file unless the variable is already set, and SHALL generate the file only at that default path, when it is absent and neither credential file starts with `pi-dashboard-encrypted:`.

#### Scenario: Fresh container gets a key file
- **WHEN** the container starts with empty `/home/pi/.pi` and `/home/pi/.pi-key` volumes
- **THEN** `/home/pi/.pi-key/data-key` exists with mode `0600`, owned by `pi`, and the first vault account is written encrypted

#### Scenario: Preset custom key path is never generated
- **WHEN** the container starts with `PI_DASHBOARD_DATA_KEY_FILE` set to a path that does not exist
- **THEN** the entrypoint leaves the variable unchanged and creates no file at that path
- **AND** the credential stores report reason `key_file_missing` for an encrypted file

### Requirement: Docker entrypoint warns without a key volume
When `/home/pi/.pi-key` is not a mountpoint, the Docker entrypoint SHALL print a warning that the key is not persisted on a volume, and SHALL continue starting the server.

#### Scenario: Key directory without a volume warns
- **WHEN** the container starts with `/home/pi/.pi-key` not mounted as a volume
- **THEN** the entrypoint prints a warning naming `/home/pi/.pi-key` and the server still starts

### Requirement: Docker entrypoint never replaces a lost key
When an encrypted credential file exists and the key file is absent, the Docker entrypoint SHALL NOT generate a key. The server SHALL then report the encrypted files locked with reason `key_file_missing`.

#### Scenario: Lost key volume is not replaced
- **WHEN** the container starts with an encrypted `vault.json` in `/home/pi/.pi` and an empty `/home/pi/.pi-key` volume
- **THEN** no key file is generated and the vault is locked with reason `key_file_missing`

### Requirement: OS keychain key source
When `PI_DASHBOARD_DATA_KEY_FILE` is not set, the dashboard SHALL read the data key from the OS keychain entry with service `pi-dashboard-credential-key` and account `data-key-v1`. It SHALL use the platform credential store: macOS Keychain, Linux Secret Service or Windows Credential Manager. If the keychain or its native binding cannot be used, the key state SHALL be unavailable with reason `keychain_unavailable`.

#### Scenario: Native keychain binding missing
- **WHEN** the keychain module cannot be loaded on the running platform and no key file is configured
- **THEN** the key state is unavailable with reason `keychain_unavailable`

#### Scenario: Keychain worker fails to load
- **WHEN** the keychain worker cannot start or cannot load its entry or the keychain binding, and no key file is configured
- **THEN** the key state is unavailable with reason `keychain_unavailable`
- **AND** no keychain call is made on the server's main thread

#### Scenario: Malformed keychain value is never overwritten
- **WHEN** the keychain entry exists but its value is not base64 or does not decode to 32 bytes
- **THEN** the key state is unavailable with reason `keychain_unavailable`
- **AND** the entry is not overwritten and no credential is written

#### Scenario: Binding refused in a signed app bundle
- **WHEN** the packaged app cannot load the keychain binding and no key file is configured
- **THEN** the key state is unavailable with reason `keychain_unavailable` and every credential write is refused
- **AND** no credential is written in plaintext

### Requirement: Keychain access never blocks the server
Every keychain read or write SHALL run off the server's main thread. `initCredentialKey` SHALL be bounded by one total 10 s deadline covering all its keychain jobs (read, creation-lock wait, creation) and SHALL complete before the server starts listening. A job started later by the first credential write has its own 10 s deadline. On expiry the key state SHALL be unavailable with reason `keychain_timeout`, a late answer SHALL be ignored, and the process SHALL NOT retry.

#### Scenario: Unresponsive keychain
- **WHEN** a credential file exists and the keychain does not answer, for example because an unlock prompt is left open
- **THEN** server creation completes within the 10 s total keychain deadline with the credential stores locked with reason `keychain_timeout`, so startup stays within the launcher's 30 s health budget
- **AND** the event loop is not blocked while the keychain call is pending: timers scheduled during that time fire
- **AND** the process makes no further keychain call, so no second prompt appears

### Requirement: Data key confined to the server process
The data key SHALL be resolved at most once per process (at startup when a credential file exists, otherwise before the first credential write) and held only in that process's memory. A resolution failure SHALL be kept for the process lifetime, except key-creation lock contention. The key SHALL NOT appear in a log line, error message, HTTP response, command-line argument, child-process environment, or message to a bridge, plugin or client.

#### Scenario: Key never in logs or argv
- **WHEN** the server starts, creates a key and migrates both files
- **THEN** no log line and no spawned process argument or environment contains the key or its base64 form

### Requirement: Data key creation never orphans ciphertext
The dashboard SHALL create a keychain data key only when the keychain holds none and neither credential file is encrypted. Creation SHALL run under a lock shared by all dashboard processes of the user, and the creating process SHALL read the stored value back and use it. If an encrypted file exists and no key is found, the key state SHALL be unavailable with reason `key_missing`.

#### Scenario: First start creates a key
- **WHEN** the keychain holds no entry and neither credential file exists
- **THEN** the first credential write creates the keychain entry and the file is written encrypted

#### Scenario: Lost key is not replaced silently
- **WHEN** `vault.json` is in the encrypted format and the keychain entry has been deleted
- **THEN** no new key is created and the key state is unavailable with reason `key_missing`

#### Scenario: Two processes start at once
- **WHEN** two dashboard server processes of the same user start concurrently with no keychain entry and both write credentials
- **THEN** both processes use the same key and each one can decrypt files written by the other

### Requirement: Key creation lock contention
The key-creation lock (`credential-key.lock`) SHALL use a 30 s stale limit and a 2 s retry budget. If it cannot be taken, the write SHALL be refused with reason `keychain_unavailable` and the failure SHALL NOT be kept for the process.

#### Scenario: Creation lock busy refuses one write only
- **WHEN** the key-creation lock is held by a live process beyond the 2 s retry budget, or cannot be acquired (for example `EACCES`), and a credential write needs a key
- **THEN** that write is refused with reason `keychain_unavailable`
- **AND** the failure is not kept: the next write retries the lock and proceeds once it is free

#### Scenario: Stale creation lock is taken over
- **WHEN** the key-creation lock is older than the 30 s stale limit and a credential write needs a key
- **THEN** the lock is taken over and the key is created

### Requirement: Data key created lazily
The dashboard SHALL create a data key only to migrate an existing plaintext credential file or to perform a credential write. At startup with no credential file, it SHALL NOT access the keychain.

#### Scenario: No credential files means no keychain write at startup
- **WHEN** the server starts with neither credential file present and the user only views the vault page
- **THEN** no keychain entry is created or read and no credential file is created

#### Scenario: Plaintext file triggers creation at startup
- **WHEN** the server starts with a plaintext `plugin-credentials.json`, no encrypted file and no keychain entry
- **THEN** a keychain entry is created under the lock and the file is migrated to the encrypted format

### Requirement: Credential files are stored in an authenticated envelope
`~/.pi/agent/plugin-credentials.json` and `~/.pi/dashboard/vault.json` SHALL each be written as one AES-256-GCM envelope over the whole JSON document. Every write SHALL use a fresh random 12-byte nonce. The additional authenticated data SHALL bind the envelope to the file's identity, `plugin-credentials` or `vault`. The envelope SHALL carry a non-secret key identifier.

#### Scenario: No plaintext secret on disk
- **WHEN** a plugin stores `{ "token": "tok-Q7vX2mR9pL4k" }` under key `key-H3nB8wZ1cT6y@x.com` and a vault account labelled `lbl-K5dF9sJ2qW7e` is added with value `val-P8gN4vY6rM3a`
- **THEN** neither file contains `tok-Q7vX2mR9pL4k`, `key-H3nB8wZ1cT6y`, `lbl-K5dF9sJ2qW7e` or `val-P8gN4vY6rM3a` as plaintext bytes

#### Scenario: Ciphertext swapped between files fails
- **WHEN** the bytes of `vault.json` are copied over `plugin-credentials.json`
- **THEN** the plugin credential file does not decrypt and is reported locked

### Requirement: Envelope header tolerance
When it reads a credential file, the dashboard SHALL strip one leading UTF-8 BOM and SHALL accept `\r\n` line endings and one trailing newline. The `pi-dashboard-encrypted:` prefix check SHALL be case-sensitive. On a `v1` file, an `alg` other than `A256GCM` or any non-empty line after the envelope line SHALL make the file `envelope_damaged`.

#### Scenario: BOM and CRLF are tolerated
- **WHEN** a valid v1 envelope has a UTF-8 BOM, or `\r\n` line endings, or one trailing newline
- **THEN** it decrypts and is not locked

#### Scenario: Unknown algorithm or extra line is damaged
- **WHEN** a v1 envelope has `alg` `A128GCM`, or a third non-empty line
- **THEN** the file is locked with reason `envelope_damaged` and its bytes are unchanged

#### Scenario: Case-variant prefix is not an envelope
- **WHEN** a file starts with `PI-DASHBOARD-ENCRYPTED:v1`
- **THEN** it is classified corrupt (not an envelope) and handled as a corrupt file

### Requirement: Encrypted format is not mergeable by older versions
An encrypted credential file SHALL start with the line `pi-dashboard-encrypted:v1`, followed by one JSON line holding `alg`, `kid`, `iv`, `tag` and `ct`. The file as a whole SHALL NOT parse as a JSON object, so a dashboard version without this capability treats it as corrupt instead of adding plaintext fields to it.

#### Scenario: Older parser sees a corrupt file
- **WHEN** an encrypted `vault.json` is parsed as a JSON object
- **THEN** parsing fails

### Requirement: Other JSON files keep their format
Files written through the shared locked JSON primitives other than the two credential files, including `auth.json`, SHALL keep their current plaintext format and behaviour.

#### Scenario: auth.json format unchanged
- **WHEN** provider credentials are written to `auth.json` with this capability active
- **THEN** `auth.json` is plain JSON exactly as before

### Requirement: Undecryptable files are locked, never overwritten
A credential file in the encrypted format that cannot be decrypted SHALL be `locked`. A locked file SHALL NOT be quarantined, rewritten, renamed or deleted, except by the explicit reset command. While a file is locked, every write to its store SHALL be refused and none of its values SHALL be returned.

#### Scenario: Wrong key keeps the ciphertext
- **WHEN** `plugin-credentials.json` was encrypted with key A, the dashboard starts with key B, and a plugin calls `set`
- **THEN** the call is refused
- **AND** the file's bytes are unchanged and no `.corrupt-*` copy is made

### Requirement: Credential stores fail closed before key initialisation
The plugin credential store and the vault store SHALL NOT be constructible without a codec. Production stores SHALL use the process key codec, and tests SHALL inject a test codec. While no key has been resolved in the process, an encrypted file SHALL be locked with reason `key_uninitialized`. A store used before key initialisation has run SHALL refuse every write with `key_uninitialized`. In no case SHALL a store read or write plaintext in place of an encrypted file.

#### Scenario: Store used before key initialisation
- **WHEN** a vault store is used before the process has initialised its key and `vault.json` is in the encrypted format
- **THEN** the vault is locked with reason `key_uninitialized`, a write is refused, and the file's bytes are unchanged

### Requirement: Lock reasons
A locked file SHALL carry exactly one non-secret reason:
- the key state's reason, when no key is available;
- `key_mismatch`, when the key identifier differs or authentication fails;
- `unsupported_format`, when the first line starts with `pi-dashboard-encrypted:` but names an unknown version;
- `envelope_damaged`, when the first line is `pi-dashboard-encrypted:v1` but the envelope is missing, not JSON or non-conforming (see "Envelope header tolerance").

#### Scenario: Different key reported as mismatch
- **WHEN** `vault.json` was encrypted with key A and the dashboard runs with key B
- **THEN** the vault is locked with reason `key_mismatch`

#### Scenario: Newer format is not overwritten
- **WHEN** the file starts with `pi-dashboard-encrypted:v2`
- **THEN** the file is locked with reason `unsupported_format` and its bytes are unchanged after any write attempt

### Requirement: Lock remedies
Every lock reason SHALL map to one fixed, non-secret remedy text kept in a reason→remedy table in `packages/shared/src/credential-encryption.ts`. `key_missing` and `key_mismatch` SHALL name `pi-dashboard credentials reset --vault` (or `--plugin-credentials` for that file). `keychain_unavailable`, `keychain_timeout` and the `key_file_*` reasons SHALL name `PI_DASHBOARD_DATA_KEY_FILE`. The vault status, the vault page and the refusal message SHALL use that table.

#### Scenario: Remedy per reason
- **WHEN** a file is locked with reason `key_mismatch`, and another with `key_file_missing`
- **THEN** the first remedy names `pi-dashboard credentials reset --vault` and the second names `PI_DASHBOARD_DATA_KEY_FILE`

### Requirement: Envelope files are never corrupt
A file whose first line starts with `pi-dashboard-encrypted:` (case-sensitive, after an optional BOM) SHALL NOT be classified as corrupt, backed up as corrupt, or replaced by a corrupt-file recovery path.

#### Scenario: Damaged envelope header is locked, not corrupt
- **WHEN** `plugin-credentials.json` starts with `pi-dashboard-encrypted:v1` and its second line is truncated JSON, and a plugin calls `set`
- **THEN** the store is locked with reason `envelope_damaged`, the call is refused, no `.corrupt-*` copy is made and the bytes are unchanged

### Requirement: No silent plaintext writes
When no data key is available, the dashboard SHALL refuse every write to either credential store, giving the key state's reason and a remedy that names `PI_DASHBOARD_DATA_KEY_FILE`. It SHALL NOT write credentials in plaintext. An existing plaintext credential file SHALL stay readable in that state.

#### Scenario: Headless Linux without a keyring
- **WHEN** no Secret Service is reachable, no key file is configured, and a vault account is added
- **THEN** the request is refused with reason `keychain_unavailable` and a remedy naming `PI_DASHBOARD_DATA_KEY_FILE`
- **AND** `vault.json` is unchanged

#### Scenario: Plaintext vault without a key is not writable
- **WHEN** `vault.json` is valid plaintext and no key is available, and a vault account is added
- **THEN** the request is refused with `vault_locked` (HTTP 409) carrying the key state's reason and its remedy
- **AND** the vault status reports it as not writable with that reason, and `vault.json` is unchanged

#### Scenario: Existing plaintext readable without a key
- **WHEN** `plugin-credentials.json` is valid plaintext JSON and no key is available
- **THEN** `get` returns the stored record and `set` is refused

### Requirement: Plaintext files are migrated in place and verified
When a data key is available, the dashboard SHALL encrypt each credential file that holds a valid plaintext JSON object, both at startup and on any later write. It SHALL do so under that file's lock. The new ciphertext SHALL be decrypted in memory and compared with the parsed plaintext before it atomically replaces the file. On a mismatch the plaintext SHALL be left unchanged and the failure logged.

#### Scenario: First start after upgrade
- **WHEN** the server starts with a key and a plaintext `vault.json` holding two accounts
- **THEN** `vault.json` is in the encrypted format and both accounts are listed unchanged

#### Scenario: Verification failure keeps plaintext
- **WHEN** the in-memory decryption of the new ciphertext differs from the parsed plaintext
- **THEN** the plaintext file is unchanged and a log line names the file without any content

### Requirement: Migration leaves no plaintext copy
The migration SHALL NOT leave a plaintext copy of a migrated file, including temporary files. Existing `.corrupt-*` backups SHALL be left byte-exact.

#### Scenario: No plaintext sibling after migration
- **WHEN** a plaintext `plugin-credentials.json` is migrated
- **THEN** no file in `~/.pi/agent` other than pre-existing `.corrupt-*` backups contains the plaintext records

### Requirement: Credential status command
`pi-dashboard credentials status` SHALL be a local-only command that prints `key=value` lines mirroring the startup log tokens: `source=<…> state=<…> reason=<…> kid=<…>`, one `<basename>: <state> [reason]` line per credential file, and `corrupt=<N> undecryptable=<N>` for the `.corrupt-*` and `.undecryptable-*` siblings. It SHALL read the keychain only when a credential file exists. It SHALL NOT print a secret value or the key.

#### Scenario: Status on a migrated host
- **WHEN** both files are encrypted and the user runs `pi-dashboard credentials status`
- **THEN** the output names the key source and both files as `encrypted`, and contains no record content

#### Scenario: Status on a host without credential files
- **WHEN** neither credential file exists and the user runs `pi-dashboard credentials status`
- **THEN** the keychain is not accessed and both files are reported `absent`

### Requirement: Decrypt command for rollback
`pi-dashboard credentials decrypt` SHALL rewrite every encrypted credential file as owner-only plaintext. It SHALL require an interactive confirmation or `--yes`. It SHALL print one result per file (`decrypted`, `already-plaintext`, `absent` or `failed` with a reason), never a value, and SHALL exit non-zero when any file is not decrypted.

#### Scenario: Decrypt before downgrade
- **WHEN** the server is stopped and the user runs `pi-dashboard credentials decrypt`
- **THEN** both files are valid plaintext JSON objects with mode `0600` holding the same records, and the output names the files only

#### Scenario: Decrypt without confirmation refused
- **WHEN** the user runs `pi-dashboard credentials decrypt` with no TTY and no `--yes`
- **THEN** the command exits non-zero and both files are unchanged

### Requirement: Decrypt refuses a running server
Before changing any file, `pi-dashboard credentials decrypt` SHALL query `/api/health` on the configured port. Any HTTP reply, including `401`, SHALL make it refuse and exit non-zero. It SHALL proceed only when the connection is refused. It SHALL also refuse when the server PID file (`~/.pi/dashboard/server.pid`) or the per-HOME lock metadata names a live server process of this HOME, even if that server listens on another port.

#### Scenario: Decrypt refused while the server runs
- **WHEN** a dashboard server is running and the user runs `pi-dashboard credentials decrypt`
- **THEN** the command exits non-zero and both files are unchanged

#### Scenario: Server of this HOME on another port
- **WHEN** the configured port refuses connections, but the PID file names a live dashboard server of this HOME on another port, and the user runs `pi-dashboard credentials decrypt --yes`
- **THEN** the command exits non-zero and both files are unchanged

#### Scenario: Unauthorised reply still means a running server
- **WHEN** the configured port answers `/api/health` with `401` and the user runs `pi-dashboard credentials decrypt --yes`
- **THEN** the command exits non-zero and both files are unchanged

### Requirement: Decrypt is all-or-nothing
`pi-dashboard credentials decrypt` SHALL hold both store locks for the whole run. It SHALL decode every encrypted file before writing any, and SHALL write nothing if any file cannot be decoded.

#### Scenario: One locked file blocks the whole decrypt
- **WHEN** the server is stopped, `plugin-credentials.json` decodes, `vault.json` is locked with `key_mismatch`, and the user runs `pi-dashboard credentials decrypt --yes`
- **THEN** neither file is changed, the output names `vault.json` with `key_mismatch`, and the command exits non-zero

### Requirement: Reset command for key loss
`pi-dashboard credentials reset [--vault|--plugin-credentials]` SHALL rename a locked file to `<file>.undecryptable-<stamp>` and keep it, and SHALL require an interactive confirmation or `--yes`. With no flag it SHALL act on both files. With the keychain source, if the keychain holds no key, it SHALL create a new one.

#### Scenario: Reset after key loss
- **WHEN** the server is stopped, `vault.json` is locked with reason `key_missing`, and the user runs `pi-dashboard credentials reset --vault --yes`
- **THEN** the old file is kept as `vault.json.undecryptable-<stamp>`, no `vault.json` exists, and the next account added is written encrypted

#### Scenario: Reset without confirmation refused
- **WHEN** the server is stopped and the user runs `pi-dashboard credentials reset --vault` with no TTY and no `--yes`
- **THEN** the command exits non-zero and `vault.json` is unchanged

### Requirement: Reset leaves unlocked files and never overwrites backups
A file that is not locked (it decrypts, is plaintext, or is absent) SHALL be left untouched and reported as `<basename>: not-locked`, with exit 0 for that file. `<stamp>` SHALL be `YYYYMMDDTHHMMSSZ`, with a `-N` suffix on collision so an earlier `.undecryptable-*` file is never overwritten.

#### Scenario: Reset of a file that is not locked
- **WHEN** the server is stopped, `vault.json` decrypts with the available key, and the user runs `pi-dashboard credentials reset --vault --yes`
- **THEN** the output has the line `vault.json: not-locked`, the file is unchanged, no `.undecryptable-*` file is created, and the exit code is 0

#### Scenario: Reset without a flag acts on both files
- **WHEN** both files are locked and the user runs `pi-dashboard credentials reset --yes`
- **THEN** both files are renamed to `.undecryptable-<stamp>`

#### Scenario: Two resets in one second keep both files
- **WHEN** a locked file is reset, a new locked file appears, and it is reset again within the same second
- **THEN** the second backup gets a `-1` suffix and the first backup is unchanged

### Requirement: Reset refuses a running server and holds the store locks
Before changing any file, `pi-dashboard credentials reset` SHALL query `/api/health` on the configured port like `credentials decrypt`. Any HTTP reply, including `401`, SHALL make it refuse and exit non-zero; it SHALL proceed only when the connection is refused. It SHALL also refuse when the PID file or lock metadata names a live server of this HOME, as `decrypt` does. It SHALL hold both store locks, `plugin-credentials.json` first and then `vault.json`, while it renames.

#### Scenario: Reset refuses a running server
- **WHEN** a dashboard server answers `/api/health` on the configured port and the user runs `pi-dashboard credentials reset --vault --yes`
- **THEN** the command exits non-zero, `vault.json` is unchanged, and no `.undecryptable-*` file is created

#### Scenario: Reset refuses a server of this HOME on another port
- **WHEN** the configured port refuses connections but the PID file names a live dashboard server of this HOME, and the user runs `pi-dashboard credentials reset --vault --yes`
- **THEN** the command exits non-zero, `vault.json` is unchanged, and no `.undecryptable-*` file is created

### Requirement: Reset never creates a key file
With the key-file source, `pi-dashboard credentials reset` SHALL NOT create a key. When the key file is missing or unusable, it SHALL still rename the locked file, print the remedy `openssl rand -base64 32 > <file>; chmod 600 <file>`, and exit non-zero.

#### Scenario: Reset with a missing key file
- **WHEN** the server is stopped, `PI_DASHBOARD_DATA_KEY_FILE` names a missing file, `vault.json` is locked with reason `key_file_missing`, and the user runs `pi-dashboard credentials reset --vault --yes`
- **THEN** the old file is kept as `vault.json.undecryptable-<stamp>`, no key file is created, the output names the `openssl rand -base64 32` remedy, and the command exits non-zero

### Requirement: Decrypt on read stays cheap
Decoding one credential envelope of 2 MiB (the plugin store cap) SHALL take under 50 ms at p95.

#### Scenario: Large envelope decode budget
- **WHEN** a 2 MiB plugin credential envelope is read 200 times
- **THEN** the p95 decode-and-parse time is below 50 ms

### Requirement: Key state is observable without the key
At startup the server SHALL log one line with the key source, key state, reason and key identifier. It SHALL log one line for each credential file that is migrated, locked or refused. The key identifier SHALL be derived by a one-way function and SHALL NOT allow the key to be recovered.

#### Scenario: Startup log on a locked vault
- **WHEN** the server starts with `vault.json` encrypted under a different key
- **THEN** the log has a `[credential-key]` line naming `vault.json` with state `locked` and reason `key_mismatch`
- **AND** no line contains file content or key material
