TDD: write each folded test task (sections 9–13) failing before the implementation task it covers. Test ids reference `test-plan.md`.

## 1. Shared types

- [x] 1.1 `packages/shared/src/operate-required.ts`: add `"request-access"` to `OperateRemedy`; `OPERATE_REMEDY_ORDER` becomes `["use-host", "re-pair", "request-access", "sign-in"]` (design D5); update the doc comment. Verify: `npx tsc --noEmit -p packages/shared` clean; update the row in `packages/shared/src/AGENTS.md` (`See change: add-request-access-remedy`)

## 2. Server — shared knock peer gate (design D1)

- [x] 2.1 `packages/server/src/pairing/knock-admission.ts`: export `knockPeerInput(request)` (moves `headerString` normalisation from `routes/pairing-routes.ts:76`), `KnockPeerDeps`, `knockPeerState(deps)`, `knockPeerGate(input, state)` holding today's gates 1–2 verbatim; `admitKnock()` calls `knockPeerGate` first. Verify: tasks 9.1–9.3 green
- [x] 2.2 `packages/server/src/routes/pairing-routes.ts`: build the knock input with `knockPeerInput(request)` and spread `knockPeerState(deps)` into the `admitKnock` state; deps take a `KnockPeerDeps`. Verify: `pair-request-route.test.ts` green unchanged; update rows in `packages/server/src/pairing/AGENTS.md` and `packages/server/src/routes/pairing-routes.ts.AGENTS.md`
- [x] 2.3 Coordination: if `retire-trusted-networks-bypass` has archived before this task runs, include its configured-list branch in `KnockPeerDeps` / `knockPeerState` / `knockPeerGate` instead of re-adding it at a call site (design: Coordination). Verify: `grep -n "knockPeerGate\|knockPeerState" packages/server/src` shows the list read only inside those helpers

## 3. Server — remedy rule (design D2, D3)

- [x] 3.1 `packages/server/src/auth/operate-required.ts`: `SendOperateRequiredOptions` gains optional `requestAccessAvailable?: (request: FastifyRequest) => boolean`; `describeOperateRefusal` adds `request-access` iff `authVia === undefined` and the thunk returns true; update the file-header disclosure note. Verify: tasks 10.1, 10.6 green; update the row in `packages/server/src/auth/AGENTS.md`
- [x] 3.2 Thread the option: `VaultRoutesDeps` (`packages/server/src/vault/vault-routes.ts`) and `ServiceRoutesDeps` (`packages/server/src/services/routes.ts`) gain optional `requestAccessAvailable`, passed to `sendOperateRequired`. Verify: `npx tsc --noEmit -p packages/server` clean; update rows in `packages/server/src/vault/AGENTS.md`, `packages/server/src/services/AGENTS.md`
- [x] 3.3 `packages/server/src/server.ts` (design D2, D4): build one `knockPeerDeps = { hostAdmission: () => getHostGateCtx().admission, getLanInterfaces: createLanInterfaceProvider({ bindHost: config.host }) }`; pass it to the pairing routes; build `requestAccessAvailable = (req) => !hasLocalProof(req.headers, localTrust) && knockPeerGate(knockPeerInput(req), knockPeerState(knockPeerDeps)) === null`; pass it to `registerVaultRoutes` and `registerServiceRoutes`. Verify: tasks 10.2, 10.13 green; update the vault / services / pairing wiring lines in `packages/server/src/server.ts.AGENTS.md`

## 4. Client — target helper and refusal base (design D7)

- [x] 4.1 Add `packages/client/src/lib/pairing/request-access-target.ts` exporting `requestAccessTarget(apiBase, origin) → { href, newContext }` with the banner's exact semantics (no normalisation); refactor `components/connectivity/ConnectionStatusBanner.tsx` `requestAccess` to use it, keeping `window.open(href, "_blank", "noopener")` / `location.assign(href)`. Verify: tasks 12.1, 12.2 green; add the row to `packages/client/src/lib/pairing/AGENTS.md`, update the banner row in `packages/client/src/components/connectivity/AGENTS.md`
- [x] 4.2 `packages/client/src/lib/vault/vault-api.ts`: `call()` reads `getApiBase()` once and returns it as `VaultResult.base`. Verify: task 12.3 green; update the row in `packages/client/src/lib/vault/AGENTS.md`

## 5. Client — callout row

- [x] 5.1 `components/settings/vault/VaultSection.tsx`: store the refusal as `{ remedies, base: res.base }`, pass `apiBase` to the callout. `OperateRequiredCallout.tsx`: `KnownRemedy` gains `request-access` (icon `mdiAccountArrowRight`, EN copy per design D7), renders an `<a data-testid="vault-operate-request-access">` from `requestAccessTarget(apiBase, window.location.origin)` (same origin: plain `href`; other server: `target="_blank" rel="noopener noreferrer"`) with the `sign-in` link recipe. Verify: tasks 12.4–12.7 green; update the rows in `packages/client/src/components/settings/vault/AGENTS.md`
- [x] 5.2 i18n: add `vault.operateRequired.request-access` and `vault.operateRequired.requestAccessLink` to `packages/client/src/lib/i18n-en-source.json`, `packages/client/src/lib/i18n/i18n-hu.ts`, `packages/client/src/lib/i18n/i18n-zh-CN.ts`; add `request-access` to the dynamic remedy list at `packages/client/src/__tests__/i18n.test.ts:298-299`. Verify: task 12.8 green

## 6. Verify

- [x] 6.1 Run touched suites (`set -o pipefail; npx vitest run <files> 2>&1 | tee /tmp/pi-test.log`, then grep the summary) and `npm run quality:changed`; restart the server (`curl -X POST http://localhost:8000/api/restart`) and `npm run build`. Verify: zero failures, quality ratchet clean
- [ ] 6.2 `security-hardening` + `Audit` subagent pass on the diff (new unauthenticated disclosure, raw-socket peer, Host-admission ordering, local-credential exclusion); `review-code` before commit. Verify: no open findings

## 7. Docs

- [x] 7.1 Delegate any `docs/` prose updates (auth / pairing disclosure notes) to `DocScribe`. Verify: docs mention the `request-access` remedy and its exception status, or DocScribe reports none needed

## 8. Coordination

- [x] 8.1 If this change archives before `retire-trusted-networks-bypass`, leave a note in that change's `tasks.md` (knock-eligibility task) that the list branch goes into `KnockPeerDeps` / `knockPeerState` / `knockPeerGate` so the `request-access` remedy follows. Verify: note present, or retire already archived (task 2.3 covered it)

<!-- Folded from test-plan.md by plan-proposal. One task per manifest row; write each failing before its implementation task. -->
## 9. L1 — knock peer gate (vitest)

- [x] 9.1 Test `knockPeerGate` decision table — see packages/server/src/pairing/__tests__/knock-admission.test.ts — non-admitted Host + on-link peer; admitted Host + `X-Forwarded-For`; loopback; missing peer; `100.64.0.5` on a `/32` interface; `192.168.16.40` on `192.168.16.1/24` · call `knockPeerGate(input, state)` · `host_not_admitted` (before peer check), `knock_not_lan` ×4, `null` (test-plan #E1)
- [x] 9.2 Test knock route unchanged after the extraction — see packages/server/src/__tests__/pair-request-route.test.ts and packages/server/src/pairing/__tests__/knock-admission.test.ts — existing admission and gate-order cases · run both suites after 2.1/2.2 · every existing assertion passes unchanged (test-plan #E2)
- [x] 9.3 Test `knockPeerInput` normalisation — see packages/server/src/pairing/__tests__/knock-admission.test.ts — `host` string / `["a","b"]` / absent; `socket.remoteAddress` set / undefined, `request.ip` differing · `knockPeerInput(request)` · `host` = `headerString` result; `peer` = raw socket address, never `request.ip` (test-plan #E3)

## 10. L1 — refusal builder and routes (vitest)

- [x] 10.1 Test `request-access` presence decision table — see packages/server/src/__tests__/operate-required.test.ts — `authVia` unset / device(control) / session(control) / principal × thunk true / false / omitted × `loginAvailable` true / false · `sendOperateRequired` on a stub reply · present only for (unset, true); order `use-host, re-pair, request-access, sign-in`; never with `re-pair`; omitted → never; exactly five body keys (test-plan #E4)
- [x] 10.2 Test thunk treats local credentials as credentials — see packages/server/src/__tests__/operate-required.test.ts (and local-proof helpers in packages/server/src/__tests__/vault-routes.test.ts strict rows) — on-link request with valid `X-Pi-Local-Token`; with valid `pi_dash_local` cookie; with neither · server-built `requestAccessAvailable(req)` · false, false, true (test-plan #E5)
- [x] 10.3 Test on-link no-credential vault refusal — see packages/server/src/__tests__/vault-routes.test.ts (`app.inject({ remoteAddress })`, `:122-126`) — `trustedNetworks` `["192.168.16.0/24"]`, interfaces `192.168.16.1/24`, peer `192.168.16.40`, admitted Host, no credential, no login · inject `GET /api/vault` · 403 `no-credential`, `["use-host","request-access"]` (test-plan #E6)
- [x] 10.4 Test full no-credential remedy order — see packages/server/src/__tests__/vault-routes.test.ts — 10.3 setup + OAuth provider with non-empty client id · inject `GET /api/vault` · `["use-host","request-access","sign-in"]` (test-plan #E7)
- [x] 10.5 Test off-gate trusted peer — see packages/server/src/__tests__/vault-routes.test.ts — trusted `100.64.0.0/10`, interface `100.64.0.1/32`, peer `100.64.0.5`, no credential · inject `GET /api/vault` · 403 `["use-host"]`, vault `no-credential` message, no `data` (test-plan #E8)
- [x] 10.6 Test forwarded request withholds the remedy — see packages/server/src/__tests__/vault-routes.test.ts — 10.3 setup + `X-Forwarded-For: 203.0.113.9` · inject `GET /api/vault` · no `request-access` (test-plan #E9)
- [x] 10.7 Test non-admitted Host withholds the remedy — see packages/server/src/__tests__/vault-routes.test.ts and host-gate setup in packages/server/src/__tests__/pair-request-route.test.ts — 10.3 setup, host gate report mode, `Host: evil.test` · inject `GET /api/vault` · 403 `operate_required` without `request-access` (test-plan #E10)
- [x] 10.8 Test verified local credential withholds the remedy — see packages/server/src/__tests__/vault-routes.test.ts — 10.3 setup + valid local token or local-proof cookie, non-operate path · inject `GET /api/vault` · no `request-access` (test-plan #E11)
- [x] 10.9 Test on-link low-tier device — see packages/server/src/__tests__/vault-routes.test.ts (X12 rows) — 10.3 peer with `control` bearer · inject `GET /api/vault` · `tier-too-low`, `["use-host","re-pair"]`, no `request-access` (test-plan #E12)
- [x] 10.10 Test revoked bearer off-gate and on-link — see packages/server/src/__tests__/vault-routes.test.ts — revoked bearer from the 10.5 peer and from the 10.3 peer · inject `GET /api/vault` · `["use-host"]` and `["use-host","request-access"]`, both `no-credential` (test-plan #E13)
- [x] 10.11 Test service mutation parity — see packages/server/src/services/__tests__/routes.test.ts — 10.5 peer and 10.3 peer, no credential · inject a `/api/services*` mutation · same `reason`/`remedies` as vault, services `no-credential` message, service unchanged (test-plan #E14)
- [x] 10.12 Test admission unchanged — see packages/server/src/__tests__/vault-routes.test.ts (X12 table) — operate bearer; operate / claim-less session JWT; principal; loopback strict off · inject `GET /api/vault` · 200 each (test-plan #E15)
- [x] 10.13 Test single interface provider wiring — see packages/server/src/__tests__/system-routes-restart-loader.test.ts for a source-scan pattern — `packages/server/src/server.ts` source · scan · exactly one `createLanInterfaceProvider(` and one `knockPeerDeps` shared by pairing routes and vault/services deps (test-plan #E16)
- [x] 10.14 Test refusal builder budget incl. knock gate — see packages/server/src/__tests__/operate-required.test.ts (existing P1 loop) — 1000 sequential `sendOperateRequired` calls, on-link stub requests, all three login sources, real thunk over a cached interface provider · timed loop · total ≤ 1000 ms (test-plan #P1)

## 11. L1 — disclosure (vitest)

- [x] 11.1 Test switch / knock state not disclosed — see packages/server/src/__tests__/vault-routes.test.ts and knock seeding in packages/server/src/__tests__/pair-request-route.test.ts — 10.3 caller; `acceptLanRequests` false, true, then a live knock from that peer · refuse each · three byte-identical bodies containing `request-access` (test-plan #X1)
- [x] 11.2 Test remedy mirrors the public knock gates — see packages/server/src/__tests__/pair-request-route.test.ts + vault-routes.test.ts — request shapes of 10.3, 10.6, 10.7, 10.5 · inject `GET /api/vault` and a same-origin JSON `POST /api/pair/request` (switch off) · `request-access` present ⇔ `knock_disabled`; absent ⇔ `host_not_admitted` / `knock_not_lan` (test-plan #X2)
- [x] 11.3 Test body carries no address/subnet — see the existing disclosure test in packages/server/src/__tests__/vault-routes.test.ts — trusted `192.168.16.0/24`, interface `192.168.16.1/24`, host name, device `dev-1`/`robson-mbp`, vault fixture · refuse the 10.3 caller and a `control` bearer · five keys; no `192.168.`, CIDR, host name, `dev-1`, `robson-mbp`, vault names (test-plan #X3)
- [x] 11.4 Test health posture still withheld — see packages/server/src/__tests__/health-access-grants.test.ts — the 10.3 caller · `GET /api/health` · no `accessGrants`, no `trustPosture` (test-plan #X4)
- [x] 11.5 Test empty interface list fails closed — see packages/server/src/__tests__/vault-routes.test.ts — 10.3 caller with `getLanInterfaces` returning `[]` · refuse · no `request-access`; 403 with five keys (test-plan #X5)

## 12. L1 — client (vitest)

- [x] 12.1 Test `requestAccessTarget` — new `packages/client/src/lib/pairing/__tests__/request-access-target.test.ts`, see sibling packages/client/src/lib/pairing/__tests__/knock-format.test.ts — `("", o)`, `(o, o)`, `("http://192.168.16.204:8000", "http://192.168.16.31:8000")`, `("http://x:8000/", "http://x:8000")` · call · relative same-context ×2; absolute new-context; trailing-slash base → new context (banner parity) (test-plan #E17)
- [x] 12.2 Test banner unchanged after refactor — see packages/client/src/components/__tests__/ConnectionStatusBanner.test.tsx — existing same-origin / other-server cases · run after 4.1 · all pass unchanged (test-plan #E18)
- [x] 12.3 Test `VaultResult.base` is the request-start base — see packages/client/src/lib/vault/__tests__/vault-api.test.ts — mocked `fetch`; `getApiBase()` returns `A` at call start, `B` before the response resolves · `fetchVault()` · `res.base === "A"` (test-plan #E19)
- [x] 12.4 Test request-access row on the page's own server — see packages/client/src/components/settings/vault/__tests__/VaultSection.test.tsx — remedies `["use-host","request-access","sign-in"]`, base = origin · render refusal · three rows in order; `vault-operate-request-access` `href="/pair?request"`, no `target` (test-plan #E20)
- [x] 12.5 Test request-access row for another server — see packages/client/src/components/settings/vault/__tests__/VaultSection.test.tsx — same remedies, base `http://192.168.16.204:8000`, origin `http://192.168.16.31:8000` · render · `href="http://192.168.16.204:8000/pair?request"`, `target="_blank"`, `rel` contains `noopener` (test-plan #E21)
- [x] 12.6 Test unknown remedy ignored — see packages/client/src/components/settings/vault/__tests__/VaultSection.test.tsx (existing unknown-remedy case, value switched to `future-remedy`) — `["use-host","future-remedy"]` · render · one `use-host` row (test-plan #E22)
- [x] 12.7 Test link keeps targeting the refusing server — see packages/client/src/components/settings/vault/__tests__/VaultSection.test.tsx — refusal stored with base `http://192.168.16.204:8000`, then api-base context switched to `http://192.168.16.31:8000` without reload · re-render · `href` stays `http://192.168.16.204:8000/pair?request` (test-plan #F1)
- [x] 12.8 Test i18n parity — see packages/client/src/__tests__/i18n.test.ts — keys `vault.operateRequired.request-access`, `vault.operateRequired.requestAccessLink` · run the suite with the dynamic list extended · present in en-source, hu, zh-CN; green (test-plan #E23)
- [x] 12.9 Test retry stays single-flight with the new row — see packages/client/src/components/settings/vault/__tests__/VaultSection.test.tsx (existing single-flight case) — callout with a `request-access` row · activate Try again twice before settle · one `fetchVault` call; control disabled + `aria-busy="true"` until settle (test-plan #F2)
- [x] 12.10 Test older-server and other failures unchanged — see packages/client/src/components/settings/vault/__tests__/VaultSection.test.tsx (existing cases) — 403 `operate_required` without `remedies`; network error; 500 · render · generic "Couldn't load the vault: …" line, no callout (test-plan #X6)

## 13. L3 — browser end-to-end (Playwright)

- [x] 13.1 Author `tests/e2e/vault-request-access.spec.ts` — see tests/e2e/lan-knock.spec.ts (credential-free device context on `http://127.0.0.1:<dashboardPort>`, docker-gateway peer) and tests/e2e/blackhole-settings.spec.ts (Settings navigation) — harness seed trusting `0.0.0.0/0`, credential-free device context · open Settings → Vault, click the request-access link · `vault-operate-required` visible with a `data-remedy="request-access"` row; URL becomes `/pair?request` and the request-mode landing renders; no `POST /api/pair/request` is issued by the click. Add its `.AGENTS.md` sidecar row (test-plan #F3)

## 14. Manual

- [ ] 14.1 On a 375 px viewport, check the Vault callout with three rows: copy wraps legibly, the Request access link is reachable (44 px target), the conditional wording reads naturally (test-plan: manual-only, #F4)
