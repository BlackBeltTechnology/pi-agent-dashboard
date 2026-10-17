# Test Plan — add-dedicated-agent-browser

Stage: design   Generated: 2026-10-17

Sources: proposal.md, design.md (D1–D13), specs/dedicated-agent-browser, specs/browser-relay, specs/browser-plugin-settings, specs/default-browser-skill.

Gate: HARD (design stage). No unfillable slot: every timing (15 s launch, 30 s no-client, 5 s close grace, 60 s sweep, idle 5/30/120 min, size cache 60 s, 2 s viewer convergence) and every enum is fixed in the specs/design. No clarification markers.

Harness facts:
- Server units use injected deps and fake sockets: `packages/browser-plugin/src/server/relay/__tests__/fake-socket.ts` (`FakeExtension`, `socketPair`, `flush`).
- The dedicated pipe is faked with a `FakeChromePipe` (two in-memory streams, NUL framing) modelled on `fake-socket.ts`; process helpers (`spawn`, process listing, `killProcessGroup`) are injected.
- Real CDP clients (Playwright `connectOverCDP`, `agent-browser connect`) run in `*.integration.test.ts`, as in `real-clients.integration.test.ts`; `agent-browser` is skipped with a reason when absent. Real-Chrome rows skip with a reason when no Chrome binary resolves.
- Routes: `routes.test.ts` stub-manager pattern; non-loopback WS upgrade as in `ws-routes.test.ts`.
- Timers: `vi.useFakeTimers()`.
- Client: `renderWithPlugin` + `FakeWs` in `packages/browser-plugin/src/client/__tests__/test-utils.tsx`.
- L3: the docker harness has no display, so `status.dedicated` reports `no-display` there; L3 covers only the settings surface under that reality.

Harness exemplars (verified on disk):
- L1 capability/profiles ← `server/__tests__/capability.test.ts`, `server/__tests__/profiles.test.ts`
- L1 manager ← `server/__tests__/relay-manager.test.ts`
- L1 instance/deny ← `server/relay/__tests__/relay-instance.test.ts`, `server/relay/__tests__/deny-list.test.ts`
- L1 audit ← `server/__tests__/audit.test.ts`
- L1 routes/status/ws ← `server/__tests__/routes.test.ts`, `server/__tests__/status.test.ts`, `server/__tests__/ws-routes.test.ts`
- L1 open/live view ← `server/__tests__/open-handler.test.ts`
- L1 bridge tool ← `bridge/__tests__/bridge.test.ts`
- L1 integration (real clients) ← `server/relay/__tests__/real-clients.integration.test.ts`
- L1 client ← `client/__tests__/BrowserSettings.test.tsx`, `client/__tests__/AuditList.test.tsx`, `client/__tests__/i18n.test.ts`
- L1 skill text ← `packages/extension/src/__tests__/browser-skill-registered.test.ts`
- L3 settings ← `tests/e2e/browser-relay.spec.ts`

All paths above are under `packages/browser-plugin/src/` unless they start with `packages/` or `tests/`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | DAB Availability | decision table | L1 | automated | (binary present?, system-open?, default Chrome data dir?) ∈ {(y,y,n), (n,y,y), (y,n,y)} | `GET /api/browser/status` | `dedicated.available` true / false `no-chrome` / false `no-display`; `canOpenChrome` false in row 1 |
| E2 | DAB Availability (binary resolution) | EP | L1 | automated | platform ∈ {darwin `/Applications`, darwin `~/Applications`, win32 `%LOCALAPPDATA%`, linux `google-chrome-stable` on PATH, linux Flatpak only} | resolve binary | first four return the path; Flatpak-only returns `no-chrome` |
| E3 | DAB Availability (state) | state | L1 | automated | dedicated dir absent; then present + Chrome stopped | `GET /status` | `state: "not-created"`, then `"stopped"` |
| E4 | DAB Debugging pipe (argv) | EP | L1 | automated | launch on each platform | build argv | contains `--user-data-dir=<dir>`, `--remote-debugging-pipe`, `--disable-sync`; contains none of `--remote-debugging-port`, `--enable-automation`, `--headless`; stdio `['ignore','ignore','ignore','pipe','pipe']` |
| E5 | DAB Debugging pipe (prefs) | EP | L1 | automated | existing `Default/Preferences` with unrelated keys | seed before launch | file keeps unrelated keys and has `credentials_enable_service:false`, `profile.password_manager_enabled:false`, `signin.allowed:false`, `autofill.profile_enabled:false` |
| E6 | DAB Location (mode) | EP | L1 | automated | POSIX, dir absent | first launch | dir mode `0700`; owner record mode `0600` |
| E7 | DAB Dedicated deny set (URL allow-list) | EP | L1 | automated | dedicated client | `Page.navigate` / `Target.createTarget` with url ∈ {`https://a.test`, `http://a.test`, `about:blank`, `about:settings`, `chrome://settings`, `chrome-untrusted://x`, `devtools://x`, `chrome-extension://x/y`, `file:///etc/passwd`, `javascript:1`} | first three forwarded; the rest CDP error `-32000` + `denied` audit, not forwarded |
| E8 | DAB Dedicated deny set (methods) | EP | L1 | automated | dedicated client | each of `Target.attachToBrowserTarget`, `Target.exposeDevToolsProtocol`, `Browser.close`, `Browser.crash`, `Browser.setPermission`, `Extensions.loadUnpacked`, `Tethering.bind`, `Network.setCookie`, `Storage.clearCookies`, `Storage.clearDataForOrigin`, browser-level `Fetch.enable` | each answered with the deny error, `denied` audit row naming it, nothing written to the pipe |
| E9 | DAB Dedicated deny set (ack-drop) | EP | L1 | automated | dedicated client | `Page.setDownloadBehavior` and `Browser.setDownloadBehavior` | empty success, `dropped` audit, not forwarded |
| E10 | DAB Dedicated deny set (classification) | EP | L1 | automated | `CommandParameters` keys of `playwright-core/types/protocol.d.ts` | classify every `Browser.`/`Target.`/`Storage.`/`Tethering.`/`SystemInfo.`/`Extensions.` key | zero unclassified methods; an unknown synthetic `Target.fooBar` is denied |
| E11 | DAB Dedicated deny set (cookie stripping) | EP | L1 | automated | fake pipe emits `Network.requestWillBeSent` with `Cookie` header, `requestWillBeSentExtraInfo` with `associatedCookies`, `responseReceivedExtraInfo` with `Set-Cookie` | forward to client | forwarded events contain no `Cookie`/`Set-Cookie` header and no cookie values; other headers intact |
| E12 | BR Relay-side deny-list (effective domains) | decision table | L1 | automated | (global, profile) ∈ {([], []), (["github.com"], []), (["github.com"], ["example.com"])} | navigate `https://example.com` on a relay instance and on the dedicated instance | allowed / denied / allowed (relay); dedicated uses global only: allowed / denied / denied |
| E13 | BR Audit trail (query stripping) | EP | L1 | automated | client navigates `https://example.com/cb?code=abc#state=x` | audit append | `navigate` detail is `https://example.com/cb` for relay and dedicated |
| E14 | BR Audit trail (detach causes) | decision table | L1 | automated | extension reports detach reason ∈ {`canceled_by_user`, `some_reason`, `target_closed`} | `_captureDetach` | `detach` `devtools`; `detach` `extension:some_reason`; no `detach` row |
| E15 | BR Audit trail (instance close) | state | L1 | automated | relay instance with one tab | last controlled tab removed | `detach` `closed:All controlled tabs detached` appended before the instance leaves status |
| E16 | BR Profile discovery (password managers) | EP | L1 | automated | fixture profiles with LastPass id, iCloud Passwords id, both, none | `GET /profiles` | `passwordManagers` = `["LastPass"]`, `["iCloud Passwords"]`, both, `[]` |
| E17 | BR Profile discovery (dedicated excluded) | EP | L1 | automated | live `@dedicated` instance + two discovered profiles | `GET /profiles` | two rows, no `@dedicated` row |
| E18 | BR browser_connect (resolution table) | decision table | L1 | automated | each row of design D6 table × `onUnavailable: "next"` with the first target unavailable | `browser_connect {}` | attempts sequence equals the table row; headless result has no `cdpUrl` |
| E19 | BR browser_connect (policies) | decision table | L1 | automated | dedicated busy; `onUnavailable` ∈ {`ask`, `stop`} | `browser_connect {}` | `ask` → `{unavailable:{target:"@dedicated",reason:"busy"}, options:[{target,label,available,reason?}], attempts}`; `stop` → `{unavailable, stopped:true}`; no connect performed |
| E20 | BR browser_connect (session source) | EP | L1 | automated | session `S` calls with args containing `sessionId:"T"` | `browser_connect` | holder recorded as `S` |
| E21 | BR Agent-initiated open (auto exemption) | state | L1 | automated | `openLiveViewOnConnect` true | first agent tab created, then `browser_show_in_pane` within 5 s | one broadcast for auto + one for the tool call; audit `open` `auto` + `open`; no `rate-limited` |
| E22 | BPS Agent browsing settings (validation) | EP+BVA | L1 | automated | `PUT /api/browser/settings` with `idleDisconnectMinutes` ∈ {0, 5, 30, 120, -5, 31}, unknown key `foo`, `onUnavailable:"later"`, `defaultBrowser:"Profile 99"` (not installed) | write | first four 200 and stored; the rest 400 with stored settings unchanged |
| E23 | BPS settings (`@` keys) | EP | L1 | automated | `PUT /api/browser/profile` with key `@dedicated` | write | 400, config unchanged |
| E24 | DAB Sign-in window (URL policy) | EP | L1 | automated | `dedicated/open` with url ∈ {omitted, `https://accounts.google.com/x`, `http://a.test`, `javascript:alert(1)`, `chrome://settings`, `https://evil.test` with global `["google.com"]`} | POST | default opens `https://accounts.google.com/`; second opens; the rest 400 and no `Target.createTarget` on the pipe |
| E25 | DSK recipe text | EP | L1 | automated | built `SKILL.md` + `references/dashboard-relay.md` | read | names `browser_connect`, `dedicated/open`, the body form `{profileDirectory}`, the never-read/copy/launch rule for the profile and downloads dirs, the headless stop for login tasks, and still references `references/challenge.md` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | DAB Hidden tabs | state | L1 | automated | hidden sign-in tab T1 open on the fake pipe | client sends `Target.getTargets`, `Target.getTargetInfo{T1}`, `Target.attachToTarget{T1}`, `Target.sendMessageToTarget{T1}` | getTargets omits T1; the other three answer CDP errors; nothing naming T1 reaches the client |
| F2 | DAB Hidden tabs (opener chain) | state | L1 | automated | hidden T1; fake pipe announces T2 with `openerId: T1` and an iframe target under T1 | client has discovery + auto-attach on | no `targetCreated`/`attachedToTarget` for T2 or the iframe; server sends `Runtime.runIfWaitingForDebugger` for each |
| F3 | DAB Discovery and auto-attach | state | L1 | automated | client enables auto-attach (`waitForDebuggerOnStart:true`), creates tab V, then enables discovery | events flow | V attached once, `targetCreated` for V exactly once, V resumed only after the client's `runIfWaitingForDebugger` |
| F4 | DAB Hidden tabs (WebUI) | state | L1 | automated | visible tab V attached to the client | fake pipe sends `Target.targetInfoChanged` V → `chrome://password-manager` | V becomes hidden: further client commands on V fail; V leaves `browser_relay_status` |
| F5 | DAB Hidden tabs (viewer) | EP | L1 | automated | hidden T1 | viewer subscribe for T1's numeric tab id | refused, audit `viewer-subscribe-refused` |
| F6 | BPS Dedicated panel | state | L1 | automated | `status.dedicated.state` ∈ {`not-created`, `stopped`, `running` + holder session "fix login flow", `running` + client label "gmail-setup"}; `available:false reason:no-chrome` | render | buttons: Create and open / Open + Reset enabled / Open + Stop + Reset disabled with holder name / same with "gmail-setup"; unavailable shows reason, no buttons |
| F7 | BPS Kill switch | state | L1 | automated | plugin disabled | render | Agent browsing group read-only with "Browser relay disabled"; panel shows stopped, every action disabled |
| F8 | BPS Reset confirmation | state | L1 | automated | state `stopped` | click "Reset profile…", then Cancel; then confirm | no request after Cancel; exactly one `POST /dedicated/reset` after confirm |
| F9 | BPS Browser settings section (list) | EP | L1 | automated | profiles: installed + LastPass, installed, synthetic live row, 3 uninstalled | render | 3 rows with all existing testids (`browser-token-input-*`, `browser-zero-dialog-*`, `browser-allowed-domains-*`, `browser-connect-*`); LastPass warning on the first; one disclosure "3 more profiles without the extension" with store links and no Connect |
| F10 | BPS Capability missing | decision table | L1 | automated | (`canOpenChrome`, `dedicated.available`) ∈ {(false, true), (true, false)} | render | (false,true): profile-list notice, no Connect, dedicated choice enabled; (true,false): profile rows normal, dedicated choice disabled |
| F11 | BPS Audit viewer | convergence | L1 | automated | audit gains `detach` `closed:All controlled tabs detached` and a `@dedicated` `denied` row | `browser_relay_status.auditSeq` bumps | both rows rendered under their profiles |
| F12 | BPS Agent browsing group | state | L1 | automated | user picks "One of my Chrome profiles" with `Profile 21` | change | one `PUT /api/browser/settings` with `defaultBrowser` and `realProfile` = `Profile 21` |
| F13 | BPS settings on a display-less host | convergence | L3 | automated | docker harness, plugin enabled | open Settings > Browser Relay | Agent browsing group rendered; dedicated panel shows the `no-display` reason and no buttons |
| F14 | BPS i18n | EP | L1 | automated | en, zh-CN, hu catalogs | completeness check | every new key present in all three |

### Error-handling

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| R1 | DAB Dedicated connect | decision table | L1 | automated | plugin (enabled?, available?, live instance?) ∈ {(n,·,·), (y,n,·), (y,y,y), (y,y,n)} | `POST /dedicated/connect` | 403 / 503 + reason / 409 `{busy, instanceId, holder}` / 200 `{cdpUrl, instanceId}` |
| R2 | DAB Dedicated connect (busy ignores flag) | EP | L1 | automated | `allowMultipleInstancesPerProfile: true`, live dedicated instance | second connect | 409 `busy` |
| R3 | DAB Concurrent first connects | fault injection (delay) | L1 | automated | Chrome stopped; fake spawn delays `Browser.getVersion` reply 200 ms | connect + open fired together | one spawn; both resolve against the same Chrome |
| R4 | DAB Launch failure | fault injection (abort/delay) | L1 | automated | fake Chrome (a) exits before replying, after handing off to a running foreign instance; (b) exits with code 1; (c) never replies | connect | (a) 503 `profile-in-use`; (b) 503 `launch-failed`; (c) 503 `launch-failed` at 15 s with group kill; no instance registered; a following connect launches again |
| R5 | DAB Ownership | decision table | L1 | automated | process listing: (dedicated Chrome running?, owner server alive?, foreign Chrome without pipe flag?) ∈ {(y,y,n), (y,n,n), (n,·,y), (n,·,n)} on darwin and win32 listings | connect | 409 `owned-by-other-server` and no kill / kill by identity then launch / 503 `profile-in-use` / launch |
| R6 | DAB Identity by command line | EP | L1 | automated | pid reused by an unrelated process whose command line lacks the dedicated flags | orphan check | no kill issued |
| R7 | DAB Kill switch during launch | fault injection (delay) | L1 | automated | connect waiting on a 200 ms launch | `setEnabled(false)` completes meanwhile | connect fails 403; no `@dedicated` instance registered; Chrome closed |
| R8 | DAB Kill switch | state | L1 | automated | dedicated running with a client | `PUT /enabled {enabled:false}` | client socket closed, `Browser.close` then group kill before the response |
| R9 | DAB Unexpected exit | fault injection (abort) | L1 | automated | client connected | fake pipe EOF + process exit | client socket closed; audit `detach` `closed:chrome-exited`; `state: stopped`; owner record removed; next connect spawns again |
| R10 | DAB Graceful shutdown | fault injection (delay) | L1 | automated | Chrome ignores `Browser.close` | `dedicated/stop` | `killProcessGroup` called at 5 s (fake timers), not before |
| R11 | DAB Client lifecycle | state | L1 | automated | instance minted | (a) no client within 30 s; (b) client attaches, creates 2 tabs, then closes | (a) `detach` `no-cdp-client`, Chrome running; (b) `Target.closeTarget` for both tabs, instance gone, Chrome running, next connect 200 |
| R12 | DAB Remote cdpUrl | EP | L1 | automated | `cdpUrl` from dedicated connect | WS upgrade from a non-loopback address | refused, as for the relay |
| R13 | DAB Reset | state | L1 | automated | Chrome running; then stopped | `POST /dedicated/reset` | 409 and dir unchanged; then 200 and dir removed, `state: not-created` |
| R14 | BR browser_connect (same-session reconnect) | state | L1 | automated | session `S` holds dedicated instance I1 | `S` calls `browser_connect {}` | I1 closed; new `cdpUrl` for I2 returned; another session would get `busy` |
| R15 | BR Idle disconnect | BVA | L1 | automated | `idleDisconnectMinutes: 5`, fake timers | no client command for 4 min 59 s, then for 5 min + one sweep | still connected at 4:59; closed with `detach` `idle` after the next sweep |
| R16 | BR Idle disconnect (holds) | decision table | L1 | automated | idle 5; (a) pending `browser_await_human` for 10 min; (b) viewer input every 2 min; (c) `idleDisconnectMinutes: 0` for 3 h; (d) plugin disabled | sweeps run | all stay connected / not swept; (d) sweep no-op |
| R17 | DAB Disconnect route | EP | L1 | automated | live dedicated instance | `POST /api/browser/disconnect?instanceId=<id>` | instance closed, Chrome running |
| R18 | DSK login wall routing | EP | L1 | automated | built `references/dashboard-relay.md` | read | login wall in dedicated → `dedicated/open` + `ask_user`; `browser_await_human` scoped to Chrome profiles and non-sign-in steps; password-manager diagnosis via audit `closed:`/`extension:` |

### Integration (real clients / real Chrome)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| I1 | DAB Discovery and auto-attach + deny set | contract | L1 | automated | `DedicatedInstance` over `FakeChromePipe` scripted from a real handshake | Playwright `connectOverCDP(cdpUrl)` and `agent-browser connect` (skipped if absent) | both connect, `newPage().goto("https://example.com")` issues the navigate, no denied handshake method |
| I2 | DAB Debugging pipe (no TCP) + lifetime | contract | L1 | automated | real Chrome resolved (skip with reason otherwise) | launch, connect Playwright through the proxy, stop | no listening TCP socket in Chrome's process tree (`lsof -p`/`ss -p` on its pids); page navigates; after stop no process with the dedicated `--user-data-dir` remains |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | DAB Sign-in survives restart; Google accepts the browser | exploratory | — | manual-only | macOS, real Google account | "Open to sign in", sign in, agent tab reload, `/api/restart`, connect again | no "browser may not be secure" block; agent tab signed in; still signed in after restart; Chrome offers no password save |
| M2 | DAB cross-platform | smoke | — | manual-only | Windows desktop with Chrome | connect, `agent-browser connect`, Stop, kill server process, connect again | pages listed; no leftover `chrome.exe` with the dedicated dir after Stop; orphan cleaned on reconnect |
| M3 | DAB cross-platform | smoke | — | manual-only | Linux desktop with `google-chrome` | as M2 | as M2 |
| M4 | BPS visual fidelity | visual review | — | manual-only | built settings section, dark + light | compare with `mockups/index.html` | layout, tokens and copy match the mockup |
