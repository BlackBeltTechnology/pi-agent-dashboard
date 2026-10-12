## MODIFIED Requirements

### Requirement: Service secret store
Service secrets SHALL be stored in exactly one backend at a time, separate from `services.json`, `config.json`, `auth.json` and `plugin-credentials.json`:
- **legacy**: `~/.pi/dashboard/services-secrets.json`, keyed `<serviceId>/<name>`;
- **vault**: `key` accounts in namespace `service:<serviceId>`, labelled `<name>`, in the credential vault (`~/.pi/dashboard/vault.json`, see `credential-vault`).

Service secrets SHALL live in the vault once there is migration evidence: a sentinel file `~/.pi/dashboard/services-secrets.vault` (holding no secret), a `service:*` account in a readable vault, or a `services-secrets.json.migrated.*` copy. The dashboard SHALL create the sentinel on migration, on import, at startup when there is neither evidence nor `services-secrets.json`, and at startup when other evidence exists without it. It SHALL NOT delete it, and SHALL NOT offer to delete it. Creating it SHALL NOT create the vault file. The backend SHALL be selected as follows, read once per `ensure` or `service exec` call:
- with evidence: the vault, treating a missing vault file as empty; when the vault file is corrupt, service secrets SHALL be unavailable — every write SHALL be refused and services that need a `store:` secret SHALL report `secret-unavailable` naming the vault backup path. When `.migrated` copies exist and the vault holds no service secret, the services status SHALL warn and name the restore command;
- without evidence: the legacy file when it exists (a corrupt vault defers the migration until it is repaired); otherwise the vault.

Legacy reads and writes SHALL hold the legacy file's lock and SHALL confirm, inside it, that there is still no sentinel; otherwise they SHALL signal a backend change, and the caller SHALL select again once. A missing secret SHALL never cause a read from the other backend.

Every reader and writer of service secrets — including `service exec` — SHALL use the selected backend, and SHALL NOT fall back to the other backend for a missing secret. The legacy backend SHALL NOT create `services-secrets.json`. The rules below apply to the selected backend's file. Writes SHALL use the shared lock +
atomic-write module with mode `0600`. A corrupt file SHALL be backed up
byte-exact, and **every** write SHALL be refused while the file is corrupt, so
a write can never replace other services' secrets with a fresh file. While the
file is unreadable, services that need a `store:` secret SHALL report
`unavailable` with reason `secret-unavailable`, and `status` SHALL name the
backup path.
Removing a service SHALL delete its stored secrets, except those another service definition still references through `store:`, and SHALL be refused while the selected backend's file or the vault file is corrupt. Service secrets have no minimum length.

**One-time migration.** At startup, before service routes are served or services start, when the legacy file is selected and the vault file is not corrupt, the dashboard SHALL hold the legacy file's lock across these steps; a file that is corrupt, or whose `secrets` field is missing or not an object, SHALL NOT be migrated:
1. when the file has migratable entries, one locked vault write SHALL insert them into the `service:*` namespace, keyed by service id and name (creating the vault file if missing); if the vault already holds a different value for one of them, the migration SHALL stop, the legacy backend SHALL stay selected, and the services status SHALL report `migration-conflict` with service ids only;
2. the sentinel SHALL then be written;
3. the file SHALL then be set to mode `0600` and renamed to `services-secrets.json.migrated.<YYYYMMDDTHHMMSSZ>`, with a `-<n>` suffix if that name exists, so no copy is overwritten.

Entries that are not string values keyed `<id>/<name>` SHALL NOT be migrated; their keys and count, never their values, SHALL be logged. A corrupt file or a corrupt vault SHALL leave the legacy backend selected. Each renamed copy SHALL be kept until the user deletes it; the services status SHALL list each one, and any leftover `services-secrets.json*.tmp` file, and offer to delete them.

**Legacy file while service secrets live in the vault.** At startup, if `services-secrets.json` exists while there is migration evidence (services-status requests SHALL only report, never rename):
- a corrupt file SHALL be reported as `legacy-file-conflict` and SHALL NOT be renamed;
- a file whose SHA-256 equals the digest the last export recorded in the vault SHALL be renamed as in step 3;
- a file whose migratable entries and the vault's `service:*` values are exactly the same set with the same values SHALL be renamed as in step 3;
- otherwise the vault SHALL remain the backend, nothing SHALL be merged automatically, and the services status SHALL report `legacy-file-conflict` until the user imports the file (see `credential-vault`, local import) or deletes it. Later vault changes, including deleting every service secret, SHALL NOT end the conflict.

#### Scenario: Secrets file is owner-only
- **WHEN** a secret is stored
- **THEN** the selected backend's file SHALL have mode `0600`

#### Scenario: Removing a service removes its secrets
- **WHEN** service `neo4j` is removed
- **THEN** no secret of `neo4j` SHALL remain in the selected backend, except one another service references through `store:neo4j/<name>`

#### Scenario: Corrupt store refuses writes
- **WHEN** the selected backend's file is not valid JSON
- **THEN** a secret write SHALL be refused, the corrupt file SHALL be preserved byte-exact, and other services' secrets SHALL NOT be replaced

#### Scenario: Removal keeps a secret another service references
- **WHEN** service `neo4j` is removed while service `app` references `store:neo4j/password`
- **THEN** `neo4j/password` SHALL remain, and every other `neo4j` secret SHALL be deleted

#### Scenario: Legacy store migrated once
- **WHEN** the dashboard starts with no sentinel and a valid `services-secrets.json` containing `obs/password`
- **THEN** the vault SHALL hold account `password` in namespace `service:obs`, and the sentinel SHALL exist
- **AND** one `services-secrets.json.migrated.<timestamp>` SHALL exist with the original bytes and mode `0600`
- **AND** `store:obs/password` SHALL resolve to the same value as before

#### Scenario: Corrupt legacy file keeps today's behaviour
- **WHEN** the dashboard starts with no sentinel and a `services-secrets.json` that is not valid JSON
- **THEN** no migration SHALL happen, a secret write SHALL be refused, the file SHALL be preserved byte-exact, and services that need a `store:` secret SHALL report `secret-unavailable` naming the backup path

#### Scenario: Unreadable vault defers the migration
- **WHEN** the dashboard starts with no sentinel, a valid `services-secrets.json` and a corrupt vault file
- **THEN** the legacy backend SHALL stay selected, and `store:obs/password` SHALL resolve from `services-secrets.json`

#### Scenario: Corrupt vault after migration does not fall back
- **WHEN** the sentinel exists, the vault file is corrupt, no `.migrated` copy exists any more, and a stale `services-secrets.json` is present
- **THEN** a secret write SHALL be refused, the stale file SHALL NOT be used, and services that need a `store:` secret SHALL report `secret-unavailable` naming the vault backup path

#### Scenario: Interrupted migration completes on the next start
- **WHEN** the dashboard stopped after the vault write but before the sentinel was written, and starts again
- **THEN** the migration SHALL complete without a conflict, and the vault SHALL be the backend

#### Scenario: Deleted vault after migration is reported
- **WHEN** the sentinel exists, `vault.json` is missing, and a `.migrated` copy exists
- **THEN** the vault SHALL be the backend, and the services status SHALL warn and name the restore command

#### Scenario: Deleted sentinel does not revive the legacy file
- **WHEN** the vault holds `service:obs` accounts, the user deletes the sentinel, and a stale `services-secrets.json` is present
- **THEN** the vault SHALL remain the backend, the sentinel SHALL be recreated at startup, and the stale file SHALL be reported as `legacy-file-conflict`

#### Scenario: A write racing the migration is not lost
- **WHEN** a legacy secret write waits on the legacy file's lock while the migration holds it
- **THEN** the write SHALL signal a backend change, select again, and store its value in the vault

#### Scenario: Deleted entries on an older version are a conflict
- **WHEN** the sentinel exists and `services-secrets.json` holds the vault's service secrets except `obs/password`
- **THEN** the services status SHALL report `legacy-file-conflict`

#### Scenario: Migration of a file with no migratable entry is not repeated
- **WHEN** the dashboard starts with a valid `services-secrets.json` whose only entry has a non-string value
- **THEN** the sentinel SHALL be written, no vault file SHALL be created, the file SHALL be renamed, and the next start SHALL NOT migrate again

#### Scenario: Conflict survives deleting every service secret
- **WHEN** `legacy-file-conflict` is reported and the user removes every service
- **THEN** the vault SHALL remain the backend, and the legacy file's values SHALL NOT be used

#### Scenario: Fresh install uses the vault
- **WHEN** the dashboard starts with no sentinel, no vault file and no `services-secrets.json`, and a service with a generated secret is added
- **THEN** the sentinel SHALL be written at startup, and the secret SHALL be stored in the vault

#### Scenario: Legacy file reappears after migration
- **WHEN** the sentinel exists and a `services-secrets.json` with a different `obs/password` appears
- **THEN** `store:obs/password` SHALL keep resolving from the vault, and `status` SHALL report `legacy-file-conflict`

#### Scenario: Short secret accepted
- **WHEN** the user sets `obs/pin` to a 5-character value after migration
- **THEN** the value SHALL be stored, and `store:obs/pin` SHALL resolve to it

#### Scenario: service exec reads the selected backend
- **WHEN** the sentinel exists and `pi-dashboard service exec obs -- <cmd>` needs `store:obs/password`
- **THEN** the child process SHALL receive the vault value

### Requirement: Secret sources are explicit
A secret SHALL come from exactly one source:
- **generated**: `generate: { bytes }`, created when the service is added;
- **user-entered**: through the secret write route, or
  `pi-dashboard service secret set <id> <name>` reading the value from stdin and
  never from argv;
- **imported**: through an explicit user action naming the source file.

The dashboard SHALL NOT read third-party configuration files for secrets without
such an action, and SHALL NOT offer any surface that returns a stored secret
value.

#### Scenario: Generated secret on add
- **WHEN** a service whose definition declares `secrets.password.generate` is added
- **THEN** a random value SHALL be stored in the `<id>/password` slot of the selected service-secret backend
- **AND** the add response SHALL report `configured: true` without the value

#### Scenario: CLI secret entry does not use argv
- **WHEN** `pi-dashboard service secret set obs password` runs with the value on stdin
- **THEN** the value SHALL be stored
- **AND** it SHALL NOT appear in any process argv

### Requirement: Secret references and resolvers
A definition SHALL reference secrets as `store:<id>/<name>`, `vault:<binding>`, `env:<NAME>`, or
`keychain:<service>/<account>`. A `store:` reference SHALL resolve from the selected service-secret backend. A `vault:<binding>` reference SHALL resolve the value of the named `env`-target vault binding — the grant's override account, else the binding's default — only when a vault grant with subject `service:<serviceId>` exists for that binding, and only from a `key` account. Secret values SHALL be resolved when the service starts; a changed value SHALL take effect at the service's next start. The `keychain:` resolver SHALL be read-only: on
macOS via `security find-generic-password … -w`, on Linux via
`secret-tool lookup`, both resolved through `ToolRegistry` and run with a 10 s
timeout. The dashboard SHALL NOT write keychain entries. A ref that cannot be
resolved (binary missing, keyring locked, no session bus, unsupported OS,
timeout, missing vault binding, no grant for the service, `no-account`, or a non-`key` or non-`env` binding) SHALL make the service `unavailable` with reason `secret-unavailable`,
and SHALL NOT fall back to another backend.

#### Scenario: Keychain ref on Linux without a session bus
- **WHEN** a service references `keychain:pi-dashboard/obs` and `secret-tool` cannot reach a keyring
- **THEN** `ensure` SHALL report `unavailable` with reason `secret-unavailable`
- **AND** the service-secret backend SHALL NOT be consulted for that secret

#### Scenario: Keychain ref on Windows
- **WHEN** a service references a `keychain:` secret on win32
- **THEN** `ensure` SHALL report `unavailable` with reason `secret-unavailable`

#### Scenario: Service uses a shared vault binding
- **WHEN** a service definition references `vault:GEMINI_API_KEY`, the vault holds that `env` binding backed by a `key` account, and a grant with subject `service:<that service>` exists for it
- **THEN** the service receives that value through its normal delivery channel (file mount or child env)

#### Scenario: Ungranted vault binding
- **WHEN** service `obs` references `vault:GEMINI_API_KEY` and no grant with subject `service:obs` exists for it
- **THEN** `ensure` SHALL report `unavailable` with reason `secret-unavailable`

#### Scenario: Missing vault binding
- **WHEN** a service references `vault:NOPE` and no such binding exists
- **THEN** `ensure` SHALL report `unavailable` with reason `secret-unavailable`

#### Scenario: Rotation reaches a running service at restart
- **WHEN** the account behind a granted `vault:GEMINI_API_KEY` is rotated while service `obs` runs
- **THEN** `obs` keeps the old value until it restarts, and receives the new value at its next start
