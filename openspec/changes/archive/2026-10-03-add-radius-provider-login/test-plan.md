# Test Plan — add-radius-provider-login

Stage: design   Generated: 2026-10-04 (after doubt-review cycles 1–3)

No open clarifications. Q-defaults (design D2/D4/D5/D6) are assumed as written; flipping one re-opens the affected rows.

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | OAuth provider registry — radius listed by default | EP | L1 | automated | fake runtime whose providers include `radius` with `auth.oauth = { name: "Radius" }` (no `isSubscription`), no models.json | `mapProviders` / `getOAuthRegistry()` | entry `{ id: "radius", name: "Radius", flowType: "auth_code", subscription: false }` present; no exclusion set left in the module |
| E2 | OAuth provider registry — override predicate | decision-table | L1 | automated | temp agent dir `models.json` variants: (a) `radius{oauth:"radius",baseUrl:"https://gw.example.com/v1"}`; (b) `baseUrl:"https://radius.pi.dev/v1"`; (c) `baseUrl:"gw.example.com"`; (d) `baseUrl:"radius.pi.dev/"`; (e) `radius{baseUrl:"https://gw.example.com"}` (no oauth); (f) `other{oauth:"radius",baseUrl:"https://gw.example.com"}`; (g) `providers:null`; (h) no file; (i) `baseUrl:""` | `isRadiusOverridden()` | (a) true, (b) false, (c) true, (d) false, (e) false, (f) false and `other` not added to registry, (g) false, (h) false, (i) false |
| E3 | OAuth provider registry — pi parse parity | EP | L1 | automated | override (a) written with: leading BOM; `//` line comment; trailing comma; `/* */` block comment; schema-invalid extra field type (e.g. `"models": 5`) | `isRadiusOverridden()` | BOM → true; `//` → true; trailing comma → true; block comment → false; schema-invalid → true |
| E4 | OAuth provider registry — drift guard (bi-implication) | decision-table | L1 | automated | each schema-valid fixture of E2/E3 in a temp dir; `PI_CODING_AGENT_DIR` = that dir; real `ModelRuntime.create({ modelsPath, credentials: empty, refreshOnCreate: false })` | compare predicate with runtime's `radius` provider (baseline catalogue empty ⇔ non-default gateway) | for every fixture: `isRadiusOverridden()` === (runtime `radius` getModels() is empty) |
| E5 | OAuth provider registry — custom agent dir | EP | L1 | automated | `PI_CODING_AGENT_DIR=<tmp>` with override in `<tmp>/models.json`; `~/.pi/agent/models.json` (test HOME) without | `GET /api/provider-auth/providers` | no `radius` row |
| E6 | OAuth provider registry — edit without restart (1 s cache) | BVA | L1 | automated | override present, predicate evaluated at t=0 (true); override removed at t=0.1 s (fake timers) | evaluate at t=0.9 s and t=1.1 s | t=0.9 s → still excluded (cached); t=1.1 s → `radius` listed |
| E7 | Flow start — override hides radius on every route | decision-table | L1 | automated | route test with injected registry containing `radius`, plus override fixture | `GET /providers`, `GET /handlers`, `POST /start {provider:"radius"}` | `radius` absent from both lists; `/start` → 400 `{ error: "Unknown OAuth provider: radius" }` |
| E8 | New OAuth ids participate in api-key twin naming | decision-table | L1 | automated | catalogue `radius {configured:true, source:"environment", envVar:"RADIUS_API_KEY"}`; cases: (a) no override, nothing stored; (b) override, nothing stored; (c) override, `auth.json` `radius:{type:"oauth",…}` | `GET /api/provider-auth/status` (real registry path, temp agent dir) | (a) `radius-api` "Radius (API Key)" configured + `radius` OAuth row configured:false; (b) single bare `radius` api-key row; (c) `radius` OAuth row authenticated + `radius-api` row |
| E9 | Server exposes registered handler ids | EP | L1 | automated | real pi 1.0.0 registry, no override / with override | `GET /api/provider-auth/handlers` | exactly the 9 ids incl. `radius` / the 8 without `radius` |
| E10 | Status rows carry the subscription flag | EP | L1 | automated | real pi 1.0.0 registry | `GET /api/provider-auth/providers` | `anthropic` subscription:true; `openrouter` and `radius` subscription:false |
| E11 | Flow start — Start Radius (generic select) | state-transition | L1 | automated | scripted fake flow mirroring Radius: first prompt `select` ids `browser`/`device-code`, then device code, then credential `{access,refresh,expires}` | `POST /start radius` → `POST /flow/:id/input "device-code"` → flow completes | `/start` 200 `pending.kind:"select"` with both ids; after input `pending.kind:"device_code"`; `auth.json.radius` equals the returned credential |
| E12 | Radius MCP — plan rules | decision-table | L1 | automated | global entries: (a) none; (b) `gw:{url:"https://radius.pi.dev/mcp/",oauth:{clientId:"x"},exposure:"codemode"}`; (c) unrelated `radius:{command:"x"}`; (d) `r:{url:"https://radius.pi.dev/mcp",auth:{provider:"radius"}}`; (e) `gw:{url:"https://radius.pi.dev/mcp",auth:{provider:"other"}}` | `planRadiusMcp` | (a) new `radius` entry `{url,auth}`; (b) `gw` gains `auth`, loses `oauth`, keeps `exposure`; (c) name `radius-mcp`; (d) `configured:true`, no entry; (e) `gw` repointed to `auth.provider:"radius"` |
| E13 | Radius MCP — POST evaluation order | decision-table | L1 | automated | combos of: runtime loaded y/n; `radius` OAuth credential y/n; override y/n; `mcp.json` unparseable y/n; already configured y/n | `POST /api/provider-auth/radius/mcp` | first match wins: runtime n → 503 `provider_auth.radius_mcp_runtime_unavailable`; no cred → 409 `…_no_credential` (also when already configured); override → 409 `…_overridden`; unparseable → 409 `…_write_refused` `reason:"unparseable"`; configured → 200 `written:false`; every refusal and no-op leaves `mcp.json` bytes identical and dispatches no reload |
| E14 | Radius MCP — GET responses | decision-table | L1 | automated | runtime unavailable; `mcp.json` absent; unparseable; name `radius` taken | `GET /api/provider-auth/radius/mcp` | 503 `…_runtime_unavailable`; 200 `{configured:false,name:"radius",path:<abs>}`; 409 `…_write_refused` `reason:"unparseable"`; 200 `name:"radius-mcp"` |
| E15 | Radius MCP — successful write + reload count | EP | L1 | automated | credential stored, no override, fresh `mcp.json`; injected fan-out with 3 targets whose `dispatchReload` outcomes are `forwarded`, `respawn`, `refused` | `POST` | `mcp.json` has `mcpServers.radius = {url:"https://radius.pi.dev/mcp",auth:{provider:"radius"}}` and every pre-existing key unchanged; `dispatchReload` called 3×; response `{configured:true,written:true,name:"radius",reloaded:2}` |
| E16 | Radius MCP — writer refusal surfaced | fault-injection (abort) | L1 | automated | fake writer returning refusal `name-collision` | `POST` | 409 `provider_auth.radius_mcp_write_refused` `vars.reason:"name-collision"`; no reload |
| E17 | RADIUS_MCP_URL drift | EP | L1 | automated | server constant; pi's `dist/core/radius.js` resolved by walking `node_modules` (test-only) | import both | values equal (`https://radius.pi.dev/mcp`) |
| E18 | Radius MCP — route tiers + manifest | EP | L1 | automated | `ROUTE_TIERS`; MCP manifest completeness check | evaluate tables | `GET` and `POST /api/provider-auth/radius/mcp` both tier `operate`; completeness test passes (covered by `/api/provider-auth/` denylist prefix) |
| E19 | OAuth implementation resolved from pi runtime — no pi-ai in runtime | EP | L1 | automated | source of `radius-override.ts`, `radius-mcp.ts`, `provider-auth-registry.ts` | static import scan | no `@earendil-works/pi-ai` specifier and no `pi-coding-agent/dist/` deep path in any of them |
| E20 | Post-sign-in offer — i18n keys | EP | L1 | automated | locale catalogs en / zh-CN / hu | key parity check | `err.provider_auth.radius_mcp_runtime_unavailable`, `…_no_credential`, `…_overridden`, `…_write_refused` present in all three; offer strings present in all three |
| E21 | Enumerated reload trigger sources — source 7 | state-transition | L1 | automated | write path vs no-op path (`written:false`) | `POST` twice | write → fan-out invoked via `dispatchReload`; no-op → fan-out not invoked |

### Performance

_None. No latency or throughput budget is specified. The only cost-bearing behaviour (≤1 small sync `models.json` read per second) is a bounded design constraint, covered functionally by E6._

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Radius sign-in uses the generic panes | state-transition | L3 | automated | mocked `/providers` incl. `radius` (auth_code); mocked `/start` → `pending:select` with pi labels; `/flow` → `device_code` after input | open picker → choose Radius → Sign in → choose device-code option | picker lists Radius; select shows both pi labels; after choice the device-code pane shows user code + "Open Registration Page" for the same flowId |
| F2 | Post-sign-in Radius MCP offer — accept | state-transition | L3 | automated | Radius flow mocked to complete; `GET /radius/mcp` → `{configured:false,name:"radius",path:"/home/u/.pi/agent/mcp.json"}`; `POST` → `{configured:true,written:true,name:"radius",reloaded:2}` | flow completes → click accept | dialog closed; inline offer names the path + `radius`; exactly one POST; success text states 2 sessions reloaded; offer gone |
| F3 | Post-sign-in Radius MCP offer — suppression | decision-table | L1 | automated | section with mocked fetch: (a) decline; (b) GET `configured:true`; (c) GET 503; (d) Anthropic flow completes | flow completion / click decline | (a) no POST, offer gone; (b) no offer; (c) no offer; (d) GET `/radius/mcp` never requested |
| F4 | Post-sign-in Radius MCP offer — refusal rendering | EP | L1 | automated | POST → 409 `{code:"provider_auth.radius_mcp_write_refused",vars:{reason:"unparseable"},error}`; second case unknown code `x.y` with `error:"boom"` | click accept | first: translated `err.provider_auth.radius_mcp_write_refused` text, no success text; second: "boom" shown |
| F5 | Radius sign-in — override + badge | decision-table | L1 | automated | (a) `/providers` without `radius`; (b) status row `radius` configured, `subscription:false` | render picker / list | (a) no Radius OAuth entry in picker; (b) row badge "Account" with Sign out |
| F6 | Post-sign-in Radius MCP offer — keyboard + a11y names | state-transition | L3 | automated | offer visible (as F2) | Tab to accept, press Enter; separately Tab to decline, Enter | accept/decline reachable by keyboard, have accessible names (`getByRole("button", { name })`); Enter on accept sends one POST; axe reports no violations on the offer region |
| F7 | Real Radius round trip | exploratory | — | manual-only | real Radius account, local dashboard | sign in via device code, accept the offer | credential stored; global `mcp.json` holds the radius entry; a reloaded session lists Radius MCP tools (`pi mcp list`) [judgment: live third-party service, not automatable in CI] |
| F8 | Browser method locality | exploratory | — | manual-only | dashboard opened (a) on the server host, (b) from another device | choose "Sign in with browser" | (a) completes; (b) cannot complete; device-code completes [judgment: depends on real network topology + live gateway] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Flow start — Radius callback port bound after select | fault-injection (abort) | L1 | automated | scripted fake flow: `select` first, then on `browser` throws `EADDRINUSE 127.0.0.1:1456` | `POST /start radius` → input `browser` | `/start` returned 200 `pending:select`; flow then reports `status:"error"` with `error` containing `1456`; no flow left pending |
| X2 | OAuth provider registry — unreadable models.json | fault-injection (abort) | L1 | automated | `models.json` present with mode 000 (or injected read throwing `EACCES`) | `isRadiusOverridden()` / `GET /providers` | returns false, no throw; `radius` listed; no 5xx |
| X3 | Radius MCP — pi runtime load failure | fault-injection (abort) | L1 | automated | registry init with `loadModule` rejecting | `GET` and `POST /radius/mcp` | both 503 `provider_auth.radius_mcp_runtime_unavailable`; `mcp.json` untouched; other provider-auth routes still answer |
| X4 | Radius MCP — reload dispatch rejects | fault-injection (abort) | L1 | automated | fan-out where one `dispatchReload` rejects | successful `POST` | response 200 `written:true`; the rejected target not counted in `reloaded`; one error log line naming the session id; no unhandled rejection |
| X5 | Radius MCP — no secret in logs | fault-injection (spy) | L1 | automated | stored credential with access token `tok-SECRET-123`; console spies | `POST` (success and each refusal) | no log line contains `tok-SECRET-123` or the request body |

---

## Coverage summary

- Requirements covered: 10/10 (provider-auth-server: OAuth provider registry, Flow start, New OAuth ids twin naming, Server exposes registered handler ids, Status rows subscription flag, OAuth implementation resolved from pi runtime, Radius MCP server configuration; provider-auth-ui: Radius sign-in uses the generic panes, Post-sign-in Radius MCP offer; headless-reload: Enumerated reload trigger sources)
- Scenarios by class: edge 21 · perf 0 · frontend 8 · error 5
- Scenarios by level: L1 29 · L2 0 · L3 3 · — 2
- Scenarios by disposition: automated 32 · manual-only 2

## New infra needed

- None. L3 rows use the existing Playwright network-mock pattern (`tests/e2e/delegate-provider-oauth-flow.spec.ts`). L1 Radius MCP rows need the post-`migrate-mcp-to-pi-builtin` writer (or a fake implementing its single-entry save + global-list read).
