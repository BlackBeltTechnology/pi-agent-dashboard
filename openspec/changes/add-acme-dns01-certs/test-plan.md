# Test Plan — add-acme-dns01-certs

Stage: design   Generated: 2026-10-19 (regenerated after 3 doubt-review cycles)

Hard gate passed with no open clarification: every Triple below fills from the spec deltas (`specs/acme-dns01-certificates/spec.md`, `specs/credential-vault/spec.md`), design D1–D12 and the approved mockup (`mockups/gateway-tls.html`).

- Real ACME protocol is exercised at L3 against Pebble, pebble-challtestsrv, a Cloudflare-API shim and an acme-dns double. These run in the docker harness overlay `docker/compose.test.acme.yml`, layered through `TEST_EXTRA_COMPOSE`.
- Unit behaviour is tested at L1 with a mocked `acme-client`, mocked `fetch`/DNS resolver, fake timers and a temp-dir vault.
- No performance budget is specified, so the performance class is intentionally empty.
- The prerequisite's own hooks are tested by `add-tailscale-cert-tls` and not re-tested here: `CertManager` backoff, gate-before-obtain, the attempt-deadline backstop, SNI, pruning and `POST /api/tls/issue` authorization.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | ACME source configuration — domain validation | EP | L1 | automated | domains `dash.example.com`, `*.lab.example.com`, `xn--bcher-kva.example` (valid); `https://dash.example.com:8443`, `10.0.0.5`, `[::1]`, `a.*.example.com`, `*`, `.`, `a..example.com`, `-x.example.com`, `a_b.example.com`, `bücher.example` (invalid) | `PUT /api/tls/acme/home` and `PUT /api/config` with each | valid → 200; each invalid → 400 naming the entry, `config.json` bytes unchanged |
| E2 | ACME source configuration — normalization + count | BVA | L1 | automated | domains `Dash.Example.COM.` + `dash.example.com`; lists of 0, 1, 20, 21 entries | `PUT /api/tls/acme/home` | stored `domains` = `["dash.example.com"]`; 0 → 400; 1 and 20 → 200; 21 → 400 |
| E3 | ACME source configuration — required fields + solver shape | decision-table | L1 | automated | `agreeTos` missing / `false`; duplicate id; `id:"tailscale"`; directory `http://ca.internal/dir`, `https://u:p@ca.internal/dir`; acme-dns `server:"http://auth.example.net"`; acme-dns without `fulldomain`; cloudflare `zoneId:"xyz"`; cloudflare `{type, token:"cf-secret-1234567"}` | `PUT /api/tls/acme/<id>` | each → 400 naming the field; the `token` case names the unknown field and `config.json` never contains `cf-secret-1234567` |
| E4 | ACME source configuration — `configured` ignored | EP | L1 | automated | entry whose solver carries `configured: true` (as projected by `GET /api/config`) | `PUT /api/tls/acme/home` | 200; stored solver has no `configured` key |
| E5 | Advertisement trust classification | decision-table | L1 | automated | directory ∈ {`staging`, `production`, `https://acme-staging-v02.api.letsencrypt.org/directory`, `https://ACME-v02.api.letsencrypt.org/directory/`, `https://pebble.test:14000/dir`} × advertise ∈ {unset, true} | `obtain()` with mocked client | `advertise` F,F,T,T,F,F,T,T,F,T; `details.staging` T,T,F,F,T,T,F,F,F,F; `kind:"domain"` throughout |
| E6 | Advertisement trust classification — re-issue scope | decision-table | L1 | automated | base source (production); variants: directory→staging, advertise toggled, email changed, solver cloudflare→acme-dns, domain added; custom-directory variant with advertise toggled | `configFingerprint("dash.example.com")` | differs for directory change and for the custom-directory advertise toggle; equal for production advertise toggle, email, solver and domain-list changes |
| E7 | DNS-01 issuance — challenge owner + type | EP | L1 | automated | domains `dash.example.com`, `*.example.com`; authorization offering `[http-01, dns-01]`; one offering only `[http-01]` | cloudflare `publish()` / `obtain()` with mocked client | TXT owners `_acme-challenge.dash.example.com` / `_acme-challenge.example.com`; the dns-01 challenge is completed; the http-01-only case fails with "no dns-01 challenge" and no `completeChallenge` |
| E8 | DNS-01 issuance — Cloudflare zone lookup | EP | L1 | automated | zones `example.com`, `sub.example.com`; a source with `zoneId` set | publish for `a.sub.example.com` | `GET /zones?name=a.sub.example.com` then `?name=sub.example.com` (stops on match), POST to the `sub.example.com` zone id; with `zoneId` no `/zones` request at all |
| E9 | DNS-01 issuance — Cloudflare cleanup always | decision-table | L1 | automated | attempt succeeding; attempt failing at validation; second `DELETE` answering 404 | issuance | exactly one `DELETE dns_records/<id>` per published record in both cases; a repeated cleanup treats 404 as success |
| E10 | DNS-01 issuance — acme-dns serialization + deadline start | state-transition | L1 | automated | acme-dns source `a.test`, `b.test`, `c.test`; each order takes 4 min (fake timers) | trigger all three at t=0 | `createOrder` calls start at 0, 4, 8 min; none abandoned; source `attemptTimeoutMs` ≥ 3 × (10 min + 30 s) |
| E11 | ACME account persistence | state-transition | L1 | automated | same dir+email twice; `staging` vs its explicit Let's Encrypt URL; email `Ops@Example.com ` vs `ops@example.com`; last source changes email; last source removed | issue / reconcile | `createAccount` once for each equivalent pair; old key file deleted after email change and after removal; key mode `0o600` |
| E12 | Solver credential storage — vault account | decision-table | L1 | automated | temp-dir vault; save Cloudflare token `cf-secret-1234567890` for `home`, then a second token | `PUT /api/tls/acme/home/credentials` twice | vault holds exactly one account `{kind:"tls-solver", namespace:"tls:home", provider:"cloudflare", label:"cloudflareToken"}` with the second value; `config.json` contains neither token; `vault.json` mode `0o600` |
| E13 | Solver credential storage — API redaction | decision-table | L1 | automated | `home` with saved token `cf-secret-1234567890` | local `GET /api/config`; `/api/health` local and non-local | `solver.configured:true`; token in no response body; non-local health carries no ACME source or domain data |
| E14 | Solver credential storage — route authority + id | decision-table | L1 | automated | callers: vault-manage refused, genuinely local strict-proof; `sourceId` ∈ {`home`, `nope`, `..`, `%2e%2e`, `a/b`} | `PUT /api/tls/acme/<id>/credentials` | refused caller → same status as a vault management route refusal, vault unchanged; `home` → 200 + one `CertManager.trigger("home")`; others → 404 with no vault read or write |
| E15 | Solver credential storage — GC on remove/rename | state-transition | L1 | automated | vault namespaces `tls:home`, `tls:lab`, `user`; then config without `home`; then corrupt `config.json`; then corrupt `vault.json` | reconcile after each | `tls:home` deleted, `tls:lab` and `user` untouched; with corrupt config or corrupt vault no vault write happens |
| E16 | Solver readiness — cache | BVA | L1 | automated | cached `check()` result for `home` | 20 status reads in 60 s; a secret save; time +4:59 and +5:01 with no change | 0 external calls during reads; 1 after save; reads at +4:59 and +5:01 still make 0 calls and report the last result with its `checkedAt` |
| E17 | Solver readiness — CNAME at authoritative servers | EP | L1 | automated | acme-dns source; `_acme-challenge.dash.example.com` missing at the zone's NS but cached-positive at a recursive resolver; wildcard `*.example.com` | `check()` | queries go to the discovered NS addresses only; gate `{ok:false,name:"dash.example.com",hint:"_acme-challenge.dash.example.com CNAME <fulldomain>"}`; wildcard query owner `_acme-challenge.example.com`; `details["checkedAt:dash.example.com"]` set |
| E18 | Solver readiness — gate-blocked names | decision-table | L1 | automated | `home` with (a) no credentials, (b) corrupt vault, (c) CNAME missing for one name | source `readiness()` | (a) `credentials` gate unmet; (b) `credentials` gate unmet with hint naming the credential vault; (c) one name-scoped gate unmet, other name met; in all cases no `fetch` to CA or DNS-provider write |
| E19 | Solver readiness — acme-dns credential check | state-transition | L1 | automated | acme-dns source; mutex free, then held by a running order; `/update` answering 200, then 401 | `check()` | free → one `/update` with the placeholder, 401 → `credentials` gate unmet; held → no `/update` request, last result kept |
| E20 | ACME status reporting — stage | state-transition | L1 | automated | attempt paused in `createOrder`, then propagation pending | detailed status read | `stage:"order"`, then `stage:"propagation"`; after success `stage:"idle"` with `notAfter` |
| E21 | ACME status reporting — next attempt | BVA | L1 | automated | CA marks challenge `invalid` at T for a domain holding no certificate | detailed status read | domain listed with redacted `lastError` and `nextAttemptAt` ≥ T + 1 h |
| E22 | Source editing preserves other sources — per-entry write | state | L1 | automated | stored `tls.sources` `[tailscale, acme home]` | `PUT /api/tls/acme/home` adding `b.example.com` | stored array = unchanged tailscale + updated `home`; `writeConfigPartial` called once |
| E23 | Source editing preserves other sources — stale tab | state-transition | L1 | automated | stored `[tailscale, home]`; tab A holds the old copy; tab B adds acme `lab` | tab A saves `home` via `PUT /api/tls/acme/home`, and both saves race | stored array contains `tailscale`, edited `home` and `lab`; the two writes are serialized on the config save chain |
| E24 | Source editing preserves other sources — corrupt config | EP | L1 | automated | `config.json` = `{not json` | `PUT /api/tls/acme/home`, `DELETE /api/tls/acme/home` | 409; `config.json` bytes unchanged |
| E25 | TLS solver accounts — vault isolation | decision-table | L1 | automated | `tls:home` / `cloudflareToken` account | set it as a binding default; as a grant override; generic `PUT /api/vault/accounts/:id/value`; `DELETE /api/vault/accounts/:id`; plugin read of a binding; delivery snapshot | each mutation refused (account unchanged); plugin read and delivery snapshot never contain the value |
| E26 | Gateway ACME editor — secrets + save order | decision-table | L1 | automated | stored `home` with `configured:true`; a new source `lab` with a typed token where `PUT /api/tls/acme/lab` → 200 and credentials PUT → 500 | open `home` editor; save `lab`; unmount | `home` token input empty and labelled "Saved in the credential vault"; calls in order entry → credentials; `lab` group shows the credentials gate + the error; the token is in no URL, `localStorage` or `sessionStorage`, and the input is empty after unmount |
| E27 | Gateway ACME editor — terms gate + read-only id | EP | L1 | automated | new source with valid fields, `agreeTos` unchecked → checked; existing source `home` | render, tick; open `home` editor | Save disabled with `aria-describedby` reason "Accept the terms to save.", enabled after ticking; `home` id input `readonly` |
| E28 | TLS solver accounts — vault page | EP | L1 | automated | vault with `tls:home` / `cloudflareToken` and a `user` key | render the vault Accounts tab | "TLS certificates" group lists `home` / `cloudflareToken`, "Gateway source home", a Gateway link, no rotate or revoke control, no value |

### Performance

_none — the spec sets no latency, throughput or memory budget._

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | ACME status reporting (rendered) | state-convergence | L3 | automated | Pebble harness overlay, no acme source | add source `pebble` (`directory` = Pebble URL, Cloudflare via shim, `dash.test`) in the Gateway editor, enter the token, Save | the Domain certificates group converges to a `dash.test` row with "Valid · … days left" and a "Not advertised" badge; no rendered text contains the token |
| F2 | Gateway ACME editor — Check now (rendered) | state-convergence | L3 | automated | Pebble overlay, acme-dns source via the acme-dns double, CNAME for `dash.test` absent in challtestsrv | click "Check now" on the CNAME gate; add the CNAME through challtestsrv; click "Check now" again | first click: gate stays with a newer "Checked … ago", no row stage change; second click: gate disappears and the row converges to valid |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | DNS-01 issuance — propagation bound | BVA (fault: delay) | L1 | automated | TXT appears at one of two NS at 175 s / never; second NS never answers (3 s timeout) | issuance with fake timers | 175 s case: `completeChallenge` after 175 s; never case: fails at 180 s naming the lagging NS, no `completeChallenge`, cleanup called; rounds stay 5 s apart despite the hung NS |
| X2 | DNS-01 issuance — DoH fallback | fault-injection (abort) | L1 | automated | direct resolvers reject `ECONNREFUSED`; DoH A returns the value, DoH B not yet, then both | propagation check | proceeds only once both DoH resolvers return the value; `details.propagationMode === "doh-fallback"` |
| X3 | DNS-01 issuance — hung CA abandoned | fault-injection (delay) | L1 | automated | `waitForValidStatus` never settles (Cloudflare source); then the same on an acme-dns source | issuance; +10 min; issue now; then resolve the stale promise | at 10 min: `obtain()` rejects (failed), cleanup called, acme-dns mutex free; issue now → new `createOrder`; the axios interceptor rejects the stale attempt's next poll; stale certificate not stored |
| X4 | DNS-01 issuance — late publish after abort | fault-injection (delay) | L1 | automated | Cloudflare `POST dns_records` resolves at 10 min + 5 s (after the abort) | issuance | one `DELETE dns_records/<late id>` right after the late POST resolves; the ref never reaches the new attempt |
| X5 | DNS-01 issuance — CA failure floor + issue now | BVA | L1 | automated | CA marks challenge `invalid` | +59 min; +60 min; separately `POST /api/tls/issue {sourceId:"home",name:"dash.example.com"}` at +1 min | no automatic attempt at 59 min; attempt at 60 min; the issue route starts one at 1 min |
| X6 | DNS-01 issuance — DNS credential failure | fault-injection (abort) | L1 | automated | Cloudflare API 403 on publish | issuance | `credentials` gate unmet; `RetryAfterError` ≥ 6 h |
| X7 | Solver credential storage — redaction | fault-injection | L1 | automated | DNS API error body echoing the token raw, `%2D`/`%2d` encoded, double-encoded, JSON-escaped, base64 and base64url; `DEBUG=acme-client` set | issuance; capture the server logger + status | none of those forms appears in logs or `lastError`; no request body appears in the captured log |
| X8 | E2E override host guard | fault-injection | L1 | automated | `PI_E2E_SEED=1` with `PI_E2E_CLOUDFLARE_API` = `http://evil.example`, `http://nas` (dot-free), `http://cf-shim.test`; then `PI_E2E_SEED` unset | publish | first two refused with a log line, request goes to `api.cloudflare.com`; `.test` host used; without the seed flag the override is ignored |
| X9 | End-to-end DNS-01, advertised | integration | L3 | automated | overlay, `advertise:true`, `dash.test`, non-loopback bind | issue now, wait for `idle` | handshake to `dash.test:8443` chains to the Pebble root; `/api/tunnel/endpoints` has `{kind:"domain",url:"https://dash.test:8443",tls:true}`; challtestsrv TXT for the owner cleared |
| X10 | Custom directory not advertised | integration | L3 | automated | same overlay, `advertise` unset | issue now | handshake succeeds; URL absent from endpoints and from a minted pairing payload |
| X11 | Switch re-issues | integration | L3 | automated | X10 state held | set `advertise:true` via the Gateway editor Save | a new serial is served and the URL appears in endpoints |
| X12 | Harness teardown removes the overlay | integration | L2 | automated | harness up with `TEST_EXTRA_COMPOSE=compose.test.acme.yml` | run `docker/test-down.sh` with `TEST_EXTRA_COMPOSE` unset | `docker ps -a` for the project lists no pebble, challtestsrv, cf-shim or acme-dns container |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | DNS-01 issuance against Let's Encrypt production | exploratory | — | manual-only | owned domain → ZeroTier IP, Cloudflare token scoped to one zone | staging issuance, then switch to production; pair a phone | [judgment: real CA + real device — browser trusts cert, pairing completes over `https://dash.<domain>:8443`] |
| M2 | acme-dns delegation with a non-Cloudflare DNS host | exploratory | — | manual-only | public acme-dns instance + CNAME at a registrar DNS | issue against staging | [judgment: third-party DNS host behaviour — the CNAME shown in the UI is accepted by the registrar; issuance succeeds] |

---

## Coverage summary

- Requirements covered: 11/11 (acme-dns01-certificates 9, credential-vault 2)
- Scenarios by class: edge 28 · perf 0 · frontend 2 · error 12 · manual 2
- Scenarios by level: L1 35 · L2 1 · L3 6
- Scenarios by disposition: automated 42 · manual-only 2

## New infra needed

- Docker test-harness overlay `docker/compose.test.acme.yml`, layered through the existing `TEST_EXTRA_COMPOSE` hook (`docker/test-up.sh:254-256`). It contains `letsencrypt/pebble`, `letsencrypt/pebble-challtestsrv`, a Cloudflare-API shim and an acme-dns double, with `.test` network aliases and `NODE_EXTRA_CA_CERTS` in the overlay environment.
- `docker/test-down.sh` reads the overlay list from the harness state file and adds `--remove-orphans`.
- `PI_E2E_SEED`-gated overrides `PI_E2E_CLOUDFLARE_API` and `PI_E2E_DNS_AUTHORITATIVE`, restricted to `localhost` / `.test` hosts (design D10).
