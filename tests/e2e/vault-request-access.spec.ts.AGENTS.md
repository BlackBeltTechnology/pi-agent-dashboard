# vault-request-access.spec.ts — index

L3 F3 for `add-request-access-remedy`. Credential-free device context (docker-gateway peer, seed trusts `0.0.0.0/0`) opens `/settings/vault`; `vault-operate-required` shows a `data-remedy="request-access"` row; clicking `vault-operate-request-access` lands on `/pair?request` (request-mode landing renders) and issues no `POST /api/pair/request`. Changes no config. See change: add-request-access-remedy.
