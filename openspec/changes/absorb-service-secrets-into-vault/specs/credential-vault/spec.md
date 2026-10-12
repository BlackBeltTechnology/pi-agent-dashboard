## ADDED Requirements

### Requirement: Grants to managed services
A grant MAY name the subject `service:<serviceId>` instead of a project key.
- **Effect.** Such a grant SHALL make the binding available to that service's `vault:` references only (see `service-secrets`), SHALL follow the same override and `no-account` rules as project grants, and SHALL need no checkout confirmation.
- **Isolation.** A service grant SHALL NOT deliver anything to a pi session, and a project grant SHALL NOT make a binding available to a service.
- **Management.** Service grants SHALL be created and removed through the vault's grant management, under its authority rules.
- **Removal.** Removing a service SHALL delete its service grants.

#### Scenario: Service grant does not reach sessions
- **WHEN** binding `GEMINI_API_KEY` is granted only to subject `service:obs`
- **THEN** service `obs` can resolve `vault:GEMINI_API_KEY`, and no pi session receives it

#### Scenario: Project grant does not reach services
- **WHEN** binding `GEMINI_API_KEY` is granted only to a project
- **THEN** service `obs` referencing `vault:GEMINI_API_KEY` reports `secret-unavailable`

#### Scenario: Re-added service starts without grants
- **WHEN** service `obs` with a grant for `GEMINI_API_KEY` is removed and added again
- **THEN** `obs` has no service grant, and `vault:GEMINI_API_KEY` reports `secret-unavailable`

### Requirement: Local export and import of service secrets
`pi-dashboard vault export-services` and `pi-dashboard vault import-services` SHALL be available only as local commands, never as HTTP routes, and SHALL take the vault lock for their vault access.

Export SHALL be a read-only snapshot:
- it SHALL refuse unless service secrets live in the vault and the vault is readable, and SHALL NOT change accounts, bindings or grants;
- it SHALL record the SHA-256 of the bytes it is about to write as the vault's last-export digest, and then write them to `~/.pi/dashboard/services-secrets.json` through the atomic-write module with mode `0600`;
- it SHALL refuse when that file exists, unless `--force` is given, in which case the existing file SHALL first be copied byte-exact to `services-secrets.json.bak.<YYYYMMDDTHHMMSSZ>` (with a `-<n>` suffix on collision) with mode `0600`;
- it SHALL print only the number of secrets written and the ids of services that use `vault:` references; it SHALL NOT print any secret value, secret name or binding name.

Import SHALL read `services-secrets.json`, or a file named with `--from`:
- it SHALL refuse, listing only the affected service ids, when any `service:*` value in the vault differs from the source's value for the same service and name, unless `--force` is given, in which case the replaced vault values SHALL first be written to `services-secrets.json.vault-backup.<YYYYMMDDTHHMMSSZ>` with mode `0600`;
- it SHALL insert or replace the source's migratable entries in one vault write, and SHALL delete vault service secrets absent from the source only when `--exact` is given, applying the vault's revocation rules to each deleted account;
- it SHALL then create the service-secret sentinel if absent, and clear the last-export digest;
- it SHALL rename the source as the migration does only when the source is `services-secrets.json`; a `--from` file SHALL NOT be renamed or deleted.

Backup and renamed copies SHALL be kept until the user deletes them, and the services status SHALL list them.

#### Scenario: Export prints no secret and leaves the vault unchanged
- **WHEN** the user runs `pi-dashboard vault export-services` with two service secrets in the vault
- **THEN** `services-secrets.json` holds both with mode `0600`, the vault's accounts, bindings and grants are unchanged, and stdout contains the count and no secret value or name

#### Scenario: Export does not overwrite without force
- **WHEN** `services-secrets.json` already exists and the user runs export without `--force`
- **THEN** export refuses, and the file is unchanged

#### Scenario: Unused export is renamed away even after a rotation
- **WHEN** the user exports, keeps the same version running, rotates `obs/password`, and restarts without touching the exported file
- **THEN** startup renames the file to a `.migrated` copy, no conflict is reported, and `store:obs/password` resolves to the rotated value

#### Scenario: Import does not discard a later rotation
- **WHEN** the vault holds `obs/password` and the user runs `pi-dashboard vault import-services` with a file holding a different value
- **THEN** import refuses and names `obs`, and the vault is unchanged

#### Scenario: Re-upgrade after an edit on the older version
- **WHEN** the user exports, downgrades, changes `obs/password` with the older version, upgrades again, and runs `pi-dashboard vault import-services --force`
- **THEN** `store:obs/password` resolves to the changed value, and the replaced vault value is in a `.vault-backup` copy

#### Scenario: Restore from a migrated copy keeps the copy
- **WHEN** `vault.json` was deleted and the user runs `pi-dashboard vault import-services --from services-secrets.json.migrated.<timestamp>`
- **THEN** the vault holds the copy's secrets, the sentinel exists, and the copy is unchanged

## MODIFIED Requirements

### Requirement: Account storage
The vault SHALL store credentials as accounts. Each account has a stable id, a provider, a kind, a user-visible label and a namespace. Accounts created through this capability have kind `key` and namespace `user`; managed-service secrets are `key` accounts in namespace `service:<serviceId>` (see `service-secrets`). The vault SHALL allow more than one account for the same provider.

The vault file SHALL be `~/.pi/dashboard/vault.json`. It SHALL be:
- owner-only: mode `0600` on POSIX; on Windows, owner-only as observed against the platform's access control;
- written atomically under a lock;
- not created until the first account is added.

Updates SHALL preserve fields, account kinds and namespaces that the running version does not recognise. The vault SHALL reject a value shorter than 8 characters, whether it was entered or imported, except in the `service:*` namespace, which has no minimum from any source (service-secret writes, the service-secret migration and `vault import-services`); key import creates `user` accounts only. An account whose value is shorter than 8 characters SHALL never be delivered to a pi session: a binding default or grant override that resolves to one SHALL deliver nothing, and the session's binding state SHALL show `too-short`.

#### Scenario: Two accounts for the same provider coexist
- **WHEN** the user adds a `key` account labelled "personal" and a second `key` account labelled "work", both for provider `gemini`
- **THEN** the vault lists two distinct accounts, each with its own id and label

#### Scenario: Vault file permissions
- **WHEN** the first account is added on POSIX
- **THEN** `~/.pi/dashboard/vault.json` exists with mode `0600`

#### Scenario: No file before the first account
- **WHEN** the dashboard starts with no accounts and the user only views the vault page
- **THEN** no vault file is created

#### Scenario: Concurrent writes do not lose updates
- **WHEN** two account additions are submitted concurrently
- **THEN** both accounts are present after both requests complete

#### Scenario: Too-short value rejected
- **WHEN** the user adds a `key` account in namespace `user` whose value is 5 characters long
- **THEN** the request is rejected with a validation error and nothing is stored

#### Scenario: Unknown data survives an update
- **WHEN** the vault file contains an account of a kind this version does not know, and the user adds a `key` account
- **THEN** the unknown account is still present, unchanged, after the write

#### Scenario: Short service secret is never delivered to a session
- **WHEN** env binding `OBS_PIN` defaults to a 6-character `service:obs` account, and a project grant includes `OBS_PIN`
- **THEN** sessions in that project do not receive `OBS_PIN`, and its state is `too-short`
