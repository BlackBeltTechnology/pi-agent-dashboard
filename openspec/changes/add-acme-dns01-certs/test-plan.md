# Test Plan — add-acme-dns01-certs

Stage: design   Generated: 2026-09-28

Clarifications resolved before writing (hard gate): real ACME protocol exercised against Pebble + pebble-challtestsrv + Cloudflare-API shim in the docker test harness (new `compose.test.acme.yml` overlay, L3); unit behaviour at L1 with a mocked `acme-client` and mocked `fetch`/DNS resolver; no performance budget (performance class intentionally empty). Prerequisite hooks (`CertManager`, `TlsCertStore`, pruning, SNI) are tested by `add-tailscale-cert-tls` and not re-tested here.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | ACME source configuration — domain validation | EP | L1 | automated | domains `dash.example.com`, `*.example.com` (valid); `https://dash.example.com:8443`, `10.0.0.5`, `a.*.example.com`, `*.`, `""` (invalid) | `PUT /api/config` | valid → 200; each invalid → 400 naming the entry; file unchanged on 400 |
| E2 | ACME source configuration — required fields | decision-table | L1 | automated | missing `agreeTos`; `agreeTos:false`; duplicate `id`; `id:"tailscale"`; `directory:"http://ca.internal/dir"` | PUT | each → 400 naming the field |
| E3 | Advertisement trust classification | decision-table | L1 | automated | directory ∈ {`staging`, `production`, LE staging URL, LE production URL, `https://pebble.test/dir`, same + `advertise:true`} | `obtain()` with mocked client | `ObtainedCert.advertise` = F, T, F, T, F, T; `details.staging` = T, F, T, F, F, F; `kind:"domain"` in all |
| E4 | Config fingerprint scope | decision-table | L1 | automated | base source; variants changing directory, advertise, solver type, email, domain list | `configFingerprint("dash.example.com")` | changes for the first four; identical for the domain-list change |
| E5 | Challenge owner name | EP | L1 | automated | domains `dash.example.com`, `*.example.com` | cloudflare `publish()` (mocked fetch) | TXT record name `_acme-challenge.dash.example.com` / `_acme-challenge.example.com` |
| E6 | Cloudflare zone longest-suffix | EP | L1 | automated | zones `example.com`, `sub.example.com` | publish for `a.sub.example.com` | POST targets the `sub.example.com` zone id |
| E7 | Cloudflare cleanup always | decision-table | L1 | automated | attempt succeeding; attempt failing at validation | issuance | `DELETE dns_records/<id>` called exactly once in both |
| E8 | acme-dns delegation readiness | EP | L1 | automated | resolver: no CNAME for `_acme-challenge.dash.example.com`; wildcard source `*.example.com` | `check()` | gate `{ok:false,name:"dash.example.com",hint:"_acme-challenge.dash.example.com CNAME <fulldomain>"}`; wildcard queries `_acme-challenge.example.com` |
| E9 | acme-dns one order at a time | state-transition | L1 | automated | acme-dns source with `a.test`, `b.test`; first `obtain` pending | trigger both | second `createOrder` not called until first settles |
| E10 | ACME account persistence | state-transition | L1 | automated | (a) two issuances same dir+email; (b) same dir, different email; (c) remove last source using dir+email | issue / reconcile | (a) `createAccount` once; (b) twice; (c) account key file gone; key mode `0o600` |
| E11 | Solver secret storage & redaction in APIs | decision-table | L1 | automated | secrets saved for `home` (`cloudflareToken:"cf-secret-123"`) | `GET /api/config` (local); `GET /api/health` local and non-local unauth; `PUT /api/config` echoing `configured:false` | config: `solver.configured:true`, no `cf-secret-123`; health local: no token; health non-local: no acme/domain info; echoed `configured` not persisted; secrets file mode `0o600`, keyed `home` |
| E12 | Secret write access | decision-table | L1 | automated | `PUT /api/tls/acme/home/credentials` from non-local unauthenticated vs genuinely local | PUT | non-local → 403, file bytes unchanged; local → 200 and `CertManager.trigger("home")` called once |
| E13 | Source removal deletes secrets | state-transition | L1 | automated | secrets entry `home` present | remove source `home`; reconcile | `onRemoved` removes `home` key from secrets file; other entries intact |
| E14 | Readiness caching | BVA | L1 | automated | cached `check()` result | 20 status reads in 60 s; then secret save; then advance 5 min | 0 fetch/DNS calls during reads; 1 re-check after save; 1 after cache expiry |
| E15 | Status stage reporting | state-transition | L1 | automated | propagation check pending | read detailed status | domain `stage:"propagation"`; after success `stage:"idle"` with `notAfter` set |
| E16 | Source editing preserves other sources | state | L1 | automated | client Gateway ACME editor with stored `sources:[tailscale, acme home]` | add domain `b.example.com` and save | PUT body `tls.sources` = `[tailscale unchanged, home with domains + b.example.com]` |

### Performance

None — no performance requirement (clarification answer).

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | ACME status reporting (rendered) | state-convergence | L3 | automated | Pebble harness; acme source `pebble` for `dash.test` | "Issue now" in Gateway ACME panel | panel converges to stage `idle` with an expiry date and "not advertised" badge (custom directory without `advertise`); never shows a secret value |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Propagation bound | BVA + fault-injection (delay) | L1 | automated | authoritative resolver returns the TXT at 175 s (case a) / never (case b) | issuance (fake timers) | (a) `completeChallenge` called after 175 s; (b) fail at 180 s with `propagation` error, `completeChallenge` not called, cleanup called |
| X2 | Direct DNS blocked → DoH fallback | fault-injection (abort) | L1 | automated | direct `dns.Resolver` query rejects `ECONNREFUSED` | propagation check | DoH endpoints queried; status notes negative-cache risk |
| X3 | Hung CA abandoned | fault-injection (delay) | L1 | automated | mocked `waitForValidStatus` never settles | issuance; advance 10 min; then "issue now"; then resolve the stale promise | at 10 min status failed/abandoned + cleanup called; issue-now starts a new `createOrder`; stale result not written to store |
| X4 | CA validation failure floor | BVA | L1 | automated | CA marks challenge `invalid` | advance 59 min; 60 min; separately "issue now" at 1 min | no auto attempt at 59 min; attempt at 60 min; issue-now at 1 min starts immediately |
| X5 | DNS API credential failure | fault-injection (abort) | L1 | automated | Cloudflare API responds 403 | issuance | gate `credentials` unmet; next auto attempt ≥ 6 h later |
| X6 | Error redaction | fault-injection (abort) | L1 | automated | Cloudflare API error body echoing `cf-secret-123` and `cf%2Dsecret%2D123` | issuance; capture logger + status | neither string appears in log lines or `lastError` |
| X7 | End-to-end DNS-01 issuance, served, advertised when trusted | integration | L3 | automated | Pebble + challtestsrv + shim; acme source `directory: <pebble dir>`, `advertise:true`, domain `dash.test`, listener on non-loopback in container | issue now; wait for `idle` | TLS handshake to `dash.test:8443` presents a cert chaining to Pebble root; `/api/tunnel/endpoints` contains `{kind:"domain",url:"https://dash.test:8443",tls:true}`; challtestsrv TXT for `_acme-challenge.dash.test` cleared |
| X8 | Non-advertised custom directory in real flow | integration | L3 | automated | same harness, `advertise` unset | issue now | handshake succeeds; URL absent from `/api/tunnel/endpoints` and from a minted pairing payload |
| X9 | Switch re-issues in real flow | integration | L3 | automated | X8 state held | set `advertise:true` via Gateway save | a new certificate (different serial) is served and the URL appears in endpoints |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | DNS-01 issuance against Let's Encrypt production | exploratory | — | manual-only | owned domain → ZeroTier IP, Cloudflare token scoped to one zone | staging issuance, then switch to production; pair a phone | [judgment: real CA + real device — browser trusts cert, pairing completes over `https://dash.<domain>:8443`] |
| M2 | acme-dns delegation with a non-Cloudflare DNS host | exploratory | — | manual-only | public acme-dns instance + CNAME at a registrar DNS | issue against staging | [judgment: third-party DNS host behaviour — CNAME guidance matches what the registrar UI accepts; issuance succeeds] |

---

## Coverage summary

- Requirements covered: 7/7
- Scenarios by class: edge 16 · perf 0 · frontend 1 · error 9
- Scenarios by level: L1 22 · L2 0 · L3 4
- Scenarios by disposition: automated 26 · manual-only 2

## New infra needed

- Docker test harness overlay `docker/compose.test.acme.yml` (`letsencrypt/pebble`, `letsencrypt/pebble-challtestsrv`, a Cloudflare-API shim container), layered by `docker/test-up.sh` when `TEST_ACME=1`; `PI_E2E_SEED`-gated overrides (`PI_E2E_CLOUDFLARE_API`, `PI_E2E_DNS_AUTHORITATIVE`, `NODE_EXTRA_CA_CERTS`) — design D10.
