## MODIFIED Requirements

### Requirement: Service secret store
Service secrets SHALL be stored in the credential vault (`~/.pi/dashboard/vault.json`, see `credential-vault`) as `key` accounts in namespace `service:<serviceId>`, named `<name>`.
- **Write path.** Writes SHALL use the vault's lock and atomic-write path with mode `0600`. A corrupt vault file SHALL be backed up byte-exact, and **every** write SHALL be refused while the file is corrupt, so a write can never replace other services' secrets with a fresh file.
- **Unreadable vault.** While the vault file is unreadable, services that need a `store:` secret SHALL report `unavailable` with reason `secret-unavailable`, and `status` SHALL name the backup path.
- **Service removal.** Removing a service SHALL delete its namespace's accounts.
- **Session isolation.** Service-namespace accounts SHALL NOT be delivered to pi sessions unless the user binds them.
- **One-time migration.** On the first start after upgrade, when `~/.pi/dashboard/services-secrets.json` exists and is valid, its entries SHALL be moved into the vault (exempt from the vault's minimum length), and the original SHALL be renamed to `services-secrets.json.migrated` with mode `0600`. When it is corrupt, it SHALL be left in place and services that need its secrets SHALL report `secret-unavailable`.

#### Scenario: Secrets file is owner-only
- **WHEN** a secret is stored
- **THEN** the vault file SHALL have mode `0600`

#### Scenario: Removing a service removes its secrets
- **WHEN** service `neo4j` is removed
- **THEN** no account SHALL remain in namespace `service:neo4j`

#### Scenario: Corrupt store refuses writes
- **WHEN** the vault file is not valid JSON
- **THEN** a secret write SHALL be refused, the corrupt file SHALL be preserved byte-exact, and other services' secrets SHALL NOT be replaced

#### Scenario: Legacy store migrated once
- **WHEN** the dashboard starts with a valid `services-secrets.json` containing `obs/password`
- **THEN** the vault SHALL hold account `password` in namespace `service:obs`
- **AND** `services-secrets.json.migrated` SHALL exist with the original bytes
- **AND** `store:obs/password` SHALL resolve to the same value as before

#### Scenario: Service secrets are not delivered to sessions
- **WHEN** a session starts in a project whose allowlist names no binding of `service:obs`
- **THEN** no `service:obs` secret is delivered to the session

### Requirement: Secret references and resolvers
A definition SHALL reference secrets as `store:<id>/<name>`, `vault:<bindingId>`, `env:<NAME>`, or `keychain:<service>/<account>`.
- **`store:`** SHALL resolve from the vault's `service:<id>` namespace.
- **`vault:`** SHALL resolve the value of the named `env`-target vault binding, only when the vault allowlist grants that binding to subject `service:<serviceId>`. That binding SHALL be backed by a `key` account.
- **`keychain:`** SHALL be read-only:
  - on macOS via `security find-generic-password … -w`;
  - on Linux via `secret-tool lookup`;
  - both resolved through `ToolRegistry` and run with a 10 s timeout.
  - The dashboard SHALL NOT write keychain entries.
- **Unresolvable references.** A reference that cannot be resolved SHALL make the service `unavailable` with reason `secret-unavailable`, and SHALL NOT fall back to another backend. Causes include a missing binary, a locked keyring, no session bus, an unsupported OS, a timeout, a missing vault binding, a binding not granted to the service, or an `oauth`-backed binding.

#### Scenario: Keychain ref on Linux without a session bus
- **WHEN** a service references `keychain:pi-dashboard/obs` and `secret-tool` cannot reach a keyring
- **THEN** `ensure` SHALL report `unavailable` with reason `secret-unavailable`
- **AND** the vault SHALL NOT be consulted for that secret

#### Scenario: Keychain ref on Windows
- **WHEN** a service references a `keychain:` secret on win32
- **THEN** `ensure` SHALL report `unavailable` with reason `secret-unavailable`

#### Scenario: Service uses a shared vault binding
- **WHEN** a service definition references `vault:GEMINI_API_KEY`, the vault holds that `env` binding backed by a `key` account, and the allowlist grants it to `service:<that service>`
- **THEN** the service receives that value through its normal delivery channel (file mount or child env)

#### Scenario: Ungranted vault binding
- **WHEN** service `obs` references `vault:GEMINI_API_KEY` and the allowlist does not grant it to `service:obs`
- **THEN** `ensure` SHALL report `unavailable` with reason `secret-unavailable`

#### Scenario: Missing vault binding
- **WHEN** a service references `vault:NOPE` and no such binding exists
- **THEN** `ensure` SHALL report `unavailable` with reason `secret-unavailable`
