# DOX — packages/client/src/lib/vault

Credential-vault client transport.

| File | Purpose |
|------|---------|
| `vault-api.ts` | Client transport for `/api/vault*` and `/api/session/:id/vault-bindings` (`{success,data,error}` envelope), view types, `repoSubject`/`dirSubject`/`describeSubject`. Only values that travel are typed/uploaded ones, upward once. See change: add-credential-vault. |
