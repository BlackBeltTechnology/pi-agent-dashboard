# Test Plan — fix-trusted-network-tunnel-bypass

Stage: design   Generated: 2026-09-28

Hard gate: no unfillable Triples — every slot resolved from `specs/trusted-networks/spec.md` + `design.md` D1–D4.

Notation: "relayed loopback" = socket peer in loopback range **and** ≥1 core forwarding header (`x-forwarded-for`, `x-forwarded-proto`, `x-forwarded-host`, `x-real-ip`, `forwarded`).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Relayed loopback never trusted | decision-table | L1 | automated | peer ∈ {`127.0.0.1`, `::1`, `::ffff:127.0.0.1`, `127.0.0.5`, `::ffff:127.0.0.5`} × header ∈ {`x-forwarded-for: 203.0.113.9`, `x-forwarded-proto: https`, `forwarded: for=203.0.113.9`, `x-real-ip: 203.0.113.9`, `x-forwarded-host: a.shares.zrok.io`} × trusted ∈ {`["127.0.0.1"]`, `["127.0.0.0/8"]`, `["127.*"]`, `["0.0.0.0/0"]`} | `isTrustedSource(peer, headers, trusted)` | returns `false` for every one of the 100 cells |
| E2 | Genuine traffic keeps matcher result | decision-table | L1 | automated | loopback peers of E1 with NO forwarding header; LAN peer `192.168.16.20` and public `203.0.113.9` with header ∈ {none, `x-forwarded-for`}; trusted ∈ {`[]`, `["127.0.0.0/8"]`, `["192.168.16.0/24"]`} | `isTrustedSource` | equals `trusted.length > 0 && isBypassedHost(peer, trusted)` for every cell (e.g. `192.168.16.20`+XFF+LAN CIDR → `true`; any peer + `[]` → `false`) |
| E3 | Empty/array header fail-closed | EP | L1 | automated | peer `127.0.0.1`, trusted `["127.0.0.1"]`, headers `{ "x-forwarded-for": "" }` and `{ "x-forwarded-for": ["a","b"] }` | `isTrustedSource` | `false` for both |
| E4 | `isLoopbackRange` boundaries | BVA | L1 | automated | `126.255.255.255`, `127.0.0.0`, `127.255.255.255`, `128.0.0.0`, `::1`, `::2`, `::FFFF:127.0.0.1`, `::ffff:128.0.0.1`, `localhost`, `""` | `isLoopbackRange(ip)` | `false, true, true, false, true, false, true, false, false, false` |
| E5 | Network guard: tunnel repro | decision-table | L1 | automated | auth off, trusted `["127.0.0.1"]`, `GET /api/sessions`, `remoteAddress: 127.0.0.1`, `x-forwarded-for: 203.0.113.9` | `app.inject` | 403, body `error === "network_not_allowed"` (red on current code: 200) |
| E6 | Network guard: genuine local | decision-table | L1 | automated | same as E5 without the header; plus auth ON, no cookie | `app.inject` | 200 in both auth modes |
| E7 | Paired device over tunnel | decision-table | L1 | automated | E5 request + valid device bearer (`Authorization: Bearer <token>`) | `app.inject` | 200; `request.authVia === "bearer"`; device-tier gate evaluated (see E10) |
| E8 | OAuth bypass-host skip | decision-table | L1 | automated | auth ON, `bypassHosts: ["127.0.0.1"]`, relayed loopback, no cookie; control: peer `192.168.16.20`, `bypassHosts: ["192.168.16.0/24"]` | `onRequest` on `GET /api/sessions` | relayed: `isAuthenticated` false and request denied (401/redirect/403 — not 200); LAN control: skipped → 200 (red on current code: relayed skipped) |
| E9 | `validateWsUpgrade` | decision-table | L1 | automated | trusted `["127.0.0.1"]`; (a) peer `127.0.0.1` + `x-forwarded-for`, no cookie, no ticket; (b) peer `192.168.16.20`, trusted `["192.168.16.0/24"]`; (c) (a) + valid `browser` ticket | `validateWsUpgrade(cookie, peer, secret, trusted, {headers, ticket, scope, consumeTicket})` | (a) `false` (b) `true` (c) `true` |
| E10 | Device-tier exemption | decision-table | L1 | automated | device bearer tier `read`; relayed loopback; trusted `["127.0.0.1"]`; route tier `operate`; control peer `192.168.16.20` + trusted `["192.168.16.0/24"]` | `tierRefusalFor(request, "operate", getTrusted)` | relayed: non-null refusal; LAN control: `null` (red on current code: relayed returns `null`) |
| E11 | Real WS upgrade, auth off | state-transition | L1 | automated | `createTestServer`, config `{ trustedNetworks: ["127.0.0.1"] }`; ws client to `/ws` from `127.0.0.1` with header `x-forwarded-for: 203.0.113.9`; control without header | WS upgrade on the real handler | relayed: `unexpected-response` status 403 + one `[ws-upgrade]` log line `status=403`; control: `open` |
| E12 | Loopback-covering detection | EP | L1 | automated | each of `127.0.0.1`, `127.0.0.0/8`, `127.*`, `0.0.0.0/0`, `::1`, `127.0.0.5`, `127.0.0.4/30`, `::1/128`; and each of `192.168.16.0/24`, `10.*`, `*`, `203.0.113.9` | `loopbackCoveringEntries([e])` | first group → `[e]`; second group → `[]` |
| E13 | Warning dedup by signature | state-transition | L1 | automated | `console.warn` spy; list A = `["127.0.0.1","192.168.16.0/24"]` | `noteTrustedList(A)` ×1000 (same ref) → new array equal to A → `[...A,"127.0.0.2"]` → `["192.168.16.0/24"]` | warn count after each step: 1, 1, 2, 2; matcher invoked only on ref change (spy on `loopbackCoveringEntries`: 3 calls for 1000+3 invocations) |
| E14 | Health `trustPosture` disclosure | decision-table | L1 | automated | trusted ∈ {`["127.0.0.1"]`, `["192.168.16.0/24"]`}; caller ∈ {genuine-local, `203.0.113.9`, relayed loopback} | `GET /api/health` via inject | genuine-local: `trustPosture.trustedHasLoopback` = `true` / `false`; remote and relayed: `trustPosture === null`; `accessGrants` shape unchanged |
| E15 | No grant prompt for relayed denial | decision-table | L1 | automated | observer spy via `setNetworkDenialObserver`; auth off, trusted `[]`; (a) relayed loopback; (b) peer `192.168.16.30` no header | guarded `GET /api/sessions` → 403 | (a) observer 0 calls; `blockEvents` entry for `127.0.0.1` with `trustable: false`; (b) observer 1 call |
| E16 | Single predicate — no drift | static scan | L1 | automated | `packages/server/src/**/*.ts` excluding `__tests__`, comments stripped | scan for `isBypassedHost(` | occurrences only in `auth/localhost-guard.ts` and `auth/cors-origin.ts` |

### Performance

None beyond E13 (hot-path cost pinned as call-count: one reference compare per request on an unchanged trusted array).

### Frontend-quirk

None — no client change; existing `network_not_allowed` banner renders unchanged.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Relayed loopback denied on a live process | state-transition | L2 | automated | running server (from `02-server-start.sh`); `PUT /api/config {"trustedNetworks":["127.0.0.1"]}` from loopback (no header) | `curl -H 'X-Forwarded-For: 203.0.113.9' $BASE/api/sessions`; then same without header; then restore config | first: HTTP 403 and body contains `network_not_allowed`; second: 200; restore PUT returns 200 (config is live — no restart) |
| X2 | Real tunnels inject a core header | manual verification | — | manual-only | live zrok v2, ngrok and `tailscale serve` shares to a dashboard with request logging | one browser request through each | server log / echo shows ≥1 of the 5 core headers per provider; findings recorded in `design.md` Risks |
| X3 | End-to-end on the reporter's instance | manual verification | — | manual-only | live instance, `trustedNetworks: ["192.168.16.0/24","127.0.0.1"]`, zrok share active | after `POST /api/restart`: unauthenticated public-URL `GET /api/sessions`; desktop dashboard on localhost; LAN browser in `192.168.16.0/24`; paired phone over zrok | 403 `network_not_allowed`; desktop, LAN browser and paired phone all load sessions |

---

## Coverage summary

- Requirements covered: 6/6 (relayed-loopback predicate · inert-entry report · relayed-denial no-prompt · network guard factory · WS upgrade · auth-plugin merged list)
- Scenarios by class: edge 16 · perf 0 · frontend 0 · error 3
- Scenarios by level: L1 16 · L2 1 · L3 0
- Scenarios by disposition: automated 17 · manual-only 2

## New infra needed

- none (L1 exemplars: `localhost-guard.test.ts`, `auth-plugin.test.ts`, `forwarded-ip-trust.test.ts`, `route-tier-gate.test.ts`, `ws-upgrade-reject-wiring.test.ts`, `health-access-grants.test.ts`, `access-grant-denial-sites.test.ts`, `core-goal-free.test.ts`; L2 exemplar: `qa/tests/04-ws-ticket-auth.sh`). No L3: every observable is an HTTP/WS status, and the docker harness cannot present a loopback socket peer from Playwright.
