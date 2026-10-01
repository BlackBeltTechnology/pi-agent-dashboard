## 1. Groundwork

- [ ] 1.1 Confirm `add-tailscale-cert-tls` is merged (`CertSource` with `configFingerprint`/`onRemoved`/`details`, `Gate.name`, `CertManager.trigger(sourceId, name?)`, pruning, `domain` endpoint kind present); verify by importing them in a scratch test that type-checks
- [ ] 1.2 Add `acme-client@^5` to `packages/server/package.json` via `pnpm add`; verify `pnpm install` is clean and `import * as acme from "acme-client"` type-checks
- [ ] 1.3 Spike: confirm `acme.axios.defaults.timeout` is honoured by `acme-client@5.4.0` requests (Pebble or a stalled local HTTP server); record the result in design.md D1; verify by the recorded outcome
- [ ] 1.4 Extend `tls.sources[]` with the `acme` entry (`id`, `domains`, `email`, `agreeTos`, `directory`, `advertise?`, `solver`) and its validation (hostname/single-label wildcard, `https://` directory, global id uniqueness, `tailscale` reserved) in `packages/shared/src/config.ts` and the `PUT /api/config` validator; verify by tests 6.1 and 6.2

## 2. Secrets

- [ ] 2.1 Implement `packages/server/src/tls/sources/acme/credentials.ts` (0600, atomic write, keyed by source id, `configured` projection stripped on write, redactor for raw + URL-encoded values, delete-entry); verify by tests 6.11, 6.13 and 6.21
- [ ] 2.2 Add `PUT /api/tls/acme/:sourceId/credentials` gated by `canDiscloseAccessPosture`, invalidating the readiness cache and calling `CertManager.trigger(sourceId)`; verify by test 6.12

## 3. Solvers & DNS

- [ ] 3.1 Implement the `cloudflare` solver (strip `*.`, longest-suffix zone, TXT create/delete in `finally`, `AbortSignal.timeout(30_000)`, `check(domain)`); verify by tests 6.5–6.7 and 6.21
- [ ] 3.2 Implement the `acme-dns` solver (`/update`, no-op cleanup, per-domain CNAME `check` at the `*.`-stripped owner, source-level one-order-at-a-time mutex); verify by tests 6.8 and 6.9
- [ ] 3.3 Implement the propagation checker (NS discovery via DoH, direct authoritative queries via `dns.Resolver`, 5 s poll, 180 s bound, DoH fallback) and the 5 min readiness cache; verify by tests 6.14, 6.16 and 6.17

## 4. ACME source

- [ ] 4.1 Implement account management per (directory, email) with 0600 key and orphan deletion in `onRemoved`/reconcile; verify by test 6.10
- [ ] 4.2 Implement `AcmeCertSource` (`names`, `configFingerprint(name)` excluding the domain list, staged `obtain` with `onStage`, advertisement classification incl. LE URL normalisation, `details`, 30 s axios timeout, 10 min `Promise.race` deadline releasing the slot and running cleanup, `RetryAfterError` 1 h on CA `invalid` and 6 h on DNS 401/403, `onRemoved`); verify by tests 6.3, 6.4, 6.15 and 6.18–6.20
- [ ] 4.3 Add `POST /api/tls/acme/:sourceId/issue` (`{ domain? }` → `CertManager.trigger`) gated by `canDiscloseAccessPosture`; verify by test 6.19

## 5. Harness & UI

- [ ] 5.1 Add `docker/compose.test.acme.yml` (Pebble, pebble-challtestsrv, Cloudflare-API shim), `TEST_ACME=1` layering in `docker/test-up.sh`, and the `PI_E2E_SEED`-gated overrides (`PI_E2E_CLOUDFLARE_API`, `PI_E2E_DNS_AUTHORITATIVE`, `NODE_EXTRA_CA_CERTS`); verify `TEST_ACME=1 docker/test-up.sh` brings up all containers and `docker/test-down.sh` removes them
- [ ] 5.2 Gateway ACME editor in `packages/client/src/components/Gateway/`: domain list, solver picker, write-only secret form, per-domain status/stage/badges, "Issue now", staging→production switch, CT-log/private-IP disclosure note; saves send the full `tls.sources` array; verify by tests 6.22 and 6.23

## 6. Tests (folded from test-plan.md)

- [ ] 6.1 L1 test, domain validation (test-plan #E1): input valid `dash.example.com`, `*.example.com` and invalid `https://dash.example.com:8443`, `10.0.0.5`, `a.*.example.com`, `*.`, `""` · trigger `PUT /api/config` · observable valid → 200, each invalid → 400 naming the entry, file unchanged; harness exemplar `packages/server/src/__tests__/host-gate-config-api.test.ts`
- [ ] 6.2 L1 test, required fields (test-plan #E2): input missing/false `agreeTos`, duplicate id, acme `id:"tailscale"`, `http://` directory · trigger PUT · observable each → 400 naming the field; harness exemplar `packages/server/src/__tests__/host-gate-config-api.test.ts`
- [ ] 6.3 L1 test, advertisement classification (test-plan #E3): input six directory/advertise variants · trigger `obtain()` with mocked client · observable `advertise` F,T,F,T,F,T, `details.staging` T,F,T,F,F,F, `kind:"domain"`; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [ ] 6.4 L1 test, fingerprint scope (test-plan #E4): input base source + five single-field variants · trigger `configFingerprint("dash.example.com")` · observable differs for directory/advertise/solver/email, equal for domain-list change; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [ ] 6.5 L1 test, challenge owner name (test-plan #E5): input `dash.example.com`, `*.example.com` · trigger cloudflare `publish()` with mocked fetch · observable TXT names `_acme-challenge.dash.example.com` / `_acme-challenge.example.com`; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [ ] 6.6 L1 test, zone longest-suffix (test-plan #E6): input zones `example.com`, `sub.example.com` · trigger publish for `a.sub.example.com` · observable POST targets the `sub.example.com` zone id; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [ ] 6.7 L1 test, Cloudflare cleanup always (test-plan #E7): input attempt succeeding / failing at validation · trigger issuance · observable exactly one `DELETE dns_records/<id>` in both; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [ ] 6.8 L1 test, acme-dns readiness (test-plan #E8): input no CNAME for `_acme-challenge.dash.example.com`; wildcard `*.example.com` · trigger `check()` · observable name-scoped gate with the exact CNAME hint; wildcard queries `_acme-challenge.example.com`; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [ ] 6.9 L1 test, acme-dns serialisation (test-plan #E9): input acme-dns source `a.test`, `b.test`, first obtain pending · trigger both · observable second `createOrder` only after the first settles; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [ ] 6.10 L1 test, account persistence (test-plan #E10): input same dir+email twice; different email; last user removed · trigger issue / reconcile · observable `createAccount` once, then twice, then key file gone; key mode 0o600; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [ ] 6.11 L1 test, secret storage and API redaction (test-plan #E11): input secrets for `home` with token `cf-secret-123` · trigger local `GET /api/config`, `/api/health` local and non-local, PUT echoing `configured:false` · observable `configured:true`, token never present, non-local health has no acme info, echoed flag not persisted, secrets file 0o600 keyed `home`; harness exemplar `packages/server/src/__tests__/health-access-grants.test.ts`
- [ ] 6.12 L1 test, secret write access (test-plan #E12): input PUT credentials from non-local unauth vs genuinely local · trigger PUT · observable 403 with file unchanged vs 200 plus one `CertManager.trigger("home")`; harness exemplar `packages/server/src/__tests__/health-access-grants.test.ts`
- [ ] 6.13 L1 test, source removal deletes secrets (test-plan #E13): input entries `home` + `other` · trigger remove `home` + reconcile · observable `home` gone, `other` intact; harness exemplar `packages/server/src/__tests__/config-api.test.ts`
- [ ] 6.14 L1 test, readiness cache BVA (test-plan #E14): input cached result · trigger 20 reads in 60 s, a secret save, then +5 min · observable 0 external calls during reads, 1 after save, 1 after expiry; harness exemplar `packages/server/src/__tests__/provider-health-cache-route.test.ts`
- [ ] 6.15 L1 test, stage reporting (test-plan #E15): input pending propagation · trigger detailed status read · observable `stage:"propagation"`, then `idle` with `notAfter` after success; harness exemplar `packages/server/src/__tests__/health-access-grants.test.ts`
- [ ] 6.16 L1 test, propagation bound BVA (test-plan #X1): input TXT appears at 175 s / never · trigger issuance with fake timers · observable `completeChallenge` after 175 s; fail at 180 s without `completeChallenge` and with cleanup; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [ ] 6.17 L1 test, DoH fallback (test-plan #X2): input direct resolver rejects `ECONNREFUSED` · trigger propagation check · observable DoH endpoints queried and status notes negative-cache risk; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [ ] 6.18 L1 test, hung CA abandoned (test-plan #X3): input `waitForValidStatus` never settles · trigger issuance, +10 min, issue-now, then resolve the stale promise · observable failed/abandoned + cleanup at 10 min, new `createOrder` on issue-now, stale result not stored; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [ ] 6.19 L1 test, CA failure floor + issue-now route (test-plan #X4): input CA marks challenge `invalid` · trigger +59 min, +60 min, and `POST /api/tls/acme/home/issue` at +1 min · observable no auto attempt at 59, attempt at 60, route starts immediately; harness exemplar `packages/server/src/__tests__/system-routes-restart.test.ts`
- [ ] 6.20 L1 test, DNS credential failure (test-plan #X5): input Cloudflare API 403 · trigger issuance · observable `credentials` gate unmet and next auto attempt ≥ 6 h; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [ ] 6.21 L1 test, error redaction (test-plan #X6): input API error body echoing `cf-secret-123` and `cf%2Dsecret%2D123` · trigger issuance, capture logger + status · observable neither string in logs or `lastError`; harness exemplar `packages/server/src/__tests__/ws-upgrade-reject-log.test.ts`
- [ ] 6.22 L1 test, editing preserves other sources (test-plan #E16): input stored `[tailscale, acme home]` · trigger add `b.example.com` and save · observable PUT `tls.sources` has the unchanged tailscale entry + updated `home`; harness exemplar `packages/client/src/components/Gateway/__tests__/GatewayProviderActions.test.tsx`
- [ ] 6.23 L3 test, ACME panel convergence (test-plan #F1): input Pebble harness, source `pebble` for `dash.test` · trigger "Issue now" in the Gateway ACME panel · observable panel converges to `idle` with expiry and a "not advertised" badge, no secret rendered; harness exemplar `tests/e2e/gateway-reserved-name.spec.ts`
- [ ] 6.24 L3 test, end-to-end DNS-01 advertised (test-plan #X7): input Pebble + challtestsrv + shim, `advertise:true`, `dash.test`, non-loopback bind · trigger issue now, wait for `idle` · observable handshake to `dash.test:8443` chains to the Pebble root, `/api/tunnel/endpoints` has `{kind:"domain",url:"https://dash.test:8443",tls:true}`, challtestsrv TXT cleared; harness exemplar `tests/e2e/gateway-readiness-board.spec.ts`
- [ ] 6.25 L3 test, custom directory not advertised (test-plan #X8): input same harness, `advertise` unset · trigger issue now · observable handshake succeeds, URL absent from endpoints and from a minted pairing payload; harness exemplar `tests/e2e/pairing-qr.spec.ts`
- [ ] 6.26 L3 test, switch re-issues (test-plan #X9): input X8 state held · trigger set `advertise:true` via Gateway save · observable new serial served and URL appears in endpoints; harness exemplar `tests/e2e/gateway-readiness-board.spec.ts`

## 7. Docs & manual verification

- [ ] 7.1 Add `packages/server/src/tls/sources/acme/AGENTS.md` rows and `docker/compose.test.acme.yml.AGENTS.md`; delegate `docs/` prose (setup guide: A record → mesh IP, Cloudflare token scope, acme-dns CNAME, staging → production) to DocScribe; verify rows and docs present
- [ ] 7.2 Manual QA against Let's Encrypt production (test-plan: manual-only, #M1): owned domain → ZeroTier IP, Cloudflare token scoped to one zone, staging then production, pair a phone via `https://dash.<domain>:8443`; verify cert trusted and pairing completes
- [ ] 7.3 Manual QA with acme-dns at a non-Cloudflare DNS host (test-plan: manual-only, #M2): create the CNAME the UI shows at a registrar, issue against staging; verify the registrar accepts the record and issuance succeeds
