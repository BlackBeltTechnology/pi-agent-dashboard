Order: for each implementation task, author its folded test tasks (sections 10–12, referenced by test-plan id) first and see them fail, then implement until they pass.

## 1. Shared config and types

- [x] 1.1 Add `acceptLanRequests: boolean` to `PairingConfig` in `packages/shared/src/config.ts` (loader default `false` when absent; non-boolean → `false`); verify test-plan #E1 passes; update the `config.ts` row in `packages/shared/src/AGENTS.md`
- [x] 1.2 Add `KnockRefusal` (`host_not_admitted | knock_not_lan | knock_disabled | knock_rate_limited | knock_pending | knock_busy`) and `PairingProvenance = "qr" | "knock"` to the shared pairing types; extend the pending-view type with optional `provenance`, `requesterName`, `unencrypted`; verify `tsc --noEmit` for shared + server + client passes

## 2. Server — peer-address predicates (design D3, D4)

- [x] 2.1 Implement the IPv6 parser, `isOnLinkPrivate(ip, interfaces)` and `knockSourceKey(ip)` in `packages/server/src/auth/localhost-guard.ts` beside `netmaskToCidrBits`/`networkAddress`; interface list = non-internal `os.networkInterfaces()` covered by the bind host, cached 30 s; verify test-plan #E2 #E3 #E4 pass; update the `localhost-guard.ts` row (`See change: add-lan-knock-pairing`)

## 3. Server — admission and limiter (design D2, D5, D12)

- [x] 3.1 Implement `packages/server/src/pairing/knock-admission.ts` (`admitKnock` in spec gate order: Host admission via `isHostAdmitted(host, hostAdmission())` in enforce semantics, `knock_not_lan`, `knock_disabled`, rate, pending, busy; `KnockLimiter` with per-source 5/10-min window of admitted knocks, deny/lockout cooldown 10 min, global 10/10-min window, bounded LRU map, injectable clock); verify test-plan #E5–#E13 #E15 pass; add its row to `packages/server/src/pairing/AGENTS.md`

## 4. Server — PairingManager knock entry (design D1, D12, D16)

- [x] 4.1 Implement `knock()`, `liveKnocks()` (compares `expiresAt` itself), `onKnockResolved(sourceKey, outcome)` from `deny()`, `approve()` lockout and match branches and `sweep()`, the name normaliser (strip Cc/Cf, trim, truncate ≤64 UTF-8 bytes on a character boundary) and the provenance fields in `packages/server/src/pairing/pairing.ts`, reusing the existing entry lifecycle; verify test-plan #E14 #E16 #E17 #E18 and the existing pairing suites pass; update the `pairing.ts` row / sidecar

## 5. Server — routes (design D5, D6, D7, D13, D14, D15)

- [x] 5.1 Add `POST /api/pair/request` to `packages/server/src/routes/pairing-routes.ts` (call `isHostAdmitted` directly — NOT `createOperatorGuard`, which 401s non-operators; socket address via `request.socket.remoteAddress`, recorded as the pending remote address; `unencrypted` from the socket; live `pairing.acceptLanRequests`; limiter + manager), add it to `PUBLIC_PAIRING_PREFIXES`, add the per-reason refusal throttle with timer flush; verify test-plan #E19 #E20 #X1 #X2 and the existing pairing route + auth-plugin suites pass; update the `pairing-routes.ts` row / sidecar
- [x] 5.2 Accept `pairing.acceptLanRequests` (boolean only) on the existing `PUT /api/config` route with its authority unchanged; verify test-plan #E23 passes
- [x] 5.3 Add optional `tier` to `POST /api/pair/approve-pending` (validated with `isTier`; invalid → 400, pending unchanged; absent → `operate`); verify test-plan #E21 passes
- [x] 5.4 Make the `/api/device-session` cookie drop `Secure` only for a direct plain-http peer outside `isLoopbackRange`, else keep the global `isSecure()` (spec `bearer-device-auth`); verify test-plan #E22 passes; update the `bearer-auth.ts` row in `packages/server/src/auth/AGENTS.md`

## 6. Client — approval dialog

- [x] 6.1 Mockup board `mockups/knock-pairing.html` + `mockups/ui-plan.md` delivered under this change (ui-plan decisions D1–D18; ui-plan IDs are distinct from design.md IDs, so tasks cite them as "ui-plan Dn")
- [x] 6.2 Implement board section 1 / ui-plan D1–D3, D17 in `components/pairing-approval/PairingApprovalDialog.tsx` (address row first in mono, "Says it is" + unverified note, warning callout before the code field, tier group reusing `TIER_OPTIONS` from `components/connectivity/PairedDevicesSection.tsx`, test ids `pairing-dialog-unencrypted` / `pairing-dialog-says` / `pairing-dialog-tier`) and optional `tier` in `lib/pairing/pairing-approval-api.ts` `approvePending`; theme tokens only; verify test-plan #E28 passes; update `components/pairing-approval/AGENTS.md` and `lib/pairing/AGENTS.md`

## 7. Client — request landing, Gateway, banner, shared pairing

- [x] 7.1 Implement request mode in `components/connectivity/PairLanding.tsx` (+ `lib/pairing/pairing-api.ts` `requestAccess()`) matching board section 2 state-for-state with the ui-plan copy table: same-origin knock without challenge, grouped code, countdown, no Cancel (ui-plan D8), session-storage resume, immediate poll on `visibilitychange`, missed-outcome copy, refusal map; verify test-plan #F1–#F7 #X3 pass; update `PairLanding.tsx.AGENTS.md`
- [x] 7.2 Change `finishDevicePairing` (`lib/pairing/device-auth.ts`) to clear the stored bearer only after a cookie-only authenticated `/api/` request succeeds, else keep it and surface the "couldn't keep its access" message (QR and knock); verify test-plan #F8 and the existing QR landing tests pass; update `device-auth.ts.AGENTS.md`
- [x] 7.3 Add the "Devices on this network" panel to `components/Gateway/GatewayPairQR.tsx` per ui-plan D11/D16 (switch button with On/Off word, `--accent-solid` on-fill, ≥32 px / 44 px below `sm`; while on, Copy rows for `kind: "lan"` endpoints + `/pair?request`) writing `pairing.acceptLanRequests` through the existing config save path, and change `NoSecureRoadBlock` copy per ui-plan D12; verify test-plan #E24 #E25 pass; update `components/Gateway/AGENTS.md`
- [x] 7.4 Add provenance to `components/Gateway/WaitingDevices.tsx` per ui-plan D13 (existing test ids kept); verify test-plan #E26 passes; update its row
- [x] 7.5 Add "Request access" to the "Network not allowed" surface in `ConnectionStatusBanner.tsx` (most prominent; same origin → `/pair?request`; remote active server → its own `/pair?request` with `noopener`) and restyle that surface from the Tailwind amber palette to `--severity-warning-*` tokens with an icon and a wrapping, verbatim server hint (ui-plan D15, D18); verify test-plan #F9 passes and `node scripts/theme-token-guard.mjs` reports no new violation; update its row
- [x] 7.6 Add a `randomUuid()` helper (native `crypto.randomUUID`, else RFC 4122 v4 from `crypto.getRandomValues`) and move every secure-context API hit in `packages/client/src` and `packages/client-utils/src` (`grep -rn 'crypto\.randomUUID\|crypto\.subtle\|navigator\.clipboard'`, ~20 sites incl. `SettingsPanel.tsx:596`, `ModelProxySection.tsx:241`, `plugin-row-parts.tsx:94`, `GatewayPairQR.tsx:262`, `useSessionActions.ts:73-77`) behind it or `lib/util/clipboard.ts`; add a `crypto.subtle` capability check to `client-utils/src/identity/dpop.ts` (design D17); verify test-plan #E29 #E30 #E31 pass

## 8. Client — Network Discovery Connect and native helper

- [x] 8.1 Add Connect to remote rows in `components/connectivity/NetworkDiscoverySection.tsx` (board section 4, ui-plan D14; `BTN_SMALL` + open-in-new icon before Add / Already added; actions wrap below the name on narrow widths); verify test-plan #E27 passes; update its `.AGENTS.md`
- [x] 8.2 Implement `lib/pairing/knock.ts` `knockServer(baseUrl, expectedFingerprint, name, hooks)` (design D11); verify test-plan #E32 passes; add its row to `lib/pairing/AGENTS.md`

## 9. Integration and review

- [x] 9.1 Run the full suite (`set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`) and `npm run quality:changed`; restart the server (`POST /api/restart`) and build the client; verify green
- [x] 9.2 `Audit` subagent pass on the diff (unauthenticated prompt-raising route, peer-address admission, cleartext bearer, cookie `Secure` change, log redaction) and `review-code`; resolve findings
- [x] 9.3 DocScribe: add knock pairing to `docs/` (pairing flow, `pairing.acceptLanRequests`, the design D8 threat model, the bridge-networked container caveat from design Risks) and a FAQ entry "Pair a LAN device without TLS"; verify rows applied
- [x] 9.4 Record the follow-ups: (a) a change adding the `request-access` remedy to `operate-required-remedy` per design D10 once `surface-operate-required-remedy` archives, carrying a MODIFIED `trust-and-credential-boundaries` delta for the disclosure exception; (b) the non-secure-context audit of plugin client bundles (design D17); verify each change directory exists or the items are in the priority queue

<!-- Folded from test-plan.md by plan-proposal. One task per manifest row; write each failing before its implementation task. -->
## 10. L1 — server and shared (vitest)

- [x] 10.1 Test config field parsing — see `packages/shared/src/__tests__/config-host-gate.test.ts` for harness glue; new `config-pairing.test.ts` — `acceptLanRequests` absent / `true` / `"yes"` · shared config loader · `false` / `true` / `false` (test-plan #E1)
- [x] 10.2 Test IPv6 parsing — see `packages/server/src/__tests__/localhost-guard.test.ts` — `fe80::a1b2%en0`, `::ffff:192.168.16.31`, `fd12:3456:789a:1::10`, `::1`, `not-an-ip` · parse · zone stripped, IPv4 unwrapped, expanded, loopback, `null` (test-plan #E2)
- [x] 10.3 Test on-link private decision table — see `localhost-guard.test.ts` — interfaces `192.168.16.204/24`, `fe80::1%en0/64`, `fd12::1/64` × 10 peers · `isOnLinkPrivate` · true, false, false, false, false, false, true, true, true, false (test-plan #E3)
- [x] 10.4 Test source keys — see `localhost-guard.test.ts` — /64 neighbours, zoned link-local, IPv4 · `knockSourceKey` · distinct keys, `fe80::a1b2`, `192.168.16.31` (test-plan #E4)
- [x] 10.5 Test Host admission gate — see `packages/server/src/__tests__/host-gate-config-api.test.ts` for host-gate setup; new `pairing/__tests__/knock-admission.test.ts` — report mode, `Host: evil.test`, LAN peer, switch on · `admitKnock` · `403 host_not_admitted`, no pending (test-plan #E5)
- [x] 10.6 Test forwarding-header and loopback refusals — see `knock-admission.test.ts` — four peer/header combos · `admitKnock` · `knock_not_lan` ×3, admitted ×1 (test-plan #E6)
- [x] 10.7 Test disabled by default — see `knock-admission.test.ts` — no `acceptLanRequests`, LAN peer · `admitKnock` · `403 knock_disabled` (test-plan #E7)
- [x] 10.8 Test off-link caller never sees toggle state — see `knock-admission.test.ts` — switch off, peer `203.0.113.9` · `admitKnock` · `knock_not_lan` (test-plan #E8)
- [x] 10.9 Test per-source window — see `knock-admission.test.ts` — 5 then 6 admitted (approved) knocks; 10 refusals then flip on · `admitKnock` · 6th `429` + `retryAfter`; refusals not counted (test-plan #E9)
- [x] 10.10 Test cooldown paths — see `knock-admission.test.ts` — deny 5 s ago / lockout / approve / expiry · re-knock · `429` / `429` / admitted / admitted (test-plan #E10)
- [x] 10.11 Test live definition — see `knock-admission.test.ts` — live, denied-pollable, expired-unswept · `liveKnocks()` + re-knock · `409` only for live (test-plan #E11)
- [x] 10.12 Test global caps — see `knock-admission.test.ts` — 3 live from 3 sources; 10 admitted-then-denied from 10 sources · 4th / 11th knock · `503 knock_busy` + `retryAfter` (test-plan #E12)
- [x] 10.13 Test IPv6 neighbours do not collide — see `knock-admission.test.ts` — live from `…:1::10` · knock from `…:1::22` · admitted (test-plan #E13)
- [x] 10.14 Test name normalisation — see `packages/server/src/__tests__/pairing.test.ts` — 200 chars, 63 + 4-byte emoji, U+202E, ZWSP, blank, `123` · `knock()` → `listPending()` · ≤64 B, 63 B, stripped, `ab`, absent, absent; all admitted (test-plan #E14)
- [x] 10.15 Test name never authorizes — see `knock-admission.test.ts` — same state, name absent vs spoofing name · `admitKnock` · identical result (test-plan #E15)
- [x] 10.16 Test knock lifecycle — see `pairing.test.ts` — admitted knock · knock / approve / poll / deny / 5 wrong codes · 8 digits, ≈300 s, one hint; bearer once; `rejected`; `locked_out` (test-plan #E16)
- [x] 10.17 Test pending feed provenance — see `pairing.test.ts` — QR + unencrypted named knock · `listPending()` · `qr` / `knock` + name + `unencrypted`; no codes (test-plan #E17)
- [x] 10.18 Test resolution callbacks — see `pairing.test.ts` — deny / lockout / match / sweep · observe `onKnockResolved` · `denied` / `locked_out` / `approved` / `expired` with `sourceKey` (test-plan #E18)
- [x] 10.19 Test admitted knock route — see `packages/server/src/__tests__/pairing-approval-dialog.test.ts` for route + guard glue; new `pair-request-route.test.ts` — switch on, untrusted LAN socket peer, no credential · `POST /api/pair/request` · `200 {pendingId, confirmCode, expiresAt, fingerprint}`, never `network_not_allowed`, remote address = socket peer, `unencrypted: true` (test-plan #E19)
- [x] 10.20 Test route preconditions — see `pair-request-route.test.ts` — foreign `Origin`; `text/plain` · `POST /api/pair/request` · `403 untrusted origin`; `415`; no pending, no hint (test-plan #E20)
- [x] 10.21 Test approve-pending tier — see `pairing-approval-dialog.test.ts` — `observe` / `admin` / `123` / absent · `POST /api/pair/approve-pending` · tier `observe`; 400 pending; 400 pending; `operate` (test-plan #E21)
- [x] 10.22 Test device cookie `Secure` matrix — see `packages/server/src/__tests__/bearer-auth.test.ts` — four base/peer/socket combos · `POST /api/device-session` · no / yes / yes / no `Secure`; first cookie authenticates the next inject (test-plan #E22)
- [x] 10.23 Test config route toggle — see `packages/server/src/__tests__/config-api.test.ts` — `true`; `"yes"` · `PUT /api/config` then knock · accepted + next knock passes `knock_disabled` without restart; non-boolean rejected (test-plan #E23)
- [x] 10.24 Test admission log redaction — see `pair-request-route.test.ts` (console spy) — named knock from `192.168.16.31` · admit · one `knock admitted id=<8>` line; no code, name, address, UA (test-plan #X1)
- [x] 10.25 Test refusal throttle and flush — see `pair-request-route.test.ts` with fake timers — 100 `knock_disabled` in 60 s then silence · advance 60 s · one line in window; `suppressed=99` at window end; reasons independent (test-plan #X2)

## 11. L1 — client (vitest + Testing Library)

- [x] 11.1 Test Gateway panel — see `packages/client/src/components/Gateway/__tests__/GatewayPairQR.test.tsx` — `local` / `lan` / `public` endpoints, switch off then on · render · Off word + `aria-checked=false`, no URL; On: one `http://192.168.16.204:8000/pair?request` row with Copy (test-plan #E24)
- [x] 11.2 Test no-secure-road copy — see `GatewayPairQR.test.tsx` — `noSecureRoad` · render · no "cannot pair"; points to the switch (test-plan #E25)
- [x] 11.3 Test waiting-list provenance — see `GatewayPairQR.test.tsx` for store seeding; new `Gateway/__tests__/WaitingDevices.test.tsx` — unencrypted named knock + QR · render · pills, address, says, Unencrypted, Review `aria-label`s, test ids intact (test-plan #E26)
- [x] 11.4 Test discovery Connect — see `components/connectivity/__tests__/NetworkDiscoverySection.test.tsx` — remote IPv4, remote IPv6, local · click Connect · `window.open(url, _, "noopener")` with bracketed IPv6; none on local; accessible name (test-plan #E27)
- [x] 11.5 Test knock approval dialog — see `components/pairing-approval/__tests__/PairingApprovalDialog.test.tsx` — knock entry vs QR entry · render, pick Observe, submit · title, Says it is, prefill, callout before code, tier default + consequence switch, `approvePending` tier `observe`; QR unchanged (test-plan #E28)
- [x] 11.6 Test UUID fallback — see `packages/client/src/lib/pairing/__tests__/single-encoder.test.ts` for pure-helper layout; new `lib/util/__tests__/random-uuid.test.ts` — `crypto.randomUUID` undefined · `randomUuid()` ×1000 + `spawn_session` dispatch · v4 regex, distinct, dispatch carries one (test-plan #E29)
- [x] 11.7 Test secure-context source scan — see `components/connectivity/__tests__/connectivity-token-scan.test.ts` for scan glue; new `secure-context-scan.test.ts` — `packages/client/src` + `packages/client-utils/src` · scan · zero hits outside the allowlist (test-plan #E30)
- [x] 11.8 Test DPoP capability check — see `packages/client-utils/src/identity` sibling tests — `crypto.subtle` undefined · DPoP entry point · reports unavailable, no throw (test-plan #E31)
- [x] 11.9 Test native knock helper — see `lib/pairing/__tests__/device-auth-cookie.test.ts` for fetch mocking; new `knock.test.ts` — fp mismatch / match / response mismatch · `knockServer` · no knock + mismatch error; bearer; rejected (test-plan #E32)
- [x] 11.10 Test landing intro in insecure context — see `packages/client/src/components/__tests__/PairLanding.test.tsx` — `/pair?request` on http, `crypto.subtle` + `randomUUID` undefined · render · host, unencrypted note, primary action, no challenge call, no throw (test-plan #F1)
- [x] 11.11 Test landing waiting — see `PairLanding.test.tsx` — knock `48217730`, `expiresAt` +300 s · Request access · `4821 7730`, countdown, no Cancel, status region (test-plan #F2)
- [x] 11.12 Test landing reload resume — see `PairLanding.test.tsx` — live request in session storage · remount · same code, polling, no second knock; storage cleared on resolution / expiry (test-plan #F3)
- [x] 11.13 Test visibility poll — see `PairLanding.test.tsx` — waiting, timer not due · `visibilitychange` · one immediate poll (test-plan #F4)
- [x] 11.14 Test missed outcome — see `PairLanding.test.tsx` — `unknown` before / after `expiresAt` · poll · "may have been decided" vs "expired", both with Request again (test-plan #F5)
- [x] 11.15 Test refusal map — see `PairLanding.test.tsx` — 8 refusal kinds · Request access · per-code copy; no retry on `knock_not_lan`; disabled `7:00` button; generic for the last three (test-plan #F6)
- [x] 11.16 Test landing approved — see `PairLanding-exchange-order.test.tsx` — poll `approved`, cookie check 200 · poll · bearer stored then cleared; navigate `/` (test-plan #F7)
- [x] 11.17 Test bearer kept until cookie proven — see `lib/pairing/__tests__/device-auth-cookie.test.ts` — exchange 200, cookie check 401, QR and knock paths · `finishDevicePairing` · bearer kept, next call uses `Authorization`, message shown (test-plan #F8)
- [x] 11.18 Test banner Request access — see `packages/client/src/components/__tests__/ConnectionStatusBanner.test.tsx` — hint; same-origin vs remote active server · click · hint kept; `/pair?request` vs `window.open(..., "noopener")`; Settings → Servers kept; no amber classes (test-plan #F9)
- [x] 11.19 Test landing transport failure — see `PairLanding.test.tsx` — knock POST rejects · Request access · error + button re-enabled; nothing stored (test-plan #X3)

## 12. L3 — Playwright E2E (docker harness)

- [x] 12.1 E2E happy path — see `tests/e2e/pairing-approval-dialog.spec.ts` for two-page harness glue (port from `.pi-test-harness.json`); new `tests/e2e/lan-knock.spec.ts` — switch on, page B at `http://<host-ip>:<dashboardPort>/pair?request` · B requests, A types code, approves · A dialog shows B's address; B authenticated on `/` (test-plan #F10)
- [x] 12.2 E2E disabled — see `lan-knock.spec.ts` — switch off · B Request access · `knock_disabled` copy; no dialog on A (test-plan #F11)
- [x] 12.3 E2E deny — see `lan-knock.spec.ts` — switch on · A denies, B requests again · "declined", then rate-limited copy with countdown (test-plan #F12)
- [x] 12.4 E2E tier observe — see `lan-knock.spec.ts` + `tests/e2e/pairing-qr.spec.ts` for Paired devices glue — switch on · A picks Observe, approves · Paired devices shows Observe; B's operate-only action refused (test-plan #F13)
- [x] 12.5 E2E remote banner — see `tests/e2e/known-server-stale-name.spec.ts` for known-server setup — page on `localhost`, active known server = same dashboard at host IP (untrusted) · banner Request access · new page `http://<host-ip>:<dashboardPort>/pair?request` (test-plan #F14) — **adapted at implementation**: the harness seed enables OAuth (`bypassUrls:["/"]`) so the real guard cannot answer `network_not_allowed`, and the page CSP admits only its own origin, so the spec simulates the guard's 403 on the page's own `/api/health` (socket + status probe failed → offline) and asserts the same-origin Request access navigation to the server-rendered `/pair?request`; the remote-server `window.open` variant stays pinned at L1 (F9). Found while doing it: `ConnectionStatusBanner` was never mounted in the desktop layout and `App.tsx` never passed `networkDenied`, so `hooks/useNetworkDenied.ts` + a desktop mount were added

## 13. Manual (post-merge)

- [ ] 13.1 Visual fidelity of dialog, landing states, Gateway panel, Connect and banner to `mockups/knock-pairing.html` in base dark, base light, nord dark and at 375 px (test-plan: manual-only, #F15)
- [ ] 13.2 Real two-machine LAN over plain http (Chrome + Safari): Connect → Request access → approve on host, then start a session and use a Copy button on the http origin (test-plan: manual-only, #X4)
