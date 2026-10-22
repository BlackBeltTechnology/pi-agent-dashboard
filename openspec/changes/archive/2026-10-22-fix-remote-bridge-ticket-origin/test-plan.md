# Test Plan — fix-remote-bridge-ticket-origin

Stage: design   Generated: 2026-10-22

Hard gate passed: every Triple slot fills from `specs/pi-gateway-auth/spec.md` + `design.md` D1–D4. No clarifications.

Requirement refs: **R1** = "A remote bridge sends its HTTP credential calls to the dashboard HTTP origin"; **R2** = "An explicit dashboard HTTP URL is pinned, scoped and fails closed"; **R3** = "A wrong dashboard HTTP origin is reported distinctly".

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 (default topology) | EP | L1 | automated | endpoint `ws://dash.example:9999`, env `{}` | `resolveDashboardHttpOrigin(endpoint, env)` | `{ ok: true, origin: "http://dash.example:8000", source: "endpoint-host+http-port" }` |
| E2 | R1 (port precedence) | decision-table | L1 | automated | endpoint `ws://dash.example:9999`; env rows: `{PI_DASHBOARD_PORT:"18000",DASHBOARD_PORT:"28000"}`, `{DASHBOARD_PORT:"28000"}`, `{PI_DASHBOARD_PORT:"abc"}`, `{PI_DASHBOARD_PORT:"70000"}`, `{PI_DASHBOARD_PORT:"0"}` | resolve each row | origins `:18000`, `:28000`, `:8000`, `:8000`, `:8000` respectively (unusable values ignored, never shadow) |
| E3 | R1 (bridge machine config not read) | EP | L1 | automated | `~/.pi/dashboard/config.json` (temp HOME) with `port: 4321`; endpoint `ws://dash.example:9999`; env `{}` | resolve | origin `http://dash.example:8000` — never `:4321` |
| E4 | R1 (IPv6) | BVA | L1 | automated | endpoint `ws://[fd00::1]:9999`, env `{}` | resolve | origin `http://[fd00::1]:8000` (brackets kept) |
| E5 | R1 (TLS / port-less keep origin) | decision-table | L1 | automated | endpoints `wss://dash.example:8443`, `wss://dash.example`, `ws://dash.example`, `ws://dash.example:80`, `wss://dash.example:443`; env `{PI_DASHBOARD_PORT:"18000"}` | resolve each | origins `https://dash.example:8443`, `https://dash.example`, `http://dash.example`, `http://dash.example`, `https://dash.example`; all `source: "endpoint-origin"`; `PI_DASHBOARD_PORT` ignored |
| E6 | R1 (no http origin) | EP | L1 | automated | endpoints `http://dash.example:9999`, `ws+unix:/tmp/gw.sock`, `not a url` | resolve | `{ ok: false, cause: "no-http-origin" }` for each |
| E7 | R2 (override wins, origin only) | EP | L1 | automated | endpoint `ws://dash.example:9999`; env `{PI_DASHBOARD_HTTP_URL:"https://dash.example/base/path?q=1#f"}` | resolve | `{ ok: true, origin: "https://dash.example", source: "PI_DASHBOARD_HTTP_URL" }` |
| E8 | R2 (scope via `PI_DASHBOARD_URL` host) | EP | L1 | automated | endpoint `ws://GW.example:9999`; env `{PI_DASHBOARD_URL:"ws://gw.example:9999", PI_DASHBOARD_HTTP_URL:"https://proxy.example"}` | resolve | origin `https://proxy.example` (hostname comparison case-insensitive via WHATWG lowercasing) |
| E9 | R2 (re-target out of scope) | state-transition | L1 | automated | env `{PI_DASHBOARD_URL:"ws://a.example:9999", PI_DASHBOARD_HTTP_URL:"http://a.example:8000"}`; endpoint `ws://b.example:9999` | resolve | origin `http://b.example:8000`, source `endpoint-host+http-port`; `a.example` absent from result |
| E10 | R2 (invalid override fails closed, before scope) | decision-table | L1 | automated | override values `not a url`, `ftp://dash.example`, `http://u:p@dash.example`, `http://:p@dash.example`, `javascript:alert(1)` × endpoints `ws://dash.example:9999` (in scope) and `ws://other.example:9999` (out of scope) | resolve each of 10 cells | every cell `{ ok: false, cause: "bad-http-url" }`; no cell returns `ok: true` |
| E11 | R2 (blank override = unset) | BVA | L1 | automated | override `""` and `"   "`; endpoint `ws://dash.example:9999` | resolve | identical to E1: `http://dash.example:8000`, source `endpoint-host+http-port` |
| E12 | R1 (live query targets HTTP origin) | EP | L1 | automated | `createHttpLiveQuery({ endpoint: () => "ws://dash.example:9999", env: { PI_DASHBOARD_TOKEN: "t" }, fetchImpl: spy })` | query with `remote: true` | spy called once with URL `http://dash.example:8000/api/pi-trust/query` |
| E13 | R1 (identity challenge targets HTTP origin) | EP | L1 | automated | pinned store (one pin, `lastEndpoint ws://dash.example:9999`); endpoint `ws://dash.example:9999`; env `{}`; challenge stub | `gateRemoteRegistration({ endpoint, store, env, challenge })` | stub called once with `baseUrl` `http://dash.example:8000` |
| E14 | R1 (end-to-end, real two-port topology) | state-transition | L1 | automated | `createTestServer()` (distinct `httpPort` ≠ `piPort`, gateway TCP on); real paired-device bearer from `PairedDeviceRegistry` | resolve `ws://127.0.0.1:<piPort>` with env `{PI_DASHBOARD_PORT:String(httpPort)}` → `mintBridgeTicket` → `withTicket` → dial gateway | mint `ok: true`; WebSocket reaches `open` (HTTP 101); control arm minting from `http://127.0.0.1:<piPort>` returns `cause: "wrong-origin"` with status `426` in the reason |

### Performance

None — no latency/throughput requirement in the delta. The resolver is a pure synchronous URL parse on the dial path, so no budget is defined or needed.

### Frontend-quirk

None — no rendered UI changes.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R3 (gateway answers mint) | fault-injection (abort) | L1 | automated | `fetchImpl` stub returns `426 Upgrade Required` | `mintBridgeTicket({ httpBase: "http://dash.example:9999", token: "t" })` | `cause: "wrong-origin"`; reason contains `http://dash.example:9999/api/ws-ticket`, `426`, `PI_DASHBOARD_HTTP_URL`; reason does NOT contain `revoked` |
| X2 | R3 (status taxonomy) | decision-table | L1 | automated | stub statuses `401`, `403`, `400`, `404`, `500`, `503` | mint each | `401`→`refused`, `403`→`refused`, `400`/`404`/`500`/`503`→`wrong-origin` |
| X3 | R3 (redirect never followed with bearer) | fault-injection (abort) | L1 | automated | real `node:http` server on ephemeral port answering `307` `Location: /api/ws-ticket2` (same origin) | mint against it with real `fetch` | `cause: "wrong-origin"`; server request log has exactly 1 request (no second request carrying `Authorization`) |
| X4 | R3 (network error unchanged) | fault-injection (abort) | L1 | automated | closed ephemeral port (ECONNREFUSED) | mint | `cause: "unreachable"` (not `wrong-origin`) |
| X5 | R2 (gate refuses with resolver cause) | fault-injection (abort) | L1 | automated | pinned store; env `{PI_DASHBOARD_HTTP_URL:"ftp://dash.example"}`; challenge stub | `gateRemoteRegistration` | `{ allow: false, cause: "bad-http-url" }`; challenge stub call count 0 |
| X6 | R2 (live query fails closed) | fault-injection (abort) | L1 | automated | `createHttpLiveQuery` remote, env `{PI_DASHBOARD_TOKEN:"t", PI_DASHBOARD_HTTP_URL:"not a url"}`, `fetchImpl` spy | query twice | result kind `error` both times; spy call count 0; exactly 1 log line naming `bad-http-url` (once per distinct cause) |
| X7 | R2 (ticket mint path fails closed) | fault-injection (abort) | L1 | automated | remote endpoint `ws://dash.example:9999`; env `{PI_DASHBOARD_TOKEN:"t", PI_DASHBOARD_HTTP_URL:"ftp://x"}`; `fetchImpl` spy | prepare-remote-upgrade step (the `bridge.ts` mint preparer, exercised directly) | rejects/throws; logged line starts `[dashboard] bridge ticket bad-http-url:`; spy call count 0; no dial URL produced |
| X8 | R3 (origin logged on change, deduped, no bearer) | state-transition | L1 | automated | token `secret-bearer-123`; endpoint `ws://a.example:9999` then re-target `ws://b.example:9999` | run the mint preparer 3× for `a`, then 1× for `b` | exactly 2 `http origin` lines: `http origin http://a.example:8000 (endpoint-host+http-port)` then `…b.example:8000…`; `transportDiagnostics.record` receives the same 2; no captured console/diagnostic output contains `secret-bearer-123` |
| X9 | R1 (local bridge unaffected by bad override) | EP | L1 | automated | endpoints `ws://127.0.0.1:9999` and `ws+unix:/tmp/gw.sock`; env `{PI_DASHBOARD_HTTP_URL:"not a url"}`; `fetchImpl` spy | mint preparer + `gateRemoteRegistration` | preparer resolves `undefined` (no mint); gate returns `cause: "local"`, `allow: true`; spy call count 0; no `bad-http-url` log |
| M1 | R1 (real cross-machine remote bridge) | exploratory | — | manual-only | docker dashboard on host A (default ports 8000/9999), paired device token | on host B run pi with `PI_DASHBOARD_URL=ws://<A>:9999` + `PI_DASHBOARD_TOKEN` | [judgment: two physical machines on one network; session appears in A's dashboard with the remote origin chip and bridge log shows `http origin http://<A>:8000` — not reproducible in CI without a second host] |

---

## Coverage summary

- Requirements covered: 3/3 (R1: E1–E6, E12–E14, X9, M1 · R2: E7–E11, X5–X7 · R3: X1–X4, X8)
- Scenarios by class: edge 14 · perf 0 · frontend 0 · error 10
- Scenarios by level: L1 23 · L2 0 · L3 0 · manual 1
- Scenarios by disposition: automated 23 · manual-only 1

## New infra needed

- none — `createTestServer` already serves distinct `httpPort`/`piPort` with gateway TCP (`packages/server/src/test-support/test-server.ts:27-57`); `PairedDeviceRegistry` used by `pi-trust-live-integration.test.ts`.
