# DOX — packages/server/src/tls/sources/acme/solvers

DNS-01 solvers behind the `Dns01Solver` contract (`../types.ts`). See change: add-acme-dns01-certs.

| File | Purpose |
|------|---------|
| `acme-dns.ts` | `createAcmeDnsSolver`: `POST <server>/update` (`X-Api-User`/`X-Api-Key`), no-op cleanup, per-domain CNAME `check` at authoritative servers, placeholder-write `checkCredentials` only with the lock free, module-level FIFO order lock keyed `(server,subdomain)` with `maxWaitMs` → "acme-dns registration busy"; `__resetAcmeDnsLocks`. |
| `cloudflare.ts` | `createCloudflareSolver`: zone by `zoneId` or exact-name `GET /zones?name=` longest suffix first; TXT create (TTL 60) / delete by record id (404 = ok); every fetch 30 s timeout; 401/403 → `onCredentialFailure` + plain redacted error; `check` = token verify + zone (unknown zone → gate `dns-zone`). |
