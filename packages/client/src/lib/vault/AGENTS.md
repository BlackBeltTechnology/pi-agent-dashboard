# DOX — packages/client/src/lib/vault

Credential-vault client transport.

| File | Purpose |
|------|---------|
| `vault-api.ts` | Client transport for `/api/vault*` and `/api/session/:id/vault-bindings` (`{success,data,error}` envelope), view types, `repoSubject`/`dirSubject`/`describeSubject`. Only values that travel are typed/uploaded ones, upward once. `VaultResult` also carries `code` (envelope `error`) + `remedies` (array only). `call()` reads `getApiBase()` once; `VaultResult.base` = request-start base. See change: add-credential-vault, surface-operate-required-remedy, add-request-access-remedy. `VaultStatus` (+`locked`, `reason`, `writable`), `vaultLock(status)`, `isVaultWriteBlocked(status)`: unknown state counts as locked, never ok. See change: encrypt-credentials-at-rest. |
| `__tests__/vault-api.test.ts` | E14 envelope parsing. F3 `vaultLock` / `isVaultWriteBlocked` (locked, read-only, unknown state never ok). See change: surface-operate-required-remedy, encrypt-credentials-at-rest. |
