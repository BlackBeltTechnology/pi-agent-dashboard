# Test Plan — add-electron-server-windows

Stage: design   Generated: 2026-10-15

Levels: **L1** vitest (`packages/*/src/**/__tests__/*.test.ts(x)`; Electron APIs behind injected ports) · **L3** Playwright vs docker harness (`tests/e2e/*.spec.ts`, derived port from `.pi-test-harness.json`) · **electron** Playwright `_electron` vs the packaged app (`tests/e2e-electron/*.electron.spec.ts`, fake remote server from `electron-lifecycle.ts`, bound to a non-loopback local IPv4) · **manual-only** post-merge.

Fixtures used below: F = `sha256:` fingerprint of fake remote `home-imac` (real Ed25519 key), G ≠ F, H = fingerprint of a manual-URL target; bearer `B1`; LAN host `192.168.16.204:8000`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | ESW Identity verified — expected rule | decision-table | L1 | automated | combos {pin: none/F} × {advert: none/F/G} × {proven: F/G/unreachable} | `resolveExpectedFingerprint` + verdict | pin=F,advert=G ⇒ mismatch (no knock); pin none+advert none ⇒ `tofu-confirm`; proven≠expected ⇒ mismatch; unreachable ⇒ `unverifiable`; pin=F,advert=F,proven=F ⇒ proceed |
| E2 | lan-knock delta — Manual address knocks only after confirmation | state-transition | L1 | automated | no pin, no advert, prove→H | pairing-client run without `sendRequest()` call | zero POSTs to `/api/pair/request`; phase `confirm` with full H; after `sendRequest()` exactly one POST; keyring pinned to H only after `approved` |
| E3 | lan-knock delta — Pin and advert disagree | decision-table | L1 | automated | keyring pin F, advert G at same host | `servers:pair-again` | no `/api/pair/request` POST; outcome `identity_mismatch` naming short F and short G |
| E4 | ESW knock — response fingerprint check | fault-injection (abort) | L1 | automated | challenge proves F, knock response `fingerprint: G` | knock | outcome `identity_mismatch stage=response`; `/api/pair/poll` never called; keyring unchanged |
| E5 | ESW Server keyring — MRU cap | BVA | L1 | automated | entry with 4, 5, 6 distinct hosts healed in sequence | `heal()` each | lengths 4,5,5; newest first; oldest dropped at 6th |
| E6 | ESW keyring — heal never precedes https | decision-table | L1 | automated | `lastHosts=[https://dash.lan:8443]`, discovery proves F at `http://192.168.16.77:8000` | heal | `lastHosts[0]` stays `https://dash.lan:8443`; http host inserted after it |
| E7 | ESW keyring — encryption unavailable | decision-table | L1 | automated | crypto port `isEncryptionAvailable=false` (and Linux backend `basic_text`) | pair approved | file entry `bearer:null, remembered:false`; bearer string absent from file bytes; `partitionFor` returns non-`persist:` name |
| E8 | ESW keyring — bearer not in clear text + mode | equivalence | L1 | automated | encryption available, bearer `B1` | save | file bytes do not contain `B1`; POSIX `stat.mode & 0o777 === 0o600`; pre-existing `0644` file tightened to `0600` on load |
| E9 | ESW keyring — undecryptable bearer | fault-injection | L1 | automated | stored blob, crypto port `decrypt` throws | load + open `home-imac` | entry kept with pin F, `needsPairing:true`, bearer dropped; open starts pairing flow |
| E10 | ESW keyring — corrupt / unknown version | equivalence | L1 | automated | file `{` (truncated) ; file `{"version":2,...}` | app start (`loadKeyring`) | keyring empty; original renamed `server-keyring.corrupt-<ts>.json`; one `[server-windows]` set-aside log line; no throw |
| E11 | ESW keyring — atomic write | fault-injection (abort) | L1 | automated | fs port fails between write and rename | save | previous file content intact; no partial `server-keyring.json` |
| E12 | ESW discovery — display-name sanitiser | BVA | L1 | automated | names: 63/64/65-byte UTF-8 ASCII; 64-byte boundary splitting a 3-byte char; `"\u202Ecod.exe"`; zero-width only `"\u200B"` | `sanitizeDisplayName` | ≤64 bytes on char boundary; no U+202E; zero-width-only ⇒ falls back to host |
| E13 | ESW One window — page-title sanitised | equivalence | L1 | automated | `page-title-updated` with `"\u202EMain"` for label `home-imac` | handler | `setTitle` called with `home-imac — Main` minus U+202E; event `preventDefault` called |
| E14 | ESW discovery — local exclusion | decision-table | L1 | automated | adverts: {isLocal:true, fp=localFp}, {isLocal:false, fp=localFp, host 192.168.16.9}, {isLocal:false, fp=F} | `listDiscovered` | first dropped; second listed with label "same identity as this dashboard"; third listed "not paired" |
| E15 | ESW discovery — remote mode skips localFp | state-transition | L1 | automated | mode `remote` | startup hook | `proveServerIdentity` not called for local origin; `localFp` undefined |
| E16 | ESW short fingerprint | BVA | L1 | automated | fp `sha256:` + 43-char b64url | `shortFingerprint` | returns `sha256:` + first 16 chars; malformed fp (42 chars) rejected by IPC fp regex |
| E17 | ESW partition | equivalence | L1 | automated | fp F, remembered true/false | `partitionFor` | `persist:server-<32 hex>` / `server-<32 hex>`; same F ⇒ same name; renderer-supplied partition field ignored |
| E18 | ESW origin construction | equivalence | L1 | automated | `{http, fe80::1, 8000}`, `{http, 192.168.16.204, 8000}`, `{https, dash.lan, 8443}` | `serverOrigin` | `http://[fe80::1]:8000`, `http://192.168.16.204:8000`, `https://dash.lan:8443` |
| E19 | ESW validated requests — sender check | decision-table | L1 | automated | sender = {main top frame on local origin, main subframe same origin, main top frame remote-mode origin, remote-connect file://, connecting file://, server window, unknown window} | `isServerWindowsSender` | true only for rows 1,4,5; all others false |
| E20 | ESW validated requests — payload validation | BVA | L1 | automated | host len 253/254; port 0/1/65535/65536; fp regex pass/fail; manual URL `ftp://x`, `http://127.0.0.1:8000`, `https://dash.lan:8443/p?q` from remote-connect; manual URL from main window | handler | 254, 0, 65536, bad fp, ftp, loopback, manual-from-main refused; `https://dash.lan:8443` accepted with path dropped |
| E21 | ESW validated requests — unknown host from main window | equivalence | L1 | automated | main window request `{host:"10.9.9.9", port:22}` matching nothing | `servers:open-from-dashboard` | `{ok:false}`; fetch port records zero requests to `10.9.9.9` |
| E22 | ESW One window — navigation decisions | decision-table | L1 | automated | origin `http://192.168.16.204:8000`; targets `/settings`, `http://192.168.16.204:8000/x`, `https://example.com`, `mailto:a@b`, `file:///Applications/Calculator.app`, `ms-msdt:/id`, unparseable | `decideServerWindowNavigation` | allow, allow, external, external, drop, drop, drop |
| E23 | ESW One window — redirect cancelled | state-transition | L1 | automated | fake webContents emits `will-redirect` (main frame) to `http://evil.test/` | handler | `preventDefault` called; `shell.openExternal` called with `http://evil.test/` only via allowlist; no `loadURL(evil)` |
| E24 | ESW One window — webPreferences posture | equivalence | L1 | automated | open `home-imac` | `createServerWindow` | captured options: `sandbox:true, contextIsolation:true, nodeIntegration:false, webviewTag:false`, no `preload`; `setWindowOpenHandler` returns `{action:"deny"}` |
| E25 | ESW One window — permissions | decision-table | L1 | automated | permission requests `clipboard-sanitized-write`, `notifications`, `fullscreen`, `media`, `geolocation` | partition handler | first three granted; `media`, `geolocation` denied |
| E26 | ESW Revoked — exchange classification | decision-table | L1 | automated | exchange responses 200; 401; 403 `{error:"network_not_allowed"}`; 403 `{error:"insufficient_scope"}`; 404; 500; timeout | `classifyExchange` | ok; refused; refused; transport; transport; transport; transport |
| E27 | ESW Revoked — tier refusal does not unpair | state-transition | L1 | automated | open window; `onCompleted` 403 on `/api/x`; re-run exchange → 200 | handler | bearer + cookie kept; entry `Paired`; no `reload()`; no dialog |
| E28 | ESW Revoked — re-check rate limit | BVA | L1 | automated | ten 401s at t=0..59 s; one more at t=299 s and t=301 s | handler (fake clock) | exactly 1 exchange in first minute; none at 299 s; second exchange at 301 s |
| E29 | ESW Revoked — refused re-check unpairs once | state-transition | L1 | automated | 403 on `/api/x`; exchange → 403 `network_not_allowed`; then more 401s | handler | `needsPairing:true`; bearer removed from keyring; partition `pi_dash_device` removed; dialog shown exactly once |
| E30 | ESW One window — focus-existing | state-transition | L1 | automated | `home-imac` window open & minimized | `servers:open` F twice | one window; `restore()` + `focus()` called; no second `BrowserWindow` |
| E31 | ESW One window — open of unpaired starts pairing | state-transition | L1 | automated | discovered `lab-box` with no keyring entry | `servers:open` | connecting window created; no server window until `approved` |
| E32 | ESW Forget | state-transition | L1 | automated | `home-imac` paired with window open | `servers:forget` F | window closed; keyring entry gone; `server-windows-state.json` entry gone; `clearStorageData` called on F's partition; message mentions operator revocation |
| E33 | ESW Servers menu | equivalence | L1 | automated | keyring {home-imac Paired, lab-box needsPairing} | build menu template; then forget `home-imac` | items `home-imac`, `lab-box — needs pairing`, `Connect to another dashboard…`; after forget `home-imac` absent in app + tray templates |
| E34 | electron-shell delta — server window ≠ external link | equivalence | L1 | automated | main window `setWindowOpenHandler` with `http://192.168.16.204:8000/` | `window.open` from dashboard | `{action:"deny"}` + `openExternal`; `server-windows` registry unchanged |
| E35 | ERC Open in window — no mode/MRU change | state-transition | L1 | automated | settings mode standalone, MRU [A] | `servers:connect` (discovered) and manual "Open in window" | `writeModeFile` and `addRecentRemote` not called; `app.relaunch` not called |
| E36 | ERC Use as remote dashboard unchanged | regression | L1 | automated | valid URL | `remote-connect:connect` | MRU updated, mode `remote` written, relaunch called (existing `remote-mode.test.ts` stays green) |
| E37 | SS Electron branch — available entry opens window | state-transition | L1 | automated | `window.piDashboard.openServerWindow` stub, loopback origin, entry `home-imac` Available | select entry | stub called with `{host:"192.168.16.204", port:8000}`; no WebSocket constructed; `pi-dashboard-last-server` untouched |
| E38 | SS Electron branch — unavailable entries inert | decision-table | L1 | automated | entries Unreachable / Network not allowed / Blocked / Name not found / Moved / Checking | Enter on each | stub never called; `aria-disabled="true"` |
| E39 | SS Electron branch — local entry & absent capability | decision-table | L1 | automated | (a) Local entry with capability; (b) remote entry, no `openServerWindow` | select | (a) dropdown closes, no call, no WS; (b) `performServerSwitch` invoked (existing transactional path) |
| E40 | SS Persist last-used — Electron ignores saved remote | state-transition | L1 | automated | capability present, origin `http://localhost:8000`, `pi-dashboard-last-server=192.168.16.204:8000` | `getInitialWsUrl()` | returns `ws://localhost:8000/...`; localStorage value unchanged |
| E41 | shared knock client refactor | regression | L1 | automated | moved `knock.test.ts` suite | run with injected `prove` | all prior knock outcomes identical; client re-export passes WebCrypto prover |
| E42 | ESW knock — refusal mapping | equivalence | L1 | automated | refusals `knock_disabled`, `knock_not_lan`, `knock_pending`, `knock_rate_limited` (retryAfter 30), `knock_busy`, `host_not_admitted`, `unknown`, HTTP 404 | connecting-window message map | each maps to the shared landing wording; `knock_not_lan` says same-local-network only; 404/unknown ⇒ generic refusal; nothing stored |
| E43 | ESW knock — device name | BVA | L1 | automated | name field `""`, `"   "`, 200-char, default `os.hostname()` | send request | `""`/whitespace ⇒ body `{}`; 200-char ⇒ ≤64 bytes; default prefilled = hostname |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | ESW One window — host selection ≤ 5 s | tail-latency (fake timers) | L1 | automated | 5 stored hosts each stalling forever + 3 discovery hosts, the 3rd discovery host proves F after 300 ms | `pickVerifiedHost` resolves with the discovery host in ≤ 5 000 ms simulated; all 8 challenges started concurrently | single run |
| P2 | ESW One window — host selection deadline | BVA (fake timers) | L1 | automated | all 8 candidates stall | resolves "unreachable" at 5 000 ms ± 50 ms; no exchange POST sent | single run |
| P3 | ESW re-verification cadence | soak (fake timers) | L1 | automated | open window, 10 simulated minutes, focus events at 30 s and 90 s, one `resume` | challenge count = 10 interval + 1 focus(90 s) + 1 resume; focus at 30 s adds none | 10 min simulated |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | ESW knock — connecting window waiting view | state-convergence | L1 | automated | phase push `{phase:"waiting", confirmCode:"48217730", expiresAt: now+300000, unencrypted:true}` | render `connecting.html` (jsdom) | text `4821 7730`; countdown shows `5:00` then `4:59` after 1 s; unencrypted notice present; "Stop waiting" present |
| F2 | ESW knock — TOFU confirm view | state-convergence | L1 | automated | phase `confirm`, full H, device name prefilled | render | full H visible; compare-prompt text present; "Send request" enabled; no code shown |
| F3 | ERC Remote-connect window lists | state-convergence | L1 | automated | state {paired:[home-imac Paired, lab-box needs pairing], discovered:[x Not paired, y Identity not advertised], recent:[A]} then push removes `x` | render `remote-connect.html` (jsdom) | four section headings; state words per row; actions Open/Forget, Pair again, Connect, Open in window; after push `x` gone without reload |
| F4 | SS Electron branch — in-flight + failure toast | state-convergence | L3 | automated | harness dashboard; `addInitScript` stub `window.piDashboard.openServerWindow` resolving `{ok:false, reason:"identity_mismatch"}` after 500 ms; known server entry Available | select entry in header dropdown | entry shows inline progress until resolution; toast text contains "identity" and the entry label; no `pi-dashboard-last-server` write; header still shows local server |
| F5 | SS Browser keeps in-page switch | regression | L3 | automated | harness dashboard, no `piDashboard` stub, second reachable known server | select entry | existing staging-switch path runs (`servers` WS switches); covered by extending existing selector spec |
| F6 | Connecting + remote-connect windows look right | visual/subjective | — | manual-only | macOS + Windows, light/dark | human looks at code grouping, sections, focus order | [judgment: layout, contrast, keyboard focus order feel correct] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | ESW Full ceremony — pair then window on own origin | fault-free path, real app | electron | automated | fake remote (real keypair F; `/api/pair/challenge`, `/api/pair/request`→code `48217730`, `/api/pair/poll` approved on 2nd poll, `/api/device-session` sets `pi_dash_device`) on non-loopback IPv4 | remote-connect "Open in window" manual URL → confirm → wait | connecting window shows `4821 7730`; a new BrowserWindow loads the fake origin; fake server saw `POST /api/device-session` with `Authorization: Bearer <token>` BEFORE the first `GET /`; subsequent `GET /api/*` carry the cookie; local main window URL unchanged |
| X2 | ESW Partitions isolated | real app | electron | automated | as X1, window open | `app.evaluate` reads cookies of default session and of the server partition | `pi_dash_device` present only in the server partition |
| X3 | ESW server window has no bridge | real app | electron | automated | as X1 | `evaluate` in server window `typeof window.piDashboard`, `typeof window.remoteConnect`, `typeof require` | all `"undefined"` |
| X4 | ESW Revoked at open | fault-injection (abort) | electron | automated | paired as X1; fake remote now answers `/api/device-session` `403 {error:"network_not_allowed"}` | close window, reopen from Servers menu | no server window loads `GET /`; Servers menu template shows `— needs pairing`; one dialog call (stubbed) with Pair again / Forget |
| X5 | ESW Address taken over | fault-injection | electron | automated | paired as X1; fake remote swaps its key to G | trigger re-verification (`app.evaluate` advances, or focus after 60 s) | server window URL `about:blank`; partition cookie removed; log line contains short F and short G, not the bearer |
| X6 | ESW Server briefly unreachable | fault-injection (delay/abort) | L1 | automated | challenge port rejects (ECONNREFUSED) on one re-verification, succeeds on next | interval ticks | window not navigated; title contains "not reachable" then reverts to label |
| X7 | ESW Identity mismatch before knock | fault-injection | L1 | automated | advert F, challenge proves G | Connect | zero knock POSTs; connecting window phase `mismatch` with short F + short G; keyring unchanged; one log line |
| X8 | ESW Dashboard without challenge | fault-injection | L1 | automated | challenge answers 404 / ECONNREFUSED / 2.1 s stall (timeout 2 s) | Connect | phase `unverifiable` ("identity cannot be verified … unreachable or too old"); no knock |
| X9 | ESW Exchange transport failure | fault-injection | L1 | automated | `/api/device-session` 500 / timeout | open | no `loadURL`; entry state unchanged (still Paired); user told unreachable |
| X10 | ESW Stop waiting | state-transition | L1 | automated | knock admitted, polling | `servers:stop-waiting` | poll loop aborted (no further polls after abort); keyring unchanged; window text says request remains until expiry |
| X11 | ESW knock expired / rejected | state-transition | L1 | automated | poll → `rejected`; separately clock passes `expiresAt` | pairing-client | phases `rejected` / `expired`; nothing stored; log lines `rejected` / `expired` |
| X12 | ESW observability without secrets | invariant | L1 | automated | run E2, E7, E29, X5, X7, E10 flows with captured logger | inspect all lines | none contains `B1`, `48217730`, the device name, or cookie value; each outcome line contains a `sha256:` short fp |
| X13 | ESW discovery — list readable only by trusted windows | fault-injection | electron | automated | X1 window open | from the server window `evaluate` an `ipcRenderer` call is impossible; from remote-connect, `servers:list` returns entries | server window has no IPC path (X3); remote-connect receives list; `servers:changed` pushes are received only by remote-connect/connecting/main (spy on `webContents.send` targets) |
| X14 | Two-machine LAN ceremony, real knock gates | real network | — | manual-only | two machines on one LAN, remote `pairing.acceptLanRequests:true` | discover → Connect → type code on remote → window; revoke on remote → reopen; Forget | [judgment: real mDNS discovery, on-link knock admission and real revocation behave end-to-end; local dashboard keeps working] |
| X15 | safeStorage on real Linux keyring / no keyring | real OS backend | — | manual-only | Ubuntu with gnome-keyring vs headless `basic_text` | pair, restart | [judgment: remembered vs "pair again after restart" message on a real desktop session; partition dir absent for basic_text] |

---

## Coverage summary

- Requirements covered: 19/19 (electron-server-windows 10 · electron-remote-connect 3 · server-selector 3 · electron-shell 1 · lan-knock-pairing 1 · knock-client refactor 1)
- Scenarios by class: edge 43 · perf 3 · frontend 6 · error 15
- Scenarios by level: L1 56 · L3 2 · electron 6 · manual-only 3 (L2 0)
- Scenarios by disposition: automated 64 · manual-only 3

## New infra needed

- `tests/e2e-electron/electron-lifecycle.ts`: a `startFakeRemoteDashboard({fingerprintKey, knock})` helper (real Ed25519 identity, challenge/request/poll/device-session routes, request log, key swap) bound to the first non-internal IPv4. Extends the existing fake-health-server helper; no new runner.
- jsdom DOM tests for the bundled `renderer/*.html` pages (F1–F3) — check for an existing Electron renderer DOM test before adding vitest `environment: jsdom` to the electron package.
