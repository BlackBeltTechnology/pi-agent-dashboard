## Context

See proposal.md for the motivation. This is part 3 of 3. It builds on `add-credential-vault` (the foundation) and reuses these of its decisions:
- the store (D1): `~/.pi/dashboard/vault.json`, lock, atomic write, corrupt handling, unknown-field preservation, bindings, grants with overrides, `no-account`;
- routes and authority (D6).

It archives after `add-credential-vault` and `add-vault-llm-delivery`, which already modifies that change's grants requirement. This change therefore *adds* a requirement for service grants rather than modifying the same block a second time.

### Today

- **Store.** `packages/server/src/services/secrets-store.ts` keeps `{ version: 1, secrets: { "<id>/<name>": value } }` in `~/.pi/dashboard/services-secrets.json`.
  - Writes go through `withLockedJsonFile` and `writeJsonAtomic(…, 0o600)` (`secrets-store.ts:82-92`).
  - A corrupt file throws `SecretsCorruptError` naming the latest backup, so every write is refused (`:87`). Non-string values are ignored on read (`:54`).
- **Writers.**
  - `ServiceManager.setSecret` accepts any non-empty string up to 64 KiB, with no minimum length (`service-manager.ts:700-715`).
  - `generate({bytes})` stores `randomBytes(bytes).toString("base64url")` (`secrets-store.ts:108-116`), so 5 bytes or fewer give fewer than 8 characters.
- **Removal.** Removal keeps slots that another definition still references through `store:<id>/<name>` (`service-manager.ts:850-859`). It is refused with 409 while the store is corrupt (`:829-835`).
- **Readers.** The `ServiceManager` (`service-manager.ts:203`), and `service exec`, which builds its own `SecretsStore` (`cli-service.ts:442`).
- **Resolution.** References are `store:`, `env:` and read-only `keychain:` (10 s timeout, no fallback). Values are resolved when the service starts (`ensure`) and delivered by file mounts (OCI) or child env (process).
- **Authority.** Secret writes and imports require `operate` or local trust; the foundation's vault routes use the same rule (its D6).

## Goals / Non-Goals

**Goals:**
- one store for every secret the dashboard holds;
- keys shared between services and sessions without duplicate entry;
- no loss of the current `service-secrets` guarantees;
- rollback through export.

**Non-Goals:**
- changing how or when secrets are delivered to services;
- changing `env:` or `keychain:` resolution;
- a minimum length for service secrets;
- making service secrets visible to sessions or plugins by default.

## Decisions

### D1: One backend at a time, chosen by migration evidence

- **Evidence.** Service secrets live in the vault once any of these exists:
  - the **sentinel** `~/.pi/dashboard/services-secrets.vault`, a dashboard-owned file with no secrets that the dashboard never deletes or offers to delete (a corrupt sentinel still counts);
  - a `service:*` account in a readable vault;
  - a `services-secrets.json.migrated.*` copy.

  When evidence exists without the sentinel (the user deleted it), startup recreates the sentinel; it never flips back to legacy. The sentinel is created by the migration (D3), by `vault import-services` (D6), or at startup when there is no evidence and no legacy file (a fresh install). Creating it never creates `vault.json`.
- **Selection:**

  | Evidence | `vault.json` | `services-secrets.json` | Backend |
  |---|---|---|---|
  | yes | readable or missing | any | **vault**; a missing vault is empty. If `.migrated` copies exist and the vault holds no service secret, the services status warns "vault holds no service secrets — restore with `vault import-services --from <copy>`". A present legacy file is handled by D4 |
  | yes | corrupt | any | **unavailable**: writes refused; `store:` services report `secret-unavailable` naming the vault backup path |
  | no | not corrupt | present | **legacy**; startup migrates it (D3) |
  | no | corrupt | present | **legacy**, not yet migrated; the migration retries once the vault is repaired |
  | no | any | absent | **vault**; startup writes the sentinel |

  Deleting `vault.json` loses everything in it, user keys and service secrets alike. The foundation's backup rules apply, and this change adds only the warning above.
- **Locks.** The order is always **legacy lock, then vault lock**.
  - The migration (D3) and `vault import-services` on `services-secrets.json` hold the legacy lock across their whole read, write, sentinel and rename sequence.
  - Every vault lock call passes `createIfMissing: false` (the default is `true`, `locked-json-file.ts:120,126-131`). Only a write that adds an account may create `vault.json`, as the foundation requires.
- **Legacy reads and writes.**
  - Every legacy read and write takes the legacy lock and checks, inside it, that the sentinel is still absent. If it is not, the operation raises `BackendChanged` instead of reading `{}` (today a missing file reads as `{}`, `secrets-store.ts:48`).
  - `SecretsStore.mutate` also passes `createIfMissing: false`, so it never creates `services-secrets.json`.
  - On `BackendChanged` the caller re-selects once. This tells a changed backend apart from an unset secret, so it is never a fallback for a missing secret.
- **One snapshot per resolution.** The factory gives `ensure` and `service exec` a backend-bound reader that reads all of the service's `store:` secrets in one locked read (`resolveServiceSecrets` today calls `get` per ref, `secrets-resolver.ts:109-113`). One resolution therefore never mixes backends.
- **Factory.** A single `serviceSecretsBackend()` factory serves every reader and writer:
  - the `ServiceManager` (`service-manager.ts:203`);
  - the resolver's store (`secrets-resolver.ts:23`);
  - the routes, `generate`, removal and `ensure`;
  - `service exec` (`cli-service.ts:442`).
- **Ordering.** The migration (D3) runs at startup, before the server accepts service routes or starts services.

### D2: Vault mapping

- **Accounts.** `services-secrets.json["<id>/<name>"]` becomes a vault account with namespace `service:<id>`, provider `service`, kind `key` and label `<name>`. `(namespace, label)` is unique.
- **Writes.** `service secret set` (stdin, never argv), the secret write route and `generate` upsert that account.
- **No minimum length** in the `service:*` namespace, from any source, as today. The foundation's 8-character minimum applies to the `user` namespace.
- **Delivery guard.** The foundation deliberately keeps trivial strings out of the redaction set (minimum 8 characters, measured as string length; `add-credential-vault` design D1), so an account shorter than that is never delivered to a pi session. A binding default or grant override that resolves to one delivers nothing, and the session state shows `too-short`. Services still receive short values; service delivery is not session output.
- **Removal.** Removing a service:
  - deletes its namespace's accounts, except those another definition still references through `store:` (today's `keep` rule);
  - deletes its service-subject grants (D5);
  - applies the foundation's revocation rules to what is deleted: a binding loses that default, and a user grant that overrode to it becomes `no-account` and is listed for repair.

  Removal is refused with 409 while the vault file or the selected backend's file is corrupt, so service grants (which live in the vault) are always removed with the service. The order is: vault grants and vault accounts, then legacy secrets (if legacy is selected), then the definition. A crash midway leaves the service defined, so re-running removal completes it, and a same-id re-add cannot happen in between.
- **Management UI.** The vault page lists `service:*` accounts grouped under "Services", names only.

### D3: Migration

At startup, when the table selects **legacy** and the vault is not corrupt, the migration runs **under the legacy lock**:
1. **Read.** Parse the file. If it is corrupt, or its `secrets` field is missing or not an object (today's store reads that as `{}`, `secrets-store.ts:53`), stop: legacy stays, and the services status reports why.
2. **Vault write.** When there are migratable entries, write them in **one** locked vault write. Skip this step when there are none.
   - If the vault already holds a different value for any of them, stop. Legacy stays, and the services status reports `migration-conflict` with service ids only.
   - Equal values are no-ops.
   - Entries that are not `"<id>/<name>": <string>` are not migrated. Their keys (never values) and count are logged, and they stay in the renamed file.
3. **Sentinel.** Write the sentinel, under its own lock. This is the commit point.
4. **Rename.** Set the file to `0600`, then rename it with an exclusive-create to `services-secrets.json.migrated.<YYYYMMDDTHHMMSSZ>`, with `-<n>` on collision.
   - Copies are kept until the user deletes them, and the services status lists them, and any leftover `services-secrets.json*.tmp`, with a delete action.

**Crashes and concurrency.**
- A crash before step 3: the next start repeats the migration, and step 2 is a no-op for equal values.
- A crash between steps 3 and 4: D4 renames the file at startup, because it equals the vault.
- A second dashboard process waiting on the legacy lock finds the sentinel and stops. An `ENOENT` at rename counts as done.

### D4: Legacy file while service secrets live in the vault

At **startup only**, if `services-secrets.json` exists while evidence exists (D1), it is checked under the legacy lock. Services-status requests only report the result; they never rename.
- **Corrupt.** Detected with a non-quarantining parse (`tryReadJson`, `locked-json-file.ts:267-283`). It is reported as `legacy-file-conflict` (corrupt) and never renamed.
- **Untouched export.** The file's SHA-256 equals `services.lastExportDigest` in the vault, which export records before the file appears (D6). The file is renamed like D3 step 4, whatever the vault holds now, and the digest is cleared.
- **Equal.** The file's migratable entries and the vault's `service:*` values are exactly the same set, with the same values, in both directions. This covers the crash window between D3 steps 3 and 4. The file is renamed like D3 step 4.
- **Otherwise: conflict.** For example, the file was edited on an older version (including deletions), or restored by the user.
  - The vault stays authoritative, and nothing is merged.
  - The services status reports `legacy-file-conflict` until the user runs `vault import-services` (D6) or deletes the file.
  - Later vault changes, including deleting every service secret, do not end the conflict.

### D5: `vault:` references and service grants

- **Resolution.** `vault:<binding>` resolves the value of the named `env` binding only when a grant with subject `service:<serviceId>` exists for it. The account is the grant's override, else the binding's default; it must be a `key` account.
- **Grants.** Service grants are foundation grants with a different subject.
  - They are created and removed through the foundation's grant routes (operate or local trust). The service view offers "Allow vault binding" for each `vault:` reference.
  - Checkout confirmation does not apply.
  - A service grant gives nothing to sessions, and a project grant gives nothing to services.
  - Removing the service deletes its grants, so a re-added service starts with none.
- **Failure.** A missing binding, missing grant, `no-account`, or an `llm`-target or non-`key` binding makes the service `unavailable` with `secret-unavailable`. There is no fallback.
- **When values change.** Values are read at service start. A rotation reaches a running service at its next restart, and the service view shows "restart to apply".

### D6: Rollback, export and import

Both commands are **local CLI only**; there is no HTTP route. Each runs as the OS user that owns `vault.json`, and follows the lock order of D1.

- **`vault export-services`.** A snapshot of the vault's service secrets.
  - **Preconditions.** It refuses unless evidence exists (creating the sentinel if absent) and the vault is readable.
  - **Recording.** It builds the file bytes, records their SHA-256 as `services.lastExportDigest` in the vault, and then writes `services-secrets.json` through the atomic-write module at `0600`. The digest is the only vault change; accounts, bindings and grants are untouched. Because the digest is stored in the secret store, a short secret is never exposed through a hash outside it.
  - **Existing file.** If a `services-secrets.json` exists, it refuses unless `--force` is given. With `--force`, the existing file is first copied to `services-secrets.json.bak.<YYYYMMDDTHHMMSSZ>` (`-<n>` on collision, `0600`, kept until the user deletes it).
  - **Output.** It prints the number of secrets written and the ids of services that use `vault:` references. It never prints a secret value, a secret's `<name>`, or a binding name.
- **`vault import-services [--from <file>] [--force] [--exact]`.**
  - **Source.** `services-secrets.json` by default, under the legacy lock; or any named file, such as a `.migrated` copy.
  - **Refusal.** It refuses when any `service:*` value in the vault differs from the source for the same `(id, name)`, unless `--force` is given. The refusal lists only the affected service ids. With `--force`, the vault values it replaces are first written to `services-secrets.json.vault-backup.<YYYYMMDDTHHMMSSZ>` (`0600`, kept until the user deletes it).
  - **Write.** It inserts or replaces the source's migratable entries in one vault write.
    - With `--exact` it also deletes vault service secrets absent from the source, through the same revocation path as service removal (D2). Bindings lose those defaults, overrides become `no-account`, and sessions are told to withdraw.
  - **Afterwards.** It writes the sentinel if absent, and clears `lastExportDigest`.
    - It renames the source like D3 step 4 only when the source is `services-secrets.json`.
    - A `--from` file is never renamed or deleted.
- **Downgrade guide.** Stop the dashboard, run export, then downgrade.
  - The older version reads the exported file.
  - Services with `vault:` references become unavailable there.
  - A foundation-only version keeps delivering user-created bindings on service accounts without the `too-short` guard, so the guide says to remove those bindings first.
- **Re-upgrade.**
  - An untouched export: D4 renames it away.
  - An edited file: `legacy-file-conflict`, resolved with `vault import-services` (`--exact` to carry deletions over).
- **Restore after a lost vault.** `vault import-services --from <newest .migrated copy>`.

### D7: Collateral dispositions

| Candidate | Disposition |
|---|---|
| `service-secrets`: Service secret store | **MODIFIED**: one backend at a time chosen by migration evidence, migration under the legacy lock, conflict state, no minimum, removal `keep` rule (D1–D4) |
| `service-secrets`: Secret references and resolvers | **MODIFIED**: `vault:` per D5; `store:` per D1 |
| `service-secrets`: Secret sources are explicit | **MODIFIED** scenario wording only: generated values are stored in the service's slot, in whichever backend D1 selects |
| `service-secrets`: Secret values never leave the delivery channel | honoured: export is local-only and prints no value or name; vault routes return names only |
| `service-secrets`: Container / process delivery | unaffected (D5: still at service start) |
| `managed-services`: Adding, updating and removing services | **MODIFIED**: removal keeps secrets another definition references through `store:` (today's code, `service-manager.ts:850-859`, now in the spec) and also removes the service's vault grants (D2, D5) |
| `credential-vault` (foundation): Account storage | **MODIFIED**: service namespace, no minimum there (including migration and `vault import-services`), delivery guard (D1, D2) |
| `credential-vault` (foundation): Non-destructive import of keys | honoured: that import creates `user` accounts only, so its 8-character skip rule is unchanged; service secrets enter only through `service-secrets` writes, the migration and `vault import-services` |
| `credential-vault` (foundation): Plugin read access | honoured: a plugin reads a `service:*` account only through a binding the user created and a plugin approval the user gave |
| `credential-vault` (foundation): Per-project grants | not modified here. The foundation text (and `add-vault-llm-delivery`'s copy of it) states that a grant names a project key or another subject type a vault capability defines; service subjects are this change's ADDED requirement (D5) |
| `credential-delivery` (foundation): Delivery is observable | honoured: the foundation's state set admits states that other vault capabilities define; this change defines `too-short` |
| `docker-packaging`, `nano-banana-*`, `video-production-env`, `document-converter`, `plugin-credential-store`, `bridge-asset-inlining`, `server-openspec-polling`, `model-refresh` | unaffected: lexical matches only; the only readers of `services-secrets.json` are `service-manager.ts:203`, the resolver's injected store (`secrets-resolver.ts:23`) and `cli-service.ts:442` |
| `push-notifications`: Token persistence and lifecycle | unaffected: lexical match (atomic `0600` writes of `push-tokens.json`); not a secret store this change touches |
| `provider-auth-server`: auth.json corrupt-content recovery | unaffected: a parallel pattern on another file; this change reuses the vault's corrupt rule, not auth.json's |
| `managed-services`: CLI and REST consumer contract | honoured: `service secret set` and `service exec` keep their contract; the new commands live under `vault`, not `service` |
| `managed-services`: definitions file, drivers, adoption, probes, runtime detection, `pi.services` offers | unaffected: they do not read secret storage; secrets still arrive at service start |

## Risks / Trade-offs

- **The migration is automatic.** Mitigation: the file is dashboard-owned; the migration commits in one vault write; each original is kept under its own timestamp until the user deletes it; export reverses it.
- **Export is a snapshot.** Rotations made after an export are not in the exported file; the downgrade guide says to stop the dashboard first.
- **A downgrade to a foundation-only version keeps delivering user-created bindings on service accounts, without the `too-short` guard.** The guide says to remove them first.
- **Vault corruption now affects services after migration.** Mitigation: the same byte-exact backup and refuse-write rule; services report `secret-unavailable` with the backup path.
- **Downgrading without export.** Post-migration values are missing on the older version; the pre-migration values remain in `.migrated` until the user deletes them.
- **`vault:` references do not survive a downgrade.** Export lists the affected services.
- **Short service secrets cannot be shared with sessions.** Stated (`too-short`).
- **A rotation reaches a running service only at restart.** Unchanged; the UI hints it.
- **`.migrated`, `.bak` and `.vault-backup` copies hold plaintext values until the user deletes them.** They are owner-only, and listed in the services status with a delete action.

## Migration Plan

Ship after `add-credential-vault` and `add-vault-llm-delivery`. The migration runs on the first start. To roll back, run `pi-dashboard vault export-services`, then downgrade.

## Open Questions

None.
