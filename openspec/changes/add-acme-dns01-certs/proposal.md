## Why

`add-tailscale-cert-tls` gives the dashboard a native TLS listener, but its only certificate source covers `*.ts.net` names. Other private meshes — ZeroTier, plain LAN, WireGuard, a tailnet without HTTPS enabled — have no name a public CA will sign, so every endpoint on them stays `http://`, is dropped by the pairing gate, and denies phones a secure context. An operator who owns a domain can point a record at a private IP (e.g. `dash.example.com → 10.147.17.5`) and prove control with an ACME **DNS-01** challenge, the only challenge type that works when the CA cannot reach the host.

## What Changes

- Add an **`acme` certificate source** for the native TLS listener: obtains and renews Let's Encrypt (or any RFC 8555 CA) certificates for operator-listed domains using the DNS-01 challenge.
- Two DNS-01 **solvers** in v1:
  - `cloudflare` — creates/removes the `_acme-challenge` TXT record via the Cloudflare API with a scoped token.
  - `acme-dns` — updates a delegated [acme-dns](https://github.com/joohoi/acme-dns) account (`server` over `https://`, `subdomain`, `fulldomain` in config); works with any DNS provider via a one-time `CNAME _acme-challenge.<domain> → <fulldomain>`.
- Staging-first issuance (`directory: "staging"` default until the operator switches to production) to avoid CA rate limits during setup.
- Solver secrets stored in the existing **credential vault** as `tls-solver` accounts in namespace `tls:<sourceId>` (locked, `0600`; not `key`, so never bindable or delivered, even on older builds); APIs report only `configured: true/false`; writes need credential-vault management authority.
- Production certificates are advertisable (`domain` endpoint kind, reach the pairing payload via the prerequisite's wiring); staging certificates are served but never advertised; certificates from other custom directories are advertised only when the operator explicitly sets `advertise: true`.
- Explicit terms-of-service acceptance, 180 s DNS propagation bound, 10 min per-attempt ceiling, 1 h retry floor after CA-side failures.
- Gateway UI: a "Domain certificates" group inside the prerequisite's Built-in HTTPS "Certificates" list — add/remove domains, choose solver, enter write-only credentials, see per-domain status and retry time, recheck DNS delegation and trigger "issue now", both through the prerequisite's `POST /api/tls/issue`. Mockup: `mockups/gateway-tls.html` (shell owned by `add-tailscale-cert-tls/mockups/tls.html`).

## Capabilities

### New Capabilities
- `acme-dns01-certificates`: ACME DNS-01 certificate source (domains, solvers, account, staging/production directory, renewal, credential storage, endpoint emission, status).

### Modified Capabilities
- `credential-vault`: ADDED "TLS solver accounts" (the `tls:<sourceId>` namespace with kind `tls-solver`, never bindable or delivered, listed by name on the vault page); MODIFIED "Account rotation and revocation" (vault rotate/revoke refuse `tls-solver` accounts).

Listener, lifecycle, SNI and enumeration hooks come from `add-tailscale-cert-tls` and are used as its specs state them (design D12).

## Impact

- **Depends on**: `add-tailscale-cert-tls` (TLS listener, `CertSource` interface with `advertise`/`kind`/`RetryAfterError`, single-flight `CertManager.trigger`, wildcard SNI, `domain` endpoint kind, `tls` deep-merge, disclosure-gated `/api/health.tls`, pairing wiring). Must land after it; uses those hooks as specified (design D12). Also depends on the credential vault (archived `add-credential-vault`).
- **Code**: new `packages/server/src/tls/sources/acme/` (source, solvers, vault-backed credentials adapter), `packages/server/src/vault/` (kind `tls-solver`; internal `upsertTlsSecret`/`deleteTlsNamespace`/`readTlsSecret`; a kind check on the generic revoke route), the vault settings page ("TLS certificates" group), the prerequisite's `tls` validator (acme rules), `packages/server/src/config-api.ts` (`readConfigState()`), `packages/shared/src/config.ts` (`tls.sources[]` acme entry), `packages/server/src/tunnel/tunnel-endpoints.ts`, Gateway UI in `packages/client/`, new routes `PUT`/`DELETE /api/tls/acme/:sourceId` (one entry, serialized with other config saves) and `PUT /api/tls/acme/:sourceId/credentials` (vault management authority), all registered in `packages/shared/src/route-tiers.ts` ("issue now" and DNS recheck reuse the prerequisite's `POST /api/tls/issue`).
- **Dependencies**: `acme-client` (MIT, TS types; deps @peculiar/x509, asn1js, axios, debug, node-forge) — server package only.
- **External calls**: ACME directory (Let's Encrypt), Cloudflare API or acme-dns server, public DNS-over-HTTPS resolver for propagation checks.
- **Test infra**: new overlay `docker/compose.test.acme.yml` layered through the existing `TEST_EXTRA_COMPOSE` hook (Pebble, pebble-challtestsrv, Cloudflare-API shim); `docker/test-down.sh` tears overlays down (`--remove-orphans`); `PI_E2E_SEED`-gated endpoint overrides restricted to local/test hosts.
- **Compatibility**: additive; no `acme` source configured → no behaviour change. Rollback = remove the source (reconcile deletes its certificates, `tls:<id>` vault accounts and orphaned account keys); the listener keeps serving any other source.

## Discipline Skills

- `security-hardening` — stores third-party API credentials (DNS write access = domain takeover risk): credential vault (`tls:*` namespace, never bindable), redaction in API/log output, `operate`-tier write route with `sourceId` validation, domain-name validation, no credential echo, e2e override URLs restricted to local/test hosts.
- `observability-instrumentation` — new external calls (ACME CA, DNS API, DoH): per-attempt structured log with domain, solver, stage, latency, redacted error; status in `/api/health.tls`.
- `doubt-driven-review` — adding a network-facing dependency (`acme-client`) and a credential store is hard to reverse once operators rely on it.
