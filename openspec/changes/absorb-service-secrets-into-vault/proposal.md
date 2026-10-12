## Why

Managed-service secrets live in their own store, `~/.pi/dashboard/services-secrets.json`, separate from the credential vault. A key that a service and a pi session both need, such as a shared `GEMINI_API_KEY`, therefore has to be entered twice and rotated twice. This change is part 3 of 3 and depends on `add-credential-vault`.

## What Changes

- **Storage.** Service secrets become vault `key` accounts in the namespace `service:<serviceId>`. The file-mount (OCI) and child-env (process) delivery channels are unchanged.
- **Automatic one-time migration.** The first start after upgrade moves a valid `services-secrets.json` into the vault and renames the original to `services-secrets.json.migrated` (`0600`). A corrupt source is left in place, and services report `secret-unavailable` as they do today. Migrated values are exempt from the vault's minimum-length rule.
- **References.** `store:<id>/<name>` resolves from the vault. A new `vault:<bindingId>` reference lets a service use an `env` binding, but only when the vault allowlist grants that binding to the subject `service:<serviceId>`. Services get no default access.
- **Isolation.** Service-namespace accounts are never delivered to pi sessions unless the user binds and grants them.
- **Rollback.** `pi-dashboard vault export-services` writes the current `service:*` accounts back to `services-secrets.json`, so rotations made after the migration are not lost. `.migrated` is the fallback if the vault cannot be read.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `service-secrets`: the store moves into the vault through a one-time migration; `store:` resolves from the vault; `vault:<binding>` references require an allowlist grant.

## Impact

- **Server** (`packages/server/src/services/secrets-store.ts`, resolvers, startup migration): the store backend is replaced; a new resolver handles `vault:`.
- **Vault** (from `add-credential-vault`): adds the `service:<id>` namespace and `service:<id>` allowlist subjects.
- **CLI**: adds `vault export-services`. `service secret set` writes to the vault, still reading the value from stdin.
- **Unchanged**: the authority rule (`operate` or local trust), the `configured: boolean` reporting, the explicit source rule, and container and process delivery.
- **Compatibility and rollback**: secret values are unchanged. Rollback uses the export command.

## Discipline Skills

- `doubt-driven-review`: before the migration, which is irreversible once rotated values exist only in the vault.
- `security-hardening`: allowlist enforcement on `vault:` references, and the permissions of the migrated file.
