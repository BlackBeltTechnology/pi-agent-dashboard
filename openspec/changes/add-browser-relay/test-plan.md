# Test Plan — add-browser-relay

Stage: design   Generated: 2026-09-13

Gate: HARD — 4 clarifications resolved before generation (allowedDomains leading-dot matching; no viewer cap; missing Local State → synthetic Default row; env-gated fake instance for L3).

Levels: L1 = vitest under `packages/*/src/**/__tests__/`; L2 = `qa/tests/*.sh`; L3 = Playwright `tests/e2e/*.spec.ts` against the docker harness (port from `.pi-test-harness.json`, `PI_BROWSER_RELAY_FAKE=1`).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | plugin-ws-route / registration | decision-table | L1 | automated | registry empty; plugin A registers `browser-ext`+`/ws/browser-ext/` during activation | plugin B registers same scope; plugin C registers prefix `/ws/browser-ext/x/` | both throw; A's registration still resolves for `/ws/browser-ext/abc` |
| E2 | plugin-ws-route / reserved scopes | EP | L1 | automated | each of `browser`,`terminal`,`live`,`bridge` and prefixes `/ws`,`/ws/terminal/`,`/live/`,`/ws/bridge` | `registerWsRoute` | throws for all 8; registry unchanged |
| E3 | plugin-ws-route / late registration + re-activation | state-transition | L1 | automated | plugin activated, activation completed | `registerWsRoute` after activation; then toggle off → on and register during 2nd activation | first throws; second succeeds and `routeScopeForUrl` resolves to the new handler |
| E4 | plugin-ws-route / origin admission | decision-table | L1 | automated | scope with `admitOrigins:["chrome-extension://abc"]`; scope with `admitOrigins:[]` | Origins: `chrome-extension://abc`, `chrome-extension://xyz`, `http://localhost:5173`, absent | pinned scope: only `abc` passes (localhost:5173 → 403, absent → 403); empty scope: core policy result byte-identical to `isWsOriginTrusted` fixtures |
| E5 | plugin-ws-route / core scopes unchanged | regression (golden) | L1 | automated | existing `cors-origin.test.ts` + `ws-ticket.test.ts` fixtures | run with registry populated by a plugin scope | every existing assertion passes unchanged; `routeScopeForUrl("/ws?ticket=x")` still `browser` |
| E6 | plugin-ws-route / ticket refusal | EP | L1 | automated | `POST /api/ws-ticket {scope:"browser-ext"}` | mint | 400; `wsTicketStore.consume(ticket,"browser-ext")` type-rejected + runtime false |
| E7 | browser-relay / loopback Host list | BVA on Host | L1 | automated | remote 127.0.0.1; Host ∈ {`127.0.0.1:8000`,`[::1]:8000`,`localhost:8000`,`localhost`} vs {`share.zrok.io`,`127.0.0.1.evil`,`192.168.1.5:8000`} | upgrade to `/ws/browser-ext/<live guid>` with pinned Origin | first set → 101; second set → 403 with `[ws-gate]` log naming scope + peer |
| E8 | browser-relay / forwarding headers | EP | L1 | automated | loopback + valid guid + each header in {`x-forwarded-for`,`x-forwarded-host`,`x-forwarded-proto`,`x-forwarded-server`,`x-forwarded-port`,`x-real-ip`,`forwarded`,`via`} | upgrade | 403 for each single header; none → 101 |
| E9 | browser-relay / guid validity | BVA | L1 | automated | guids: live-unclaimed, live-claimed, expired (61 s), never-minted, malformed (`abc`, 31 hex chars, 33 hex chars) | ext upgrade | unclaimed → 101 + claimed; claimed → 2nd socket close 1000 `Another extension connection already established`; expired/never/malformed → 404 |
| E10 | browser-relay / CDP scope Origin | EP | L1 | automated | valid guid, loopback; request with `Origin: http://localhost:8000` vs no Origin header | upgrade `/ws/browser-cdp/<guid>` | with Origin → 403; without → 101 |
| E11 | browser-relay / second CDP client | state-transition | L1 | automated | instance with CDP client attached | second CDP connect | second closed 1000 `Another CDP client already connected`; first keeps receiving responses |
| E12 | browser-relay / deny-list verbs | EP | L1 | automated | each of `Storage.getCookies`,`Network.getAllCookies`,`Network.getCookies`,`Browser.setDownloadBehavior` | CDP client sends | response `{id, error:{code:-32000, message:"Denied by dashboard relay policy: <m>"}}`; fake extension receives nothing; audit `denied` row with method |
| E13 | browser-relay / navigate scheme | EP | L1 | automated | `Page.navigate` and `Target.createTarget` with `file:///etc/passwd`, `javascript:alert(1)`, `data:text/html,x`, `blob:https://a/b`, `https://ok.test` | send with `allowedDomains` empty | first four denied; `https://ok.test` forwarded verbatim |
| E14 | browser-relay / allowedDomains matching | decision-table | L1 | automated | `allowedDomains` = `["github.com"]` / `[".github.com"]` / `[]`; hosts `github.com`, `api.github.com`, `github.com.evil.io`, `GITHUB.COM:443`, host-less `about:blank` | `Page.navigate` | `["github.com"]`: github.com ✓, GITHUB.COM:443 ✓, api ✗, evil ✗, about:blank ✗; `[".github.com"]`: github.com ✓, api ✓, evil ✗; `[]`: all ✓ except schemes from E13 |
| E15 | browser-relay / audit ring | BVA | L1 | automated | ring cap 500; append 499, 500, 501, 600 entries | serialize | counts 499/500/500/500; oldest dropped first; `auditSeq` strictly increasing across 600; JSON of any entry contains neither guid nor token substring |
| E16 | browser-relay / audit detail content | EP | L1 | automated | events: navigate `https://a/b?q=1`, denied `Runtime.x`, viewer-input `mouse` | append | `detail` is URL string / method name / `mouse` — never a payload object |
| E17 | browser-relay / profiles listing | EP | L1 | automated | fixture `Local State` with 3 profiles (one duplicate label, one with email); Extensions dir present for 1 | `GET /api/browser/profiles` | 3 rows keyed by `profileDirectory`; duplicate labels preserved; `installed` true for exactly 1; `hasToken` false; `instances: []` |
| E18 | browser-relay / connect URL | EP | L1 | automated | profile `Profile 37`, `zeroDialog` false / true with token `T` | `connect` (mocked `systemOpen`) | args contain `--profile-directory=Profile 37`, URL has `mcpRelayUrl=ws://127.0.0.1:<port>/ws/browser-ext/<32hex>`, `protocolVersion=2`; `token=T` only in the true case |
| E19 | browser-relay / connect 409 reasons | decision-table | L1 | automated | `installed:false`; `installed:true` + live instance (spike says busy) | `connect` | 409 `{reason:"not-installed"}`; 409 `{reason:"busy", instanceId}` respectively; first instance untouched |
| E20 | browser-relay / disconnect param | BVA | L1 | automated | `disconnect` with no `instanceId`, unknown id, live id | POST | 400; 404; 200 + ext socket closed + guid 404 afterwards |
| E21 | browser-relay / kill switch | state-transition | L1 | automated | 2 live instances, `enabled:true` | `PUT /api/browser/enabled {enabled:false}` | PUT resolves only after both instances closed; then ext/cdp upgrades → 403; `connect`/`disconnect` → 403; PUT `{enabled:true}` → 200 |
| E22 | browser-relay / status payload | EP | L1 | automated | instance with tabs 5 and 9 | `browser_relay_status` broadcast | `instances[0].tabs` = `[{tabId:5,…},{tabId:9,…}]`; no `guid`/`token` keys anywhere; `auditSeq` number |
| E23 | browser-relay / viewer input mapping | BVA | L1 | automated | last frame metadata 1280×800; inputs `{x:0,y:0}`, `{x:0.5,y:0.5}`, `{x:1,y:1}`, `{x:1.0001,y:0}`, `{x:-0.01,y:0}` | `browser_relay_input {kind:"mouse"}` | `Input.dispatchMouseEvent` with (0,0), (640,400), (1280,800); last two dropped + audit `denied` |
| E24 | browser-relay / input kinds | EP | L1 | automated | kinds `mouse`,`key`,`scroll`,`bringToFront`,`evaluate`,`""` | input | first four map to `Input.dispatchMouseEvent`/`Input.dispatchKeyEvent`/`Input.synthesizeScrollGesture`/`Page.bringToFront`; last two: no CDP command, audit `denied` |
| E25 | browser-relay / tap command ids | EP | L1 | automated | CDP client sends ids 1..1000; tap active | interleaved responses | tap ids ≥ 2^30; every client response routed to the client with original id; no tap response leaks to client |
| E26 | browser-relay / frame filtering per session | decision-table | L1 | automated | tabs A (tap active) and B (no tap); extension emits `Page.screencastFrame` for both | forward | client receives B's frames only; subscribers receive A's; client `Page.startScreencast` on A → denied error, on B → forwarded |
| E27 | browser-relay / client screencast precedence | state-transition | L1 | automated | client already sent `Page.startScreencast` on tab A | viewer subscribes to A | subscribe refused, tab state `client-screencast-active`; client frames untouched; after client `Page.stopScreencast`, re-subscribe succeeds |
| E28 | browser-relay / fake instance gating | EP | L1 | automated | env unset / `PI_BROWSER_RELAY_FAKE=1` | plugin activation | no instance / one instance `profileDirectory:"Fake"` tab 1; subscriber gets ≥5 frames in 1 s |
| E29 | shared-protocol / union members | type-level | L1 | automated | `BrowserToServerMessage`, `ServerToBrowserMessage` | exhaustiveness test | includes the 3 + 2 new members; frame/status types have no `guid`/`token` field (type-level `never` check) |
| E30 | default-browser-skill / file layout + frontmatter | EP | L1 | automated | packaged extension skill dir | existing skill-structure test | `references/dashboard-relay.md` present; `allowed-tools` contains all four grants incl. `Bash(npx @panerelay/setup:*)` and `Bash(curl:*)` |
| E31 | browser-plugin-settings / manifest | EP | L1 | automated | `packages/browser-plugin/package.json` | loader manifest validation | id `browser`, claims `settings-section` + content-view slot resolve to exported components; `configSchema.json` marks `token` `writeOnly` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | browser-relay / tap fps | throughput | L1 | automated | fake extension emitting 4 KB frames at 10 fps, 1 subscriber, CDP client sending 20 `Runtime.evaluate`/s | subscriber ≥ 8 fps; CDP round-trip p95 ≤ 100 ms added over baseline (run without tap) | 5 s |
| P2 | browser-relay / backpressure | threshold | L1 | automated | 2 subscribers; stub socket A reports `bufferedAmount` 600 KiB, B 0 | A receives 0 frames while high, B receives all; ack sent for every frame regardless; `status` skipped-count for A ≥ frames emitted | 2 s |
| P3 | browser-relay / status coalescing | throughput | L1 | automated | 100 audit appends in 100 ms | ≤ 1 `browser_relay_status` broadcast per 500 ms; final `auditSeq` = last append | 1 s |
| P4 | browser-relay / instance churn | soak | L1 | automated | 200 connect→claim→cdp-attach→cdp-close cycles | `Map` sizes return to 0; no listener leak (`process.getMaxListeners` not exceeded, `wss.clients.size` 0); RSS growth < 20 MB | 200 cycles |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | browser-plugin-settings / profile rows | state-convergence | L3 | automated | harness with `PI_BROWSER_RELAY_FAKE=1` (canOpenChrome false in docker) | open settings → Browser section | notice "cannot open Chrome" rendered; no `Connect` button; Fake instance row shows 1 tab |
| F2 | browser-plugin-settings / token write-only | state-transition | L3 | automated | RTL/L3: paste `tok123` in Fake row | save | input cleared; `hasToken` badge true; subsequent `GET /api/browser/profiles` body does not contain `tok123`; `Zero-dialog` toggle now enabled with mismatch help text |
| F3 | browser-plugin-settings / kill switch UI | state-convergence | L3 | automated | Fake instance live | toggle `Enabled` off | within 2 s every row shows no instances, `Connect` disabled with reason "Browser relay disabled"; toggle on restores |
| F4 | browser-plugin-settings / audit refresh | state-convergence | L3 | automated | audit list open for Fake | send `browser_relay_input {kind:"evaluate"}` via page WS | a `denied` row appears within 2 s (driven by `auditSeq` change); no refetch when a status with the same `auditSeq` arrives |
| F5 | browser-plugin-settings / tile lifecycle | state-transition | L3 | automated | Fake instance tab 1 | open content view → tile mounts | `browser_relay_subscribe {instanceId, tabId:1}` observed; ≥5 frames rendered as `<img>` src changes in 1 s; navigate away → `browser_relay_unsubscribe` sent |
| F6 | browser-plugin-settings / no-frames overlay | state-transition | L1 (RTL) | automated | tile mounted | receive status tab state `no-frames` | overlay text "No repaints — tab may be idle or in the background"; clicking `Bring to front` sends `{kind:"bringToFront"}`; state back to `live` hides overlay |
| F7 | browser-plugin-settings / DevTools overlay | state-transition | L1 (RTL) | automated | tile mounted, live | status `{state:"detached", reason:"devtools"}` | overlay "DevTools open on this tab — close it to resume"; pointer/key events produce no `browser_relay_input` |
| F8 | browser-plugin-settings / coordinate normalization | BVA | L1 (RTL) | automated | tile rendered at 320×200 CSS px for a 1280×800 frame | click at CSS (160,100) and (319,199) | `browser_relay_input {kind:"mouse", x:0.5, y:0.5}` and `{x≈0.997, y≈0.995}`; never pixel values |
| F9 | browser-plugin-settings / tab list drives tiles | state-convergence | L1 (RTL) | automated | status with tabs [1] → [1,2] → [2] | successive statuses | tiles count 1→2→1; tile for tab 1 unsubscribes on removal |
| F10 | browser-plugin-settings / remote viewer path | invariant | L3 | automated | harness reached via non-loopback host (tunnel simulation: `Host: harness.test`) | open tile | frames arrive over `/ws`; page never opens a socket to `/ws/browser-ext/` or `/ws/browser-cdp/` (network log assertion) |
| F11 | browser-plugin-settings / tile rendering quality | visual/subjective | — | manual-only | real Chrome, real page | human looks at tile at 1280→320 scale | [judgment: legibility/aspect ratio "looks right"] |
| F12 | browser-relay / real tab group colour visible | visual/subjective | — | manual-only | real Chrome profile OSS | agent connects | [judgment: user can visually tell which tabs are agent-controlled] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | browser-relay / connect timeout | fault-injection (delay) | L1 | automated | extension never dials in | `connect`, fake timers +60 s | 504; guid → 404 afterwards; no instance in map |
| X2 | browser-relay / CDP before extension | fault-injection (delay) | L1 | automated | CDP client connects first; extension handshake 5 s later / never | connect cdp | commands held then answered after handshake; never → CDP socket closed at 30 s with reason `Extension not connected` |
| X3 | browser-relay / CDP never attaches | fault-injection (abort) | L1 | automated | extension handshake done, no CDP client | +30 s | instance closed, ext socket closed, audit `detach/no-cdp-client`, guid 404 |
| X4 | browser-relay / CDP client dies | fault-injection (abort) | L1 | automated | live instance | CDP socket destroyed without close frame | ext socket closed ≤ 1 s, tab group released message sent, instance removed |
| X5 | browser-relay / extension dies | fault-injection (abort) | L1 | automated | live instance with CDP client | ext socket destroyed | CDP socket closed with `Extension disconnected`; subscribers get status with instance removed |
| X6 | browser-relay / last tab closed | state-transition | L1 | automated | instance with 1 tab | fake extension emits tab-closed | ext close reason `All controlled tabs detached`; CDP close `Extension disconnected`; guid expired |
| X7 | browser-relay / DevTools detach | fault-injection | L1 | automated | live tab A, viewer subscribed | fake extension emits detach `canceled_by_user` for A | status `{state:"detached", reason:"devtools"}` ≤ 1 s; CDP commands for A → error `Target detached: devtools`; tab B unaffected |
| X8 | browser-relay / no-frames detector | fault-injection (delay) | L1 | automated | subscriber on tab A | 2 s without frames (fake timers) | status tab A `no-frames`; `bringToFront` input → `Page.bringToFront` sent; next frame → state `live` |
| X9 | browser-relay / Local State missing/corrupt | fault-injection | L1 | automated | userDataDir absent; `Local State` = `{not json` | `GET /api/browser/profiles` | 200, one row `Default`, `warning` names the path; `connect?profile=Default` proceeds to `installed` check |
| X10 | browser-relay / systemOpen unavailable | fault-injection | L1 | automated | `systemOpen` capability false | `status`, `connect` | `{canOpenChrome:false}`; 503 |
| X11 | browser-relay / plugin toggled off | fault-injection (abort) | L1 | automated | live ext + cdp sockets on plugin scopes | `POST /api/plugins/browser/toggle` off | both sockets closed 1001 ≤ 1 s; new upgrade → 404; `/api/browser/status` → 404 |
| X12 | browser-relay / malformed viewer messages | robustness | L1 | automated | `browser_relay_subscribe` with missing `tabId`, string `tabId`, unknown `instanceId`; `browser_relay_input` with 10 MB payload | send | each ignored with audit `denied`; socket stays open; no CDP command |
| X13 | browser-relay / viewer socket drops mid-stream | fault-injection (abort) | L1 | automated | 2 subscribers on tab A | subscriber 1 socket destroyed | subscriber 2 keeps receiving; tap continues; after subscriber 2 unsubscribes → `Page.stopScreencast` sent |
| X14 | browser-relay / vendor dir integrity | regression | L1 | automated | `src/server/relay/vendor/` | hash test | directory hash equals recorded manifest; `NOTICE` present with upstream SHA |
| X15 | default-browser-skill / routing on failures | decision-table | L1 | automated | fixture dashboard responses: status 404 / `enabled:false` / `canOpenChrome:false` / connect 409 not-installed / 409 busy / 503 / 504 | skill routing doc table test (SKILL.md contains the branch text) | SKILL.md + dashboard-relay.md contain each branch with the specified user-facing instruction (not-installed → install; busy → ask reuse/other; unavailable → own-browser only if ready else halt) |
| X16 | browser-relay / real-Chrome end-to-end | manual | — | manual-only | real Chrome profile OSS with extension | run skill: connect → `agent-browser connect` → snapshot; open DevTools; close tab | [manual evidence: cdpUrl works, tab group appears, tile streams, DevTools detach shown, tab close ends instance] |
| X17 | browser-relay / two sockets one profile (spike) | manual | — | manual-only | profile OSS | two `connect` calls | [manual: either two tab groups, or second refused → decides 409 busy branch] |

---

## Coverage summary

- Requirements covered: 31/31 requirement blocks across the 5 spec deltas (every SHALL has ≥1 row)
- Scenarios by class: edge 31 · perf 4 · frontend 12 · error 17
- Scenarios by level: L1 55 · L2 0 · L3 6 · manual 4 (rows marked `—`)
- Scenarios by disposition: automated 60 · manual-only 4 (F11, F12, X16, X17)

## New infra needed

- `FakeRelayInstance` behind `PI_BROWSER_RELAY_FAKE=1` (spec'd in browser-relay; task 2.10b) — required for F1–F5, F10.
- Docker harness must pass `PI_BROWSER_RELAY_FAKE=1` through `docker/test-up.sh` env (one-line addition; see `docker/AGENTS.md` for the env plumbing).
- A `fake-extension.ts` vitest helper (in-process `ws` pair speaking ExtensionProtocolV2) — shared by E9–E27, P1–P4, X1–X13.
