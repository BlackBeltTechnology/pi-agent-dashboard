# Test Plan — add-request-access-remedy

Stage: design   Generated: 2026-10-15

Gate answers folded (scenario-design HARD gate): G1 add one L3 Playwright spec for the Vault callout → Request access link, plus L1 · G2 extend the predecessor's L1 refusal budget to include the knock-gate thunk (1000 refusals ≤ 1000 ms).

Spec refs: `ORR` = `operate-required-remedy` delta; `TCB` = `trust-and-credential-boundaries` delta.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | ORR reason/remedies › knock peer gate extracted (design D1) | decision-table | L1 | automated | `knockPeerGate` inputs: non-admitted Host + on-link peer; admitted Host + `X-Forwarded-For`; admitted Host + loopback `127.0.0.1`; missing peer; `100.64.0.5` on a `/32` interface; `192.168.16.40` on `192.168.16.1/24` | call `knockPeerGate(input, state)` | `host_not_admitted` (checked before peer), `knock_not_lan` ×4, `null` |
| E2 | ORR › knock route unchanged (non-goal) | regression | L1 | automated | existing `admitKnock` / `POST /api/pair/request` cases incl. gate-order cases | run `knock-admission.test.ts` + `pair-request-route.test.ts` after the extraction | every existing assertion passes unchanged; route reads input via `knockPeerInput` and state via `knockPeerState` |
| E3 | ORR › single input builder | EP | L1 | automated | requests with `host` as string, as `["a","b"]` array, absent; `socket.remoteAddress` set / undefined | `knockPeerInput(request)` | `host` equals `headerString` result (first string / undefined); `peer` equals raw socket address, never `request.ip` |
| E4 | ORR `request-access` presence rule | decision-table | L1 | automated | `authVia` ∈ {unset, device(control), device(operate-refused n/a), session(control), principal} × `requestAccessAvailable` ∈ {true, false, omitted} × `loginAvailable` ∈ {true, false} | `sendOperateRequired` on a stub reply | `request-access` present only for (`authVia` unset, thunk true); order `use-host, re-pair, request-access, sign-in`; never with `re-pair`; omitted option → never present; body keys exactly `success,error,message,reason,remedies` |
| E5 | ORR thunk › local credential is a credential | EP | L1 | automated | on-link request with valid `X-Pi-Local-Token`; with valid `pi_dash_local` cookie; with neither | server-built `requestAccessAvailable(req)` | false, false, true |
| E6 | ORR scenario "On-link LAN browser without a credential can request access" | EP | L1 | automated | `trustedNetworks` `["192.168.16.0/24"]`, injected interfaces `192.168.16.1/24`, `remoteAddress` `192.168.16.40`, admitted Host, no credential, no login | inject `GET /api/vault` | 403 `reason:"no-credential"`, `remedies` exactly `["use-host","request-access"]` |
| E7 | ORR scenario "All no-credential remedies in order" | EP | L1 | automated | E6 + OAuth provider with non-empty client id | inject `GET /api/vault` | `["use-host","request-access","sign-in"]` |
| E8 | ORR scenario "Network-admitted browser without a credential" (off-gate peer) | EP | L1 | automated | `trustedNetworks` includes `100.64.0.0/10`, interface `100.64.0.1/32`, `remoteAddress` `100.64.0.5`, no credential, no login | inject `GET /api/vault` | 403 `["use-host"]`, vault `no-credential` message, no `data` key |
| E9 | ORR scenario "Forwarded request gets no request-access" | EP | L1 | automated | E6 + header `X-Forwarded-For: 203.0.113.9` | inject `GET /api/vault` | `remedies` lacks `request-access` |
| E10 | ORR scenario "Non-admitted Host gets no request-access" | EP | L1 | automated | E6 with host gate in report mode + `Host: evil.test` | inject `GET /api/vault` | 403 `operate_required`; `remedies` lacks `request-access` |
| E11 | ORR scenario "Verified local credential gets no request-access" | EP | L1 | automated | E6 + valid local token (or local-proof cookie) on a non-operate path | inject `GET /api/vault` | `remedies` lacks `request-access` |
| E12 | ORR scenario "Trusted-network paired device below operate tier" (on-link) | EP | L1 | automated | E6 peer with `control` bearer | inject `GET /api/vault` | `reason:"tier-too-low"`, `["use-host","re-pair"]`, no `request-access` |
| E13 | ORR scenarios "Revoked bearer…" ×2 | EP | L1 | automated | revoked bearer from E8 peer; revoked bearer from E6 peer | inject `GET /api/vault` | `["use-host"]`; `["use-host","request-access"]`; both `reason:"no-credential"` |
| E14 | ORR scenario "Service mutation refusal uses the same reason and remedies" | EP | L1 | automated | E8 peer and E6 peer, no credential | inject a `/api/services*` mutation | same `reason`/`remedies` as the vault refusal for that peer; services `no-credential` message; service state unchanged |
| E15 | ORR "Admission unchanged" (regression) | EP | L1 | automated | operate bearer; operate / claim-less session JWT; principal; loopback strict off | inject `GET /api/vault` | 200 for each, as before |
| E16 | ORR wiring › one interface provider | static | L1 | automated | `packages/server/src/server.ts` source | source scan in a server test | exactly one `createLanInterfaceProvider(` call; the pairing routes and the vault/services deps receive the same `knockPeerDeps` |
| E17 | client › target helper (design D7) | EP | L1 | automated | `(apiBase, origin)`: `("", o)`; `(o, o)`; `("http://192.168.16.204:8000", "http://192.168.16.31:8000")`; `("http://x:8000/", "http://x:8000")` | `requestAccessTarget` | `{href:"/pair?request",newContext:false}` ×2; `{href:"http://192.168.16.204:8000/pair?request",newContext:true}`; trailing-slash base treated as a different server (`newContext:true`), matching today's banner |
| E18 | connection-status-banner regression | regression | L1 | automated | existing banner tests (same origin → `location.assign("/pair?request")`; other server → `window.open(url,"_blank","noopener")`) | run `ConnectionStatusBanner.test.tsx` after refactor | all pass unchanged |
| E19 | client › `VaultResult.base` | EP | L1 | automated | mocked `fetch`; `getApiBase()` returns `A` at call start and `B` before the response resolves | `fetchVault()` | `res.base === A` |
| E20 | ORR "On-link browser sees a request-access row" | EP | L1 | automated | `remedies` `["use-host","request-access","sign-in"]`, `apiBase` = origin | render `VaultSection` refusal | three `vault-operate-remedy` rows in that order; `vault-operate-request-access` link with `href="/pair?request"`, no `target` |
| E21 | ORR "Request access on another server" | EP | L1 | automated | same remedies, refusal base `http://192.168.16.204:8000`, origin `http://192.168.16.31:8000` | render + inspect link | `href="http://192.168.16.204:8000/pair?request"`, `target="_blank"`, `rel` contains `noopener` |
| E22 | ORR "Unknown remedy from a newer server" | EP | L1 | automated | `remedies` `["use-host","future-remedy"]` | render | exactly one row (`use-host`) |
| E23 | i18n parity | static | L1 | automated | `vault.operateRequired.request-access`, `vault.operateRequired.requestAccessLink` | `packages/client/src/__tests__/i18n.test.ts` (dynamic remedy list extended) | keys present in `i18n-en-source.json`, `i18n-hu.ts`, `i18n-zh-CN.ts`; test green |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | refusal builder budget incl. knock gate (G2) | throughput | L1 | automated | 1000 sequential `sendOperateRequired` calls on stub requests with on-link peer, `loginAvailable` composed from all three sources, real `requestAccessAvailable` thunk over a cached interface provider | total wall time ≤ 1000 ms | 1000 calls |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | ORR "Link keeps targeting the refusing server" | state-transition | L1 | automated | refusal stored with base `http://192.168.16.204:8000`; then api-base context switches to `http://192.168.16.31:8000` without reload | re-render callout | link `href` stays `http://192.168.16.204:8000/pair?request` |
| F2 | ORR "Retry is single-flight" with the new row (regression) | state-transition | L1 | automated | callout with `request-access` row | activate Try again twice before the load settles | one `fetchVault` call; control disabled + `aria-busy="true"` until settle; existing test still green |
| F3 | ORR + TCB end-to-end (G1) | convergence | L3 | automated | docker harness (seed trusts `0.0.0.0/0`), credential-free device context on `http://127.0.0.1:<dashboardPort>` (docker-gateway peer passes the knock gate, per lan-knock.spec.ts) | open Settings → Vault; click the request-access link | callout `vault-operate-required` visible with a `data-remedy="request-access"` row; after click the URL is `/pair?request` and the request-mode landing renders; no knock POST is issued by the click |
| F4 | ORR copy reads clearly at 375 px | visual/subjective | — | manual-only | Settings → Vault callout with three rows on a phone-width viewport | human looks | [judgment: row copy wraps legibly, link reachable (44 px target), conditional "if this dashboard accepts…" wording reads naturally] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | ORR disclosure › switch / knock state not disclosed | fault-injection (state flip) | L1 | automated | `pairing.acceptLanRequests` false → true; then a live knock from the same peer pending | refuse the E6 caller in each state | three bodies byte-identical, each containing `request-access` |
| X2 | ORR "Request access mirrors the public knock gates" | equivalence oracle | L1 | automated | four request shapes: E6; E9; E10; E8 | inject `GET /api/vault` and a same-origin JSON `POST /api/pair/request` (switch off) per shape | `request-access` present ⇔ knock answers `knock_disabled`; absent ⇔ `host_not_admitted` / `knock_not_lan` |
| X3 | ORR disclosure › body carries no address/subnet | fault-injection (sensitive fixture) | L1 | automated | trusted `192.168.16.0/24`, interface `192.168.16.1/24`, host name, device `dev-1` / `robson-mbp`, vault fixture | refuse the E6 caller and a `control` bearer from that range | exactly five keys; no string contains `192.168.`, the CIDR, the host name, `dev-1`, `robson-mbp`, or vault names |
| X4 | TCB "Other posture surfaces keep the predicate" | EP | L1 | automated | the E6 caller | `GET /api/health` | no `accessGrants` and no `trustPosture` in the body |
| X5 | ORR thunk › interface provider failure | fault-injection (abort) | L1 | automated | `getLanInterfaces` returns `[]` (e.g. provider error / no non-internal NIC) | refuse the E6 caller | `request-access` absent (fails closed); refusal still 403 with five keys |
| X6 | ORR "Older server without remedies" / "Other failure unchanged" (regression) | fault-injection (abort) | L1 | automated | 403 `operate_required` without `remedies`; network error; 500 | render `VaultSection` | generic "Couldn't load the vault: …" line; no callout; existing tests green |

---

## Coverage summary

- Requirements covered: 4/4. ORR: reason/remedies, disclosure, vault callout. TCB: exception.
- Scenarios by class: edge 23 · perf 1 · frontend 4 · error 6
- Scenarios by level: L1 32 · L2 0 · L3 1 · manual 1
- Scenarios by disposition: automated 33 · manual-only 1

## New infra needed

- none. F3 reuses the docker harness and `lan-knock.spec.ts` glue. L1 route tests use `app.inject({ remoteAddress })` (existing pattern, `vault-routes.test.ts:122-126`) plus an injected `getLanInterfaces`.
