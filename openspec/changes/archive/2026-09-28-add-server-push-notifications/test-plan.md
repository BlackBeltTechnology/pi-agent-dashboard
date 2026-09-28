# Test Plan: add-server-push-notifications

Stage: design   Generated: 2026-09-27

Hard gate cleared: C1–C5 answered by the user (crash truncation 200 chars, titles, web-push token shape, 50-token cap, sessionFilter ≤ 100). C6 (corrupt registry file) was not answered. The recommended default was taken (quarantine + start empty) and recorded in the spec; it can be revised before apply.

Levels: L1 = vitest (`packages/*/src/**/__tests__/*.test.ts`), L3 = Playwright (`tests/e2e/*.spec.ts` against the docker harness; port read from `.pi-test-harness.json`, never hardcoded).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | event-wiring: Unread trigger site | decision-table | L1 | automated | read session (`unread:false`), no viewer, live; stub `pushDispatcher` | `agent_end` with error via event_forward | `unread` becomes true; `fanout` called once with `unreadEdge:true` |
| E2 | event-wiring: Unread trigger site | decision-table | L1 | automated | session with `unread:true`, no viewer | `streaming→idle` event | no `session_updated` broadcast; `fanout` called once with `unreadEdge:false` |
| E3 | event-wiring: Unread trigger site | decision-table | L1 | automated | read session; browser sends `session_view` | `ask_user` edge | `fanout` call count 0; `unread` stays false |
| E4 | event-wiring: Unread trigger site | state-transition | L1 | automated | read session, no viewer | same `ask_user` edge delivered via event_forward (`tool_execution_start`) AND `prompt_request` (no payload) | exactly 2 `fanout` calls, exactly 1 with `unreadEdge:true`; the `prompt_request` call carries `after.currentTool==="ask_user"` |
| E5 | event-wiring: replay | state-transition | L1 | automated | session in replay (`replay_complete` not yet sent) | replayed `agent_end` with error | `fanout` call count 0; `unread` unchanged |
| E6 | event-wiring: Unknown session | EP | L1 | automated | session id with no record | qualifying event | `fanout` call count 0 |
| E7 | event-wiring: Optional dependency | decision-table | L1 | automated | `wireEvents` without `pushDispatcher` | qualifying event | unread set as before; no error logged |
| E8 | event-wiring: Production pairing | EP | L1 | automated | `createServer` with `push.enabled:true` | server start | `wireEvents` receives both `pushDispatcher` and `viewedSessionTracker` (spy) |
| E9 | Push trigger gating and cadence | decision-table | L1 | automated | 1 web-push + 1 webhook token (stub transports) | `fanout({unreadEdge:false})` after 31 s window | web-push send count 0; webhook send count 1 |
| E10 | Push trigger gating and cadence | decision-table | L1 | automated | 1 web-push + 1 fcm + 1 webhook token | `fanout({unreadEdge:true})` | each transport `send` called exactly once |
| E11 | Webhook coalescing | BVA | L1 | automated | 1 webhook token, window 30 000, fake timers | fanout at t=0, 10 s, 29 999 ms, 30 000 ms, 31 000 ms (same session) | sends at t=0 and t=30 000 only → count 2; t=31 000 suppressed (within new window) |
| E12 | Webhook coalescing | EP | L1 | automated | 1 webhook token | fanout for session A then B within 10 s | send count 2 |
| E13 | Webhook coalescing | state-transition | L1 | automated | 1 web-push token | edge push at t=0; `unread` cleared; `fanout({unreadEdge:true})` at t=5 s | web-push send count 2 (devices not coalesced) |
| E14 | Webhook coalescing | state-transition | L1 | automated | webhook token pushed at t=0 | re-register same `deviceToken` at t=1 s, fanout at t=2 s | same `tokenId` returned; send count stays 1 |
| E15 | Coalescing config | BVA | L1 | automated | `coalesceWindowMs` = 4 999, 5 000, 30 000, 300 000, 300 001, absent, `"abc"` | `parsePushConfig` | 5 000, 5 000, 30 000, 300 000, 300 000, 30 000, 30 000 |
| E16 | Opt-in by default | decision-table | L1 | automated | config `{}`, `{push:{}}`, `{push:{enabled:"true"}}`, `{push:{enabled:true}}` | `parsePushConfig` | `enabled` = false, false, false, true |
| E17 | Push payload | EP | L1 | automated | session `abc-123` named `fix-login`, model `claude-opus-5`, `ask_user` | `buildPushPayload` | deep-equals `{type:"session_attention",trigger:"input",sessionId:"abc-123",title:"fix-login: waiting for input",body:"claude-opus-5",url:"/session/abc-123"}` |
| E18 | Push payload | EP | L1 | automated | empty name, cwd `/home/u/proj/api`, `streaming→idle` | `buildPushPayload` | `title === "api: turn finished"`, `trigger === "turn_end"` |
| E19 | Push payload | BVA | L1 | automated | crash error of 0, 1, 200, 201 chars | `buildPushPayload` | body length 0, 1, 200 (verbatim), 201 (200 chars + `…`); `trigger === "crash"` |
| E20 | Push payload | EP | L1 | automated | `prompt_request`, no payload, `after.currentTool:"ask_user"` | `buildPushPayload` | `trigger === "input"`, no throw |
| E21 | Registration validation | EP | L1 | automated | web-push with `http:` endpoint; missing `keys.auth`; valid https + both keys | `POST /api/push/register` | 400, 400, 200 `{tokenId}` |
| E22 | Registration validation | BVA | L1 | automated | 50 tokens stored | register 51st distinct; re-register existing #7 | 409; 200 with #7's original `tokenId` |
| E23 | Registration validation | BVA | L1 | automated | `sessionFilter` of 100 strings; 101; `[""]`; `"A"` | register | 200, 400, 400, 400 |
| E24 | Registration validation | BVA | L1 | automated | label of 64 chars; 65 chars | register webhook | 200; 400 |
| E25 | Registration validation | EP | L1 | automated | `transport:"apns"`; `fcm` with `""` | register | 400; 400 |
| E26 | Token persistence | EP | L1 | automated | token `sessionFilter:["A"]` | fanout for session B, then A | send count 0, then 1 |
| E27 | Token persistence | state-transition | L1 | automated | register token, then construct a new registry from the same path | `list()` | same token with same `id` |
| E28 | Token persistence | state-transition | L1 | automated | register `deviceToken` X twice | `list()` | one entry for X; `lastUsedAt` = second call time |
| E29 | Webhook URL validation | EP | L1 | automated | `file:///etc/passwd`, `ftp://h/`, `javascript:alert(1)`, `/relative`, `http://u:p@h/` | `validateWebhookUrl` / register | each → 400; registry size unchanged |
| E30 | Webhook SSRF | EP+BVA | L1 | automated | `http://169.254.169.254/latest/meta-data`, `http://2852039166/`, `http://[::ffff:169.254.169.254]/`, `http://[fe80::1]/`, `http://[fd00:ec2::254]/`, `http://169.253.255.255/`, `http://169.255.0.0/` | register | first five → 400; last two (just outside the range) → 200 |
| E31 | Webhook SSRF | EP | L1 | automated | hostname stubbed (`dns.lookup` mock) to `[192.168.1.20, 169.254.1.1]` | register | 400 (any blocked record refuses) |
| E32 | Webhook SSRF | EP | L1 | automated | `http://127.0.0.1:<dashboard port>/api/restart`; `http://127.0.0.1:<other port>/hook`; `http://192.168.1.20:8787/api/hooks/h1?key=k` | register | 400; 200; 200 |
| E33 | Route tiers | EP | L1 | automated | booted server route table | `mcp-manifest-completeness` + `route-tier-gate` suites | all 5 `/api/push/*` routes have `ROUTE_TIERS` (vapid-public-key observe, others operate) and `DENYLIST` entries; suites pass |
| E34 | Push REST API | EP | L1 | automated | push enabled, no tokens | `POST /api/push/test` with no body | 200 `{results: []}` |
| E35 | Opt-in by default | decision-table | L1 | automated | push disabled; loopback caller | GET `/api/push/vapid-public-key`, GET/POST `/api/push/register`, DELETE, POST test | each → 404; no `push-vapid.json` created; no outbound request (fetch spy count 0) |
| E36 | Push REST API: auth precedes disabled | decision-table | L1 | automated | push disabled; non-loopback untrusted caller without credentials | GET `/api/push/vapid-public-key` | 401 (not 404) |
| E37 | VAPID lifecycle | state-transition | L1 | automated | empty data dir, push enabled | start, read key, restart | file created mode `0600` with `{publicKey, privateKey}`; second start returns identical `publicKey`; GET endpoint returns `{publicKey}` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Fire-and-forget dispatch | tail-latency | L1 | automated | 50 tokens whose transports never resolve; 200 qualifying events through `wireEvents` with one browser WS connected | p95 event→browser `session_updated` delivery within 10 ms of the same run with push disabled | 200 events |
| P2 | Fire-and-forget dispatch | invariant (sync I/O) | L1 | automated | 50 registered tokens; `fs.readFileSync`/`readFileSync` spied after registry load | 100 `fanout` calls | spy call count 0 |
| P3 | Token persistence (`touch` debounce) | threshold | L1 | automated | 1 webhook token, successful sends, fake timers | 20 successful deliveries across 59 s, then 1 at 61 s | file writes caused by `touch` = 1 in the first 60 s, 2 total |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Push Settings UI | state-transition | L1 | automated | `PushNotificationsSection` with mocked fetch: register → 200 | enter URL `http://192.168.1.20:8787/api/hooks/h1?key=k` + label `nanoMuse`, submit | POST body `{transport:"webhook",deviceToken:<url>,label:"nanoMuse"}`; list row text `nanoMuse (http://192.168.1.20:8787)`; `key=k` absent from DOM |
| F2 | Push Settings UI | state-transition | L1 | automated | register mocked → 400 `{error}` | submit | error text rendered; input `aria-describedby` points at the error node's id |
| F3 | Push Settings UI | EP | L1 | automated | `/api/push/vapid-public-key` mocked → 404 | mount | text "Push not enabled on this server"; no toggle, no webhook form |
| F4 | Push Settings UI | EP | L1 | automated | `window.isSecureContext = false`, server enabled | mount | "Web Push needs https or localhost" notice; device toggle absent; webhook form present |
| F5 | Push Settings UI | EP | L1 | automated | `navigator` iOS UA, not standalone | mount | "install to home screen" hint present |
| F6 | Service worker push handler | EP | L1 | automated | `public/sw.js` loaded in a mocked SW global | dispatch `push` with `{title,body,url,sessionId}` | `registration.showNotification` called once with that title and `{body, data:{url,sessionId}}` |
| F7 | Service worker click | state-transition | L1 | automated | mocked `clients.matchAll` returning one window client | dispatch `notificationclick` | client `focus()` + `navigate(url)` called; `clients.openWindow` call count 0 |
| F8 | Service worker click | state-transition | L1 | automated | `clients.matchAll` returns [] | dispatch `notificationclick` | `clients.openWindow(url)` called once |
| F9 | Push Settings UI (rendered, WS-driven) | state-transition | L3 | automated | docker harness with `push.enabled:true`; local HTTP receiver in the harness | add webhook via Settings, then Send Test | row shows `label (origin)` only; receiver got exactly 1 POST with `type:"session_attention"`; page never shows the path or query |
| F10 | Web Push on a real browser | visual/hardware | — | manual-only | Chrome + Firefox subscribed; iOS 16.4+ PWA installed | `ask_user` in an unviewed session | [judgment: OS notification appears, looks right, and a tap opens the session: platform push services are not automatable in CI] |
| F11 | nanoMuse round trip | integration/hardware | — | manual-only | `nanomuse serve` + a `hook` trigger, URL registered in Settings, phone with nanomuse-connect | `ask_user` in an unviewed session | [judgment: one `Webhook: …` Feed entry and a phone notification; external app, not in the harness] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Fire-and-forget | fault-injection (sync throw) | L1 | automated | transport `send` throws synchronously | `fanout` | no throw out of `fanout`; logger error with the `tokenId`; other tokens still sent |
| X2 | Fire-and-forget | fault-injection (reject) | L1 | automated | transport `send` returns a rejected promise | `fanout`, flush microtasks | `process` `unhandledRejection` listener call count 0; failure logged |
| X3 | Fire-and-forget lint | static | L1 | automated | source of `event-wiring.ts` | AST scan | fails if any `await` or `.then(` wraps a `fanout(` call; passes on the real file |
| X4 | Three transports | fault-injection | L1 | automated | persisted token with `transport:"carrier-pigeon"` | `fanout` | warning logged; other tokens delivered; no throw |
| X5 | Webhook transport | fault-injection (abort) | L1 | automated | local `http.createServer` answering 302 `Location: http://127.0.0.1:<p2>/x` | deliver | request count on `<p2>` = 0; result `{ok:false}`; token kept |
| X6 | Webhook transport | fault-injection | L1 | automated | receiver answers 410 | deliver | token removed from memory and file |
| X7 | Webhook transport | fault-injection | L1 | automated | receiver answers 404 three times | 3 deliveries (coalescing disabled via distinct sessions) | token kept; `GET /api/push/register` shows `consecutiveFailures: 3`; a later 200 resets it to 0 |
| X8 | Webhook transport | fault-injection | L1 | automated | receiver answers 429, then 500 | deliver twice | both `{ok:false}`; exactly 1 request per delivery (no retry); token kept |
| X9 | Webhook transport | fault-injection (delay) | L1 | automated | receiver accepts the socket and never responds | deliver | promise settles `{ok:false}` at 5 000 ms ± 250 ms (fake-clock tolerant); failure logged |
| X10 | Webhook SSRF (rebinding) | fault-injection | L1 | automated | registered hostname; `dns.lookup` mock switched to `169.254.169.254` after registration | deliver | no connection opened (receiver/socket spy count 0); `{ok:false}`; token kept |
| X11 | Secret never echoed | invariant | L1 | automated | webhook `https://hooks.example:8443/api/hooks/h1?key=s3cret` label `nanoMuse`; transport made to fail with ECONNREFUSED, 500 and a timeout | list + deliver, capturing all logger output and responses | output contains `nanoMuse (https://hooks.example:8443)`; strings `/api/hooks/h1` and `s3cret` appear 0 times |
| X12 | Registration validation (web-push secret) | invariant | L1 | automated | web-push endpoint `https://fcm.googleapis.com/fcm/send/SECRETID`, transport failing | list + deliver, capture logs | `fcm.googleapis.com browser` present; `SECRETID` count 0 |
| X13 | Push REST API: test opacity | fault-injection | L1 | automated | webhook failing with 500, and one timing out | `POST /api/push/test` | each result deep-equals `{tokenId, ok:false}` (no status, text or timing keys) |
| X14 | Token persistence: file mode | fault-injection | L1 | automated | stale `push-tokens.json.tmp` pre-created with mode `0644` | `writeJsonFile(path, data, {mode:0o600})` | final file `stat().mode & 0o777 === 0o600`; no `.tmp` left |
| X15 | Token persistence: corrupt file | fault-injection | L1 | automated | `push-tokens.json` containing `{not json` | registry load / server start with push enabled | file renamed to `push-tokens.json.corrupt-<ms>`; registry empty; server starts; `push.errors` has a registry entry |
| X16 | Web Push transport | fault-injection | L1 | automated | mocked `web-push` rejecting with statusCode 410; then 404; then 201 | deliver | 410/404 → token pruned; 201 → `{ok:true}`, `lastUsedAt` updated |
| X17 | FCM transport | fault-injection | L1 | automated | mocked fetch: 401 once then 200; response `UNREGISTERED`; service-account path missing | deliver | re-signs JWT and retries once after 401 → ok; UNREGISTERED → pruned; missing file → FCM disabled, `push.errors` entry, server keeps running |
| X18 | Push health reporting | decision-table | L1 | automated | web-push enabled without `contactEmail` | GET `/api/health` from a caller failing `canDiscloseAccessPosture`, then from loopback | first payload has no `push` key; second has `push.errors` naming `contactEmail`; `health-shape` suite passes |

---

## Coverage summary

- Requirements covered: 16/16 (event-wiring ×2; push-notifications ×14)
- Scenarios by class: edge 37 · perf 3 · frontend 11 · error 18
- Scenarios by level: L1 66 · L2 0 · L3 1 · manual 2
- Scenarios by disposition: automated 67 · manual-only 2

## New infra needed

- none. Local `http.createServer` receivers (see `changelog-remote.test.ts`), the `dns.lookup` mock and a mocked service-worker global are in-test fixtures, not new harnesses. F9 reuses the docker e2e harness.
