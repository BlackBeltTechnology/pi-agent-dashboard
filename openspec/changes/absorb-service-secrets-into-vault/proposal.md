## Why

Managed-service secrets live in their own store, `~/.pi/dashboard/services-secrets.json`, separate from the credential vault. A key that a service and a pi session both need, such as a shared `GEMINI_API_KEY`, therefore has to be entered twice and rotated twice. This change is part 3 of 3 and depends on `add-credential-vault`.

## What Changes

- **Storage.** Service secrets become vault `key` accounts in the namespace `service:<serviceId>`. The file-mount (OCI) and child-env (process) delivery channels are unchanged.
- **One backend at a time.** Migration evidence (a sentinel file with no secrets that the dashboard never deletes, a service account in the vault, or a `.migrated` copy) selects the backend for every reader and writer, including `service exec`. Until migration, today's store and all its rules apply unchanged. After it, a stale legacy file is never used again: a corrupt vault makes service secrets unavailable, and a deleted vault is reported with a restore hint. Fresh installs use the vault.
- **Automatic one-time migration.** The first start after upgrade moves a valid `services-secrets.json` into the vault (refusing to overwrite differing values) and then writes the sentinel. It then renames the original to `services-secrets.json.migrated.<timestamp>` (`0600`, kept until the user deletes it; the services status lists it). A corrupt source or a corrupt vault defers it. A crash leftover is completed automatically; any other legacy file that appears after migration is reported as `legacy-file-conflict`, never merged silently.
- **No minimum length** for service secrets, as today; a value shorter than 8 characters is never delivered to a pi session (`too-short`).
- **References.** `store:<id>/<name>` resolves from the vault. A new `vault:<binding>` reference lets a service use an `env` binding, but only when a vault grant with subject `service:<serviceId>` exists for it. Services get no default access, and values are read at service start, as today.
- **Isolation.** Service-namespace accounts reach pi sessions or plugins only through a binding the user creates plus a project grant (sessions) or plugin approval (plugins). Service grants give nothing to sessions, and are deleted with the service.
- **Rollback.** `pi-dashboard vault export-services` and `import-services` are local CLI only, Export is a read-only snapshot that writes `services-secrets.json` for the older version and never changes the vault, so rotations made after the migration are not lost. On re-upgrade an untouched export (recognised by a digest kept inside the vault) is renamed away; an edited one (including deletions) is reported as a conflict and imported with `vault import-services` (refuse-on-differ, `--force` with a backup, `--exact` to carry deletions, `--from` to restore a `.migrated` copy). Neither command prints a secret. `vault:` references do not survive a downgrade, and export lists the affected services.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `service-secrets`: the store moves into the vault through a one-time migration; `store:` resolves from the vault after migration; `vault:<binding>` references require a service grant.
- `credential-vault` (from `add-credential-vault`; archive after it and after `add-vault-llm-delivery`):
  - MODIFIED "Account storage": the service namespace, the short-value exemption, and the delivery guard;
  - ADDED "Grants to managed services" and "Local export and import of service secrets".
- `managed-services`: removal keeps secrets another definition references (today's code behaviour, now specified) and removes the service's vault grants.

## Impact

- **Server** (`packages/server/src/services/secrets-store.ts`, `service-manager.ts`, `cli-service.ts`, resolvers, startup): a backend factory used by every reader and writer, the startup migration, and a `vault:` resolver.
- **Vault** (from `add-credential-vault`): adds the `service:<id>` namespace, `service:<id>` grant subjects, and the `too-short` delivery guard.
- **CLI**: adds `vault export-services` and `vault import-services`. `service secret set` writes to the selected backend, still reading the value from stdin; `service exec` reads the selected backend.
- **Unchanged**: the authority rule (`operate` or local trust), the `configured: boolean` reporting, the explicit source rule, and container and process delivery.
- **Compatibility and rollback**: secret values are unchanged. Rollback uses the export command.

## Discipline Skills

- `doubt-driven-review`: before the migration, which is irreversible once rotated values exist only in the vault.
- `security-hardening`: service-grant enforcement on `vault:` references, the short-value delivery guard, and the permissions of the migrated and exported files.
