## 1. Groundwork

- [x] 1.1 Confirm `add-tailscale-cert-tls` is merged with the behaviours listed in design D12. Check for:
  - `registerCertSourceType({ type, defaultId?, validate, create })` and the common id rule;
  - `CertSource` with `names()` (`string[] | null`), `configFingerprint(name)`, `readiness({ force })` + source `details`, `attemptTimeoutMs`, `onReconciled`, `onRemoved`;
  - `Gate.name`; gate-before-obtain without counting a failure and its 15-min re-check;
  - abandonment on `attemptTimeoutMs`; reconcile rebuilding instances;
  - status listing every produced name with `nextAttemptAt` and `stage`;
  - status reading the manager's last readiness result, never calling `readiness()` (request R1 — if absent, raise it before 3.3);
  - the enable switch not overwriting a non-empty stored `sources` list (R3), in-flight attempts discarded before a removed source's directory is deleted (R4), and a defined name → directory encoding that handles `*` (R5) — if any is absent, stop and raise it before 4.3;
  - `CertManager.trigger(sourceId, name?)`; `POST /api/tls/issue` with its `route-tiers.ts` row;
  - the `invalid-source` gate, the `domain` endpoint kind, `registerTlsSourceGroup` and the shared cert row component.

  Verify by importing them in a scratch test that type-checks.
- [x] 1.2 Add `acme-client@^5` to `packages/server/package.json` via `pnpm add` (pinned minor); verify `pnpm install` is clean and `import * as acme from "acme-client"` type-checks.
- [x] 1.3 Spike and record the results in design.md D1/D2/D10. Items to check:
  - `acme.axios.defaults.timeout` is honoured;
  - a request interceptor on `acme.axios` sees internal polls and 5xx/429 retries, and an `AsyncLocalStorage` context set around the attempt body is visible inside it for those requests;
  - `setLogger` exists and the library logs no bodies;
  - the low-level path does not pick the challenge type;
  - Cloudflare token scope for zone lookup, and the verify path for account-owned tokens;
  - acme-dns `/register` + `/update` request shape;
  - challtestsrv `/set-txt` / `/clear-txt` per-host semantics.

  Verify by the recorded outcomes.
- [x] 1.4 Add the `acme` entry type to `packages/shared/src/config.ts` with this shape: `id`, `domains`, `email`, `agreeTos`, `directory`, `advertise?`, and `solver` as either cloudflare + optional `zoneId`, or acme-dns `server`/`subdomain`/`fulldomain`. Add a pure `normalizeAcmeEntry(entry)` and register the type with `registerCertSourceType({ type: "acme", validate, create })` (no `defaultId`). `validate()` checks the normalized copy; `create()` builds from it. The id rule, uniqueness and `tailscale` reservation stay with the prerequisite. Rules:
  - normalization: lowercase, trailing dot stripped, dedupe;
  - 1–20 LDH/`xn--` names, single-label wildcard;
  - canonical `https://` directory with no userinfo, Let's Encrypt URLs mapped to keywords;
  - acme-dns `https` server;
  - `configured` stripped before the per-type solver field allowlist.

  Verify by tests 6.1–6.4.
- [x] 1.5 Add `readConfigState(): { state: "absent" | "ok" | "corrupt", raw }` to `packages/server/src/config-api.ts` (no change to `writeConfigPartial`); verify by tests 6.15 and 6.24.

## 2. Vault-backed secrets

- [x] 2.1 Add the `tls-solver` account kind to `packages/server/src/vault/vault-store.ts` with internal `upsertTlsSecrets({sourceId, provider, entries:[{label, value}]})` (one locked update; per label lookup by `(namespace,label)`, rotate-or-add; all labels or none), `deleteTlsNamespace(sourceId)` and `readTlsSecret(sourceId, label)`. Keep the 8-char minimum. Verify by tests 6.12, 6.15 and 6.45.
- [x] 2.2 Make the generic revoke path (`vault-grants.ts` `revokeAccount`, `DELETE /api/vault/accounts/:id`) answer 409 for `tls-solver` accounts. Confirm the existing `kind === "key"` checks already refuse them for binding default, grant override, rotate, delivery and plugin read. Verify by test 6.25.
- [x] 2.3 Add `packages/server/src/tls/sources/acme/credentials.ts`: a vault adapter with a `configured` projection for `GET /api/config` (true only when every label the solver type needs is present), and a redactor covering raw, case-insensitive percent-encoded (single and double), JSON-escaped, base64 and base64url forms plus the `Authorization`/`X-Api-Key`/`X-Api-User` headers and `token=`. Verify by tests 6.13, 6.37 and 6.45.
- [x] 2.4 Add `PUT /api/tls/acme/:sourceId/credentials`:
  - guarded by `canManageVault` (`packages/server/src/vault/vault-routes.ts:119`);
  - `ROUTE_TIERS` row `{ method: "PUT", path: "/api/tls/acme/:sourceId/credentials", tier: "operate" }`;
  - `:sourceId` validated against configured acme ids, 404 before any vault access;
  - body limited to the solver's fields;
  - writes via `upsertTlsSecrets`, then invalidates readiness and forces a refresh; calls `CertManager.trigger(sourceId)` only when the `credentials` gate was unmet before the save.

  Verify by tests 6.14 and 6.44.
- [x] 2.5 Add `acmeGc()`: delete `tls:<id>` namespaces and `acme-account-*.key` files with no configured acme source, only when `readConfigState()` is `ok` and the vault status is healthy; coalesce concurrent runs. Call it from `onReconciled()`, from `onRemoved()` and once at acme type registration (server start). Verify by tests 6.11 and 6.15.

## 3. Solvers & DNS

- [x] 3.1 Implement the `cloudflare` solver:
  - strip `*.`;
  - use `zoneId`, else query exact-name `GET /zones?name=` per suffix, longest first;
  - TXT create/delete in `finally`, delete by record id, idempotent on 404;
  - `AbortSignal.timeout(30_000)`;
  - `check(domain)` = token verify + zone; an unknown zone → name-scoped `dns-zone` gate;
  - a 401/403 from publish marks the `credentials` gate unmet in the readiness cache and throws a plain (counted) error.

  Verify by tests 6.7–6.9, 6.36 and 6.50.
- [x] 3.2 Implement the `acme-dns` solver:
  - `/update` with `X-Api-User`/`X-Api-Key`, no-op cleanup;
  - per-domain CNAME `check` at the `*.`-stripped owner against the zone's authoritative servers;
  - credential check with the placeholder `/update` only after a credentials save or a forced refresh, and only after acquiring the free lock;
  - one-non-aborted-order lock released on abort, held in a module-level map keyed by `(server, subdomain)` so it survives instance rebuilds and is shared by sources using one registration;
  - queue allowance `attemptTimeoutMs − 10.5 min`: past it `obtain()` rejects "registration busy" with no CA/DNS call; on acquiring the lock, re-check generation and removal flag.

  Verify by tests 6.10, 6.17, 6.19 and 6.46.
- [x] 3.3 Implement DNS discovery and propagation:
  - SOA walk + NS names + NS address resolution over DoH;
  - for acme-dns, use the zone of `fulldomain`;
  - per-server `dns.Resolver` with `{timeout:3000, tries:1}`, 5 s rounds, 180 s bound, lagging server named in the error;
  - fallback to both DoH resolvers, marked `details.propagationMode`;
  - 5 min readiness cache per `(sourceId, domain)` with `details["checkedAt:<domain>"]`: `readiness({force:true})` re-runs all, unforced re-runs only entries older than 5 min, nothing on the status path;
  - check errors (timeout, 5xx, network) keep the last result with hint "check failed: <reason>"; no last result → gate unmet with that hint.

  Verify by tests 6.16, 6.17, 6.31, 6.32, 6.43 and 6.50.

## 4. ACME source

- [x] 4.1 Implement account management per (canonical directory, lowercase trimmed email): ECDSA P-256 key at `acme-account-<sha256[:32]>.key`, `0600`, atomic write; orphaned keys removed by `acmeGc()` (2.5). Verify by test 6.11.
- [x] 4.2 Implement `AcmeCertSource`:
  - `names()` = normalized domains, never `null`;
  - `configFingerprint(name)` = canonical directory + effective advertise + name;
  - `onReconciled()` → `acmeGc()`; `onRemoved()` sets the removal flag, aborts in-flight attempts, then `acmeGc()`; account keys written only while the flag is clear;
  - `readiness()` returning `credentials` / CNAME / `dns-zone` gates + `details` (`directory`, `staging`, `solverType` from config, last `propagationMode`, `checkedAt:<domain>`);
  - staged `obtain` with `onStage` (`order` → `dns-publish` → `propagation` → `validation` → `finalize`) and dns-01 challenge selection;
  - classification against the two Let's Encrypt URLs;
  - `details`;
  - 30 s axios timeout;
  - 10 min source deadline starting after the lock wait, with an abort generation held in `AsyncLocalStorage`, checked per step and by an `acme.axios` request interceptor; late-publish cleanup and late-result discard;
  - `attemptTimeoutMs` backstop: 10.5 min for Cloudflare, × `domains.length` for acme-dns;
  - `RetryAfterError` 1 h on CA `invalid`; DNS 401/403 → plain error + `credentials` gate (3.1);
  - `acme.setLogger` no-op.

  Verify by tests 6.5–6.7, 6.10, 6.18, 6.20, 6.21, 6.33–6.37, 6.39–6.41, 6.47 and 6.48.
- [x] 4.3 Add `PUT /api/tls/acme/:sourceId` (upsert one acme entry) and `DELETE /api/tls/acme/:sourceId`:
  - store `normalizeAcmeEntry(body)` and run the prerequisite's `tls` validator over the merged `tls.sources`;
  - 400 when the body `id` differs from `:sourceId`, or another acme source already uses the same acme-dns `(server, subdomain)`;
  - 409 when `readConfigState()` is `corrupt`;
  - replace only that entry in `tls.sources`, write via `writeConfigPartial` on the `configSaveTail` chain (`packages/server/src/routes/system-routes.ts:123-155`), then the prerequisite's reconcile;
  - `ROUTE_TIERS` `operate` rows for both.

  Verify by tests 6.1–6.4 and 6.22–6.24.
- [x] 4.4 Wire the E2E overrides `PI_E2E_CLOUDFLARE_API` and `PI_E2E_DNS_AUTHORITATIVE`: honoured only with `PI_E2E_SEED=1` and a `localhost` / `.test` host, otherwise log the refusal and ignore. Verify by test 6.38.

## 5. Harness & UI

- [x] 5.1 Add `docker/compose.test.acme.yml` and the teardown changes:
  - overlay services: Pebble, pebble-challtestsrv, Cloudflare-API shim keeping per-host record sets, and an acme-dns double;
  - `.test` network aliases;
  - `NODE_EXTRA_CA_CERTS` in the overlay env;
  - `docker/test-up.sh` records the `TEST_EXTRA_COMPOSE` overlay list in the harness state file;
  - `docker/test-down.sh` reads it and adds `--remove-orphans`; with the state file absent or unreadable it includes every `docker/compose.test.*.yml` and logs the fallback.

  Verify by test 6.42 and `TEST_EXTRA_COMPOSE=compose.test.acme.yml docker/test-up.sh` bringing up all containers.
- [x] 5.2 Add the Gateway "Domain certificates" group in `packages/client/src/components/Gateway/` (new `GatewayAcmeSource.tsx`, registered with `registerTlsSourceGroup("acme", GatewayAcmeSource)`, reusing the prerequisite's cert row and `POST /api/tls/issue` action), per `mockups/gateway-tls.html` states B1–B11 and C1–C2 (design D11). It includes:
  - group gates: credentials; per-name CNAME record + Copy + Check now + check time;
  - row badges, stage steps and the retry ETA;
  - the Let's Encrypt failed-validation note after a CA `invalid`;
  - "Renewal blocked: <gate>" warning with the expiry date when a held certificate is due and a gate for its name is unmet;
  - the editor: domain list, solver cards, Cloudflare optional zone id, acme-dns server/subdomain/fulldomain, write-only secret fields cleared on success/cancel/unmount, directory cards, staging→production consequence, CT-log/private-IP disclosure, terms-gated Save, `id` read-only after the first save;
  - save order `PUT /api/tls/acme/:id` → credentials; Remove = `DELETE`;
  - stage values mapped to step labels (unknown → the prerequisite's "Working…");
  - the Accessible-at staging note (Domain pill = the prerequisite's neutral chip); copy says pairing, never sign in.

  Verify by tests 6.26, 6.27, 6.29, 6.30 and 6.49.
- [x] 5.3 Add the vault Accounts tab "TLS certificates" group in `packages/client/src/components/settings/vault/`: names only, "Gateway source `<id>`", a Gateway link, no rotate/revoke controls. Verify by test 6.28.

## 6. Tests (folded from test-plan.md)

- [x] 6.1 L1 test, domain validation (test-plan #E1): input valid `dash.example.com`, `*.lab.example.com`, `xn--bcher-kva.example`; invalid `https://dash.example.com:8443`, `10.0.0.5`, `[::1]`, `a.*.example.com`, `*`, `.`, `a..example.com`, `-x.example.com`, `a_b.example.com`, `bücher.example` · trigger `PUT /api/tls/acme/home` and `PUT /api/config` with each · observable valid → 200, each invalid → 400 naming the entry, `config.json` bytes unchanged; harness exemplar `packages/server/src/__tests__/host-gate-config-api.test.ts`
- [x] 6.2 L1 test, normalization + count (test-plan #E2): input domains `Dash.Example.COM.` + `dash.example.com`; lists of 0, 1, 20, 21 entries · trigger `PUT /api/tls/acme/home` · observable stored `["dash.example.com"]`; 0 → 400, 1 and 20 → 200, 21 → 400; harness exemplar `packages/server/src/__tests__/host-gate-config-api.test.ts`
- [x] 6.3 L1 test, required fields + solver shape (test-plan #E3): input missing/false `agreeTos`, duplicate id, `id:"tailscale"`, `http://` and userinfo directories, acme-dns `http://` server, acme-dns without `fulldomain`, bad `zoneId`, cloudflare solver with `token`, body `id` ≠ path id, second acme-dns source on `home`'s `(server, subdomain)` · trigger `PUT /api/tls/acme/<id>` · observable each → 400 naming the field; `config.json` never contains the token; harness exemplar `packages/server/src/__tests__/host-gate-config-api.test.ts`
- [x] 6.4 L1 test, `configured` ignored (test-plan #E4): input solver with `configured:true` · trigger `PUT /api/tls/acme/home` · observable 200 and stored solver has no `configured` key; harness exemplar `packages/server/src/__tests__/config-api.test.ts`
- [x] 6.5 L1 test, advertisement classification (test-plan #E5): input five directories (keywords, Let's Encrypt URLs incl. case/trailing-slash variant, Pebble URL) × advertise unset/true · trigger `obtain()` with mocked client · observable `advertise` F,F,T,T,F,F,T,T,F,T, `details.staging` T,T,F,F,T,T,F,F,F,F, `kind:"domain"`; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [x] 6.6 L1 test, fingerprint scope (test-plan #E6): input production base + variants (directory, advertise toggle, email, solver, added domain) and a custom-directory advertise toggle · trigger `configFingerprint("dash.example.com")` · observable differs only for the directory change and the custom-directory advertise toggle; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [x] 6.7 L1 test, challenge owner + type (test-plan #E7): input `dash.example.com`, `*.example.com`; authorizations `[http-01, dns-01]` and `[http-01]` · trigger publish / `obtain()` · observable owners `_acme-challenge.dash.example.com` / `_acme-challenge.example.com`; dns-01 completed; http-01-only fails with no `completeChallenge`; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [x] 6.8 L1 test, Cloudflare zone lookup (test-plan #E8): input zones `example.com`, `sub.example.com`; source with `zoneId` · trigger publish for `a.sub.example.com` · observable exact-name queries longest-first stopping on match, POST to the `sub.example.com` zone; with `zoneId` no `/zones` request; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [x] 6.9 L1 test, Cloudflare cleanup always (test-plan #E9): input attempt succeeding; failing at validation; repeated `DELETE` → 404 · trigger issuance · observable one `DELETE dns_records/<id>` per record in both cases; 404 treated as success; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [x] 6.10 L1 test, acme-dns serialization + deadline start (test-plan #E10): input acme-dns source `a.test`, `b.test`, `c.test`, 4 min per order (fake timers); a second source on the same `(server, subdomain)` · trigger all at t=0, rebuild via `create()` at t=1 min, trigger the second source · observable `createOrder` at 0, 4, 8, 12 min, none abandoned, `attemptTimeoutMs` ≥ 3 × 10.5 min; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [x] 6.11 L1 test, account persistence (test-plan #E11): input same dir+email twice; `staging` vs its Let's Encrypt URL; email case/whitespace variants; last source changes email; last source removed · trigger issue / reconcile · observable one `createAccount` per equivalent pair, old key deleted after email change and removal, key mode `0o600`; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [x] 6.12 L1 test, vault account storage (test-plan #E12): input temp-dir vault, token `cf-secret-1234567890` then a second token for `home` · trigger credentials PUT twice · observable one `{kind:"tls-solver", namespace:"tls:home", provider:"cloudflare", label:"cloudflareToken"}` account holding the second value, no token in `config.json`, `vault.json` mode `0o600`; harness exemplar `packages/server/src/__tests__/vault-bindings.test.ts`
- [x] 6.13 L1 test, API redaction (test-plan #E13): input `home` with saved token · trigger local `GET /api/config`, `/api/health` local and non-local · observable `solver.configured:true`, token in no body, non-local health carries no ACME data; harness exemplar `packages/server/src/__tests__/health-access-grants.test.ts`
- [x] 6.14 L1 test, credential route authority + id (test-plan #E14): input vault-manage-refused caller vs genuinely local strict-proof caller; ids `home`, `nope`, `..`, `%2e%2e`, `a/b`; `home` with its credentials gate unmet · trigger `PUT /api/tls/acme/<id>/credentials` · observable refused like a vault management route with vault unchanged; `home` → 200 + one forced readiness refresh + one `CertManager.trigger("home")`; others → 404 with no vault access; harness exemplar `packages/server/src/__tests__/vault-routes.test.ts`
- [x] 6.15 L1 test, GC on remove/rename (test-plan #E15): input namespaces `tls:home`, `tls:lab`, `user`; then config without `home`; then without any acme source; then corrupt `config.json`; then corrupt `vault.json` · trigger `onReconciled()`, `onRemoved()` of the last source, type registration at start · observable `tls:home` then `tls:lab` deleted, `user` untouched; no vault write with a corrupt config or vault; harness exemplar `packages/server/src/__tests__/config-api.test.ts`
- [x] 6.16 L1 test, readiness cache (test-plan #E16): input cached `check()` result · trigger 20 status reads in 60 s, a secret save, status reads and unforced `readiness()` at +4:59 and +5:01, forced at +1 min · observable 0 calls from status reads (expired entry still reported with its `checkedAt`), 1 after the save, unforced calls out at +5:01 only, forced at once; harness exemplar `packages/server/src/__tests__/provider-health-cache-route.test.ts`
- [x] 6.17 L1 test, CNAME at authoritative servers (test-plan #E17): input CNAME missing at the zone's NS but cached-positive at a recursive resolver; wildcard `*.example.com` · trigger `check()` · observable queries only to the discovered NS addresses; name-scoped gate with the exact CNAME hint; wildcard owner `_acme-challenge.example.com`; `checkedAt` detail set; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [x] 6.18 L1 test, gate-blocked names (test-plan #E18): input `home` without credentials; with corrupt vault; with CNAME missing for one name · trigger `readiness()` · observable `credentials` gate unmet, with the vault hint in the corrupt case; one name-scoped gate unmet; no CA request or DNS-provider write; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [x] 6.19 L1 test, acme-dns credential check (test-plan #E19): input lock free, then held by a running order; `/update` → 200, then 401 · trigger forced `readiness()`, a credentials save, unforced `readiness()` with an expired cache · observable forced/save with a free lock → one placeholder `/update`, 401 → `credentials` gate unmet; held → no request, last result kept; unforced → no `/update`; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [x] 6.20 L1 test, stage reporting (test-plan #E20): input attempt paused in `createOrder`, then propagation pending · trigger detailed status read · observable `stage:"order"`, then `"propagation"`, then `idle` with `notAfter`; harness exemplar `packages/server/src/__tests__/health-access-grants.test.ts`
- [x] 6.21 L1 test, next attempt + config fields (test-plan #E21): input CA marks the challenge `invalid` at T, no certificate held, staging directory, acme-dns solver · trigger detailed status read · observable domain listed with redacted `lastError`, `nextAttemptAt` ≥ T + 1 h, source `details` `directory:"staging"`, `staging:true`, `solverType:"acme-dns"`; harness exemplar `packages/server/src/__tests__/health-access-grants.test.ts`
- [x] 6.22 L1 test, per-entry write keeps other sources (test-plan #E22): input stored `[tailscale, acme home]` · trigger `PUT /api/tls/acme/home` adding `b.example.com` · observable unchanged tailscale + updated `home`, `writeConfigPartial` called once; harness exemplar `packages/server/src/__tests__/config-api.test.ts`
- [x] 6.23 L1 test, stale tab (test-plan #E23): input stored `[tailscale, home]`; concurrent saves of `home` (old copy) and new acme `lab` · trigger both routes racing · observable stored array holds `tailscale`, edited `home` and `lab`; writes serialized on the config save chain; harness exemplar `packages/server/src/__tests__/system-routes-pi-mirror.test.ts`
- [x] 6.24 L1 test, corrupt config refuses (test-plan #E24): input `config.json` = `{not json` · trigger `PUT` and `DELETE /api/tls/acme/home` · observable 409 and `config.json` bytes unchanged; harness exemplar `packages/server/src/__tests__/config-api.test.ts`
- [x] 6.25 L1 test, vault isolation (test-plan #E25): input a `tls:home` / `cloudflareToken` account · trigger set as binding default, as grant override, generic value PUT, generic DELETE, plugin read, delivery snapshot · observable each mutation refused with the account unchanged; plugin read and snapshot never contain the value; harness exemplar `packages/server/src/__tests__/vault-grants.test.ts`
- [x] 6.26 L1 test, editor secrets + save order (test-plan #E26): input stored `home` with `configured:true`; new `lab` with a typed token, entry PUT → 200 and credentials PUT → 500 · trigger open `home`; save `lab`; unmount · observable `home` token input empty with "Saved in the credential vault"; calls entry → credentials; `lab` shows the credentials gate + error; token in no URL or browser storage; input empty after unmount; harness exemplar `packages/client/src/components/Gateway/__tests__/GatewayProviderActions.test.tsx`
- [x] 6.27 L1 test, terms gate + read-only id (test-plan #E27): input a new source with `agreeTos` unchecked → checked; existing `home` · trigger render, tick, open `home` · observable Save disabled with `aria-describedby` "Accept the terms to save." then enabled; `home` id input `readonly`; harness exemplar `packages/client/src/components/Gateway/__tests__/GatewayProviderActions.test.tsx`
- [x] 6.28 L1 test, vault page TLS group (test-plan #E28): input vault with `tls:home` / `cloudflareToken` and a `user` key · trigger render the Accounts tab · observable "TLS certificates" group with `home` / `cloudflareToken`, "Gateway source home", a Gateway link, no rotate/revoke control, no value; harness exemplar `packages/client/src/components/settings/vault/__tests__/VaultAccountsPanel.test.tsx`
- [x] 6.29 L3 test, ACME group convergence (test-plan #F1): input Pebble overlay, no acme source · trigger add source `pebble` (Pebble directory, Cloudflare via shim, `dash.test`) with the token in the Gateway editor and Save · observable the Domain certificates group converges to a valid `dash.test` row with a "Not advertised" badge and no rendered token; harness exemplar `tests/e2e/gateway-reserved-name.spec.ts`
- [x] 6.30 L3 test, Check now (test-plan #F2): input Pebble overlay, acme-dns source via the double, CNAME for `dash.test` absent · trigger click Check now, add the CNAME in challtestsrv, click Check now again · observable first click keeps the gate with a newer check time and no stage change; second click clears the gate and the row converges to valid; harness exemplar `tests/e2e/gateway-readiness-board.spec.ts`
- [x] 6.31 L1 test, propagation bound (test-plan #X1): input TXT at one of two NS at 175 s / never; second NS hangs (3 s timeout) · trigger issuance with fake timers · observable `completeChallenge` after 175 s; never case fails at 180 s naming the lagging NS with cleanup and no `completeChallenge`; rounds 5 s apart; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [x] 6.32 L1 test, DoH fallback (test-plan #X2): input direct resolvers reject `ECONNREFUSED`; DoH A has the value, DoH B later · trigger propagation check · observable proceeds only when both return it; `details.propagationMode === "doh-fallback"`; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [x] 6.33 L1 test, hung CA abandoned (test-plan #X3): input `waitForValidStatus` never settles, Cloudflare and acme-dns variants · trigger issuance, +10 min, issue now, then one more library poll and the stale promise resolves · observable at 10 min `obtain()` rejects, cleanup called, acme-dns lock free; issue now → new `createOrder`; the interceptor reading the `AsyncLocalStorage` generation rejects the stale poll; stale certificate not stored; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [x] 6.34 L1 test, late publish after abort (test-plan #X4): input Cloudflare `POST dns_records` resolving at 10 min + 5 s · trigger issuance · observable one `DELETE dns_records/<late id>` right after it resolves, ref never handed to the next attempt; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [x] 6.35 L1 test, CA failure floor + issue now (test-plan #X5): input CA marks the challenge `invalid` · trigger +59 min, +60 min, and `POST /api/tls/issue {sourceId:"home",name:"dash.example.com"}` at +1 min · observable no automatic attempt at 59, attempt at 60, route starts one at 1 min; harness exemplar `packages/server/src/__tests__/system-routes-restart.test.ts`
- [x] 6.36 L1 test, DNS credential failure (test-plan #X6): input Cloudflare API 403 on publish, then two due ticks, then a token save · trigger issuance, ticks, save · observable one counted failure and no `RetryAfterError`; `credentials` gate unmet; ticks call no `obtain()` and `failures` stays 1; after the save the gate is re-checked and an attempt starts; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [x] 6.37 L1 test, redaction (test-plan #X7): input DNS API error body echoing the token raw, `%2D`/`%2d`, double-encoded, JSON-escaped, base64, base64url; `DEBUG=acme-client` · trigger issuance, capture logger + status · observable no form in logs or `lastError`; no request body in the log; harness exemplar `packages/server/src/__tests__/ws-upgrade-reject-log.test.ts`
- [x] 6.38 L1 test, E2E override host guard (test-plan #X8): input `PI_E2E_SEED=1` with `PI_E2E_CLOUDFLARE_API` = `http://evil.example`, `http://nas`, `http://cf-shim.test`; then the seed unset · trigger publish · observable first two refused with a log line and the request goes to `api.cloudflare.com`; `.test` host used; without the seed the override is ignored; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [x] 6.39 L3 test, end-to-end DNS-01 advertised (test-plan #X9): input overlay, `advertise:true`, `dash.test`, `tls.host` = container address · trigger issue now, wait for `idle` · observable handshake to `dash.test:8443` chains to the Pebble root; `/api/tunnel/endpoints` has `{kind:"domain",url:"https://dash.test:8443",tls:true}`; challtestsrv TXT cleared; harness exemplar `tests/e2e/gateway-readiness-board.spec.ts`
- [x] 6.40 L3 test, custom directory not advertised (test-plan #X10): input same overlay, `advertise` unset · trigger issue now · observable handshake succeeds; URL absent from endpoints and from a minted pairing payload; harness exemplar `tests/e2e/pairing-qr.spec.ts`
- [x] 6.41 L3 test, switch re-issues (test-plan #X11): input X10 state held · trigger set `advertise:true` via the Gateway editor Save · observable a new serial is served and the URL appears in endpoints; harness exemplar `tests/e2e/gateway-readiness-board.spec.ts`
- [x] 6.42 L2 test, harness teardown removes the overlay (test-plan #X12): input harness up with `TEST_EXTRA_COMPOSE=compose.test.acme.yml`; second run with the harness state file deleted · trigger `docker/test-down.sh` with `TEST_EXTRA_COMPOSE` unset · observable `docker ps -a` for the project lists no pebble, challtestsrv, cf-shim or acme-dns container in both runs; the second run logs the fallback; harness exemplar `qa/tests/18-harness-orphan-recorder.sh`
- [x] 6.43 L1 test, gated name recovers (test-plan #E29): input acme-dns source, CNAME for `dash.example.com` missing at t=0, fake timers, manager re-check every 15 min · trigger create the CNAME at t=1 min, no operator call · observable unforced `readiness()` at the 15-min re-check re-runs the expired check, gate met, `obtain("dash.example.com")` before t=20 min, `failures` unchanged; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [x] 6.44 L1 test, credential save keeps retry wait (test-plan #E30): input CA marked the challenge `invalid` at T, credentials gate met · trigger save a new token at T + 10 min · observable no `CertManager.trigger`, no attempt before T + 1 h; harness exemplar `packages/server/src/__tests__/vault-routes.test.ts`
- [x] 6.45 L1 test, acme-dns pair atomic + `configured` (test-plan #E31): input acme-dns `home`, vault write failing on the second label; then a vault holding only `acmeDnsUser` · trigger `PUT /api/tls/acme/home/credentials {user, key}`, `GET /api/config` · observable neither label changed after the failed save; `solver.configured:false` and `credentials` gate unmet with only the user present; harness exemplar `packages/server/src/__tests__/vault-bindings.test.ts`
- [x] 6.46 L1 test, acme-dns queue allowance (test-plan #E32): input acme-dns source with 2 names (`attemptTimeoutMs` 21 min), lock held by a hung holder for 11 min (fake timers) · trigger the second name at t=0 · observable `obtain()` rejects "registration busy" at ≤ 10.5 min, before the backstop, with no CA/DNS call, and never runs later; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`
- [x] 6.47 L1 test, removal during an attempt (test-plan #E33): input `home` attempt paused in `createAccount` / propagation · trigger `DELETE /api/tls/acme/home`, then resume the paused calls · observable `onRemoved()` aborts the attempt, no further CA/DNS call, no `acme-account-*.key` written after GC, `tls:home` gone; harness exemplar `packages/server/src/__tests__/config-api.test.ts`
- [x] 6.48 L1 test, renewal blocked status (test-plan #E34): input `dash.example.com` held with 20 of 90 days left, its CNAME gate unmet · trigger due tick, detailed status read · observable no `obtain()`, `failures` 0, the name listed with the unmet gate and `notAfter`; harness exemplar `packages/server/src/__tests__/health-access-grants.test.ts`
- [x] 6.49 L1 test, renewal blocked row (test-plan #E35): input status from 6.48 · trigger render the Domain certificates group · observable the row shows "Renewal blocked" naming the gate and the expiry date; harness exemplar `packages/client/src/components/Gateway/__tests__/GatewayProviderActions.test.tsx`
- [x] 6.50 L1 test, readiness check errors (test-plan #E36): input met CNAME result cached, then a DoH timeout on refresh; Cloudflare `/zones` with no match for `a.unknown.test`; no prior result + 503 · trigger forced `readiness()` · observable last result kept with "check failed: …"; unknown zone → name-scoped `dns-zone` gate; no prior result → gate unmet with the hint; harness exemplar `packages/server/src/__tests__/tunnel-tailscale.test.ts`

## 7. Docs & manual verification

- [x] 7.1 Add `packages/server/src/tls/sources/acme/AGENTS.md` rows, update `packages/server/src/vault/AGENTS.md` (`tls-solver` kind, new store methods) and add `docker/compose.test.acme.yml.AGENTS.md`. Delegate the `docs/` prose to DocScribe: setup guide (A record → mesh IP, Cloudflare token scope, acme-dns registration + CNAME, staging → production, credential vault). Verify the rows and docs are present.
- [x] 7.2 Manual QA against Let's Encrypt production (test-plan #M1, test-plan: manual-only): owned domain → ZeroTier IP, Cloudflare token scoped to one zone, staging then production, pair a phone via `https://dash.<domain>:8443`; verify the certificate is trusted and pairing completes.
- [x] 7.3 Manual QA with acme-dns at a non-Cloudflare DNS host (test-plan #M2, test-plan: manual-only): register at a public acme-dns instance, create the CNAME the UI shows at a registrar, issue against staging; verify the registrar accepts the record and issuance succeeds.
