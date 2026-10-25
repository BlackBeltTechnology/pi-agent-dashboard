# DOX — packages/client/src/lib/vault

Credential-vault client transport.

| File | Purpose |
|------|---------|
| `vault-api.ts` | Client transport for `/api/vault*` and `/api/session/:id/vault-bindings` (`{success,data,error}` envelope), view types, `repoSubject`/`dirSubject`/`describeSubject`. Only values that travel are typed/uploaded ones, upward once. `VaultResult` also carries `code` (envelope `error`) + `remedies` (array only). `call()` reads `getApiBase()` once; `VaultResult.base` = request-start base. See change: add-credential-vault, surface-operate-required-remedy, add-request-access-remedy. Carries `trustDetail`. See change: prove-vault-bridge-tls. |
