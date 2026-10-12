## Context

See proposal.md for the motivation. This is part 3 of 3 and depends on the vault store and allowlist from `add-credential-vault` (its D1 and D3).

The current store is `packages/server/src/services/secrets-store.ts`, governed by the spec `service-secrets`. It keys secrets by `<serviceId>/<name>` and uses the shared lock and atomic-write module. It supports `store:`, `env:` and read-only `keychain:` references. Secrets reach services through file mounts (OCI) or the child process environment.

## Goals / Non-Goals

**Goals:**
- One store for every secret the dashboard holds.
- Shared keys between services and sessions without duplicate entry.
- No loss of the current guarantees.

**Non-Goals:**
- Changing how secrets are delivered to services.
- Changing how `keychain:` and `env:` references resolve.
- Making service secrets visible to sessions by default.

## Decisions

### D1: Namespace mapping
`services-secrets.json["<id>/<name>"]` becomes a vault account with namespace `service:<id>`, provider `service`, kind `key` and label `<name>`. Removing a service deletes its namespace.

### D2: Migration
The migration runs once at startup:
1. If `services-secrets.json` exists and parses, every entry is written in a single locked vault write.
2. The original is then renamed to `.migrated` and set to `0600`.
3. The step is idempotent: when `.migrated` exists and the source does not, nothing happens.

If the source is corrupt, it stays in place and the corrupt-file behaviour of `service-secrets` applies until the user resolves it. Migrated and generated values are exempt from the 8-character rule. Per `add-credential-vault` D1, an account shorter than 8 characters can never back a session binding.

### D3: `vault:` references require a service grant
`vault:<bindingId>` resolves only when the allowlist names that binding for the subject `service:<serviceId>`. This keeps the default-deny posture of the session allowlist. An ungranted, missing or `oauth`-backed binding makes the service report `unavailable` with reason `secret-unavailable`. It never falls back to another resolver.

### D4: Rollback without loss
`pi-dashboard vault export-services` writes the current `service:*` accounts back in the `services-secrets.json` format, at `0600`, through the existing lock module. A downgrade guide documents running this command before installing the older version.

## Risks / Trade-offs

- [The migration is automatic] → the file is owned by the dashboard, the original is kept as `.migrated`, and export makes the step reversible.
- [Vault corruption now affects services as well as sessions] → the same byte-exact backup and refuse-write rule; services report `secret-unavailable` with the backup path.

## Migration Plan

Ship after `add-credential-vault`. The migration runs on the first start. To roll back, run `vault export-services` and then downgrade.
