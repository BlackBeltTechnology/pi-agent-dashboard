# Test Plan — add-operator-browser-relay

Stage: design   Generated: 2026-10-14

Decisions applied:
- Perf target from the gate: tee path ≤ 50 ms p95 receipt → `onFrame`, and ≥ 8 fps live on a LAN. The first is L1 timed; the fps is a manual live check, because it depends on real Chrome repaint.
- Electron-side tests are unit tests of `packages/electron/src/lib/browser-host/*` with fakes, plus one manual live check. No new Electron CI job.

Sources: proposal.md, design.md (D1–D11), specs/browser-operator-host, specs/electron-browser-host, specs/browser-relay (MODIFIED ×6), specs/browser-pane-tab, specs/browser-plugin-settings, specs/default-browser-skill, specs/shared-protocol.

Harness facts:
- **Plugin server tests** use in-process sockets. `FakeSocket` / `FakeExtension` (`packages/browser-plugin/src/server/relay/__tests__/fake-socket.ts`) deliver synchronously. A fake carrier = a `FakeSocket` registered through the plugin's browser handlers, as `status.test.ts` invokes handlers with a `ws`.
- **Timers** use `vi.useFakeTimers()` (`relay-manager.test.ts` already drives the 60 s connect timeout that way).
- **REST** uses `Fastify inject` (`routes.test.ts`). A long-wait connect over a real socket reuses the `fix-browser-relay-pane-input` real-listen pattern.
- **Electron lib tests** inject ports: `CryptoPort` (safeStorage fake) as in `server-keyring.test.ts`; trusted-sender checks as in `servers-ipc.test.ts`; menu as in `servers-menu.test.ts`; preload exposure as in `src/__tests__/renderer-boundary.test.ts`; a health fetch fake as in `src/__tests__/remote-probe.test.ts`.
- **Ed25519** comes from `node:crypto` `generateKeyPairSync("ed25519")`, available in Node ≥ 16.

Harness exemplars (verified on disk):
- L1 relay/link ← `packages/browser-plugin/src/server/relay/__tests__/relay-instance.test.ts`, `screencast-tap.test.ts`, `fake-socket.ts`
- L1 manager/connect ← `packages/browser-plugin/src/server/__tests__/relay-manager.test.ts`
- L1 routes ← `packages/browser-plugin/src/server/__tests__/routes.test.ts`
- L1 handlers/status ← `packages/browser-plugin/src/server/__tests__/status.test.ts`
- L1 ws routes ← `packages/browser-plugin/src/server/__tests__/ws-routes.test.ts`
- L1 audit ← `packages/browser-plugin/src/server/__tests__/audit.test.ts`
- L1 profiles parity ← `packages/browser-plugin/src/server/__tests__/profiles.test.ts`
- L1 shared protocol ← `packages/shared/src/__tests__/browser-protocol-types.test.ts`
- L1 WS tiers ← `packages/server/src/identity/__tests__/ws-message-tiers.test.ts`
- L1 REST tiers ← `packages/server/src/identity/__tests__/http-road-classification.test.ts`
- L1 client ← `packages/browser-plugin/src/client/__tests__/BrowserPaneTab.test.tsx`, `BrowserSettings.test.tsx`, `test-utils.tsx`
- L1 Electron ← `packages/electron/src/lib/__tests__/server-keyring.test.ts`, `servers-ipc.test.ts`, `servers-menu.test.ts`, `packages/electron/src/__tests__/renderer-boundary.test.ts`, `remote-probe.test.ts`
- L1 skill doc ← `packages/extension/src/__tests__/browser-skill-registered.test.ts`

Abbreviations:
- REG = Operator host identity and registration
- HTC = Host-targeted connect
- LNK = Operator link stream
- LFV = Local frame viewers
- LIFE = Operator host lifecycle
- OBS = Operator host observability
- IPC = Trusted browser-host IPC surface
- KEY = Host key pair
- SHIM = Loopback relay shim
- CON = Operator consent
- TOK = Local pairing token store
- PROF = Local Chrome profiles and launch
- TEE = Local frame tee
- BR-* = browser-relay MODIFIED
- BPT = One pane tab per relay tab
- BPS = This-computer block
- DBS = Dashboard-relay recipe
- SP = Browser relay operator host messages

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | REG "Capable Electron registers" | state-transition | L1 | automated | fake carrier, key pair K, server instanceId I | hello → challenge → register signed over (nonce, I) | `browser_host_registered {hostId}` sent to carrier only; `GET /api/browser/profiles` `operatorHosts[0]` = `{hostId, online:true, profiles:[…]}` |
| E2 | REG hostId derivation | EP | L1 | automated | register whose `hostId` ≠ `host-`+sha256(pub)[0:32] | register | refused; no host listed; audit `host:<claimed>` entry `browser_host:register` |
| E3 | REG "Impersonation attempt" | decision table | L1 | automated | H pinned to K1 and bound to socket A; attacker socket B with K2 | B sends hello/register for H signed by K2 | refused; `pin=mismatch` log; A's binding + live instance unchanged |
| E4 | REG "Signature for another server" | EP | L1 | automated | valid key; signature over serverId J ≠ I | register | refused |
| E5 | REG "Same machine on a second socket while active" | state-transition | L1 | automated | H bound to A with a live instance | B registers H with valid signature | refused `host-active`; instance on A still live |
| E6 | REG "Re-bind after reload" | state-transition | L1 | automated | H bound to A, no links; A closes | B registers H validly | H bound to B; `online:true` |
| E7 | REG bounds | BVA | L1 | automated | register with profiles count ∈ {64, 65}, label length ∈ {128, 129}, `profileDirectory` "a/b", email length 255 | register | 64 / 128 accepted; 65, 129, "a/b", 255 refused |
| E8 | REG "Older server" (client) | decision table | L1 | automated | `OperatorHostCarrier` mounted with `browserHost` present; status `{enabled:true, canOpenChrome:true}` without `operatorHosts` | mount + ws open | zero `browser_host_*` messages sent |
| E9 | REG carrier gating (client) | EP | L1 | automated | no `window.piDashboard.browserHost`; status has `operatorHosts:true` | mount | zero `browser_host_*` messages; no IPC calls |
| E10 | REG pin persistence + pruning | BVA | L1 | automated | pin file with 257 pins and one pin last seen 91 days ago | load + register a new host | file holds ≤ 256 pins; the 91-day pin is gone; new pin present |
| E11 | REG `DELETE /api/browser/operator-hosts/:hostId` | EP | L1 | automated | pinned H | `DELETE` H, then H registers with a new key K3 | 200; new register pins K3 (`pin=new`) |
| E12 | HTC "Operator connect succeeds" | state-transition | L1 | automated | H registered with `Default` installed; fake carrier answers `ok:true`, then `ext_open` + FakeExtension handshake via `ext_data` | `connect {profileDirectory:"Default", host:H}` | 200 `{cdpUrl:"ws://127.0.0.1:<port>/ws/browser-cdp/…", instanceId}`; no message sent to any socket contains the guid (scan all `FakeSocket.sent`) |
| E13 | HTC decision table of outcomes | decision table | L1 | automated | one row per D6 cause: disabled, unknown host, profile absent, `installed:false`, live instance, pending same profile, 8 links, 2 pending, `denied`, `no-chrome`, `boom` | `connect` with host | 403; 404 `unknown-host`; 409 `not-installed` ×2; 409 `busy` (+`instanceId` when live); 409 `busy`; 409 `host-busy` ×2; 403 `operator-denied`; 503 `no-chrome`; 503 `launch-failed` |
| E14 | HTC "Same profile name on two hosts" | EP | L1 | automated | dashboard `Default` live instance; H lists `Default` | `connect {host:H, profileDirectory:"Default"}` | not `busy`; `browser_host_connect` sent to H |
| E15 | HTC "Omitted host keeps today's behaviour" / BR "Omitted host" | regression | L1 | automated | H registered | `connect {profileDirectory:"Default"}` and `{…, host:"dashboard"}` | dashboard `openChrome` called once each; zero `browser_host_*` sent |
| E16 | HTC "Pending connect is deduplicated" | state-transition | L1 | automated | connect (H, `Default`) awaiting consent | second connect (H, `Default`) | second → 409 `busy`; exactly one `browser_host_connect` sent |
| E17 | BR "Operator-targeted guid is not claimable on the endpoint" | EP | L1 | automated | operator connect pending for guid G | real upgrade on `/ws/browser-ext/G`, loopback + pinned Origin | HTTP 404; H's `ext_open` still attaches afterwards |
| E18 | BR "Profile cannot host a second concurrent instance" (per host) | regression | L1 | automated | live instance (H, `Default`) | second connect (H, `Default`) | 409 `{reason:"busy", instanceId}`; first instance unaffected |
| E19 | LNK "Attach before consent" | state-transition | L1 | automated | `browser_host_connect` sent, no `connect_result` yet | carrier sends `ext_open` | dropped; audit `denied` `browser_host:ext_open`; connect still pending |
| E20 | LNK "Foreign socket names a link" | decision table | L1 | automated | live link L on carrier A; other socket B | B sends `ext_data`, `ext_close`, `connect_result` naming L / its requestId | all dropped; link alive; 3 `denied` audit entries |
| E21 | LNK "Oversized frame" | BVA | L1 | automated | live link | `ext_data` of length 16 MiB and 16 MiB + 1 | first delivered; second closes the link with 1009 and the instance closes |
| E22 | LNK non-string `data` / second `ext_open` | EP | L1 | automated | live link | `ext_data {data: 42}`; second `ext_open` for L | both dropped + audited; link alive |
| E23 | LNK "Deny-list on a linked instance" | regression | L1 | automated | linked instance | agent CDP `Network.getAllCookies` | agent gets `-32000`; no `browser_host_relay_data` carries that method |
| E24 | LNK "Carrier messages are unicast" | EP | L1 | automated | carrier A with link; plain client B | full connect + one relay frame + tee + cancel cycle | B's `sent` contains no `browser_host_*`; A's contains them |
| E25 | LFV "Pane on the operator machine" | state-transition | L1 | automated | carrier A hosting instance X, tab T | A subscribes `{X, T, local:true}`, extension emits 3 frames | A gets `browser_host_tee {on:true}` and 0 `browser_relay_frame`; 3 acks sent to extension |
| E26 | LFV "Local flag from another client" | EP | L1 | automated | same X, T; phone socket P | P subscribes `local:true`, 3 frames | P gets 3 `browser_relay_frame`; audit `denied` `browser_host:local-ignored` |
| E27 | LFV "Mode switch on the carrier" | state-transition | L1 | automated | A subscribed local | A subscribes same tab without `local`, then a frame | A receives `tee {on:false}` before its first `browser_relay_frame`; never both for one frame |
| E28 | LFV last viewer leaves | state-transition | L1 | automated | A local-subscribed (only viewer) | A unsubscribes | `tee {on:false}` sent; `Page.stopScreencast` sent to extension |
| E29 | BR "Screencast tap" status shape | EP | L1 | automated | one dashboard instance, one linked instance, Fake instance | status compose | instances carry `host:"dashboard"`, `host:H`, `host:"dashboard"` respectively |
| E30 | BR "Profile discovery" | EP | L1 | automated | no hosts / one host | `GET /status`, `GET /profiles` | status has `operatorHosts:true`; profiles `operatorHosts:[]` then one entry with `instances` and no `hasToken`/`zeroDialog` keys |
| E31 | BR "Operator-hosted attach is attributable" / OBS | EP | L1 | automated | linked attach | read audit | `attach` detail contains `host:H`; no entry contains guid or linkId (string scan) |
| E32 | SP "Union type inclusion" + one direction per name | EP | L1 | automated | `browser-protocol.ts` | type-level + runtime name lists | every listed type in exactly one union; intersection of the two name sets is empty |
| E33 | SP "Tier table lists the new types" | EP | L1 | automated | `ws-message-tiers.ts` | look up each browser→server `browser_host_*` | each = `operate` |
| E34 | REST tier for DELETE | EP | L1 | automated | `route-tiers.ts` | `routeTier("DELETE","/api/browser/operator-hosts/:hostId")` | `operate`, and `hasRouteTier` true |
| E35 | IPC "Remote-origin window" | decision table | L1 | automated | preload-main with `location.origin` = local port vs `http://192.168.16.204:8000` | load preload | `browserHost` defined only for local; trusted wrapper rejects a remote sender with `UntrustedSenderError` |
| E36 | IPC / KEY "Stable identity" | state-transition | L1 | automated | CryptoPort available | identity(), restart (new module instance, same userData), identity() | same `hostId` + `publicKey`; private key never in any IPC return (JSON scan) |
| E37 | KEY memory-only fallback | EP | L1 | automated | CryptoPort unavailable | identity() twice across restarts | different `hostId` each run; nothing written to disk for the key |
| E38 | KEY "Signature verifies" / "Challenge from a different server" | decision table | L1 | automated | target instanceId I (fake health) | `sign(n, I)`; `sign(n, J)` | first verifies with `verifyHostSignature`, fails for J-message; second refused, nothing signed |
| E39 | SHIM "Extension attaches through the shim" | state-transition | L1 | automated | link L registered after Allow | ws client dials `127.0.0.1:<port>/ws/browser-ext/L` with pinned Origin | accepted; `ext_open {L}` emitted; frames relay both directions |
| E40 | SHIM "Web page probes the shim" / "Unknown link" / "Link used twice" | decision table | L1 | automated | link L | dials with Origin `http://localhost:5173`; no Origin; path `/ws/browser-ext/unknown`; second dial for claimed L | rejected, rejected, 404, rejected; no extra `ext_open` |
| E41 | SHIM lifecycle | state-transition | L1 | automated | one link | link closes | listener closed (port refuses connections) |
| E42 | SHIM "Reload mid-connect" | state-transition | L1 | automated | dialog open for request R | renderer `did-start-navigation` / `destroyed` fake event | dialog closed; L unregistered; no Chrome launch called |
| E43 | SHIM cancel | state-transition | L1 | automated | Allowed link L with extension attached | `cancelConnect(R)` | extension socket closed; L unregistered |
| E44 | CON "First connect asks" / "Remembered consent" | state-transition | L1 | automated | fake dialog port, empty store | connect for (S,P) → Always allow; second connect | dialog shown once; Chrome launch called twice; consent file has one entry |
| E45 | CON dialog default + Escape | decision table | L1 | automated | fake dialog returning cancelId / Escape / Deny | connect | `respondConnect(R,false,"denied")`; no launch |
| E46 | CON "No answer" | BVA | L1 | automated | fake timers, dialog unanswered | advance 54 999 ms, then 1 ms | no answer at 54 999; denied + dialog closed at 55 000 |
| E47 | CON "Re-paired server asks again" | EP | L1 | automated | consent for (origin O, instanceId I1); fake health now returns I2 | connect | dialog shown |
| E48 | CON "Revoke all from the menu" | state-transition | L1 | automated | 2 consents, 1 live link | invoke menu item | `listConsents()` = []; live link still open; next connect shows dialog |
| E49 | CON corrupt store | EP | L1 | automated | consent file content `{not json` | load | file renamed `browser-host-consent.corrupt-<ts>.json`; store empty; dialog on next connect |
| E50 | TOK "Token never leaves the machine" | EP | L1 | automated | `setToken("Default","T0KEN-xyz")` | connect for Default | Chrome launch URL contains `token=T0KEN-xyz`; no IPC return, emitted `browser_host_*` payload or log line contains it |
| E51 | TOK memory-only fallback | EP | L1 | automated | CryptoPort unavailable | setToken, restart | token used in-run; absent after restart; nothing on disk |
| E52 | PROF "Profiles match the plugin's parsing" | EP | L1 | automated | the 3 `profiles.test.ts` Local State fixtures | parse via plugin and via shared helper | identical row arrays |
| E53 | PROF `canOpenChrome:false` | EP | L1 | automated | no Chrome user-data dir | connect | `respondConnect(R,false,"no-chrome")`; no launch |
| E54 | TEE "Child-session frames are not copied" | decision table | L1 | automated | tee (L, X, T) on | events: (tabId T, no session, screencastFrame); (T, sessionId s, screencastFrame); (T', no session, screencastFrame); (T, no session, Page.loadEventFired) | only the first reaches `onFrame`; all four forwarded to the server unchanged |
| E55 | BPT "Operator views their own tab" / "Another device views the same tab" | decision table | L1 | automated | pane in window registered as H vs window not registered | open pane for instance with `host:H` | registered window: subscribe `local:true` + `browserHost.tee(on)` + image from `onFrame`; other: no `local`, frames from `browser_relay_frame` |
| E56 | BPT "Opening subscribes, closing unsubscribes" (regression) | regression | L1 | automated | pane for a dashboard-host instance | open, close | exactly one subscribe `{instanceId, tabId}` without `local`; one unsubscribe |
| E57 | BPS "Plain browser" / "Token saved locally" / "Revoke a consent" | decision table | L1 | automated | settings rendered with and without `browserHost` fake | render; save token; click Revoke | block absent without; `setToken` called + input cleared + no fetch/WS carrying the token; `revokeConsent(key)` + row removed |
| E58 | BPS dashboard rows unchanged | regression | L1 | automated | `BrowserSettings.test.tsx` fixtures + `browserHost` present | render | dashboard-host rows unchanged; no operator profiles in them |
| E59 | DBS recipe text | EP | L1 | automated | `references/dashboard-relay.md` | read file | contains `host`, `operatorHosts: true` precondition and `unknown-host`, `operator-denied`, `consent-timeout`, `no-chrome`, `host-gone` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | TEE "Tee latency budget" | tail-latency | L1 | automated | 200 synthetic 20 KB `Page.screencastFrame` events into the tee | p95 receipt → `onFrame` ≤ 50 ms | one run of 200 events |
| P2 | LNK congestion rule | threshold | L1 | automated | fake carrier `bufferedAmount` = 33 MiB constant, fake timers | links closed with 1013 at 10 s, not at 9.9 s | 11 s simulated |
| P3 | TEE ≥ 8 fps live | throughput | — | manual-only | mac-home Electron → MacBook dashboard, agent scrolls a long page | [judgment on real Chrome: pane shows ≥ 8 fps (count frames over 10 s via devtools overlay or log)] | 10 s |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | REG re-register on reconnect (client) | state-transition | L1 | automated | carrier registered; ws drops and reconnects | `FakeWs` reconnect | exactly one new hello/register cycle per reconnect; `registered as H` restored |
| F2 | BPT pane before registration ack | state-transition | L1 | automated | pane opened while `browser_host_registered` not yet received | ack arrives later | first subscribe has no `local`; after the ack exactly one re-subscribe with `local:true` (converges) |
| F3 | CON dialog copy + parenting | visual/subjective | — | manual-only | real Electron on macOS | trigger a connect | [judgment: dialog is modal to the main window, names server + profile, Deny is default] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | HTC "Late Allow still gets a full handshake window" | fault-injection (delay) | L1 | automated | carrier answers `ok:true` at +50 s; extension handshake at +70 s (fake timers) | connect | 200 |
| X2 | HTC "No consent answer" | fault-injection (delay) | L1 | automated | carrier never answers | advance 60 s | 504 `{reason:"consent-timeout"}`; carrier receives `browser_host_connect_cancel {requestId}` |
| X3 | HTC handshake timeout after Allow | fault-injection (delay) | L1 | automated | `ok:true` at +5 s, no `ext_open` | advance to +65 s | 504; cancel sent; linkId discarded (later `ext_open` dropped + audited) |
| X4 | HTC / LIFE "Host goes away mid-connect" | fault-injection (abort) | L1 | automated | carrier closes after `browser_host_connect` | close | 503 `{reason:"host-gone"}` |
| X5 | LIFE "Operator closes the window" | fault-injection (abort) | L1 | automated | live linked instance with CDP client | carrier socket close | instance closed reason `host-gone`; CDP socket closed; host `online:false`/absent |
| X6 | LIFE kill switch | fault-injection (config) | L1 | automated | live linked instance | `PUT /api/browser/enabled {false}`, then host connect | instance closed before the PUT responds; connect → 403 |
| X7 | LIFE "Server restart" | state-transition | L1 | automated | pin file present; fresh manager | register with pinned key | accepted `pin=ok`; no host online before |
| X8 | LNK "Congested carrier" | fault-injection (backpressure) | L1 | automated | see P2 | — | all links on the carrier close 1013 `carrier-congested`; instances close |
| X9 | OBS "Connect is traceable without secrets" | fault-injection (log capture) | L1 | automated | successful + denied + timeout connects | capture logger | exactly one `[browser-host] connect` line per request with the right `outcome=`; no guid, linkId, nonce, signature or token in any line (string scan) |
| X10 | SHIM extension disconnects mid-session | fault-injection (abort) | L1 | automated | live link | extension socket closes 1000 | `ext_close {L, 1000}` emitted; server instance closes |
| X11 | CON "Target cannot be verified" | fault-injection (network) | L1 | automated | fake target `/api/health` rejects | connect | `respondConnect(R,false,"server-unverified")`; no dialog, no launch; server maps to 503 `launch-failed` |
| X12 | end-to-end live | fault-injection (real) | — | manual-only | mac-home Electron (in-page switch) → MacBook dashboard; agent `connect {host}` | full flow incl. reload during an open dialog | [judgment: one consent dialog; agent drives mac-home Chrome logged in; reload cancels cleanly; no stray Chrome window] |

---

## Coverage summary

- Requirements covered: REG, HTC, LNK, LFV, LIFE, OBS, IPC, KEY, SHIM, CON, TOK, PROF, TEE, the 6 BR-MODIFIED, BPT, BPS, DBS and SP. That is all 20 in the delta.
- Scenarios by class: edge 59 · perf 3 · frontend 3 · error 12.
- Scenarios by level: L1 74 · L2 0 · L3 0 · manual-only 3.
- New infra needed: none. Ed25519 is in `node:crypto`; all fakes follow existing exemplars.
