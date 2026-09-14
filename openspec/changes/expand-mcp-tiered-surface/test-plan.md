# Test Plan — expand-mcp-tiered-surface

Stage: design   Generated: 2026-05-22

Levels: L1 = vitest in `packages/*/src/**/__tests__/`; L3 = Playwright in
`tests/e2e/` against the docker harness (port from `.pi-test-harness.json`).
No L2 rows: nothing here is OS/install-specific.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | bearer-device-auth: registry tier | EP | L1 | automated | `add("x","manual")` with no tier | `list()` | row has `tier: "observe"` |
| E2 | bearer-device-auth: registry tier | EP | L1 | automated | `add("x","pairing")` with no tier | `list()` | row has `tier: "operate"` |
| E3 | bearer-device-auth: registry tier | EP (invalid) | L1 | automated | `add("x","manual","root")` | call | throws; file unchanged (same byte length) |
| E4 | bearer-device-auth: legacy row | EP | L1 | automated | `paired-devices.json` row `{id,label,hash,createdAt}` (no `tier`, no `source`) | `verify(token)` + `list()` | returns `{ id, tier: "operate" }`; listed `source:"pairing"`, `tier:"operate"` |
| E5 | bearer-device-auth: unknown fields survive | state | L1 | automated | row with extra field `"futureField": 1` | `add()` another row, then `revoke()` it | file still contains `"futureField": 1` on the original row |
| E6 | bearer-device-auth: mint routes | decision-table | L1 | automated | `POST /api/paired-devices` body `{label}` / `{label,tier:"control"}` / `{label,tier:"admin"}` | each | 200 `tier:"observe"` / 200 `tier:"control"` / 400 and `list()` length unchanged |
| E7 | bearer-device-auth: approve tier | decision-table | L1 | automated | `POST /api/pair/approve` with and without `tier:"control"` | redeem completes | resulting row `control` / `operate` |
| E8 | mcp-tool-tiers: tier from bearer | EP | L1 | automated | `verifyDeviceToken` stub → `{id,tier:"control"}` / old-key stub → `"dev1"` | `authenticate()` | `McpCaller.tier` = `control` / `operate` (fallback) |
| E9 | mcp-tool-tiers: session token tier | EP | L1 | automated | session-kind caller | `authenticate()` | `tier === "control"` |
| E10 | mcp-tool-tiers: tools/list subsets | decision-table | L1 | automated | fixture manifest with 1 tool per tier | `tools/list` as observe / control / operate | names = `{o}` / `{o,c}` / `{o,c,p}`; `observe ⊂ control ⊂ operate` |
| E11 | mcp-tool-tiers: path cap | decision-table | L1 | automated | operate token | `tools/list` at `/mcp/observe`, `/mcp/control`, `/mcp` | 1 / 2 / 3 tools |
| E12 | mcp-tool-tiers: path cap keeps own tier | BVA | L1 | automated | observe token | `tools/list` at `/mcp/control` | 1 tool (observe set) |
| E13 | mcp-tool-tiers: bad suffix | EP (invalid) | L1 | automated | any token | `POST /mcp/operate`, `GET /mcp/nope`, `PUT /mcp/observe` | 404 JSON `{error}` / 404 JSON / 405 (same as `PUT /mcp`); never `text/html` |
| E14 | mcp-tool-tiers: annotations invariants | decision-table | L1 | automated | full manifest | invariants test | every observe tool `readOnlyHint:true`; no destructive tool at observe; `force_kill` operate+destructive; every description ≤ 120 chars; names unique; each `rest` row tier ≥ `routeTier(route)` |
| E15 | mcp-tool-tiers: manifest completeness | partition | L1 (`packages/server`) | automated | booted server routes R (`/api/*`) + union V | test | `rest.paths ∪ session.messages = (R ∪ V) − DENYLIST`; removing one denylist entry → failure names that route |
| E16 | mcp-tool-tiers: ROUTE_TIERS total | partition | L1 (`packages/server`) | automated | booted server routes R | test | every R route has a `ROUTE_TIERS` entry; adding a fixture route without one fails naming it |
| E17 | mcp-tool-tiers: generated freshness | state | L1 | automated | checked-in `generated/tools.ts` + README block | regenerate in memory | deep-equal; hand-editing one description → inequality |
| E18 | mcp-tool-tiers: session-targeting coverage | decision-table | L1 | automated | manifest rows with `:id` path, `:sessionId` path, `sessionId` in schema | invariants test | each flagged `sessionTargeting`; a fixture row under `/api/session/:id/x` without the flag fails |
| E19 | dashboard-mcp-server: paramSplit | EP | L1 | automated | `rest` row `GET /api/session/:id/events?since=5` args `{sessionId:"S1",since:5}` | `tools/call` | inject called with url `/api/session/S1/events?since=5`, no body |
| E20 | dashboard-mcp-server: path-param encoding | EP (invalid) | L1 | automated | args `{sessionId:"S1/../../restart"}` and `{sessionId:"a%2Fb"}` | `tools/call` | validation error `-32602`; inject not called |
| E21 | dashboard-mcp-server: fixed body | EP | L1 | automated | `force_kill` row (`fixed:{action:"force_kill"}`) args `{sessionId:"S2"}` | operate caller `tools/call` | inject `POST /api/session/S2/lifecycle` body `{action:"force_kill"}` |
| E22 | dashboard-mcp-server: existing 4 tools unchanged | regression | L1 | automated | existing `dispatch.test.ts` fixtures | control caller invokes `list_sessions`/`send_prompt`/`spawn_session`/`abort` | byte-identical results to pre-change snapshots |
| E23 | bearer-device-auth: REST gate decision table | decision-table | L1 | automated | principal ∈ {observe, control, operate bearer; cookie; loopback+observe bearer; trusted-net+observe bearer} × route ∈ {`GET /api/sessions`(observe), `POST /api/session/:id/prompt`(control), `POST /api/restart`(operate), unlisted `POST /api/fixture`} | request from `203.0.113.5` unless loopback/trusted | 403+header only for bearer principal below route tier from off-host; cookie/loopback/trusted rows never 403 on tier grounds; unlisted → `scope="operate"` |
| E24 | bearer-device-auth: gate never admits | EP | L1 | automated | no credential, off-host | `GET /api/sessions` | existing 401/403 path unchanged (status equals pre-change snapshot) |
| E25 | bearer-device-auth: ws-ticket | BVA | L1 | automated | control bearer / operate bearer, off-host | `POST /api/ws-ticket` | 403 `scope="operate"` / 200 |
| E26 | design D3: lifecycle action tier | decision-table | L1 | automated | `POST /api/session/:id/lifecycle` × action ∈ {stop_after_turn, retry, force_kill, kill_process} × principal ∈ {control bearer off-host, operate bearer, loopback} | request | control+force_kill/kill_process → 403 `scope="operate"`; all others reach the extracted handler (spy called once with sessionId+action) |
| E27 | design D3: extracted handlers shared | state | L1 | automated | WS `extension_ui_response` and `POST /api/session/:id/extension-ui-response` for the same `requestId` | each path | both clear `pendingUiRequests[S][requestId]`; handler spy called with identical args |
| E28 | bearer-device-auth: reachable-urls | EP | L1 | automated | `localEndpoints()` stub → `[http://localhost:8000, http://192.168.1.4:8000]`, tunnel `https://x.share.zrok.io`, public `[]` | `GET /api/pair/reachable-urls` | body lists exactly those 3, tunnel first, no duplicates |
| E29 | bearer-device-auth: CLI token create | decision-table | L1 | automated | args `--label ci --tier control` / `--label ci --url https://x/` / `--tier control` (no label) | run with mocked fetch to `/api/paired-devices` + `/api/pair/reachable-urls` (2 urls) | stdout has token exactly once + 2 `claude mcp add` lines / 1 line targeting `https://x/mcp` / usage error exit 2 no fetch |
| E30 | design D4: route skew | EP | L1 | automated | manifest with a `rest` row whose route is not registered | plugin activation | row absent from `tools/list`; one `mcp.manifest_route_missing` log line naming it |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | design D4 inject budget | micro-timed | L1 | automated | 100 sequential `tools/call list_sessions` via a `rest`-bound row vs direct `context` row, in-process | p95(rest) − p95(context) < 20 ms | one run, warm-up 10 |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | bearer-device-auth: Settings tier picker | state-transition | L1 (RTL) | automated | create-token dialog open | select `operate` | radio default was `observe`; warning text contains "restart"; snippet not yet shown |
| F2 | bearer-device-auth: base-URL select | convergence | L1 (RTL) | automated | `/api/pair/reachable-urls` mocked → `[origin, https://x.share.zrok.io]` | dialog mounts | select preselects `window.location.origin`; 2 options |
| F3 | bearer-device-auth: snippet | EP | L1 (RTL) | automated | tier `control`, base `https://x.share.zrok.io`, mint returns `tok_123` | submit | snippet text contains `https://x.share.zrok.io/mcp` and `Bearer tok_123`; token shown exactly once in the DOM |
| F4 | bearer-device-auth: token not shown again | state-transition | L1 (RTL) | automated | after F3 | dismiss dialog, reopen | no element contains `tok_123` |
| F5 | bearer-device-auth: tier badge | EP | L1 (RTL) | automated | device list `[{tier:"observe"},{tier:"operate"}]` | render | each row shows its tier text |
| F6 | end-to-end pairing for an agent | state-transition | L3 | automated | harness up; Settings → create token, tier `observe` | copy token; `POST <harness>/mcp tools/list` with it from the test runner (off-host address via docker network) | list has no `send_prompt`; `tools/call send_prompt` → HTTP 403 with `WWW-Authenticate` containing `insufficient_scope` and `scope="control"` |
| F7 | end-to-end operate token | state-transition | L3 | automated | harness up; token minted `operate` via `POST /api/paired-devices` | `tools/list`, then `tools/call force_kill` on a harness-seeded session | list contains `force_kill`; call returns `isError:false` and the session card leaves the running state within 10 s |
| F8 | tier descriptions read well | visual/subjective | — | manual-only | Settings create-token dialog | human reads the three tier lines | [judgment: wording clear to a first-time operator — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | mcp-tool-tiers: scope challenge | fault (authz) | L1 | automated | observe caller | `tools/call send_prompt` | HTTP 403; header `WWW-Authenticate: Bearer error="insufficient_scope", scope="control"`; JSON-RPC error `-32001` `data.scope:"control"`; handler spy not called; log `mcp.tier_refused` `{caller, tool:"send_prompt", callerTier:"observe", requiredTier:"control"}` |
| X2 | mcp-tool-tiers: refusal precedes guard | ordering | L1 | automated | session caller `A` (control) | `tools/call force_kill {sessionId:"A"}` | 403 `scope="operate"`; guard refusal log absent |
| X3 | mcp-tool-tiers: refusal precedes validation | ordering | L1 | automated | observe caller | `tools/call send_prompt {}` (missing args) | 403, not `-32602` |
| X4 | dashboard-mcp-server: unknown tool | EP | L1 | automated | any caller | `tools/call nope` | existing `-32601` unchanged |
| X5 | dashboard-mcp-server: self-target on new tools | fault (guard) | L1 | automated | session caller `A` | `tools/call` each session-targeting tool with `sessionId:"A"` (iterate manifest) | every call refused by guard; inject never called; refusal log has caller `A`, target `A`, tool name |
| X6 | dashboard-mcp-server: REST error envelope | fault | L1 | automated | inject returns `{success:false,error:"boom"}` 500 | `tools/call` on a `rest` row | MCP result `isError:true`, `content[0].text` contains `boom` |
| X7 | dashboard-mcp-server: inject identity | fault | L1 | automated | device caller from `203.0.113.5` via tunnel (`x-forwarded-for` set) / session caller | `tools/call` `rest` row | inject options: device → `remoteAddress:"203.0.113.5"`, headers `authorization`, `host`, `x-forwarded-for` present, no `origin`; session → `remoteAddress:"127.0.0.1"`, no `authorization`, no `x-forwarded-*` |
| X8 | bearer-device-auth: gate logging | fault | L1 | automated | control bearer off-host | `POST /api/restart` | one log line `auth.tier_refused` `{deviceId, method:"POST", route:"/api/restart", principalTier:"control", requiredTier:"operate"}`; restart handler spy not called |
| X9 | bearer-device-auth: CLI without dashboard | fault-injection (abort) | L1 | automated | fetch to `/api/paired-devices` rejects `ECONNREFUSED` | `token create --label x` | exit code ≠ 0; stderr mentions dashboard not running; no token in stdout |
| X10 | bearer-device-auth: revoked mid-flight | state-transition | L1 | automated | observe token verified for `tools/list`, then row revoked | next `tools/call list_sessions` | 401 (not 403); inject not called |
| X11 | mcp-tool-tiers: host-gate enforce mode | fault | L1 | automated | `createHostGate` in enforce mode with admitted host `dash.local` | device caller `tools/call` `rest` row with original `host: dash.local` | injected request passes the host gate (200); with `host` not forwarded the same call is 403 (negative control) |

---

## Coverage summary

- Requirements covered: 14/14 (3 spec files: 6 + 3 + 5 requirements, incl. design D3/D4 decisions with observable behaviour)
- Scenarios by class: edge 30 · perf 1 · frontend 8 · error 11
- Scenarios by level: L1 46 · L3 2 · — 1
- Scenarios by disposition: automated 49 · manual-only 1

## New infra needed

- none. E15/E16 reuse the server test bootstrap (`packages/server/src/__tests__/*-routes.test.ts` pattern) plus an `onRoute` collector; F6/F7 reuse `docker/test-up.sh` and the off-host address the harness already exposes for Playwright.
