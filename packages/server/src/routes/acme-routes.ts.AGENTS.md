# acme-routes.ts — index

ACME cert-source routes: `PUT`/`DELETE /api/tls/acme/:sourceId` (replace ONE entry of `tls.sources` on the `runOnConfigSaveChain`; 400 id mismatch / acme-dns `(server,subdomain)` clash / validator; 409 corrupt `config.json`; then reconcile + `acmeGc()`), `PUT /api/tls/acme/:sourceId/credentials` (`createVaultManageGuard`; 404 before vault access; `credentials.save`, readiness invalidate + `refreshReadiness`, `trigger` only if the `credentials` gate was unmet). `operate` tier. See change: add-acme-dns01-certs.

Credentials route: `VaultError` `vault_corrupt`/`vault_locked` → 409; `vault_locked` body `{error,reason,remedy}` (shared remedy, no file content). See change: encrypt-credentials-at-rest.
