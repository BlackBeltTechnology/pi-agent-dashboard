# Test Plan — add-lan-knock-pairing

Stage: design   Generated: 2026-10-14

Gate answers folded (scenario-design HARD gate): G1 no performance scenario
(functional only) · G2 E2E depth = happy path + disabled + deny + tier=observe
+ remote-banner Request access (5 Playwright flows on the docker harness).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | toggle › config field | EP | L1 | automated | config with `pairing.acceptLanRequests` absent / `true` / `"yes"` | shared config loader | `false` / `true` / `false` |
| E2 | gates › IPv6 parsing | EP | L1 | automated | `fe80::a1b2%en0`; `::ffff:192.168.16.31`; `fd12:3456:789a:1::10`; `::1`; `not-an-ip` | parse | `fe80::a1b2` (zone stripped); IPv4 `192.168.16.31`; expanded 8 groups; loopback; `null` |
| E3 | gates › on-link private | decision-table | L1 | automated | interfaces `192.168.16.204/24`, `fe80::1%en0/64`, `fd12::1/64`; peers `192.168.16.31`, `192.168.17.5`, `100.101.102.103`, `203.0.113.9`, `127.0.0.1`, `::1`, `::ffff:192.168.16.31`, `fe80::a1b2%en0`, `fd12::5`, `undefined` | `isOnLinkPrivate(peer, interfaces)` | true, false, false, false, false, false, true, true, true, false |
| E4 | gates › source key | EP | L1 | automated | `fd12:3456:789a:1::10`, `fd12:3456:789a:1::22`, `fe80::a1b2%en0`, `192.168.16.31` | `knockSourceKey` | two different keys for the /64 neighbours; `fe80::a1b2`; `192.168.16.31` |
| E5 | gates › Host admission | EP | L1 | automated | host gate in report mode; `Host: evil.test` (not admitted), peer `192.168.16.31`, switch on | `admitKnock` | `{ error: "host_not_admitted", status: 403 }`; no pending created |
| E6 | gates › forwarding headers and loopback | decision-table | L1 | automated | (peer `192.168.16.5` + `X-Forwarded-For: 203.0.113.9`), (peer `127.0.0.1` + `X-Forwarded-For: 192.168.16.31`), (peer `127.0.0.1`, no header), (peer `192.168.16.31`, no header) | `admitKnock`, switch on | `knock_not_lan` ×3, admitted ×1 |
| E7 | gates › disabled by default | EP | L1 | automated | config without `acceptLanRequests`, peer `192.168.16.31` | `admitKnock` | `403 knock_disabled` |
| E8 | gates › off-link learns nothing | decision-table | L1 | automated | switch off; peer `203.0.113.9` | `admitKnock` | `knock_not_lan`, never `knock_disabled` |
| E9 | gates › source window | BVA | L1 | automated | 4 / 5 admitted knocks from `192.168.16.31` within 10 min (each approved), then one more; separately 10 `knock_disabled` refusals then switch on | `admitKnock` | 5th admitted; 6th `429 knock_rate_limited` with `retryAfter` > 0; refusals not counted (next knock after flip admitted) |
| E10 | gates › cooldown paths | state-transition | L1 | automated | knock from `192.168.16.31` resolved by deny (5 s ago) / lockout / approve / expiry | knock again from the same source | deny → `429` (not `409`); lockout → `429`; approve → admitted (window permitting); expiry → admitted |
| E11 | gates › live definition | state-transition | L1 | automated | knock live; knock denied 5 s ago but still pollable; knock past `expiresAt` with no sweep run | `liveKnocks()` + re-knock from same source | live → `409 knock_pending`; denied-pollable not counted as live; expired-unswept not counted as live |
| E12 | gates › global caps | BVA | L1 | automated | 3 live knocks from 3 sources; separately 10 admitted-then-denied knocks from 10 sources within 10 min | 4th / 11th source knocks | `503 knock_busy` with `retryAfter` > 0 in both cases |
| E13 | gates › IPv6 neighbours | EP | L1 | automated | live knock from `fd12:3456:789a:1::10` | knock from `fd12:3456:789a:1::22` | admitted (not `409`) |
| E14 | name › normalisation | EP+BVA | L1 | automated | `name` = 200 ASCII chars; 63 ASCII + one 4-byte emoji; `"\u202Ecod.exe"`; `"a\u200Bb"`; `"   "`; `123` | `knock()` then `listPending()` | ≤ 64 bytes; 63 bytes (emoji not split); no U+202E; `ab`; absent; absent — every knock admitted |
| E15 | name › never authorizes | decision-table | L1 | automated | identical peer/state with `name` absent vs `"home-imac (this computer)"` | `admitKnock` | identical admission result |
| E16 | knock lifecycle | state-transition | L1 | automated | admitted knock | `knock()`; `approvePending(id, code)`; `poll(id)`; separately `deny(id)` then `poll(id)`; 5 wrong codes | 8-digit `confirmCode`, `expiresAt` ≈ now+300 s, one change hint; `approved` + bearer once; `rejected`; `locked_out` |
| E17 | pending feed › provenance | EP | L1 | automated | one QR redemption + one unencrypted knock named `Roberts-MacBook-Pro` | `listPending()` | `qr` / `knock` + `requesterName` + `unencrypted: true`; no pairing or confirmation code in either entry |
| E18 | cooldown callbacks | state-transition | L1 | automated | knock entries resolved via `deny()`, `approve()` lockout, `approve()` match, `sweep()` expiry | observe `onKnockResolved` | `denied`, `locked_out`, `approved`, `expired` with the entry's `sourceKey` |
| E19 | route › admitted knock | EP | L1 | automated | switch on; inject from socket peer `192.168.16.31`, no credential, peer not in `trustedNetworks` | `POST /api/pair/request {name}` | `200 {pendingId, confirmCode, expiresAt, fingerprint}`; never `network_not_allowed`; pending `remoteAddress` = `192.168.16.31`; `unencrypted: true` |
| E20 | route › preconditions | EP | L1 | automated | `Origin: https://evil.example`; `Content-Type: text/plain` | `POST /api/pair/request` | `403 {error:"untrusted origin"}` and `415`; no pending created; no change hint |
| E21 | tier › approve-pending | EP | L1 | automated | pending knock; bodies with `tier:"observe"`, `tier:"admin"`, `tier:123`, no tier | `POST /api/pair/approve-pending` | device tier `observe`; `400` + still pending; `400` + still pending; device tier `operate` |
| E22 | device cookie › Secure matrix | decision-table | L1 | automated | (https base, LAN plain-http peer `192.168.16.31`), (https socket), (https base, peer `127.0.0.1` + `X-Forwarded-Proto: https`), (http base, LAN peer) | `POST /api/device-session` with a valid bearer | no `Secure`; `Secure`; `Secure`; no `Secure` — and the first cookie authenticates a following `/api/` inject |
| E23 | toggle › config route | EP | L1 | automated | `PUT /api/config {pairing:{acceptLanRequests:true}}`; `{...:"yes"}` | inject, then knock | accepted and next knock passes `knock_disabled` without restart; non-boolean rejected |
| E24 | Gateway panel | EP | L1 | automated | endpoints `local`, `lan http://192.168.16.204:8000`, `public https://pi-robson.share.zrok.io`; switch off then on | render `GatewayPairQR` | Off: switch `aria-checked=false` + word "Off", no URL; On: exactly one row `http://192.168.16.204:8000/pair?request` with Copy |
| E25 | Gateway no-secure-road copy | EP | L1 | automated | `noSecureRoad` response | render | no "cannot pair" text; points to "Accept requests from devices on this network" |
| E26 | waiting list provenance | EP | L1 | automated | pending knock (unencrypted, named) + pending QR | render `WaitingDevices` | knock row: "Network request", `192.168.16.31`, says "Roberts-MacBook-Pro", "Unencrypted"; QR row: "Pairing link", no Unencrypted; Review `aria-label`s name the request; existing test ids intact |
| E27 | discovery Connect | decision-table | L1 | automated | remote `home-imac` `192.168.16.204:8000`; remote `fd12::4:8000`; local server | click Connect | `window.open("http://192.168.16.204:8000/pair?request", _, "noopener")`; `http://[fd12::4]:8000/pair?request`; no Connect on local; accessible name "Connect to home-imac (opens in a new tab)" |
| E28 | approval dialog › knock | EP | L1 | automated | knock entry (unencrypted, named) ; QR entry | render `PairingApprovalDialog`, pick Observe, submit code | title "A device on 192.168.16.31 asks to connect"; "Says it is" row; name field = `Roberts-MacBook-Pro`; unencrypted callout before code field; tier group Operate preselected; consequence text switches to observe; `approvePending` called with `tier:"observe"`; QR entry: no tier group, unchanged title |
| E29 | spawn-correlation › UUID fallback | EP | L1 | automated | `crypto.randomUUID` undefined | `randomUuid()` ×1000 and a `spawn_session` dispatch | each matches the RFC 4122 v4 regex; 1000 distinct; dispatch carries one |
| E30 | non-secure context › source scan | EP | L1 | automated | `packages/client/src` + `packages/client-utils/src` | scan for `crypto.randomUUID`, `crypto.subtle`, `navigator.clipboard` | zero hits outside the allowlist (`randomUuid` helper, `lib/util/clipboard.ts`, `lib/pairing/pair-protocol.ts`) |
| E31 | non-secure context › DPoP | EP | L1 | automated | `crypto.subtle` undefined | DPoP key/proof entry point in `client-utils/src/identity/dpop.ts` | reports unavailable; no throw |
| E32 | native knock helper | decision-table | L1 | automated | challenge proves G ≠ advertised F; proves F, knock response `fingerprint` F; proves F, response `fingerprint` G | `knockServer(base, F, name, hooks)` | no `/api/pair/request` call + identity-mismatch error; bearer returned; rejected, no bearer |

### Performance

None — functional only (gate answer G1).

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | landing › intro in insecure context | EP | L1 | automated | `location` `http://192.168.16.204:8000/pair?request`, `crypto.subtle` + `randomUUID` undefined | render `PairLanding` | host shown, unencrypted note, "Request access" primary; no `/api/pair/challenge` call; no throw |
| F2 | landing › waiting | state-transition | L1 | automated | knock resolves `{confirmCode:"48217730", expiresAt: now+300 s}` | click Request access | code rendered `4821 7730`; countdown text; no Cancel control; `role="status"` waiting region |
| F3 | landing › reload resume | state-transition | L1 | automated | live request stored in session storage | remount `PairLanding` | same code shown, polling resumes, no second knock; storage cleared after `approved` / `rejected` / expiry |
| F4 | landing › visibility poll | state-transition | L1 | automated | waiting; poll timer not due | `visibilitychange` to visible | one immediate poll |
| F5 | landing › missed outcome | state-transition | L1 | automated | poll returns `unknown` at `now < expiresAt`; and at `now ≥ expiresAt` | poll | "may have been decided while this page was away" + Request again; "expired" copy + Request again |
| F6 | landing › refusal map | decision-table | L1 | automated | refusals `knock_disabled`, `knock_not_lan`, `knock_pending`, `knock_rate_limited (retryAfter 420)`, `knock_busy`, `host_not_admitted`, `untrusted origin`, `415` | click Request access | the ui-plan copy per code; `knock_not_lan` has no retry button; rate-limited button disabled showing `7:00`; last three → generic "This dashboard refused the request." |
| F7 | landing › approved | state-transition | L1 | automated | poll `approved` with bearer; cookie-only check 200 | poll | bearer stored then cleared after the check; navigation to `/` |
| F8 | bearer kept until cookie proven | fault-injection (abort) | L1 | automated | exchange 200 but cookie-only check 401 (QR path and knock path) | `finishDevicePairing` | bearer kept; next `/api/` call carries `Authorization: Bearer`; "couldn't keep its access" message; QR landing tests stay green |
| F9 | banner › Request access | decision-table | L1 | automated | `networkDenied` with hint; active server = page origin; active server = `http://192.168.16.204:8000` ≠ page origin | render `ConnectionStatusBanner`, click Request access | hint text present; same origin → `location` `/pair?request`; remote → `window.open(".../pair?request", _, "noopener")`; Settings → Servers still present; no Tailwind amber classes (token scan) |
| F10 | E2E happy path | state-transition | L3 | automated | docker harness, switch on via config, Playwright page A (operator) + page B (`http://<host-ip>:<dashboardPort>/pair?request`) | B requests, A types B's code, approves | A shows knock dialog with B's address; B lands on `/` authenticated (an `/api/` call returns 200) |
| F11 | E2E disabled | EP | L3 | automated | switch off | B clicks Request access | B shows the `knock_disabled` copy; A shows no dialog |
| F12 | E2E deny | state-transition | L3 | automated | switch on | A denies B's request; B clicks Request again | B shows "declined"; second attempt shows rate-limited copy with a countdown |
| F13 | E2E tier observe | EP | L3 | automated | switch on | A picks Observe and approves | Settings ▸ Paired devices on A lists the device with tier Observe; B's operate-only action (e.g. restart) is refused |
| F14 | E2E remote-banner | state-transition | L3 | automated | page served at `http://localhost:<dashboardPort>`; known server = same dashboard at `http://<host-ip>:<dashboardPort>` (untrusted → `network_not_allowed`) made active | click Request access on the banner | new page opens `http://<host-ip>:<dashboardPort>/pair?request` |
| F15 | visual fidelity to `mockups/knock-pairing.html` (dialog, landing states, Gateway panel, Connect, banner) in base dark, base light, nord dark and at 375 px | visual/subjective | — | manual-only | approved board vs implementation | human compares | [judgment: matches approved mockup — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | logs › admission redaction | fault-injection (sensitive fixture) | L1 | automated | knock with name `Roberts-MacBook-Pro`, peer `192.168.16.31` | admit | one `[pairing] knock admitted id=<8 chars>` line; no confirm code, name, address or UA in any line |
| X2 | logs › refusal throttle + flush | fault-injection (flood) | L1 | automated | 100 `knock_disabled` refusals within 60 s, then silence (fake timers) | advance 60 s | exactly one refusal line in the window; one `suppressed=99` line at the window end without further traffic; separate reasons throttle independently |
| X3 | landing › transport failure | fault-injection (abort) | L1 | automated | `POST /api/pair/request` network error | click Request access | transport error message + Request access enabled again; no stored request |
| X4 | real two-machine LAN over plain http (Chrome + Safari on the second machine) | fault-injection (real network) | — | manual-only | second machine on the same Wi-Fi, switch on, no TLS | Network Discovery ▸ Connect → Request access → approve on host; then start a session and use a Copy button | paired; dashboard usable (session start, copy) on the http origin |

---

## Coverage summary

- Requirements covered: 17/17 — `lan-knock-pairing` (knock route, admission gates, toggle, plain-http transport, requester name, observability, landing, waiting list, tier choice, non-secure context, native helper), `qr-device-pairing` (dialog, pending feed), `known-servers` (discovery Connect), `connection-status-banner` (Request access), `bearer-device-auth` (cookie Secure, bearer kept until proven), `spawn-correlation` (UUID fallback)
- Scenarios by class: edge 32 · perf 0 · frontend 15 · error 4
- Scenarios by level: L1 44 · L2 0 · L3 5 · — 2
- Scenarios by disposition: automated 49 · manual-only 2

## New infra needed

- none — L1 rows extend existing suites (`packages/server/src/__tests__/{localhost-guard,pairing,pairing-approval-dialog,bearer-auth,config-api}.test.ts`, `packages/shared/src/__tests__/config-host-gate.test.ts` layout, `packages/client/src/components/__tests__/{PairLanding,ConnectionStatusBanner}.test.tsx`, `components/Gateway/__tests__/GatewayPairQR.test.tsx`, `components/connectivity/__tests__/{NetworkDiscoverySection,connectivity-token-scan}.test.tsx`, `components/pairing-approval/__tests__/PairingApprovalDialog.test.tsx`, `lib/pairing/__tests__/device-auth-cookie.test.ts`) or add siblings (`knock-admission.test.ts`, `knock.test.ts`, `secure-context-scan.test.ts`). L3 rows extend the docker harness via `tests/e2e/pairing-approval-dialog.spec.ts` / `pairing-qr.spec.ts` glue; F14 reuses the single harness dashboard through a second origin (host IP vs `localhost`), so no second container. Harness port is read from `.pi-test-harness.json` (`dashboardPort`), never hardcoded.
