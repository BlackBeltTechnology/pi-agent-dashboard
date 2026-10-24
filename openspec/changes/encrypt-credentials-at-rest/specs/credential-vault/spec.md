## MODIFIED Requirements

### Requirement: Corrupt vault file is preserved
When the vault file cannot be parsed and is not in the encrypted format, the vault SHALL:
- keep a byte-exact backup;
- refuse every write;
- report bindings as unavailable, with a status that names the backup path.

When the vault file's first line starts with `pi-dashboard-encrypted:` (the encrypted format defined by `credential-at-rest-encryption`) and the file cannot be decrypted or its envelope is damaged, the vault SHALL be locked, not corrupt. A locked vault SHALL:
- keep the file's bytes unchanged and make no backup;
- refuse every write with error `vault_locked`;
- report bindings, delivery, plugin reads and TLS solver secrets as unavailable, and SHALL NOT delete any TLS solver namespace;
- report a status `locked` with its non-secret reason and a remedy.

When no data key is available and the vault file is plaintext, the vault SHALL refuse every write with error `vault_locked` (HTTP 409) carrying the key state's reason and its remedy, and its status SHALL report that the vault is not writable (`writable: false`) with that reason. Reads stay available.

The vault page SHALL disable every write control while the vault is locked or not writable, and SHALL name the reason and the remedy from the shared reason→remedy table (`credential-at-rest-encryption`, "Lock remedies").

No error message or log line SHALL include content from the file.

#### Scenario: Corrupt vault refuses writes
- **WHEN** `vault.json` is not valid JSON and the user adds an account
- **THEN** the write is refused
- **AND** the corrupt file is preserved byte-exact
- **AND** the reported error contains no content from the file

#### Scenario: Locked vault refuses writes and keeps the ciphertext
- **WHEN** `vault.json` is encrypted under a key that is no longer available and the user adds an account
- **THEN** the request is refused with `vault_locked` (HTTP 409)
- **AND** the file's bytes are unchanged and no `.corrupt-*` copy is made

#### Scenario: Plaintext vault without a key is not writable
- **WHEN** `vault.json` is valid plaintext, no data key is available (reason `keychain_unavailable`), and the user adds an account
- **THEN** the request is refused with `vault_locked` (HTTP 409) and the message names `PI_DASHBOARD_DATA_KEY_FILE`
- **AND** the status reports `writable: false` with that reason, the accounts stay listed, and `vault.json` is unchanged

#### Scenario: Vault page shows a not-writable plaintext vault
- **WHEN** the status reports `writable: false` with reason `keychain_unavailable`
- **THEN** the page names the reason and the remedy, and every add, rotate, revoke, grant and delete control is disabled

#### Scenario: Locked vault delivers nothing
- **WHEN** the vault is locked and a granted session requests its vault bindings
- **THEN** the session receives the unavailable outcome and no value

#### Scenario: Vault page shows the locked state
- **WHEN** the vault is locked with reason `key_missing`
- **THEN** the page names the reason and the remedy, and every add, rotate, revoke, grant and delete control is disabled

#### Scenario: Locked vault keeps ACME credentials
- **WHEN** the vault is locked and the ACME garbage collector or a TLS source status runs
- **THEN** the source reports `credential vault unavailable`, no TLS solver namespace is deleted, and no solver secret is read
