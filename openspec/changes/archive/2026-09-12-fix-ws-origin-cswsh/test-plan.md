# Test Plan — fix-ws-origin-cswsh

Stage: design   Generated: 2026-09-12

Requirement refs: `CSRG` = `specs/cross-site-request-gate/spec.md`, `DS` = `specs/dashboard-server/spec.md`. Design refs `D1`–`D5` = `design.md`.

Levels: L1 = vitest in `packages/server/src/__tests__/` (pure helpers, `fastify.inject`, and real-listener WS tests via `createTestServer`); L3 = Playwright `tests/e2e/` against the docker harness (port from `.pi-test-harness.json`); L2 = `qa/tests/*.sh`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | CSRG WS gate / D1 | decision-table | L1 | automated | `isWsOriginTrusted` table: origin ∈ {undefined, `http://localhost:8000`, `http://127.0.0.1:1`, `http://[::1]:8000`, `http://attacker.example`, `null`, `https://xyz.share.zrok.io` (not live), `https://abc.share.zrok.io` (live), `https://pi-dashboard.dev`, configured `https://dash.example`, trusted-net `http://10.0.0.5:8000`} × scope ∈ {browser, terminal, live, bridge, null} | call helper | undefined→true all scopes; loopback/IPv6/live-zrok/pi-dashboard.dev/configured/trusted→true; attacker/stranger-zrok→false all scopes; `null`→true only for `live` |
| E2 | CSRG delta (a) / D1 rule 1 | EP+BVA (normalization) | L1 | automated | (origin, host) pairs: (`http://mac.local:8000`,`mac.local:8000`), (`http://MAC.local:8000`,`mac.local:8000`), (`http://mac.local`,`mac.local`), (`http://mac.local`,`mac.local:80`), (`http://[::1]:8000`,`[::1]:8000`), (`http://mac.local:8000`,`mac.local:8001`), (`http://mac.local:8000`,undefined), (`https://mac.local:8000`,`mac.local:8000`) | `isOriginAdmitted` | first five → true; port mismatch → false; missing Host → false (falls to CORS decision); scheme is ignored for the host comparison → true |
| E3 | CSRG delta (b) / D1 rule 2 | decision-table | L1 | automated | `isCorsOriginAllowed(`https://xyz.share.zrok.io`, {allowZrokWildcard: default})` vs `{allowZrokWildcard:false}`; same for `*.shares.zrok.io` | call | default → true (CORS unchanged); false → false; live tunnel origin → true in both |
| E4 | CSRG WS gate "runs first, every path" | state-transition | L1 | automated | real server; `ws` client with `headers:{origin:"http://attacker.example"}` to `/ws`, `/ws/terminal/<liveId>`, `/live/<liveId>`, `/ws/bridge`, `/ws/nope` | connect | every dial fails with `Unexpected server response: 403`; `/ws/bridge` does NOT return its usual `400` |
| E5 | CSRG "Header-less local client admitted" / DS | happy | L1 | automated | real server; `ws` client with no origin header, and with `origin: http://127.0.0.1:<port>` | connect `/ws` | open event fires, `sessions_snapshot` received |
| E6 | CSRG "Hostname-addressed same-origin" | happy | L1 | automated | real server; `ws` client `headers:{host:"mac.local:<port>", origin:"http://mac.local:<port>"}` (peer loopback) | connect `/ws` | upgrade completes (open event) |
| E7 | CSRG null-origin scope rule | decision-table | L1 | automated | real server; `origin: null` header to `/ws`, `/ws/terminal/<id>`, `/live/<id>` | connect | `/ws` and terminal → `403`; `/live/<id>` → not `403` (proxy proceeds or destroys per target presence, never a `403` from the gate) |
| E8 | CSRG terminal scenario | state-transition | L1 | automated | terminal `T` created via `create_terminal` over a trusted socket | attacker-origin dial `/ws/terminal/T` then write `"id\n"` | `403`; `terminalManager.get(T).clients.size === 0` (or equivalent attach count) unchanged; no PTY output produced |
| E9 | CSRG "Untrusted Origin does not consume a ticket" | state-transition | L1 | automated | ticket `t` minted via `POST /api/ws-ticket` scope `browser`; `REMOTE_HEADERS` (`x-forwarded-for`) | dial `/ws?ticket=t` with attacker origin → `403`; redial `/ws?ticket=t` with `origin: http://127.0.0.1:<port>` | second dial opens (ticket still valid, consumed exactly once) |
| E10 | CSRG pi-gateway | decision-table | L1 | automated | `decideBridgeUpgrade` rows: transport tcp, loopback, `headers.origin` ∈ {`http://attacker.example`, `http://localhost:8000`, `null`, `""`} × {no ticket, valid local token, valid ticket}; transport unix with `origin: http://x` | call | every tcp row with origin defined → `{allow:false, cause:"browser-origin"}` (including valid token / ticket); unix row → allow; rows without origin → previous verdicts byte-identical |
| E11 | CSRG pi-gateway real listener | state-transition | L1 | automated | pi-gateway TCP port up (pattern `bridge-local-token-upgrade.test.ts`); `ws` client with `origin: http://attacker.example` and no ticket | connect | `Unexpected server response: 401`; `sessions` registry size unchanged; log contains `[pi-gateway]` line with `browser-origin` |
| E12 | CSRG REST gate | decision-table | L1 | automated | `fastify.inject` matrix: method ∈ {POST, PUT, DELETE, PATCH, GET, HEAD, OPTIONS} × origin ∈ {absent, `http://127.0.0.1:8000`, `http://attacker.example`, `null`} on `/api/tunnel-connect` | inject | POST/PUT/DELETE/PATCH + attacker/`null` → `403` `{error:"untrusted origin"}`; absent/loopback → not `403`; GET/HEAD/OPTIONS with attacker → not `403` |
| E13 | CSRG REST gate path matching | EP (URL variants) | L1 | automated | `POST //api/tunnel-connect`, `POST /api//tunnel-connect`, `POST /API/tunnel-connect` with attacker origin; spy on route handler | inject | handler never invoked; status ∈ {403, 404} |
| E14 | CSRG `/auth/logout` | happy/negative | L1 | automated | auth plugin registered; `POST /auth/logout` with attacker origin vs loopback origin | inject | attacker → `403` and no `set-cookie` clearing `pi_dash_token`; loopback → `200`/redirect with cookie cleared |
| E15 | CSRG REST gate scope | negative | L1 | automated | `POST /auth/login` (if any POST auth route exists) / `GET /auth/callback/github?code=x` with attacker origin; `POST /editor/...` proxied path with attacker origin | inject | none of these return the gate's `403 {error:"untrusted origin"}` |
| E16 | CSRG "Plain-LAN pairing page can pair" | happy | L1 | automated | `POST /api/pair/challenge` with `host: 192.168.1.5:8000`, `origin: http://192.168.1.5:8000` | inject | not `403` (route's own status) |
| E17 | CSRG shell pairing | happy | L1 | automated | `POST /api/pair/challenge` with `origin: https://pi-dashboard.dev` | inject | not `403` |
| E18 | D1 live options | state-transition | L1 | automated | server with `cors.allowedOrigins=[]`; dial `/ws` with `origin: https://dash.example` → `403`; then write config `cors.allowedOrigins=["https://dash.example"]` (mtime-gated reload) | redial | second dial opens without server restart |

### Performance

_No latency/throughput budget is stated in the spec for the gate; the helper is O(configured origins) string compares on a path already doing JWT/ticket work. No perf rows._

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | proposal Impact "clients unaffected" | state-convergence | L3 | automated | harness dashboard at `http://localhost:<dashboardPort>` | page load → create terminal via UI → type `echo ok` | terminal pane converges to contain `ok`; no `[ws-gate]` line in harness server log |
| F2 | CSRG WS gate (browser reality) | state-transition | L3 | automated | second static origin served by Playwright (`page.route` on `http://attacker.test/`) with the issue's inline PoC script pointed at `ws://127.0.0.1:<dashboardPort>/ws` | click "Launch Attack Chain" / run `new WebSocket(...)` | WS `onerror` fires, `onopen` never; no `sessions_snapshot` text rendered; harness server log has `[ws-gate] rejected upgrade origin=http://attacker.test scope=browser` |
| F3 | CSRG REST gate (browser reality) | state-transition | L3 | automated | attacker origin page (as F2) | `fetch("http://127.0.0.1:<port>/api/tunnel-connect",{method:"POST",mode:"no-cors"})` | `GET /api/tunnel/status` (from dashboard origin) unchanged before/after; server log has `[csrf-gate] rejected POST /api/tunnel-connect origin=http://attacker.test` |
| F4 | D3 live preview | state-transition | L1 | automated | real server (`live-server-endpoint.test.ts` pattern) with a live entry `L` whose upstream is a local `ws` server; client dial `/live/L` with `origin: null` | connect | upstream `connection` event fires with no `origin` header (proxy strips it); client `open` fires; no `[ws-gate]` log line |
| F5 | proposal Impact (pairing) | regression | L3 | automated | existing `tests/e2e/pairing-qr.spec.ts` + `security-pair-link.spec.ts` flows | run unchanged | still green; harness server log contains no `[csrf-gate]` line for `/api/pair/*` |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | CSRG "Rejections are logged" / D5 | fault-injection (hostile input) | L1 | automated | origin `"http://a.example\u001b[31m\n[fake] line"` + 600-char origin | dial `/ws` | `403`; captured log line is single-line, contains no `\u001b`/`\n`, origin field ≤ 256 chars, tag `[ws-gate]` |
| X2 | D-risk "Origin header shape" | fault-injection (malformed) | L1 | automated | origin ∈ {`"not a url"`, `"http://"`, `"http://localhost:8000, http://evil.example"`, `" http://localhost:8000"`} | `isOriginAdmitted` + real dial `/ws` | helper false, dial `403`; no exception escapes (server stays up, next good dial opens) |
| X3 | CSRG REST gate | fault-injection (malformed) | L1 | automated | `POST /api/tunnel-connect` with `origin: ""` and with `origin: "null "` (trailing space) | inject | `403` for both; process does not throw |
| X4 | D4b unix exemption | negative | L1 | automated | unix-socket bridge upgrade whose request carries `origin: http://x` (synthetic) | `decideBridgeUpgrade` transport unix | allow (unaffected) |
| X5 | proposal "header-less non-browser clients" | regression + negative | L2 | automated | running server; `curl -X POST /api/terminals -d '{"cwd":"/tmp"}'` without Origin, then the same with `-H 'Origin: http://attacker.example'` | qa smoke | first → `200` with `id`; second → `403` |
| X6 | issue #625 PoC | manual repro | — | manual-only | issue's inline PoC HTML self-hosted at `http://127.0.0.1:8899` (never the reporter's remote URL) | "Launch Attack Chain" + CSRF button; `new WebSocket('ws://127.0.0.1:<piPort>')` | [judgment: reviewer confirms every step fails and logs show `[ws-gate]`, `[csrf-gate]`, `[pi-gateway]` lines — same as F2/F3 but against a real desktop browser + real desktop dashboard] |
| X7 | D1 rule 2 cost (external zrok) | manual repro | — | manual-only | dashboard behind a hand-run `zrok share public` (not the dashboard tunnel feature) | open dashboard via that share; then add share origin to `cors.allowedOrigins` | [judgment: before → WS refused with `[ws-gate]` line; after → works. Documents the release-note escape hatch; depends on external zrok account] |

---

## Coverage summary

- Requirements covered: 7/7 (CSRG ×5 requirements, DS ×1 modified requirement, plus design invariants D1/D3/D4b/D5)
- Scenarios by class: edge 18 · perf 0 · frontend 5 · error 7
- Scenarios by level: L1 22 · L2 1 · L3 4 · manual 2 (— level)
- Scenarios by disposition: automated 28 · manual-only 2

## New infra needed

- none for L1 (`createTestServer`, `ws` client with `headers`, `fastify.inject`, existing `bridge-local-token-upgrade.test.ts` gateway boot all exist).
- L3 F2/F3 need an **attacker origin page** — achievable with Playwright `page.route("http://attacker.test/**", fulfil html)` (no new server); check `tests/e2e/` for an existing cross-origin fixture before adding one.
- No live-preview e2e exists (would need a Vite project inside the harness) — F4 is routed to L1 with a fake upstream WS server instead.
