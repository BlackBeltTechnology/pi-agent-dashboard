## Why

`add-tailscale-cert-tls` gives the dashboard a native TLS listener, but its only certificate source covers `*.ts.net` names. Other private meshes — ZeroTier, plain LAN, WireGuard, a tailnet without HTTPS enabled — have no name a public CA will sign, so every endpoint on them stays `http://`, is dropped by the pairing gate, and denies phones a secure context. An operator who owns a domain can point a record at a private IP (e.g. `dash.example.com → 10.147.17.5`) and prove control with an ACME **DNS-01** challenge, the only challenge type that works when the CA cannot reach the host.

## What Changes

- Add an **`acme` certificate source** for the native TLS listener: obtains and renews Let's Encrypt (or any RFC 8555 CA) certificates for operator-listed domains using the DNS-01 challenge.
- Two DNS-01 **solvers** in v1:
  - `cloudflare` — creates/removes the `_acme-challenge` TXT record via the Cloudflare API with a scoped token.
  - `acme-dns` — updates a delegated [acme-dns](https://github.com/joohoi/acme-dns) account; works with any DNS provider via a one-time `CNAME _acme-challenge.<domain> → <fulldomain>`.
- Staging-first issuance (`directory: "staging"` default until the operator switches to production) to avoid CA rate limits during setup.
- Solver secrets stored outside `config.json` in a `0600` file keyed by source `id`; APIs report only `configured: true/false`; writes only from authenticated or genuinely-local callers.
- Production certificates are advertisable (`domain` endpoint kind, reach the pairing payload via the prerequisite's wiring); staging certificates are served but never advertised; certificates from other custom directories are advertised only when the operator explicitly sets `advertise: true`.
- Explicit terms-of-service acceptance, 180 s DNS propagation bound, 10 min per-attempt ceiling, 1 h retry floor after CA-side failures.
- Gateway UI: add/remove domains, choose solver, enter credentials, see per-domain status, trigger "issue now".

## Capabilities

### New Capabilities
- `acme-dns01-certificates`: ACME DNS-01 certificate source (domains, solvers, account, staging/production directory, renewal, credential storage, endpoint emission, status).

### Modified Capabilities
None — every listener, lifecycle, SNI and enumeration hook this source needs is defined by `add-tailscale-cert-tls`.

## Impact

- **Depends on**: `add-tailscale-cert-tls` (TLS listener, `CertSource` interface with `advertise`/`kind`/`RetryAfterError`, single-flight `CertManager.trigger`, wildcard SNI, `domain` endpoint kind, `tls` deep-merge, disclosure-gated `/api/health.tls`, pairing wiring). Must land after it; uses those hooks without modifying them.
- **Code**: new `packages/server/src/tls/sources/acme/` (source, solvers, credentials file), `packages/shared/src/config.ts` (`tls.sources[]` acme entry), `packages/server/src/tunnel/tunnel-endpoints.ts`, Gateway UI in `packages/client/`, new auth-gated routes for credential write + "issue now".
- **Dependencies**: `acme-client` (MIT, TS types; deps @peculiar/x509, asn1js, axios, debug, node-forge) — server package only.
- **External calls**: ACME directory (Let's Encrypt), Cloudflare API or acme-dns server, public DNS-over-HTTPS resolver for propagation checks.
- **Test infra**: new overlay `docker/compose.test.acme.yml` layered by `test-up.sh` when `TEST_ACME=1` (Pebble, pebble-challtestsrv, Cloudflare-API shim) + `PI_E2E_SEED`-gated endpoint overrides.
- **Compatibility**: additive; no `acme` source configured → no behaviour change. Rollback = remove the source (and optionally `tls/acme-*` files); the listener keeps serving any other source.

## Discipline Skills

- `security-hardening` — stores third-party API credentials (DNS write access = domain takeover risk): `0600` file, redaction in API/log output, auth-gated write routes, domain-name validation, no credential echo.
- `observability-instrumentation` — new external calls (ACME CA, DNS API, DoH): per-attempt structured log with domain, solver, stage, latency, redacted error; status in `/api/health.tls`.
- `doubt-driven-review` — adding a network-facing dependency (`acme-client`) and a credential store is hard to reverse once operators rely on it.
