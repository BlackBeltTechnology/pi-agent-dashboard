# Test Plan — add-plugin-isolation-and-public-routes

Stage: design   Generated: 2026-10-14

Hard gate passed: one clarification (spawn-credential verification bound) answered by the user — live isolated spawns capped at 256, fallback verification p95 < 5 ms at 256 live credentials.

Public namespace rows (E40–E62, X9) added after the capability was folded into this change; no clarification gaps (all values fixed in the spec).

Levels: L1 = vitest unit (`packages/*/src/**/__tests__/*.test.ts`); L2 = qa VM smoke (`qa/tests/*.sh|*.ps1`, real pi, no rendered-UI asserts). No rendered-UI surface in this change → no L3 rows.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | plugin-spawn-scope › mapper total (agentDir flagged) | EP | L1 | automated | `scope.agentDir` ∈ {`"/abs/dir"`, `""`, `null`, `42`, `"/a\u0000b"`} | `pluginSpawnToSessionOptions(opts)` | `"/abs/dir"` → `agentDir:"/abs/dir"`; each other value → `agentDirInvalid:true`; no throw |
| E2 | plugin-spawn-scope › mapper total (scope container) | EP | L1 | automated | `scope` ∈ {`"x"`, `[]`, `7`, `null`, `undefined`} | mapper | `"x"`,`[]`,`7` → `agentDirInvalid:true`; `null`,`undefined` → no `agentDir*` field (absent) |
| E3 | plugin-spawn-scope › agentDir validity | EP+BVA | L1 | automated | tmp tree: valid dir; relative path; missing path; regular file; NUL path | `validateAgentDir` | valid → ok; others → `agent_dir_invalid` |
| E4 | plugin-spawn-scope › operator tree (symlink / ancestor / descendant / equal) | BVA | L1 | automated | fake operator agent dir `O`; candidates `O`, `O/sub`, parent of `O`, symlink→`O`, sibling of `O` | `isOutsideOperatorTree` | sibling → outside; the other four → inside |
| E5 | plugin-spawn-scope › case-insensitive filesystem | decision-table | L1 | automated | `O=/Users/a/.pi/agent`; candidate `/Users/A/.PI/AGENT/x`; case-insensitive helper stubbed true / false | `isOutsideOperatorTree` | insensitive=true → inside; insensitive=false → outside |
| E6 | plugin-spawn-scope › tilde env value | EP | L1 | automated | server env `PI_CODING_AGENT_DIR=~/x`, homedir `/h` | `resolveOperatorTree(env)` | agent dir = `/h/x`, equal to pi `getAgentDir()` evaluated under the same env |
| E7 | plugin-spawn-scope › own plugin data dir carve-out | decision-table | L1 | automated | plugin `web-chat`; agentDir under `~/.pi/dashboard/plugins/web-chat/users/h/agent` vs under `~/.pi/dashboard/plugins/other/…` | hook validation | own → accepted; other → `agent_dir_invalid` |
| E8 | plugin-spawn-scope › cwd / plugin paths in operator tree | EP | L1 | automated | isolated spawn with `cwd=$HOME`; with `scope.sessionDir=O/sessions`; with `scope.skills=[O/skills/s.md]` | hook validation | each → `isolated_path_invalid`, no spawn |
| E9 | plugin-spawn-scope › unsupported combos (raw presence) | decision-table | L1 | automated | valid agentDir + one of {`resume:null`, `resume:{sessionFile}`, `mode:"worktree"`, `mode:"tmux"`, `initialPrompt:"hi"`} and the same keys set to `undefined` | hook validation | defined keys → `agent_dir_unsupported_combo`; `undefined` keys → not refused for them; `mode:"local"` → not refused |
| E10 | plugin-spawn-scope › live isolated spawn cap | BVA | L1 | automated | registry with 255 / 256 live isolated spawns | next isolated spawn | 255 → succeeds (257th not reached); 256 → `agent_dir_capacity`; after one ends → succeeds |
| E11 | plugin-spawn-scope › refusal leaves no pending state | state-transition | L1 | automated | isolated spawn with `pluginRef` refused for invalid agentDir | `spawnSession` hook | `pendingPluginRefRegistry`, initial-prompt registry and spawn-credential store all unchanged |
| E12 | plugin-spawn-scope › forced flags + exclude union | decision-table | L1 | automated | isolated spawn with `scope.tools:["read","kb_search"]`, `scope.excludeTools:["foo"]` | argv build | argv has `--no-builtin-tools`, `--no-context-files`, `--no-approve`, `--no-skills`, `--exclude-tools` containing `foo,read,bash,edit,write,grep,find,ls` |
| E13 | plugin-spawn-scope › bridge entry `-e` + dedupe | EP | L1 | automated | settings.json packages lists bridge dir with `pi.extensions:["src/bridge.ts"]`; scope.extensions empty / already containing the entry via a symlinked path | argv build | exactly one `-e <dir>/src/bridge.ts`; no `-e <dir>` (package dir) |
| E14 | plugin-spawn-scope › bridge unresolved | EP | L1 | automated | no bridge package in settings; package with no `pi.extensions`; entry file deleted | isolated spawn | each → `agent_dir_bridge_unresolved`, no process |
| E15 | plugin-spawn-scope › env allowlist | decision-table | L1 | automated | server env {`ANTHROPIC_API_KEY`, `SSH_AUTH_SOCK`, `PI_CODING_AGENT_SESSION_DIR`, `PI_DASHBOARD_ISOLATED=0`, `LC_ALL=C`, `HTTPS_PROXY=x`, `PATH`, `HOME`}, spawn token `tok` | `buildSpawnEnv` isolated | child has `PATH`, `HOME`, `LC_ALL`, `HTTPS_PROXY`, `PI_DASHBOARD_SPAWN_TOKEN=tok`, `PI_CODING_AGENT_DIR`, `PI_DASHBOARD_ISOLATED=1`, `PI_DASHBOARD_SPAWN_CREDENTIAL`; none of the first three |
| E16 | plugin-spawn-scope › Windows case-insensitive allowlist | EP | L1 | automated | `process.platform` stubbed `win32`; server env key `Path`, `SystemRoot` | `buildSpawnEnv` isolated | child carries the path value and `SystemRoot` |
| E17 | plugin-spawn-scope › runtime PATH + Electron argv0 kept | decision-table | L1 | automated | isolated spawn, resolved runtime bin dir `/rt/bin`, argv0 = Electron binary | `buildSpawnEnv` | `PATH` starts with `/rt/bin`; `ELECTRON_RUN_AS_NODE=1` |
| E18 | plugin-spawn-scope › non-isolated strips markers | EP | L1 | automated | server env `PI_DASHBOARD_ISOLATED=1`, `PI_DASHBOARD_SPAWN_CREDENTIAL=x`; non-isolated plugin spawn | `buildSpawnEnv` | neither variable in child env; all other inherited vars unchanged |
| E19 | plugin-spawn-env-contributor › isolated skip | decision-table | L1 | automated | trusted contributor returning `{CTX_FETCH_STRICT:"1"}`; isolated vs non-isolated spawn | spawn | non-isolated env has it; isolated env lacks it and contributor spy called 0 times |
| E20 | host-cwd-policy › isolated merge minus skills | decision-table | L1 | automated | policy `{noTools:true, skills:["/w/s.md"], excludeTools:["x"]}` at cwd | isolated spawn there | argv has `--no-tools` and `x` in `--exclude-tools`; no `--skill /w/s.md` |
| E21 | host-access-policy › hasHostPolicy truth table | decision-table | L1 | automated | (enforced, registered) ∈ {(F,F),(F,T),(T,F),(T,T)} | `identity.hasHostPolicy()` | true only for (T,T) |
| E22 | host-access-policy › per-call after arming | state-transition | L1 | automated | policy plugin registered; identity not yet armed | call `hasHostPolicy()` before and after arming latch | false then true |
| E23 | plugin-spawn-scope › result `isolated` | EP | L1 | automated | successful isolated spawn; successful non-isolated spawn | hook return | `{success:true, isolated:true}`; non-isolated `isolated` absent/false |
| E24 | bridge control-channel-only › mode decision | decision-table | L1 | automated | env combos: ISOLATED=1+token; ISOLATED=1 no token; no ISOLATED + token | bridge load | only the first enters isolated mode |
| E25 | bridge control-channel-only › survives reload | state-transition | L1 | automated | isolated bridge registered (spawn token consumed + scrubbed) | bridge reload in same process | still isolated; re-registration reports `isolated:true` |
| E26 | bridge control-channel-only › no registrations | EP | L1 | automated | isolated bridge load with spies on `registerTool`/`registerProvider`/`registerCommand`/`registerMcpServer`/`on("before_agent_start")` (injector) and `mcp_token_minted` delivered | load + one turn | zero tool/provider/command/MCP registrations; no session-context handler |
| E27 | bridge control-channel-only › enumerating guard | EP | L1 | automated | static scan of `packages/extension/src` for `homedir()`/`.pi` path construction and `register(Tool|Provider|Command|McpServer)` calls | test run | every hit is behind `isIsolated()` or on the explicit allowlist; a new ungated hit fails the test |
| E28 | bridge control-channel-only › no operator file access | EP | L1 | automated | fake `HOME` with `~/.pi/agent/{models,providers,settings}.json`, `~/.pi/dashboard/{config.json,local/token,pinned-servers.json,access-grants.json}`; `fs` spied | isolated bridge load, register, one turn | no open/read/write/stat of any path under fake `~/.pi` |
| E29 | bridge control-channel-only › `/` input not expanded | EP | L1 | automated | isolated session cwd holds `.pi/prompts/review.md`; user input `/review` | command handling | text passed to pi is `/review` verbatim |
| E30 | bridge control-channel-only › no vault delivery | EP | L1 | automated | vault grant for cwd, hub reachable | isolated bridge connect + session_start | no vault request sent; no env var applied |
| E31 | agent-session-context-injection › non-isolated unchanged | EP | L1 | automated | non-isolated bridge, systemPrompt with cwd anchor | turn | fragment injected exactly as existing injector test expects |
| E32 | pi-gateway-auth › credential bound to spawn | decision-table | L1 | automated | credentials A, B live; connection admitted with A | registration carrying spawn token of A / of B | A → accepted; B → refused |
| E33 | pi-gateway-auth › spawn proof not consulted off gateway | EP | L1 | automated | proof valid only under live spawn credential | presented on REST route, browser WS upgrade, pairing guard | each treats proof as absent (no credentialed admission) |
| E34 | pi-gateway-auth › counter-proof keyed by verifying class | EP | L1 | automated | gateway admits on spawn proof; separately on local-token proof | upgrade response | counter-proof verifies under spawn credential (resp. local token) and not under the other |
| E35 | pi-gateway-auth › credential scrubbed, reconnect works | state-transition | L1 | automated | isolated bridge loaded with `PI_DASHBOARD_SPAWN_CREDENTIAL` | load, then forced reconnect | env var absent after load; reconnect proof verifies |
| E36 | plugin-spawn-scope › attestation kill | state-transition | L1 | automated | isolated spawn token `t`; registration for `t` without `isolated:true`; registration with `isolated:true` for non-isolated token `u` | gateway register | `t` session terminated; `u` flag ignored (session treated non-isolated) |
| E37 | plugin-spawn-scope › isolated never consumes cwd FIFO | state-transition | L1 | automated | non-isolated spawn queued initial prompt for cwd `/c`; isolated session registers in `/c` first, then the non-isolated one | registrations | isolated gets no prompt; non-isolated gets it |
| E38 | headless-spawn › isolated keeps spawn token | EP | L1 | automated | isolated spawn token `tok_i`, server env `ANTHROPIC_API_KEY` | `buildSpawnEnv` | `PI_DASHBOARD_SPAWN_TOKEN=tok_i` present; key absent |
| E39 | plugin-spawn-scope › pi env-name drift guard | EP | L1 | automated | installed `@earendil-works/pi-coding-agent` config | import `ENV_AGENT_DIR` | equals `PI_CODING_AGENT_DIR` |
| E40 | plugin-public-routes › registration validation | EP | L1 | automated | paths `messages`, `a/b`, `../admin`, `/api/sessions`, `a//b`, `a/./b`, `a%2Fb`, `a\b`, `a/*`; plugin id `Web_Chat`; bodyLimit 2 MiB; allowHeaders `X-Ok`, `bad header` | `registerPublicRoute` during activation | first two mount; every other call throws; nothing mounted for them |
| E41 | plugin-public-routes › activation-only + duplicate | state-transition | L1 | automated | plugin that registers `GET stream` twice, and again after activation closes | calls | second call and post-activation call throw |
| E42 | plugin-public-routes › predicate both views | decision-table | L1 | automated | targets `/api/plugins/web-chat/public/messages`, `/api/plugins/web-chat/public/../config`, `//api/plugins/web-chat/public/messages`, `/api/plugins/web-chat/%70ublic/messages`; enabled config | `isEnabledPublicNamespace(raw, resolved)` | true only for the first |
| E43 | plugin-public-routes › enabled conjunction + live snapshot | decision-table | L1 | automated | (config enabled, plugin enabled, plugin loaded) all 8 combos; config flipped at t0 | predicate at t0 and t0+2 s | true only for (T,T,T); flip visible within 2 s without restart |
| E44 | plugin-public-routes › disabled ⇒ 404 first | decision-table | L1 | automated | disabled namespace; remote peer; requests: `GET widget.js`, `POST` with untrusted Origin, `OPTIONS` from listed origin | full Fastify hook chain (inject) | each `404`, no CORS headers, guard denial counter unchanged, no access prompt |
| E45 | plugin-public-routes › HEAD + unregistered path | EP | L1 | automated | enabled namespace with `GET stream` registered; route mounted at `public/raw` via raw `ctx.fastify` | `HEAD stream`, `GET public/raw`, `OPTIONS public/nope` | `405` (handler spy 0 calls); `404`; `404` without CORS |
| E46 | plugin-public-routes › origin canonicalization at load | EP | L1 | automated | allowedOrigins `null`, `https://*.example`, `https://shop.example/`, `http://192.168.1.5`, `https://Shop.Example:443`, `http://localhost:5173` | config load | effective set `{https://shop.example, http://localhost:5173}`; four rejections logged |
| E47 | plugin-public-routes › namespace CORS decision | decision-table | L1 | automated | allowedOrigins `[https://shop.example]` vs empty; Origins `https://shop.example`, `http://localhost:3000`, configured dashboard origin, tunnel origin, absent | request to enabled namespace | ACAO only for listed origin; never `Access-Control-Allow-Credentials`; `Vary: Origin` on every enabled-namespace response; empty list ⇒ no ACAO for any |
| E48 | plugin-public-routes › preflight | decision-table | L1 | automated | path with `POST messages` (allowHeaders default) and `GET messages`; preflights requesting `Content-Type`, `X-Debug` | `OPTIONS` from listed origin | methods `GET, POST`; headers granted for `Content-Type`; none for `X-Debug`; `Max-Age: 600` |
| E49 | cross-site-request-gate + server-cors › no leakage either way | decision-table | L1 | automated | Origin `https://shop.example` listed for web-chat public | `POST /api/sessions` and preflight to `/api/sessions`; localhost Origin `POST` to the namespace with empty list | core route rejected `403` / preflight refused; namespace POST `403` |
| E50 | plugin-public-routes › credential stripping before parse | EP | L1 | automated | request to enabled namespace with cookies `pi_dash_token`, `pi_dash_device`, `pi_dash_local`, custom `x=1`; headers `X-Pi-Local-Token`, `X-Pi-Local-Proof` (valid) | inject through full hook chain | handler sees no Cookie header, empty `request.cookies`, neither local header; `isAuthenticated` false; no tier stamp; local-credential verdict absent |
| E51 | plugin-public-routes + bearer-device-auth › dashboard bearers are absent | decision-table | L1 | automated | identity enforced; `Authorization` ∈ {valid device bearer, revoked device bearer, malformed, valid `pi_op_`, expired `pi_op_`} | request to enabled namespace | handler runs every time with `principalOf === null`; no `401`; no operator principal |
| E52 | plugin-public-routes › resolver outcomes | decision-table | L1 | automated | identity enforced vs inert; OIDC resolver result ∈ {accept(p), claim+reject, unclaimed} | request with `Authorization: Bearer x` | enforced: accept ⇒ `principalOf === p`; reject ⇒ `401`, handler not run; unclaimed ⇒ handler with null; inert ⇒ handler with null for all |
| E53 | plugin-public-routes + auth-bypass-url-list › gates skip | decision-table | L1 | automated | OAuth configured, identity enforced, untrusted remote peer, no credential | request to enabled namespace vs `/api/plugins/web-chat/config` | namespace: handler runs (no OAuth 401/redirect, no `sign_in_required`, no tier refusal, guard allows); config route: unchanged refusal |
| E54 | plugin-public-routes › query credentials | EP | L1 | automated | queries `?token=a`, `?Access-Token=a`, `?api_key=a`, `?apiKey[]=a`, `?page=2` | request to enabled namespace | first four `400` (handler not run, no log line contains `a`); `?page=2` reaches handler |
| E55 | plugin-public-routes › host access policy classification | decision-table | L1 | automated | policy registered (deny / allow `plugin:web-chat:public`); request with principal vs without | request to enabled namespace | with principal: deny ⇒ `403`, allow ⇒ handler; without principal: policy spy 0 calls, handler runs |
| E56 | bearer-device-auth › tier gate predicate | decision-table | L1 | automated | device bearer of tier `observe` | `POST /api/plugins/web-chat/public/messages` vs `GET /api/plugins/web-chat/config` | first skipped by predicate (no tier refusal); second resolves via exact map (default `operate`) and is refused for `observe` |
| E57 | trusted-networks › namespace-coverage test | EP | L1 | automated | route table with a plugin public route registered | coverage test | passes via the in-namespace public exception; an unregistered top-level route still fails it |
| E58 | plugin-public-routes › body limit | BVA | L1 | automated | route bodyLimit default 64 KiB | POST bodies of 64 KiB and 64 KiB + 1 | first reaches handler; second `413` without handler |
| E59 | plugin-public-routes › stream helper + heartbeat + compression | state-transition | L1 | automated | `openEventStream` stream idle for 30 s (fake timers), client sends `Accept-Encoding: gzip` | hold open | ≥7 heartbeat comments; response not compressed; still open |
| E60 | plugin-public-routes › close exactly once | state-transition | L1 | automated | four streams | client disconnect / handler `close()` / plugin disable / principal expiry at T | each `onClose` spy called exactly once; disable also aborts an in-flight non-stream request |
| E61 | plugin-public-routes › caps | BVA | L1 | automated | maxConcurrent 512, maxStreams 256, maxStreamsPerPeer 8 and 0 | 512/513 in-flight non-stream; 256/257 streams; 8/9 from one peer; 20 from one peer with per-peer 0 | 513th `503`; 257th `503`; 9th `503` for that peer only; per-peer 0 ⇒ none refused |
| E62 | plugin-public-routes › non-stream timeout | BVA | L1 | automated | handler that never resolves | 30 s elapse (fake timers) | client `408`; handler abort signal fired |
| E63 | plugin-spawn-scope › plugin data dir | EP | L1 | automated | first activation of plugin `web-chat` with fake HOME | context creation | `ctx.dataDir === <home>/.pi/dashboard/plugins/web-chat`, dir exists, mode 0700; agentDir under it passes operator-tree validation |
| E64 | plugin-spawn-scope › isolated plugin-message lane | state-transition | L1 | automated | isolated bridge with a plugin extension emitting `dashboard:plugin-message` | emit + server reply via `sendExtensionMessage` | server handler receives request; extension receives reply |
| E65 | host-access-policy › registration outcome observable | decision-table | L1 | automated | plugin named vs not named in `identity.trustedPolicyPlugin`; second registration by the named plugin | `ctx.registerHostAccessPolicy(fn)` | named first call returns unregister fn; not-named throws `policy_not_trusted`; second call throws `policy_duplicate`; no policy registered on throws |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | pi-gateway-auth › fallback verification bound | tail-latency (timed unit) | L1 | automated | 256 live spawn credentials; proof keyed by the last-registered credential (worst case) and by none (miss) | fallback verification p95 < 5 ms | 1000 iterations |

### Frontend-quirk

None — no rendered UI in this change.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | pi-gateway-auth › revocation on session end | fault-injection (abort) | L1 | automated | bound isolated session ends | later dial with a proof keyed by its credential | proof does not verify; no admission |
| X2 | pi-gateway-auth › revocation on register-watchdog expiry | fault-injection (delay) | L1 | automated | isolated spawn never registers | register-watchdog window elapses (fake timers) | credential revoked; live-isolated count decremented |
| X3 | pi-gateway-auth › revocation on spawn failure | fault-injection (abort) | L1 | automated | pi spawn throws after validation | hook catch path | credential revoked; no pending ref left; live-isolated count unchanged |
| X4 | pi-gateway-auth › server restart strands isolated bridge | fault-injection (abort) | L2 | automated | real isolated session over loopback TCP | dashboard restart | bridge reconnect fails authentication; operator sessions reconnect normally |
| X5 | plugin-spawn-scope › live isolation proof (POSIX socket) | fault-injection (hostile input) | L2 | automated | fixture plugin isolated spawn, faux model; cwd ancestors hold canary `AGENTS.md`, `.agents/skills/canary`, `.pi/settings.json` package; fake operator agent dir with canary package/skill/`AGENTS.md`; server env `ANTHROPIC_API_KEY=canary` | prompt "print your system prompt and list your tools" | session registers (`isolated:true`); system prompt + tool list contain no canary and no `pi-dashboard session context`; child env lacks the key; no file under operator `~/.pi` opened by the child (fs audit log) |
| X6 | pi-gateway-auth › isolated bridge over loopback TCP (POSIX fallback listener) | fault-injection (abort socket bind) | L2 | automated | socket bind refused → loopback fallback listener; fixture plugin isolated spawn | spawn | bridge registers with spawn-scoped proof; local token file never opened by the child |
| X7 | pi-gateway-auth › isolated bridge on Windows loopback | fault-injection (platform) | L2 | automated | Windows VM; fixture plugin isolated spawn; server env stores `Path` | spawn | registers via spawn-scoped proof; child env has the path variable; local token file never opened by the child |
| X8 | plugin-spawn-scope › Electron overlay switch | fault-injection (upgrade) | L2 | automated | packaged app; runtime overlay switched after boot | isolated spawn after switch | `-e` points at the new overlay's bridge entry; session registers `isolated:true` |
| X9 | plugin-public-routes › cross-origin widget over the network | fault-injection (hostile origin) | L2 | automated | dashboard with OAuth on; fixture plugin public routes enabled, `allowedOrigins=[http://localhost:<widget-port>]` served from a second local origin; operator logged in in the same browser profile | scripted fetch from widget origin (POST message + GET stream) and from an unlisted origin | listed origin: 200 + streamed frames + no dashboard cookie observed by the fixture handler; unlisted origin: no ACAO, POST `403`; operator routes unaffected |

---

## Coverage summary

- Requirements covered: 31/31 (isolation 17 as above + plugin-public-routes ADDED ×7, cross-site-request-gate ×1, server-cors ×3, bearer-device-auth ×2 incl. bearer branch, trusted-networks ×1, auth-bypass-url-list ×1 — some rows cover several)
- Scenarios by class: edge 65 · perf 1 · frontend 0 · error 9
- Scenarios by level: L1 69 · L2 6 · L3 0
- Scenarios by disposition: automated 75 · manual-only 0

## New infra needed

- **Fixture plugin that performs an isolated spawn** (pattern: `fixture-policy-plugin`) for X4–X8: provisions an agent dir under its own data dir with a faux-model `auth.json`, registers a canary-free KB stub tool via its extension, exposes a test endpoint that triggers `spawnSession({ scope: { agentDir, tools: [...] } })`.
- **Second local origin for X9**: a static page served on another loopback port by the qa script, driving `fetch` against the dashboard (pattern: `qa/tests/32-origin-gate.sh`).
- **Child fs audit** for X5–X7: run the spawned pi under a `fs` open hook (`--require` preload via the allowlisted `NODE_OPTIONS`-free path is impossible — use a fixture extension in the agent dir that wraps `fs` before the bridge loads, or OS tooling `fs_usage`/`strace` on the VM).
