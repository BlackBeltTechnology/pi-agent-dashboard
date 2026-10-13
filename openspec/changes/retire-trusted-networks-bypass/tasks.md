## 0. Prerequisites

- [ ] 0.1 Confirm `add-lan-knock-pairing` and `add-electron-server-windows` are archived under `openspec/changes/archive/` and `openspec/specs/lan-knock-pairing/spec.md` exists; if not, stop and record the blocker (verify: `ls openspec/changes/archive | grep -E 'add-lan-knock-pairing|add-electron-server-windows'` lists both)

## 1. Non-browser consumer audit (design D8)

- [ ] 1.1 Write `openspec/changes/retire-trusted-networks-bypass/audit.md` with one row per consumer (remote bridge `/ws/bridge`, MCP `/mcp`, CLI, model proxy `/v1/*`, browser in-page server switch, Electron server windows): today's LAN admission path, path under `pair`, status `ok | blocker` (verify: file exists; every row cites file:line or a test name)
- [ ] 1.2 Mark every `blocker` row as gating the N+1 flip, or add a task below for it (verify: no unlinked `blocker` row)

## 2. Trust mode (shared + boot decision, design D2)

- [ ] 2.1 Test (L1, see `packages/server/src/__tests__/trusted-networks-config.test.ts`): boot decision table — input no `network.trustMode` with lists `[]`, `["192.168.16.0/24"]`, `["0.0.0.0/0"]`, `["*.*.*.*"]`, `["127.0.0.1","127.0.0.4/30"]`, `["::1"]`, `["localhost"]`, `["nas.local"]` · trigger server boot · observable written mode pair, legacy, legacy, legacy, pair, pair, legacy, legacy with origin `upgrade` (test-plan #E1)
- [ ] 2.2 Test (L1, see `trusted-networks-config.test.ts`): input stored `pair` · trigger add `198.51.100.23` to `auth.bypassHosts` and reboot · observable mode still `pair`, unauthenticated `GET /api/sessions` from `198.51.100.23` → 403 (test-plan #E2)
- [ ] 2.3 Test (L1, see `trusted-networks-config.test.ts`): input stored `trustMode: "open"` · trigger boot + 100 mode reads · observable effective `pair`, origin `null`, exactly one warning naming `"open"`, file bytes unchanged (test-plan #E3)
- [ ] 2.4 Test (L1, see `trusted-networks-config.test.ts`): input invalid-JSON `config.json` · trigger boot · observable file bytes unchanged, effective `legacy`, exactly one `[trusted-networks]` error (test-plan #E4)
- [ ] 2.5 Test (L1, see `trusted-networks-config.test.ts`): input empty list, `writeConfigPartial` throws at boot · trigger HTTP + WS from `192.168.16.20`, then successful `PUT /api/config` `legacy` with list `192.168.16.0/24` · observable fallback `pair` at guard and WS with one error; after PUT the next request is admitted without restart (test-plan #E5)
- [ ] 2.6 Test (L1, see `packages/server/src/__tests__/config-api.test.ts`): input stored `legacy`/`upgrade` · trigger `PUT {network:{trustMode:"pair"}}`, then same mode again, then hand edit without origin · observable origin `operator`, unchanged, reads `operator` (test-plan #E6)
- [ ] 2.7 Test (L1, see `config-api.test.ts`): input config with `network` + `auth.bypassHosts` · trigger partial `{network:{trustMode}}`, partial `{auth:{bypassHosts}}`, `PUT`/`GET` round trip · observable each partial preserves the other block and `trustModeOrigin`; `network` round-trips (test-plan #E7)
- [ ] 2.8 Test (L1, see `trusted-networks-config.test.ts` bind-reachability cases): input `127.0.0.1`, `127.0.0.4/30`, `::1`, `0.0.0.0/0`, `*.*.*.*`, `::/0`, `192.168.16.0/24`, `localhost`, `nas.local` · trigger `isLoopbackOnlyEntry` · observable true ×3, false ×6; existing `gateway-config-ops` tests unchanged (test-plan #E8)
- [ ] 2.9 Implement: `network.trustMode`/`trustModeOrigin` in `packages/shared/src/config.ts` (string passthrough), `resolveTrustMode`, IPv6 loopback in `isLoopbackOnlyEntry` (`bind-reachability.ts`), field-level `network` merge + origin stamping in `writeConfigPartial` (verify: 2.6–2.8 green)
- [ ] 2.10 Implement the boot decision before `listen` (skip on unparseable file → `legacy`; write failure → fallback consulted only while no recognised value is stored) (verify: 2.1–2.5 green)

## 3. Admission list and the five sites (server, design D1/D3)

- [ ] 3.1 Test (L1, see `packages/server/src/__tests__/localhost-guard.test.ts`, `auth-plugin.test.ts`, `authorize-ws-upgrade.test.ts`, `route-tier-gate.test.ts`): input listed peer `192.168.16.20`, no credential, modes pair/legacy · trigger universal hook, per-route guard, OAuth skip, WS auth-on, WS auth-off, observe bearer `POST /api/restart` · observable pair: 403, 403, auth required, 401, 403, 403 `insufficient_scope`; legacy: admitted, admitted, skipped, 101, 101, not refused (test-plan #E9)
- [ ] 3.2 Test (L1, see `localhost-guard.test.ts`, `authorize-ws-upgrade.test.ts`): input legacy + listed peer · trigger write `pair` then next HTTP + ticketless WS; write `legacy` then repeat · observable denied/rejected then admitted, no restart (test-plan #E10)
- [ ] 3.3 Test (L1, see `auth-plugin.test.ts`, `authorize-ws-upgrade.test.ts`): input legacy, auth on, bypass host `192.168.16.0/24` · trigger valid session cookie; expired session cookie; ticketed `/ws` · observable `authVia = "session"`; no cookie-clearing `Set-Cookie`; ticket consumed + 101 (test-plan #E11)
- [ ] 3.4 Test (L1, see `forwarded-ip-trust.test.ts`): input `127.0.0.0/8` listed, peer `127.0.0.1` + `X-Forwarded-For` · trigger HTTP + WS in both modes · observable 403 / rejected in both (test-plan #E12)
- [ ] 3.5 Test (L1, see `packages/server/src/__tests__/trusted-source-single-predicate.test.ts`): input server source tree · trigger static scan · observable fails when an admission site passes a raw list; only `cors-origin.ts`, WS origin gate, `noteTrustedList`, bind advisory, knock gate exempt by name (test-plan #E13)
- [ ] 3.6 Test (L1, see `localhost-guard.test.ts`): input the same denied request in pair and legacy · trigger guard denial · observable byte-identical bodies; `hint` mentions neither `trustedNetworks` nor the mode (test-plan #E14)
- [ ] 3.7 Implement live `admissionTrustedNetworks()` and route every site through it per request (`hasNetworkPassCondition`, `tierRefusalFor`, auth-plugin skip without `authState.bypassHosts`, `validateWsUpgrade`/`authorizeWsUpgrade`, `server.ts` WS handler replacing the boot `config.resolvedTrustedNetworks`); credential-first ordering (session before bypass skip, no cookie clearing on bypass hosts; ticket/cookie before trusted; identity floor first); mode-neutral hint (verify: 3.1–3.6 green; existing auth/guard/WS suites green)

## 4. Network-only telemetry and health (design D4)

- [ ] 4.1 Test (L1, new `network-trust-telemetry.test.ts`, see `tunnel-block-events.test.ts` for the fake-clock pattern): input legacy, listed peer · trigger unauthenticated `GET /api/sessions` (per-route + universal guard), device-cookie request, session request, ticketed WS, ticketless WS · observable count +1, +0, +0, +0, +1 (test-plan #E15)
- [ ] 4.2 Test (L1, `network-trust-telemetry.test.ts`): input fake clock, 256 peers with the oldest re-seen 1 min ago · trigger 257th peer; peer last seen 7 d + 1 ms ago; 50 admissions in 59 min then one at 61 min · observable re-seen kept and LRU evicted; stale peer gone; one log line then a second (test-plan #E16)
- [ ] 4.3 Test (L1, see `packages/server/src/__tests__/health-access-grants.test.ts`): input legacy with 2 network-only peers · trigger `/api/health` from local, authenticated, network-admitted LAN, remote unauthenticated · observable `trustPosture` object, object, `null`, `null`; `distinctPeers: 2`; no IP string in any body (test-plan #E17)
- [ ] 4.4 Implement `network-trust-telemetry.ts` (per-request marker, single WS attribution point) and the `/api/health` `trustPosture` fields behind `canDiscloseAccessPosture` only (verify: 4.1–4.3 green)

## 5. Network-denial plane (design D6)

- [ ] 5.1 Test (L1, see `packages/server/src/__tests__/network-denial-queue.test.ts`): input pair, prompting on, operator channel · trigger denial from `192.168.16.30`; `POST /api/tunnel/block-events` accept; a CORS denial · observable block event recorded, no network prompt; 403 with config unchanged; CORS prompt raised (test-plan #E18)
- [ ] 5.2 Implement: gate the network-denial observer, `createNetworkPlane` allow-always and the block-events accept route on `legacy` (verify: 5.1 green)

## 6. Live preview capability path and credential stripping (design D5)

- [ ] 6.1 Test (L1, see `packages/server/src/__tests__/live-server-endpoint.test.ts`): input target `vite-5173`, principals observe/control, unknown id `nope` · trigger `POST /api/live-server/:id/capability` · observable 403 no token; 200 `{path:"/live/vite-5173/~c/<t>/", expiresAt = now+12h}` with `<t>` ≥ 22 base64url chars; 404; store holds only a hash (test-plan #E20)
- [ ] 6.2 Test (L1, see `live-server-endpoint.test.ts`): input valid token for `vite-5173` · trigger paths valid; `/live/docs-8080/~c/<t>/`; `<t>evil/`; `%7Ec`; `x/../~c/<t>/`; no trailing `/`; `/api/sessions?c=<t>` · observable only the first admitted (test-plan #E21)
- [ ] 6.3 Test (L1, see `live-server-endpoint.test.ts` + `tunnel-block-events.test.ts` fake clock): input valid token · trigger use at 29:59 idle; 30:00 idle; continuous use to 12 h − 1 ms; 12 h · observable admitted (extends); refused; admitted; refused (test-plan #E22)
- [ ] 6.4 Test (L1, see `live-server-endpoint.test.ts`, `paired-devices.test.ts`): input tokens minted by device A and by session S · trigger remove target; revoke device A; log out S; restart store · observable each next use refused (test-plan #E23)
- [ ] 6.5 Test (L1, see `authorize-ws-upgrade.test.ts`): input identity floor enforced/not × token minted by device / identity principal · trigger `/live/vite-5173/~c/<t>/ws` upgrade · observable enforced+device refused; enforced+identity 101; not enforced+device 101 (test-plan #E24)
- [ ] 6.6 Test (L1, new `live-server-proxy.test.ts`, see `live-server-endpoint.test.ts`; real upstream echo): input GET under capability with `Referer` containing `<t>`; upstream 302 `/login`, `./x`, `http://127.0.0.1:5173/y`; responses with/without own `Referrer-Policy` · trigger proxy · observable upstream path + `Referer` without `/~c/<t>`; `Location` inside the capability prefix ×3; `Referrer-Policy: no-referrer` only when absent; captured logs contain no `<t>` (test-plan #E25)
- [ ] 6.7 Test (L1, `live-server-proxy.test.ts`; HTTP + WS upstream echo): input `Cookie: pi_dash_token=a; pi_dash_device=b; myapp_session=c`; `Cookie: pi_dash_token=a`; `Authorization` device bearer / app token; upstream `Set-Cookie: pi_dash_token=x` + `myapp_session=y` · trigger proxy (HTTP and upgrade) · observable upstream `Cookie: myapp_session=c`; no `Cookie` header; device bearer removed / app token kept; browser receives only `myapp_session` (test-plan #E26)
- [ ] 6.8 Test (L1, see `ws-upgrade-routing.test.ts`): input valid capability token · trigger `/ws`, `/ws/terminal/x`, `/ws/bridge` presenting it in path or query · observable all rejected (test-plan #E27)
- [ ] 6.9 Test (L1, see `live-server-proxy.test.ts`): input upstream for `vite-5173` stopped · trigger GET under a valid capability · observable same error status as today's `/live/<id>/` for a down target; token absent from the logged error (test-plan #X1)
- [ ] 6.10 Implement `LiveCapabilityStore`, the mint route (route→tier map `control`), the capability `onRequest` hook before the universal guard, the `live`-scope branch in `authorizeWsUpgrade` (incl. identity-ticket-only branch), invalidation calls (target removal, device revoke, session end/passkey-user revoke), proxy path/`Referer`/redirect rewriting, `Referrer-Policy`, `Set-Cookie` filtering, credential stripping in `forward` + `handleLiveServerUpgrade`, log redaction (verify: 6.1–6.9 green)

## 7. Knock eligibility (design D7)

- [ ] 7.1 Test (L1, see `packages/server/src/__tests__/pairing.test.ts`): input `acceptLanRequests` on/off; lists `198.51.100.0/24`, `0.0.0.0/0`, `127.0.0.0/8` · trigger knocks from `198.51.100.7`; `203.0.113.9` unlisted; listed + `X-Forwarded-For`; `0.0.0.0/0` + `203.0.113.9`; `127.0.0.1` + XFF; setting off · observable pending device with no bearer until approval; address-gate code ×4; setting-disabled code (test-plan #E19)
- [ ] 7.2 Implement the knock list branch: no forwarding header + raw list minus match-all entries (verify: 7.1 green; existing knock tests green)

## 8. Client (mockups/network-trust.html)

- [ ] 8.1 Test (L1, see `packages/client/src/components/__tests__/SettingsPanel.test.tsx`): input saved `legacy` · trigger open Security, add an entry, select Pair, Save · observable "Trust whole networks" stays checked after the add; no write before Save; Save body has `network.trustMode: "pair"` (test-plan #F1)
- [ ] 8.2 Test (L1, `SettingsPanel.test.tsx`): input saved legacy, draft pair × `distinctPeers` 3 / 0 / posture `null` × `acceptLanRequests` on/off · trigger render, check box, Save · observable "3 device addresses" / no count / generic copy; operate-tier + in-page notes; checkbox only when off and unchecked; checked + Save writes `pairing.acceptLanRequests: true` (test-plan #F2)
- [ ] 8.3 Test (L1, `SettingsPanel.test.tsx`): input pair / legacy with and without migration callout · trigger render · observable pair heading "Networks that may request access", no full-access warning; legacy heading "Trusted networks — admitted without sign-in", warning only without migration callout; wide copy per mode (test-plan #F3)
- [ ] 8.4 Test (L1, `SettingsPanel.test.tsx`): input pair, block events `192.168.16.31` and `198.51.100.23` · trigger render, click allow-requests · observable info row with no `block-event-trust-*` testid; draft `auth.bypassHosts` gains exactly `198.51.100.23` (test-plan #F4)
- [ ] 8.5 Test (L1, `SettingsPanel.test.tsx`): input pair + `acceptLanRequests` off; stored `"open"` · trigger render · observable info callout with control; Pair checked + warning naming `"open"` (test-plan #F5)
- [ ] 8.6 Test (L1, `SettingsPanel.test.tsx`): input legacy with advisory, migration callout, refused peers, entries · trigger render · observable DOM order radio → callout → heading → advisory → refused rows → list → add → warning (test-plan #F6)
- [ ] 8.7 Test (L1, see `packages/client/src/components/settings/__tests__/access-page-composition.test.tsx`, `AccessPromptsSection.test.tsx`): input (legacy, upgrade, 3) / (legacy, operator, 1) / (pair) / (legacy, posture null); pending CORS + network denial in pair · trigger render Access · observable warning / info / none / none; headings by mode; only revoke buttons; no network pending row in pair, CORS row answerable (test-plan #F7)
- [ ] 8.8 Test (L1, see `packages/client/src/components/__tests__/ConnectionStatusBanner.test.tsx`): input `networkDenied` + knock idle / pending / refused `knock_disabled` · trigger render, click Request access · observable Request access primary + Settings → Servers secondary; pending text with code; refusal reason; no `amber-` classes (test-plan #F8)
- [ ] 8.9 Test (L1, see `packages/client/src/components/editor-pane/__tests__/LiveServerViewer.test.tsx`, fake timers): input mint returns `expiresAt = t0+12h` · trigger open viewer, advance to 11:49:59, to 11:50:00, close + reopen · observable iframe `src` = capability path with unchanged sandbox tokens; no re-mint at 11:49:59; new mint + new `src` at 11:50:00; reopen mints again (test-plan #F9)
- [ ] 8.10 Implement Security ▸ Network access, Access headings/banner/pending rules, network-denied bar and `LiveServerViewer` capability framing per mockup A1–A4, B1–B3, C1–C3; `network` in the field-to-page map and `computeConfigPartial`; existing testids kept (verify: 8.1–8.9 green)
- [ ] 8.11 Theme parity: `node scripts/theme-token-guard.mjs` reports no new violation (verify: guard output in the PR)

## 9. End-to-end (docker harness)

- [ ] 9.1 Test (L3, see `tests/e2e/network-guard.spec.ts`): input harness with `network.trustMode: "pair"` and a list covering the harness client network · trigger open the dashboard from the Playwright browser (non-loopback peer), then `PUT network.trustMode: "legacy"` via the local admin path and reload · observable denied bar with Request access and guarded API 403; after the switch the sessions list loads without a server restart (test-plan #F10)
- [ ] 9.2 Test (L3, see `tests/e2e/live-server-downloads.spec.ts` + `tests/e2e/pairing-qr.spec.ts`; extend the live fixture target with script + image + `fetch` + WS echo): input harness in pair mode, browser paired at `control` · trigger open the target in the live viewer · observable network log shows page, script, image, fetch 2xx and WS 101 under `/live/<id>/~c/…/`; fixture upstream saw no `pi_dash_*` cookie (test-plan #F11)

## 10. Docs and release

- [ ] 10.1 Delegate to DocScribe: README + `docs/faq.md` LAN access (pair instead of trusting a network; `network.trustMode` + origin; live capability path; rollback) (verify: `grep -n trustMode README.md docs/faq.md` hits)
- [ ] 10.2 CHANGELOG `## [Unreleased]` entry flagged **BREAKING** for installs that choose `pair` with a list; note boot decision and rollback (verify: entry present)
- [ ] 10.3 Update `AGENTS.md` rows for touched files and the stale `bind-reachability.ts` comment ("both feed the runtime guard") with `See change: retire-trusted-networks-bypass` (verify: each touched file's AGENTS row names the change)

## 11. Verification

- [ ] 11.1 Full suite: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` green (verify: summary shows 0 failed)
- [ ] 11.2 Run `review-code` on the diff and the `Audit` subagent (auth boundary change) before commit (verify: no unresolved blocking findings)
- [ ] 11.3 Manual: compare Security, Access and the denied bar with `mockups/network-trust.html` in base dark, base light and nord dark (test-plan: manual-only, #F12)
- [ ] 11.4 Manual: a LAN phone paired at `control` previews a Vite target and an edit hot-reloads without refresh (test-plan: manual-only, #F13)
- [ ] 11.5 Manual: upgrade a real install with a LAN `auth.bypassHosts`; confirm `config.json` gains `legacy`/`upgrade`, a LAN phone keeps working, and Access counts it (test-plan: manual-only, #X2)
