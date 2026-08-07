# Tasks — config-override-oauth-redirect-base

Sections 1–5 are PR #409 plus the gap closure, and are **landed on this branch**.
Sections 6–11 are the scope folded in after doubt cycles 1–3 (design D7–D15) and
the `test-plan.md` manifest.

Every test task carries its manifest id, its harness exemplar, and its Triple.

## 1. Land PR #409 (already implemented upstream)

- [x] 1.1 `AuthConfig.redirectBaseUrl?: string` + trim/blank/type normalization in `parseAuthConfig` — `packages/shared/src/config.ts`
- [x] 1.2 `buildRedirectUri(provider, port, baseOverride?)` precedence + trailing-slash strip — `packages/server/src/auth/auth.ts`
- [x] 1.3 Thread `authState.redirectBaseUrl` through `/auth/login`, `/auth/start/:provider`, `/auth/callback/:provider` + `_reloadAuth` — `packages/server/src/auth/auth-plugin.ts`
- [x] 1.4 Preserve `auth.redirectBaseUrl` in `writeConfigPartial` — `packages/server/src/config-api.ts`
- [x] 1.5 Doc rows: `auth.ts.AGENTS.md`, `auth-plugin.ts.AGENTS.md`, `shared/src/AGENTS.md`

## 2. Close the test gap (blocking merge)

- [x] 2.1 Failing-test-first: `override beats an active tunnel` with `vi.mock("../tunnel/tunnel.js")` — `packages/server/src/__tests__/auth-redirect-base.test.ts`
- [x] 2.2 Full precedence decision table (6 rows) — E1
- [x] 2.3 Route-level `inject()` assertions on the `Location` header — E13
- [x] 2.4 Token-exchange echo assertion — E14
- [x] 2.5 Hot-reload assertions via `_reloadAuth` — E15/E16
- [x] 2.6 Partial-write preservation / clear — E11/E12
- [x] 2.7 Browser E2E `tests/e2e/oauth-redirect-base.spec.ts` — F1/F2
- [x] 2.8 `tests/e2e/AGENTS.md` row for the new spec

## 3. Close the observability gap

- [x] 3.1 Validate `redirectBaseUrl` at registration and every reload
- [x] 3.2 On failure log ONE warning naming `auth.redirectBaseUrl` — X1/X2/X3
- [x] 3.3 Assert the happy path stays silent — X4

## 4. Close the docs gap

- [x] 4.1 `docs/architecture.md` auth/config reference + precedence chain
- [x] 4.2 `docs/architecture.md` D6 limitation
- [x] 4.3 `CHANGELOG.md [Unreleased] → Added`
- [x] 4.4 Provider-side registration requirement documented

## 5. Verify (Slice 1)

- [x] 5.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` green
- [ ] 5.2 (PENDING — needs Docker) `npm run test:e2e -- oauth-redirect-base`
- [x] 5.3 `npm run quality:changed`
- [x] 5.4 `openspec validate config-override-oauth-redirect-base --strict`

## 6. Security corrections from doubt cycle 3 (do these FIRST)

- [x] 6.1 Add userinfo rejection to `warnOnInvalidRedirectBase` — require empty `username`/`password` on the parsed URL; warn naming the credential leak, still use the value (D4 amendment). Warning never echoes the password
- [x] 6.2 Test G1 — `packages/server/src/__tests__/auth-redirect-base.test.ts`. Triple: `https://user:pass@pi.example.com` · register · warning names the credential leak; value still used (test-plan #G1). RED verified before the fix
- [x] 6.3 Derive the session cookie `Secure` flag from the resolved redirect base scheme — new `resolveRedirectBase(port, override)` in `auth.ts` (shared with D10), consumed at `auth-plugin.ts`. `trustProxy` NOT enabled (D14)
- [x] 6.4 Test G22 — `packages/server/src/__tests__/auth-redirect-base.test.ts`. Triple: resolved base `https://…` vs `http://…` · issue session cookie · `Secure` set / not set (test-plan #G22)
- [x] 6.5 Test S1 — new `packages/server/src/__tests__/forwarded-ip-trust.test.ts`. Triple: request carrying `X-Forwarded-For: <trusted CIDR address>` from an untrusted peer · any gated route · 403, `request.ip` stays the socket peer (test-plan #S1). **Non-vacuity proven**: with `trustProxy:true` the same request returns 200 (bypass achieved)
- [x] 6.6 Test S2 — `packages/server/src/__tests__/forwarded-ip-trust.test.ts`. Triple: same spoofed header · WS upgrade + REST request · both authorize on the socket peer (test-plan #S2)
- [x] 6.7 Doc rows: `auth.ts.AGENTS.md` (resolveRedirectBase + userinfo), `auth-plugin.ts.AGENTS.md` (Secure derivation + the trustProxy prohibition and why)

### 6b. CodeRabbit findings on PR #409 (both verified real, both in code from 6.1)

- [x] 6.8 `redactUrlForLog()` — redaction moved into `complain()` so it covers EVERY warning path. The 6.1 fix only guarded the userinfo branch, so `https://user:pw@host?token=s3cret` hit the query branch first and logged the password AND the token verbatim. Redacts password + query values + fragment; keeps scheme/host/path/query keys so the warning stays actionable
- [x] 6.9 Test G1b — `packages/server/src/__tests__/auth-redirect-base.test.ts`. Triple: 4 secret-bearing bases (userinfo+query, query-only, fragment-only, ftp+userinfo) · register · no secret in the warning, host still present (test-plan #G1b). RED verified (4 failures)
- [x] 6.10 Reject a bare `?`/`#` — `new URL("https://h?").search` is `""`, so `parsed.search || parsed.hash` passed it while the delimiter still corrupted the built URI into `https://h?/auth/callback/github`. Now tests the raw string too
- [x] 6.11 Test G1c — same file. Triple: `https://pi.example.com?`, `#`, `?#` · register · warns; plus a row pinning the malformed URI that made it matter (test-plan #G1c). RED verified (3 failures)
- [x] 6.12 Test: redaction never alters the value actually USED — pins that a logging concern cannot leak into `buildRedirectUri`
- [x] 6.13 Update the X3 warning-contract fixtures to the redacted form (CodeRabbit: "update the warning contract and tests that require the complete value")
- [x] 6.14 design.md — correct the stale "query/fragment … are not detected" line; D4 detects them, and now also the empty-delimiter case
- [x] 6.15 design.md — convert all 6 ASCII box diagrams to Mermaid per the repo diagram rule (2 pre-existing flagged by CodeRabbit, 4 added by D5/D7/D12 in this session)

Still open from the CodeRabbit review (not yet actioned):

- [ ] 6.16 `specs/oauth-authentication/spec.md` — "Override cleared at runtime" describes key omission as a clear; a partial `PUT` that omits the key PRESERVES it. Restate: an API caller clears by sending `""`
- [ ] 6.17 `docs/AGENTS.md` + `docs/architecture.md` — caveman-style violation (dense multi-fact prose); one fact per line — **delegate to DocScribe**

## 7. Slice 2 — `publicBaseUrls` promotion (pairing/endpoints only)

- [ ] 7.1 Add top-level `publicBaseUrls?: string[]` with read-side fallback to `pairing.publicBaseUrls`; **do not** add it to `DEFAULTS` — `packages/shared/src/config.ts` (D7)
- [ ] 7.2 Point `server.ts:270-274` (`getReachableUrls`) and `system-routes.ts` endpoints at the resolved key
- [ ] 7.3 Point the Gateway client read/write path at the top-level key — `packages/client/src/lib/gateway/gateway-config-ops.ts`
- [ ] 7.4 Test G2/G3/G4 — see `packages/shared/src/__tests__/config.test.ts`. Triple: top-level only / legacy only / both · `loadConfig` · value returned; legacy result byte-identical; top-level wins (test-plan #G2,#G3,#G4)
- [ ] 7.5 Test G5 — see `packages/shared/src/__tests__/config.test.ts`. Triple: fresh config · `ensureConfig()` then read file · no top-level `publicBaseUrls` key written (test-plan #G5)
- [ ] 7.6 Test G6 — see `packages/server/src/__tests__/auth-redirect-base.test.ts`. Triple: `publicBaseUrls` set, no `auth.redirectBaseUrl`, tunnel active · `buildRedirectUri` · returns the TUNNEL url (test-plan #G6)
- [ ] 7.7 Test G7 — see `packages/server/src/__tests__/auth-plugin.test.ts` or a pairing sibling. Triple: `publicBaseUrls:["http://192.168.1.9:8000"]` (non-loopback) · `reachableUrls()` · entry absent from the pairing payload (test-plan #G7)

## 8. Slice 4 — provider deletion

- [ ] 8.1 Add `deleteAuthProvider(id)` raw read/write helper — reads unredacted config, deletes one key from `auth.providers`, writes back; never `readConfigRedacted()` — `packages/server/src/config-api.ts` (D9)
- [ ] 8.2 Add `DELETE /api/config/auth/providers/:id` behind `networkGuard`, calling `_reloadAuth` — `packages/server/src/routes/system-routes.ts`
- [ ] 8.3 Refuse deleting the last provider without `?force=true`; the response states the lockout consequence (D9)
- [ ] 8.4 Test G8/G10 — see `packages/server/src/__tests__/config-api.test.ts`. Triple: 2 providers / absent provider · DELETE · provider gone + reload ran / success with no side effect (test-plan #G8,#G10)
- [ ] 8.5 Test G9 — see `packages/server/src/__tests__/config-api.test.ts`. Triple: 2 providers with real secrets · delete one · survivor's `clientSecret` is the REAL value, not `"***"` (test-plan #G9)
- [ ] 8.6 Test G11 — see `packages/server/src/__tests__/config-api.test.ts`. Triple: exactly 1 provider, with/without `?force=true` · DELETE · refused / succeeds and response states the lockout (test-plan #G11)
- [ ] 8.7 Test G12 — see `packages/server/src/__tests__/auth-plugin.test.ts`. Triple: booted with 1 provider then force-delete · any gated request · still 403 and `/auth/login` lists zero providers (test-plan #G12)
- [ ] 8.8 Test S9 — see `packages/server/src/__tests__/config-api.test.ts`. Triple: unauthenticated DELETE · the route · rejected by the same guard as `PUT /api/config` (test-plan #S9)

## 9. Slice 3a — make the config actually apply (D15)

- [ ] 9.1 Fix `_reloadAuth` to merge top-level `trustedNetworks` exactly as boot does — `packages/server/src/auth/auth-plugin.ts:142` vs `:124`. **Pre-existing bug**, independent of this change
- [ ] 9.2 Pass the full reloaded config (not only `reloaded.auth`) from `system-routes.ts:257`
- [ ] 9.3 Add an mtime-gated config snapshot helper (C6): `statSync().mtimeMs` per call, reparse only on change. Measured 1.9 µs vs 24.5 µs for a full read+parse
- [ ] 9.4 Make the CORS `origin` callback read the snapshot instead of the boot closure — `packages/server/src/server.ts:1053`
- [ ] 9.5 Make `networkGuard` read the snapshot for trusted networks — `packages/server/src/server.ts:1113`
- [ ] 9.6 Test G25 — see `packages/server/src/__tests__/auth-plugin.test.ts`. Triple: boot with top-level `trustedNetworks:["10.0.0.0/8"]` then any `_reloadAuth` · bypass check for `10.1.2.3` · still bypassed (**expected RED before 9.1**) (test-plan #G25)
- [ ] 9.7 Test G23 — see `packages/server/src/__tests__/cors.test.ts`. Triple: running server, origin added via config write · preflight from that origin with no restart · allowed (test-plan #G23)
- [ ] 9.8 Test G24 — see `packages/server/src/__tests__/localhost-guard.test.ts`. Triple: running server, CIDR added · request from that range with no restart · admitted (test-plan #G24)
- [ ] 9.9 Test P3/P4 — see `packages/server/src/__tests__/cors.test.ts`. Triple: 1k preflights / 10k guard calls, config unchanged · measure · exactly ONE read+parse; p95 < 50 µs (test-plan #P3,#P4)
- [ ] 9.10 Test P5 — see `packages/server/src/__tests__/cors.test.ts`. Triple: 100 calls with the config rewritten at call 50 · measure · post-rewrite calls observe the NEW value — pins the cache is mtime-gated, not a boot snapshot (test-plan #P5)

## 10. Slice 3b — the gateway action (D12/D13)

- [ ] 10.1 Add the `gateways[]` provenance record to the config schema (`url`, `authModes[]`, `wrote{}`) — `packages/shared/src/config.ts` (D12)
- [ ] 10.2 Implement add: one atomic write of `publicBaseUrls` + `cors.allowedOrigins` + `auth.redirectBaseUrl` (iff oauth) + `trustedNetworks` (iff trusted-network); seed top-level `publicBaseUrls` from the legacy key before appending
- [ ] 10.3 Implement remove: revert only values recorded in `wrote` and still equal in live config
- [ ] 10.4 Implement the computed status + Fix (delta-only reconcile, never re-run add) — D13
- [ ] 10.5 Build the shared dialog component; render it from both `GatewaySetupGuide.tsx` and a persistent Gateway-page control — `packages/client/src/components/Gateway/`
- [ ] 10.6 Reuse `suggestTrustEntries` for the CIDR prefill (`/32` default) — `packages/client/src/lib/gateway/gateway-config-ops.ts`
- [ ] 10.7 Reconcile the two `publicBaseUrls` writers into one helper so `isSecureBaseUrl`'s throw and D12's `http://` path cannot diverge
- [ ] 10.8 Add the Settings ▸ Security redirect-base input — `packages/client/src/components/settings/SettingsPanel.tsx`
- [ ] 10.9 Test G13 — see `packages/client/src/components/Gateway/__tests__/Gateway.test.tsx`. Triple: scheme{http,https} × modes{tn,qr,oauth} · validate payload · http+qr / http+oauth / http-without-tn / https-without-any all rejected (test-plan #G13)
- [ ] 10.10 Test G14 — see `packages/server/src/__tests__/config-api.test.ts`. Triple: https gateway with {oauth,qr} · add · ONE write containing all recorded keys, no partial state (test-plan #G14)
- [ ] 10.11 Test G15 — see `packages/server/src/__tests__/config-api.test.ts`. Triple: legacy `pairing.publicBaseUrls:["https://old"]` · add first gateway · top-level list contains BOTH old and new (test-plan #G15)
- [ ] 10.12 Test G16 — see `packages/server/src/__tests__/config-api.test.ts`. Triple: gateway added then operator hand-adds `https://mine` to cors · remove gateway · `https://mine` still present (test-plan #G16)
- [ ] 10.13 Test G17 — see `packages/server/src/__tests__/config-api.test.ts`. Triple: operator hand-set `auth.redirectBaseUrl=X` then adds an OAuth gateway for X · remove · key IS cleared (documented limit) (test-plan #G17)
- [ ] 10.14 Test G18 — see `packages/client/src/lib/__tests__/gateway-config-ops.test.ts`. Triple: `http://10.4.0.9:8000` · open dialog · prefill is `10.4.0.9/32` (test-plan #G18)
- [ ] 10.15 Test G19/G21 — see `packages/client/src/components/Gateway/__tests__/Gateway.test.tsx`. Triple: the 4 drift states / entry under either trusted-network key · compute status · correct status; reflects the effective merge (test-plan #G19,#G21)
- [ ] 10.16 Test G20 — see `packages/server/src/__tests__/config-api.test.ts`. Triple: Incomplete gateway with cors entry deleted · Fix · exactly the missing value restored, list not duplicated (test-plan #G20)
- [ ] 10.17 Test S8 — see `packages/server/src/__tests__/config-api.test.ts`. Triple: config write throws mid-action · add gateway · no partial provenance record (test-plan #S8)

## 11. Slice 3c — diagnostics (D10)

- [ ] 11.1 Expose the resolved redirect base + winning tier on `GET /api/auth/diagnostics` (C4) behind `networkGuard`, reporting `authActive:false` in the no-provider boot state. Reuses `resolveRedirectBase()` from task 6.3
- [ ] 11.2 Mirror the same line to `server.log` at register/reload
- [ ] 11.3 Add the `doctor` module reading it over loopback — `packages/extension/.pi/skills/doctor/modules/`
- [ ] 11.4 Test S3/S4/S5 — see `packages/server/src/__tests__/auth-plugin.test.ts`. Triple: unauthenticated non-loopback / loopback / zero-provider boot · diagnostics endpoint · rejected / returns base+tier / reports `authActive:false` (test-plan #S3,#S4,#S5)
- [ ] 11.5 Test S6 — see `packages/server/src/__tests__/auth-redirect-base.test.ts`. Triple: any register/reload · inspect log · one line naming resolved base + tier (test-plan #S6)
- [ ] 11.6 Test S7 — see `packages/server/src/__tests__/auth-redirect-base.test.ts`. Triple: change `auth.redirectBaseUrl` between `/auth/start` and `/auth/callback` · callback · diagnosable error, not a blank screen (test-plan #S7)

## 12. Browser E2E (L3)

Harness safety: every spec seeds `auth.bypassUrls:["/"]` and restores the original
config + restarts in a **`try`/`finally`**, not a bare `afterAll`.

- [ ] 12.1 Test F5/F7 — see `tests/e2e/gateway-qr-selector.spec.ts` for harness glue. Triple: Gateway page, https URL, modes {oauth} · complete dialog, then remove · recorded keys appear in `GET /api/config` and row shows OK; removal confirmation lists each reverted field (test-plan #F5,#F7)
- [ ] 12.2 Test F6 — see `tests/e2e/gateway-qr-selector.spec.ts`. Triple: type an `http://` URL · dialog re-renders · OAuth+QR disabled with reason text, trusted-network required, save disabled until set (test-plan #F6)
- [ ] 12.3 Test F8 — see `tests/e2e/gateway-qr-selector.spec.ts`. Triple: delete the cors entry behind the gateway's back · reload page · row shows Incomplete with reason; Fix restores exactly one value (test-plan #F8)
- [ ] 12.4 Test F9 (**the change's payoff**) — see `tests/e2e/csp.spec.ts` for origin-loading glue. Triple: add a gateway, no restart · load the dashboard from the new origin · no `ERR_ABORTED` module-script failure (test-plan #F9)
- [ ] 12.5 Test F10 — see `tests/e2e/oauth-redirect-base.spec.ts`. Triple: Settings ▸ Security · set the redirect base · persisted and reflected in `/auth/start` (test-plan #F10)
- [ ] 12.6 Test F11 — see `tests/e2e/csp.spec.ts`. Triple: gateway dialog, both themes · axe scan · zero WCAG-AA violations, contrast ≥ 4.5:1 (test-plan #F11)
- [ ] 12.7 Test F12 — see `tests/e2e/gateway-qr-selector.spec.ts`. Triple: first-run guide and Gateway page · open both · identical dialog markup (test-plan #F12)
- [ ] 12.8 Add `tests/e2e/AGENTS.md` rows for every new spec

## 13. Docs

- [ ] 13.1 `docs/architecture.md` — `publicBaseUrls` promotion + legacy fallback + the OAuth-isolation rule (D7) — **delegate to DocScribe, caveman style**
- [ ] 13.2 `docs/architecture.md` — the gateway action, provenance record, status/Fix model (D12/D13) — **DocScribe**
- [ ] 13.3 `docs/architecture.md` — record why `trustProxy` is NOT enabled and what must change first if anyone ever wants it (D14) — **DocScribe**
- [ ] 13.4 `CHANGELOG.md [Unreleased]` — gateway action, provider deletion, the trusted-networks reload fix
- [ ] 13.5 Directory `AGENTS.md` rows for every new/changed source file

## 14. Manual verification (test-plan: manual-only)

- [ ] 14.1 Visual/UX review of the gateway dialog at 3 breakpoints in both themes (test-plan: manual-only, #F13)
- [ ] 14.2 Copy review — every rules string is accurate and plain-language (test-plan: manual-only, #F14)

## 15. Spec deltas for the widened scope

The proposal now claims 5 modified capabilities; only `oauth-authentication` and
`shared-config` have delta files. `openspec validate --strict` passes today
because it does not cross-check the prose list, so these are easy to lose.

- [ ] 15.0a `specs/qr-device-pairing/spec.md` — delta for the `publicBaseUrls` promotion; the TLS gate is explicitly UNCHANGED (D8)
- [ ] 15.0b `specs/tunnel-provider/spec.md` — delta for the endpoint source reading the promoted key
- [ ] 15.0c `specs/settings-panel/spec.md` — delta for the Security redirect-base input
- [ ] 15.0d `specs/doctor-skill/spec.md` — delta for the resolved-redirect-base module
- [ ] 15.0e Extend `specs/oauth-authentication/spec.md` with the DELETE route, the `Secure`-flag derivation, and the explicit NON-requirement that `publicBaseUrls` feeds OAuth

## 16. Verify (full scope)

- [ ] 16.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` — green
- [ ] 16.2 `npm run test:e2e` against the docker harness — green
- [ ] 16.3 `npm run quality:changed`
- [ ] 16.4 `openspec validate config-override-oauth-redirect-base --strict`
- [x] 16.5 Resolve the open clarifications in `test-plan.md` — C4 (new `/api/auth/diagnostics` route), C5 (last-writer-wins accepted as pre-existing), C6 (mtime-gated cache) all answered
