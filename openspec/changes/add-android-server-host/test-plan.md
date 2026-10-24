# Test Plan — add-android-server-host

Stage: design   Generated: 2026-10-24

Hard gate resolved 2026-10-24:
- **Android device-level scenarios:** automated instrumented tests in a new CI emulator lane.
- **Push end-to-end:** fully automated with a self-hosted https ntfy plus the ntfy distributor APK on the emulator.

Requirement refs `R01`–`R36` follow the order of `### Requirement:` headings in `specs/android-server-host/spec.md`.

### Levels used by this change

- **`android-unit`** — JVM JUnit tests of the pure `:core` module.
  - Path: `packages/android/core/src/test/kotlin/**`.
  - Run: `./gradlew :core:test`.
  - Virtual clock for every timing row.
- **`android-device`** — instrumented tests on the emulator.
  - Path: `packages/android/app/src/androidTest/kotlin/**`.
  - Run: `./gradlew :app:connectedDebugAndroidTest`.
  - Runs against the CI device harness (see New infra):
    - isolated dashboard servers, reached at the runner's non-loopback IP, so the server sees an untrusted peer;
    - a TLS front;
    - an https ntfy;
    - an in-test fake HTTP origin (OkHttp `MockWebServer`) for navigation, permission and download rows.
- **`ci`** — vitest workflow-contract tests in `packages/shared/src/__tests__/`.
- **`manual-only`** — no automatable observable on CI hardware.

Server-side preconditions in a row (tier, trust mode, `acceptLanRequests`, `push.*`) are set through the isolated server's `config.json` or `pi-dashboard token create --tier`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R15 | EP + BVA | android-unit | automated | Hosts: `10.255.255.255`, `11.0.0.0`, `172.15.255.255`, `172.16.0.0`, `172.31.255.255`, `172.32.0.0`, `192.168.0.0`, `192.169.0.0`, `100.63.255.255`, `100.64.0.0`, `100.127.255.255`, `100.128.0.0`, `169.254.0.1`, `127.0.0.1`, `fe80::1%wlan0`, `fd00::1`, `fbff::1`, `fe00::1`, `::ffff:192.168.1.1`, `::ffff:8.8.8.8`, `2001:db8::1`, `8.8.8.8`, `localhost`, `myhost.local`, `HOST.lan` | `CleartextPolicy.isAllowed(normalise(host))` for each | Allowed exactly: `10.255.255.255`, `172.16.0.0`, `172.31.255.255`, `192.168.0.0`, `100.64.0.0`, `100.127.255.255`, `169.254.0.1`, `127.0.0.1`, `fe80::1%wlan0`, `fd00::1`, `fbff::1`, `::ffff:192.168.1.1`; every other input refused |
| E2 | R15 | decision table | android-unit | automated | Route inputs `http://203.0.113.9:8000`, `http://myhost.local:8000`, `https://myhost.local:8000`, `http://192.168.16.203:8123`; fake transport recording calls | Add server by address | First two: 0 transport calls; messages "Use https or a tunnel for servers outside your network" and "use https or the server's IP address". Last two: challenge sent (1 call each) |
| E3 | R09 | decision table | android-unit | automated | Server origin `https://Host.Example:443`; targets `https://host.example./x`, `https://host.example:443/y`, `https://host.example:8443/`, `http://host.example/`, `https://github.com/x`, `mailto:a@b.c`, `intent://x`, `file:///etc/hosts`, `javascript:alert(1)`, `data:text/html,x`, `content://x`. Plus origin `http://[::1]:8000` vs target `http://[0:0::1]:8000/a` | `decideNavigation(origin, target)` | Allow, Allow, External, External, External, External, Drop, Drop, Drop, Drop, Drop; IPv6 case → Allow |
| E4 | R10 | EP + BVA | android-unit | automated | `/`, `/session/a`, `/session/` + 128 × `a`, `/session/` + 129 × `a`, `/session/`, `/session/a/b`, `/session/a%2F`, `/session/a\nb`, `//evil.example/x`, `https://evil.example/`, `/api/restart`, `\\evil`, empty string | `safeDeepLinkPath(p)` | First three returned unchanged; every other input returns `/` |
| E5 | R14 | decision table | android-unit | automated | Server origin `http://192.168.16.203:8123`; URLs on the same origin, `http://192.168.16.203:9000/f`, `https://192.168.16.203:8123/f`, `https://other.example/f` | `sameCanonicalOrigin(origin, url)` | true for the same origin only; false for the other three |
| E6 | R05 | decision table | android-unit | automated | Responses: `200`; `401` `{"success":false,"error":"device bearer required"}`; `401` `text/html`; `401` empty body; `403 {"error":"network_not_allowed"}`; `403 {"error":"insufficient_scope"}`; `403 {"error":"host_not_allowed"}`; `502`; socket timeout | `classifyExchange(status, body)` | Ok; Refused; Unreachable; Unreachable; Refused; Unreachable; Unreachable; Unreachable; Unreachable |
| E7 | R18, R20 | decision table | android-unit | automated | (pin, advertFp, payloadFp) ∈ {(F,–,–), (F,F,–), (F,G,–), (F,–,F), (F,–,G), (–,F,–), (–,–,F), (–,F,G), (–,–,–)} | `expectedIdentity(...)` | F, F, Mismatch, F, Mismatch, F, F, payload G, NeedsUserConfirm |
| E8 | R25 | EP | android-unit | automated | Vectors copied from `packages/shell/src/lib/protocol.ts` tests: `https://h/pair#<b64>`, `pi:pair:v1.<b64>`, bare b64url, raw JSON, JSON array, object missing `id`, missing `code`, `urls` not an array | `PairingPayload.decode(raw)` | First four decode to equal `{id, code, urls}`; the rest throw "malformed pairing payload" |
| E9 | R21 | EP + BVA | android-unit | automated | Delivered `routes`: `https://10.0.0.5`, `https://user@x.example/path`, `http://x.example`, `https://x.local`, `https://localhost`, `https://a.example/` (trailing slash), a 253-char host, a 254-char host, then 9 further valid hosts; fake challenger recording calls | Approval processing | Dropped: 10.0.0.5, userinfo, http, `.local`, localhost, 254-char. Kept: the first 8 valid in delivery order (trailing-slash form normalised). Challenger called only for kept routes; 0 calls to dropped |
| E10 | R19 | decision table | android-unit | automated | Stored `https://t.zrok.io` (proves F), stored `http://192.168.16.203:8123` (proves F), 4 discovered adverts with fp F (one proves F) | `RouteSelector.select(pin=F)` | Winner `https://t.zrok.io`; exactly 3 discovered candidates challenged. With the https route failing: winner is the stored http route. With both stored failing: the discovered winner is inserted after any `https` route with `source=mdns` |
| E11 | R26, R28, R33, R24 | state-transition | android-unit | automated | Keyring JSON v1 with 2 entries; a variant with `"version":2`; a truncated file; an entry with 6 `saved` routes and 9 `pairing` routes | Load, save, launch-target selection, adding a second pending knock | Round-trip equal. v2 and truncated → file renamed `servers.corrupt-<ts>.json`, empty keyring. Caps: saved ≤ 5 (MRU), pairing ≤ 8. Launch target = max `lastOpenedAt`. Second pending knock replaces the first (≤ 1) |
| E12 | R35 | BVA | android-unit | automated | Tags `v0.11.0`, `v1.2.3`, `v0.999.999`, `v0.1000.0`, `v0.0.1000`, `v2100.0.0`, `v2101.0.0`, `v0.11.0-rc.1`, `0.11.0` | `versionCodeFor(tag)` | 11000; 1002003; 999999; fail; fail; 2100000000; fail; not-a-final-tag; not-a-final-tag |
| E13 | R34 | invariant | android-unit | automated | Bearer `canaryBEARER…`, code `canaryCODE`, confirm `12345678`, cookie `pi_dash_device=canaryCOOKIE`, endpoint `https://ntfy.example/canaryTOPIC`, fp `sha256:AAAABBBBCCCCDDDDEEEE…` | Format every `LogEvent` type through `LogRedactor` | Every line contains `sha256:AAAABBBBCCCCDDDD` (16 chars) and the host. No line contains any canary or the confirm code |
| E14 | R22 | decision table | android-unit | automated | Knock answers `knock_disabled`, `knock_not_lan`, `knock_pending`, `knock_rate_limited`, `knock_busy`, `host_not_admitted` | `knockRefusalMessage(code)` | "Ask the operator to turn on LAN requests, or scan the pairing QR"; "Pair from the same network, or scan the pairing QR"; "A request from this device is already waiting"; "Try again shortly" (×2); "This server does not accept requests at this address — ask the operator" |
| E15 | R30 | decision table | android-unit | automated | Fake server: register → `200 {tokenId}` and test → `{ok:true}`; register `200` + test `{ok:false}`; `404`; `400 {"error":"invalid web-push subscription"}`; `400 {"error":"destination refused: …"}`; `403`; `409` | Enable notifications | Toggle on; off "The server cannot deliver notifications — check its push settings"; off "Notifications are not enabled on this server"; off showing each server `error` text verbatim; off "This device's access level cannot receive notifications"; off "This server's notification list is full" |
| E16 | R12 | BVA | android-unit | automated | WebView version strings `112.0.5615.136`, `113.0.5672.136`, `130.0.6723.58` | `webViewGate(version)` | Block, Pass, Pass |
| E17 | R22 | state-transition | android-unit | automated | Fake server: challenge proves F, knock responds `fingerprint: G` | Knock flow | Flow aborts with identity mismatch before any `/api/pair/poll` call (0 poll calls) |
| E18 | R18, R25 | state-transition | android-unit | automated | Keyring pin F for entry E; scanned payload `id` G for E | Pair from payload | Refused with mismatch; 0 HTTP calls |
| E19 | R04 | decision table | android-device | automated | Isolated server in `pair` trust mode; device token `--tier control` | Open server | "Needs full access — ask the operator to re-pair this device" shown; the server's request log shows `POST /api/ws-ticket` 403 and no `GET /` from the WebView; the keyring entry is still paired |
| E20 | R27 | static | android-unit | automated | Merged `AndroidManifest.xml` and `res/xml/data_extraction_rules.xml` from the debug build | Parse | `allowBackup="false"`; `cloud-backup` and `device-transfer` both exclude `files/` and `app_webview/` |
| E21 | R01 | static | android-unit | automated | All `packages/android/**/*.kt` sources | Source scan | 0 occurrences of `addJavascriptInterface`, `addWebMessageListener`, `addDocumentStartJavaScript`, `com.getcapacitor` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | R19 | tail-latency (virtual clock) | android-unit | automated | 5 stored routes that never answer + 3 discovered (1 proves the pin after 1.5 s) | Selection completes with the proving route at ≤ 5.0 s virtual; max concurrent challenges observed ≤ 6 | one selection |
| P2 | R18, R19 | BVA (virtual clock) | android-unit | automated | Challenge answers after 1.9 s / 2.0 s / 2.1 s | Proven / proven / unreachable | per challenge |
| P3 | R17, R19 | threshold (virtual clock) | android-unit | automated | Discovery source never resolves; one stored route proves the pin | Selection begins ≤ 2.0 s after open | one open |
| P4 | R07, R08 | cadence (virtual clock) | android-unit | automated | Server screen in foreground 10 min, no API refusals; then 10 refusals reported within 60 s | Re-proofs = 10 (every 60 s); foreground re-exchanges = 2 (every 5 min); refusal-triggered re-exchanges in that minute = 1 | 11 min virtual |
| P5 | R19 | threshold | android-device | automated | Stored route `http://10.255.255.1:8000` (black-holed) only | "Unreachable" shown ≤ 5.5 s wall clock after tap; no page load | one open |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | R01 | invariant | android-device | automated | Paired `operate` server A (untrusted peer) | Open A; `evaluateJavascript` probes after load | `typeof window.androidBridge`, `window.Capacitor`, `window.Android` are all `"undefined"`; page `fetch('/api/sessions')` → 200; the server log shows `GET /api/plugins/runtime-clients` 200 and `POST /api/ws-ticket` 200 from the WebView |
| F2 | R02, R03 | state-transition | android-device | automated | Server A paired | Open A, close the screen, then from a fresh WebView in the test (no exchange) `fetch('/api/sessions')`; repeat after `am force-stop` + relaunch | Open: 200. After close: `403 network_not_allowed` (no cookie sent). After kill + relaunch: 403 |
| F3 | R02, R11 | state-transition | android-device | automated | Servers A (`:8123`) and B (`:8125`) on the same host, both paired | Open A, then open B from the list | B's server log shows `POST /api/device-session` before B's `GET /`. Requests on B's page are attributed to B's device id. A's screen is destroyed |
| F4 | R11, R32 | state-transition | android-device | automated | A shown; B has notifications enabled | Deliver an encrypted payload `url: "/session/abc"` to B's endpoint (harness `web-push` sender), tap it | A's screen is closed; B is loaded at `<B>/session/abc` after B's exchange |
| F5 | R07, R06 | state-transition | android-device | automated | A open (`pair` mode); device revoked via `DELETE /api/paired-devices/:id` | Page triggers `/api/*` requests | Within 65 s: page stopped, dialog "Access to this server was revoked — pair again or forget". Keyring: `needsPairing=true`, no bearer, no `pushTokenId` |
| F6 | R07 | rate-limit | android-device | automated | Fake dashboard origin (`MockWebServer` implementing `/api/pair/challenge` with a test Ed25519 key, `/api/device-session` 200, `/api/ws-ticket` 200, `/api/x` → `403 {"error":"insufficient_scope"}`) opened as a paired server; page script fires 10 `/api/x` calls within 60 s | Wait 60 s | Fake origin records exactly 1 `POST /api/device-session` after the initial open; no page reload |
| F7 | R08 | state-transition | android-device | automated | A open (pin F) | Stop server A; start server C (different `HOME`, fingerprint G) on the same port | Within 65 s: WebView URL `about:blank`, no `pi_dash_device` sent on the next probe, identity-mismatch error shown; bearer still in the keyring |
| F8 | R08 | fault-injection (abort) | android-device | automated | A open | Stop A for 90 s, then restart it | Within 65 s: "not reachable" shown and the page DOM is still present. After restart, within 65 s: indicator cleared, no reload |
| F9 | R09 | state-transition | android-device | automated | Fake origin (`MockWebServer`) serving links | Page clicks `https://github.com/x` | WebView URL unchanged; a Custom Tabs intent for `https://github.com/x` is recorded (Espresso-Intents) |
| F10 | R09 | state-transition | android-device | automated | Fake origin: `/r` answers `302 Location: http://203.0.113.9/` | Page navigates to `/r` | WebView URL stays on the fake origin; External intent recorded for `http://203.0.113.9/` |
| F11 | R09 | state-transition | android-device | automated | Fake origin page | Navigate to `intent://x#Intent;end`, then `file:///etc/hosts` | No intent recorded; WebView URL unchanged |
| F12 | R13 | invariant | android-device | automated | Fake origin page | `getUserMedia({video:true})`, then `getCurrentPosition` | Promise rejects with `NotAllowedError`; geolocation error code `1` (PERMISSION_DENIED); no system permission dialog shown |
| F13 | R14 | decision table | android-device | automated | Fake origins O (`:port1`) and O2 (`:port2`) | Page starts downloads of `O/f`, `O2/f`, `https://other.example/f`; the user saves through the picker (UiAutomator) | O's request has `Authorization: Bearer`; O2 and other have none. A file is created via the picker. `DownloadManager` query returns 0 rows for these URLs |
| F14 | R12 | state-transition | android-device | automated | Debug build with the injected WebView version `99.0.0.0` | Open server A | Update screen shown; A's server log shows no request; "Continue anyway" then loads A |
| F15 | R33 | state-transition | android-device | automated | Keyring cases: empty; last-opened A reachable; last-opened A stopped | Cold launch | List with "Add by address" and "Scan pairing QR"; A loaded directly; list with A marked unreachable |
| F16 | R16 | invariant | android-device | automated | A via `http://<runner-ip>:8123`; B via `https://dash.test` (TLS front) | Open each and view the list | Test tag `badge-unencrypted` present for A in the list and on its screen; absent for B |
| F17 | R22, R23, R20 | state-transition | android-device | automated | Server with `pairing.acceptLanRequests: true`; manual address `http://<runner-ip>:8123` (no advert) | Add address, then confirm screen, then "Send request"; operator approves via `POST /api/pair/approve-pending` with the confirm code | Before sending: short fp `sha256:` + 16 chars, label, editable name, unencrypted notice. Server sees `name` = edited value. After approval: keyring entry pinned to the proven fp, with bearer |
| F18 | R22 | state-transition | android-device | automated | `acceptLanRequests: false` | Send request | Message "Ask the operator to turn on LAN requests, or scan the pairing QR"; no pending record |
| F19 | R24 | state-transition | android-device | automated | Knock pending (confirm code shown) | `am force-stop`, relaunch, then the operator approves | Polling resumes (server log shows polls after relaunch); bearer stored; entry paired |
| F20 | R24 | state-transition | android-device | automated | Knock pending | "Stop waiting" | Message that the request stays visible until it expires; no keyring entry; no `/api/pair/poll` in the server log after the tap |
| F21 | R25, R21 | state-transition | android-device | automated | Server with TLS front `https://dash.test` in `publicBaseUrls`; pairing text from `GET /api/pair/payload` | Paste the text, then confirm code shown; operator approves via `POST /api/pair/approve` | Bearer stored. Delivered route `https://dash.test` stored with `source=pairing` after its challenge. Redeem was sent to the proven URL |
| F22 | R29 | state-transition | android-device | automated | A paired, notifications on, page wrote `localStorage.x=1` | Forget | Server log: `DELETE /api/push/register/:id` then `DELETE /api/device-session`. `GET /api/push/register` (operator) no longer lists the token. Re-adding A shows it unpaired; a fresh A page has `localStorage.length === 0` and no device cookie |
| F23 | R26 | invariant | android-device | automated | Paired A | `run-as` read `files/servers.json` | Bearer string absent from the file |
| F24 | R28 | state-transition | android-device | automated | Paired A; debug hook deletes the Keystore alias | Relaunch | A shown "needs pairing", label and pin intact; no bearer sent |
| F25 | R35 | state-transition | android-device | automated | Debug-key APKs built with `versionCodeFor(v0.10.0)` and `versionCodeFor(v0.11.0)` | Install old, pair A, `adb install -r` new | Install succeeds; A still paired and opens without re-pairing |
| F26 | R17 | state-transition | android-unit | automated | Fake NSD source emitting adverts {fp F (paired), fp H (unpaired), no fp} | Map to list rows | F shown as the paired entry (no duplicate); H as discovered; the no-fp row is labelled "identity not advertised" and routed to the confirm-before-knock flow |
| F27 | R17 | real multicast | — | manual-only | Phone and dashboard on the same Wi-Fi | Open the server list | Server appears within 5 s with its advertised name (emulator has no LAN multicast) |
| F28 | R01, R25, R30 | real device | — | manual-only | Real phone, current WebView, real zrok tunnel, ntfy.sh | QR scan from the dashboard Gateway, open, enable notifications, trigger `ask_user` in a real session | Authenticated dashboard over https; notification arrives; tap opens the session |
| F29 | R16, R23 | visual / accessibility | — | manual-only | Server list, confirm screen, update screen | TalkBack walk-through and visual check | [judgment: readable, labelled, badge legible — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R05, R06 | fault-injection (delay) | android-device | automated | Server A process paused (`kill -STOP`) | Open A | "Unreachable" within 5.5 s; bearer kept; no page load |
| X2 | R06 | state-transition | android-device | automated | Device revoked before open | Open A | Revoked dialog; no page load; later encrypted pushes to the old endpoint produce no notification within 15 s |
| X3 | R05 | fault-injection (abort) | android-device | automated | TLS front for A configured to answer `401` with an HTML basic-auth page | Open A via that route | Classified unreachable; bearer and pin kept; no "needs pairing" |
| X4 | R18 | fault-injection (impostor) | android-device | automated | Server C (fingerprint G) listening on A's stored address | Open A | Identity-mismatch error; C's request log shows `POST /api/pair/challenge` only, with no `/api/device-session` and no `Authorization` header |
| X5 | R24 | fault-injection | android-unit | automated | Fake keyring store throwing on write; fake poll returns `approved` | Pairing completes | Message "Paired on the server but not saved on this phone — ask the operator to remove '<device name>' and pair again"; no partial entry |
| X6 | R30 | state-transition | android-device | automated | https ntfy + distributor APK installed; server `push.enabled`, `webPush.contactEmail` set | Enable notifications for A | `GET /api/push/register` lists 1 token `Android · <model> (<ntfy host> browser)`; the test notification is visible in the shade (UiAutomator) |
| X7 | R30 | state-transition | android-device | automated | Same, but `webPush.contactEmail` unset | Enable notifications | Toggle off, "The server cannot deliver notifications — check its push settings" |
| X8 | R30 | state-transition | android-device | automated | `push.enabled: false` | Enable notifications | Toggle off, "Notifications are not enabled on this server"; `POST /api/push/register` answered 404 |
| X9 | R30 | state-transition | android-device | automated | Emulator without a distributor (APK uninstalled) | Enable notifications | Explanation naming a UnifiedPush distributor (e.g. ntfy); server token count unchanged |
| X10 | R31 | fault-injection (forgery) | android-device | automated | Notifications on for A | Harness POSTs a plaintext JSON `PushPayload` directly to A's ntfy endpoint | No notification within 15 s |
| X11 | R30 | state-transition | android-device | automated | Notifications on for A | Force a new endpoint (connector re-register via debug hook) | Server lists the new token id; the old id is absent; one token for this phone |
| X12 | R30 | fault-injection (capacity) | android-device | automated | Server pre-filled to 50 tokens (49 dummy + this phone's) | Force a new endpoint | Old token deleted, new token registered (count stays 50); toggle stays on |
| X13 | R30 | state-transition | android-device | automated | Device tier `control` on a `pair`-mode server | Enable notifications from the server sheet | Toggle off with "This device's access level cannot receive notifications"; register answered 403 |

### CI

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| C1 | R36 | contract | ci | automated | `.github/workflows/ci-android.yml` | vitest contract test parses the YAML | `on.pull_request.paths` contains `packages/android/**`. Jobs `android-unit` (`./gradlew :core:test assembleDebug`, no `secrets.*`) and `android-device` (emulator runner, `connectedDebugAndroidTest`) exist |
| C2 | R35 | contract | ci | automated | `.github/workflows/publish.yml` | vitest contract test | `mobile-android.needs` = `[resolve, publish, github-release]`. `github-release.needs` does not include `mobile-android`. `mobile-android.if` has the final-tag guard `^v\d+\.\d+\.\d+$`. Uploaded asset name `pi-dashboard-${version}.apk`. The missing-secret step message contains `ANDROID_KEYSTORE_BASE64`. No `strategy.matrix` |

---

## Coverage summary

- Requirements covered: 36/36
  - R01 E21,F1,F28
  - R02 F2,F3
  - R03 F2
  - R04 E19
  - R05 E6,X1,X3
  - R06 F5,X1,X2
  - R07 P4,F5,F6
  - R08 P4,F7,F8
  - R09 E3,F9,F10,F11
  - R10 E4
  - R11 F3,F4
  - R12 E16,F14
  - R13 F12
  - R14 E5,F13
  - R15 E1,E2
  - R16 F16,F29
  - R17 P3,F26,F27
  - R18 E7,E18,P2,X4
  - R19 E10,P1,P2,P3,P5
  - R20 E7,F17
  - R21 E9,F21
  - R22 E14,E17,F17,F18
  - R23 F17,F29
  - R24 E11,F19,F20,X5
  - R25 E8,E18,F21,F28
  - R26 E11,F23
  - R27 E20
  - R28 E11,F24
  - R29 F22
  - R30 E15,X6,X7,X8,X9,X11,X12,X13,F28
  - R31 X10
  - R32 F4
  - R33 E11,F15
  - R34 E13
  - R35 E12,F25,C2
  - R36 C1
- Scenarios by class: edge 21 · perf 5 · frontend 29 · error 13 · ci 2 (70 total)
- Scenarios by level: android-unit 26 · android-device 39 · ci 2 · manual-only 3
- Scenarios by disposition: automated 67 · manual-only 3

## New infra needed

- **`android-unit` level:** `packages/android/core` JVM module with JUnit 5 and a virtual clock (`kotlinx-coroutines-test`). First Android test tier in the repo; there is no in-repo exemplar.
- **`android-device` level:** `packages/android/app/src/androidTest` with Espresso and Espresso-Intents, UiAutomator, and OkHttp `MockWebServer` for fake-origin rows.
  - Debug-only hooks behind `BuildConfig.DEBUG`: injected WebView version, Keystore-alias delete, keyring-write fault, forced UnifiedPush re-register, virtual re-check intervals off.
- **CI device harness**, inside `ci-android.yml` job `android-device`:
  - `reactivecircus/android-emulator-runner` on `ubuntu-latest` with KVM, API 34 `google_apis` image.
  - Isolated dashboard servers A, B and C from repo source:
    - started as `HOME=$RUNNER_TEMP/srv-X node --import ./node_modules/jiti/lib/jiti-register.mjs packages/server/src/cli.ts --port …`;
    - `bindHost 0.0.0.0`, `trustedNetworks ["127.0.0.1"]`, tunnel off;
    - reached from the emulator at the runner's non-loopback IP, so peers are untrusted.
  - A Caddy TLS front `dash.test` using a throwaway test CA. The CA is trusted by the debug build only (`network_security_config` `debug-overrides`) and installed as a user CA on the emulator.
  - A self-hosted https ntfy container behind the same CA, plus a pinned ntfy distributor APK (version + SHA-256), installed with `adb install` and configured to that server.
    - **Feasibility risk:** the ntfy app must trust the test CA. Spike task 1.3 verifies this; on failure, X6 and X10–X12 return to planning.
  - A node helper sending RFC 8291-encrypted payloads to an endpoint (the server's existing `web-push` dependency), for F4 and X2.
- **`ci` level:** reuses the vitest contract-test pattern (`packages/shared/src/__tests__/e2e-electron-workflow-contract.test.ts`).
