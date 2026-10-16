## 1. Step engine (pure, TDD) — `packages/client/src/lib/remote-access/`

- [ ] 1.1 Write L1 test `lib/remote-access/__tests__/steps.test.ts` (see `packages/client/src/lib/__tests__/gateway-connection.test.ts`): zrok primary, readiness disconnected, reservedName set, not degraded, not connected · `planTask("share")` · current = connect, first four rows skipped, k=5 n=6 (test-plan #E1)
- [ ] 1.2 Write L1 test in `steps.test.ts` (see `lib/__tests__/gateway-connection.test.ts`): readiness not-installed / not-set / disconnected / connected · evaluate install + enable · install sat F,T,T,T and enable sat F,F,T,T (test-plan #E2)
- [ ] 1.3 Write L1 test in `steps.test.ts` (see `lib/__tests__/gateway-connection.test.ts`): trusted entries `[]`, `127.0.0.1+::1`, `::1/128`, `127.0.0.0/1`, `0.0.0.0/0`, `*.*.*.*`, `localhost`, `192.168.16.0/24`+GitHub enabled · evaluate door · sat T,T,T,F,F,F,F,F (test-plan #E3)
- [ ] 1.4 Write L1 test in `steps.test.ts` (see `lib/__tests__/gateway-connection.test.ts`): resolvedBindHost 127.0.0.1 / localhost / ::1 / 0.0.0.0 / :: / 192.168.16.220 · evaluate bind · sat F,F,F,T,T,T (test-plan #E4)
- [ ] 1.5 Write L1 test in `steps.test.ts` (see `lib/__tests__/gateway-connection.test.ts`): (resolved, pending, acceptLan) four combos · `roads(snap).lan` · Off / Restart pending / Listening, but requests are off / On "all networks (0.0.0.0)" (test-plan #E5)
- [ ] 1.6 Write L1 test in `steps.test.ts` (see `lib/__tests__/gateway-connection.test.ts`): (provider, reservedName, degraded, persistent) five combos · plan share · skipped / current+degraded / current / skipped (temporary) / absent with n=5 (test-plan #E6)
- [ ] 1.7 Write L1 test in `steps.test.ts` (see `lib/__tests__/gateway-connection.test.ts`): rows [skipped,skipped,current], [skipped,current], [skipped,done,current], then showSkipped · render plan · "2 steps already set" fold / single row unfolded / "2 steps done" / 2 rows (test-plan #E7)
- [ ] 1.8 Write L1 test in `steps.test.ts` (see `lib/__tests__/gateway-connection.test.ts`): internet https on / lan on / lan listening-only / none · plan device · road sat https / sat LAN / unsat / unsat (test-plan #E8)
- [ ] 1.9 Write L1 test in `steps.test.ts` (see `lib/__tests__/gateway-connection.test.ts`): no road, branch wifi then anywhere, inserted steps later satisfied · plan device · wifi = road,bind,accept,qr,approve; anywhere = road,provider,install,enable,address,connect,qr,approve (no door); inserted rows remain (test-plan #E9)
- [ ] 1.10 Write L1 test in `steps.test.ts` (see `lib/__tests__/gateway-connection.test.ts`): config field loading / error · evaluate bind + accept · satisfied `unknown`, label "Checking…" / "unknown" (test-plan #E10)
- [ ] 1.11 Write L1 test in `steps.test.ts` (see `lib/__tests__/gateway-connection.test.ts`): resolved Approve completion — paired ids before [a], after [a,b] / [a,b,c] / [a] · pending id leaves list · "‹b› is paired" / "2 devices paired" / "denied or expired" (test-plan #E13)
- [ ] 1.12 Run the §1 tests and verify they fail (red), then implement `lib/remote-access/steps.ts` (`STEPS`, task lists, `roads()`, `planTask()`, `approveOutcome()`; loopback-only = `isLoopbackOnlyEntry` + `::1`/`::1/128`, no server change) until §1 is green; verify `npm test -- remote-access`

## 2. Indicator, snapshot, readiness poll

- [ ] 2.1 Write L1 test in `packages/client/src/lib/__tests__/gateway-connection.test.ts` (extend it): six (tunnel states, bind) combos · `remoteAccessIndicator()` · red / amber / green / blue "listening on the network" / grey "this computer only" / grey + "network status unknown" (test-plan #E11)
- [ ] 2.2 Implement `remoteAccessIndicator()` in `lib/gateway/gateway-connection.ts` until 2.1 passes; verify `npm test -- gateway-connection`
- [ ] 2.3 Write L1 test `lib/remote-access/__tests__/use-readiness-poll.test.ts` (see `packages/client/src/lib/__tests__/readiness-poll.test.ts` + fake timers in `components/Gateway/__tests__/GatewayReadinessBoard.test.tsx`): landing 60 s, provider step 12 s with first evaluation resolving at 7 s, back to landing · count readiness calls · 1 on open, 0 on landing, 5 s tick skipped while in flight, 10 s fires, +1 on return (test-plan #P1)
- [ ] 2.4 Implement `useReadinessPoll(active)` over `lib/gateway/readiness-poll.ts` and switch `GatewayReadinessBoard` to an `active` prop; verify 2.3 and existing `GatewayReadinessBoard.test.tsx` pass
- [ ] 2.5 Write L1 test `lib/remote-access/__tests__/use-remote-access-snapshot.test.tsx` (see `components/__tests__/TunnelButton.test.tsx` fetch mocking): config response delayed 300 ms · open dialog · LAN row loading, never "Off", converges (test-plan #F5)
- [ ] 2.6 Write L1 test in `use-remote-access-snapshot.test.tsx` (see `components/__tests__/TunnelButton.test.tsx`): `GET /api/config` 500 then 200 · open + click retry · rows "unknown" + retry, then loaded values (test-plan #X7)
- [ ] 2.7 Implement `useRemoteAccessSnapshot(open)` (config + status-detail + readiness on open and on landing return, `reachability_updated` + `pairingApprovalStore` subscriptions, re-read after writes) until 2.5–2.6 pass

## 3. Reused sections + GatewayPage

- [ ] 3.1 Write L1 test `components/Gateway/__tests__/GatewayPage.sections.test.tsx` (see `components/Gateway/__tests__/Gateway.test.tsx`): render `GatewayPage` with a connected non-primary and degraded zrok · mount · readiness rows, `gateway-make-primary-*`, reserved-name input and `gateway-degraded-banner` present (test-plan #F11)
- [ ] 3.2 Compose `GatewayReadinessBoard` (`active` = mounted), `GatewayReservedName`, `GatewayDegradedBanner` into `GatewayPage`; add `showProviderActions` prop to the board; verify 3.1 and existing Gateway tests pass
- [ ] 3.3 Split `GatewaySetupGuide` into per-step blocks still composed by the guide; extract the `acceptLanRequests` switch panel from `GatewayPairQR`; add an https-only endpoint filter to `GatewayPairQR`; verify `GatewayPairQR.test.tsx` and `Gateway.test.tsx` pass unchanged

## 4. Remote access dialog

- [ ] 4.1 Write L1 test `components/remote-access/__tests__/RemoteAccessDialog.test.tsx` (see `components/Gateway/__tests__/Gateway.test.tsx`): Public address skipped · click its row · expands as current showing `robson-home` (test-plan #F4)
- [ ] 4.2 Write L1 test in `RemoteAccessDialog.test.tsx` (see `components/Gateway/__tests__/Gateway.test.tsx`): Listen on network current, trusted `192.168.16.0/24` · render · all-networks / unencrypted / restart / `192.168.16.0/24` text precedes primary button in DOM order (test-plan #F3)
- [ ] 4.3 Write L1 test in `RemoteAccessDialog.test.tsx` (see `components/pairing-approval/__tests__/PairingApprovalHost.test.tsx`): dismissed pending request · click Review on landing callout and in Approve step · `pairingApprovalStore.preferred === pendingId`, not dismissed (test-plan #F8)
- [ ] 4.4 Write L1 test in `RemoteAccessDialog.test.tsx` (see `components/__tests__/TunnelButton.test.tsx`): Internet On · click "All network settings" / Disconnect · dialog closes + location `/settings/gateway` / `POST /api/tunnel-disconnect` then Internet Off (test-plan #F10)
- [ ] 4.5 Write L1 test in `RemoteAccessDialog.test.tsx` (see `components/Gateway/__tests__/Gateway.test.tsx`): primary none / zrok disconnected / zrok connected, pick tailscale · continue · PUT provider / PUT provider / no PUT + explanation + Settings link, no `gateway-make-primary-*` in wizard (test-plan #E12)
- [ ] 4.6 Write L1 test in `RemoteAccessDialog.test.tsx` (see `components/Gateway/__tests__/GatewayPairQR.test.tsx`): endpoint https zrok / http LAN / http zerotier · render Open it on the device · payload QR / QR text `http://192.168.16.220:8000` + "choose Request access" / no QR + "needs an https address or the same Wi-Fi" (test-plan #E17)
- [ ] 4.7 Write L1 test in `RemoteAccessDialog.test.tsx` (see `components/__tests__/TunnelButton.test.tsx` fetch mocking): `PUT /api/config` → 403 · Listen on network · refusal message, no restart call, step current, no sessionStorage key (test-plan #X1)
- [ ] 4.8 Write L1 test in `RemoteAccessDialog.test.tsx` (see `components/__tests__/TunnelButton.test.tsx`): `bindHostSource=env`, pending `127.0.0.1` · render + activate · names `PI_DASHBOARD_HOST` and `127.0.0.1`, no PUT, no restart, no primary action (test-plan #X2)
- [ ] 4.9 Write L1 test in `RemoteAccessDialog.test.tsx` (see `components/__tests__/TunnelButton.test.tsx`): PUT ok, restart → 500 · Listen on network · "restart pending" + Restart, key removed (test-plan #X3)
- [ ] 4.10 Write L1 test `components/remote-access/__tests__/resume.test.tsx` (see `components/__tests__/TunnelButton.test.tsx`): PUT + restart ok, socket reconnects within 5 s with resolved `0.0.0.0` · reconnect · dialog on Allow devices on my network, Listen done, Let devices ask current, key removed (test-plan #X4)
- [ ] 4.11 Write L1 test in `resume.test.tsx` (see `components/__tests__/TunnelButton.test.tsx`): run `at` now−119 s / now−121 s · reconnect · reopens / stays closed, key removed both (test-plan #E18)
- [ ] 4.12 Write L1 test in `RemoteAccessDialog.test.tsx` (see `components/Gateway/__tests__/Gateway.test.tsx`): connect → provider `failed` "zrok: name taken" · Go online · step current with reason, button red (test-plan #X8)
- [ ] 4.13 Run §4 tests and verify red; implement `components/remote-access/RemoteAccessDialog.tsx` (landing, wizard host, step bodies from §3 sections, Listen on network source-check/write/restart/resume per design D4, Approve per D6, testid map per D9) until §4 is green

## 5. Connect to another machine

- [ ] 5.1 Write L1 test `components/remote-access/__tests__/connect-machine.test.tsx` (see `packages/client/src/lib/__tests__/known-servers-api.test.ts`): typed `MacBook.local:8000` vs known `macbook.local:8000` / unknown / 409 already_known / 409 identity_changed · continue · no POST / POST created / existing address shown / task stops (test-plan #E14)
- [ ] 5.2 Write L1 test in `connect-machine.test.tsx` (see `lib/__tests__/known-servers-api.test.ts`): mDNS result not known · render Which machine · word "found on this network", no probe (test-plan #E15)
- [ ] 5.3 Write L1 test in `connect-machine.test.tsx` (see `packages/client/src/lib/pairing/__tests__/` knock tests): (pin, advert, proven) four combos · Ask runs (desktop) · knock / no knock / identity mismatch / show H, knock only after confirm (test-plan #E16)
- [ ] 5.4 Write L1 test in `connect-machine.test.tsx` (see `lib/__tests__/known-servers-api.test.ts`): probe `{status:"timeout"}` with entry created / pre-existing · Check it can be reached · reason shown, no advance, Remove offered / not offered (test-plan #X5)
- [ ] 5.5 Write L1 test in `connect-machine.test.tsx` (see `lib/__tests__/known-servers-api.test.ts`): browser client, `http://192.168.16.204:8000` · Ask runs · `window.open(".../pair?request","_blank","noopener")`, "not verified" text, finish offers new tab not in-page switch (test-plan #X6)
- [ ] 5.6 Write L1 test in `connect-machine.test.tsx` (see `lib/__tests__/known-servers-api.test.ts`): POST → 409 identity_changed · continue Which machine · task stops naming identity change, no probe (test-plan #X9)
- [ ] 5.7 Implement the Connect-to-another-machine steps (lookup → add → probe → desktop `challengeIdentity`+`knockServer` / browser `noopener` tab → finish) until §5 is green

## 6. Toolbar + removal

- [ ] 6.1 Write L1 test in `components/__tests__/TunnelButton.test.tsx` (extend it): button grey; WS `reachability_updated {resolvedBindHost:"0.0.0.0"}` · dispatch · title "Remote access: listening on the network", no extra fetch (test-plan #F6)
- [ ] 6.2 Write L1 test in `TunnelButton.test.tsx` (extend it): pending 0 / 2 · render · no badge / badge "2" + accessible name "2 devices waiting" (test-plan #F7)
- [ ] 6.3 Write L1 test in `TunnelButton.test.tsx` (extend it): status unavailable / inactive / active · click `tunnel-btn` · landing opens, no navigation to `/settings/gateway` (test-plan #F9)
- [ ] 6.4 Switch `TunnelButton` to `mdiAccessPointNetwork` + dot + badge via `remoteAccessIndicator`, always opening `RemoteAccessDialog`; keep `tunnel-btn`; verify 6.1–6.3 pass and `SessionList.*-pill.test.tsx` still pass
- [ ] 6.5 Delete `components/Gateway/GatewayDialog.tsx`; move kept testids per design D9; add i18n keys under `remoteAccess.*` (copy from `mockups/ui-plan.md`); verify `npm test` and `npm run build` succeed

## 7. E2E (docker harness)

- [ ] 7.1 Write L3 spec `tests/e2e/remote-access-wizard.spec.ts` (see `tests/e2e/gateway-reserved-name.spec.ts` for harness attach): harness defaults (env `0.0.0.0`, acceptLan off, no tunnel) · click `tunnel-btn` · `gateway-dialog` visible, LAN "Listening, but requests are off", Internet Off, 4 `remote-access-task-*` (test-plan #F1)
- [ ] 7.2 Write L3 test in `tests/e2e/remote-access-wizard.spec.ts` (see `tests/e2e/gateway-reserved-name.spec.ts`): harness `PI_DASHBOARD_HOST=0.0.0.0` · open Allow devices on my network · Listen on network "already set · all networks (0.0.0.0)", current Let devices ask (test-plan #F2)
- [ ] 7.3 Port `tests/e2e/{gateway-board-mobile,gateway-reserved-name,gateway-primary-offer,gateway-readiness-board,zrok-v2-tunnel}.spec.ts` to the D9 testid map (board/Make-primary → `/settings/gateway`; reserved name/release/error → wizard) · run them · all pass and `rg gateway-tab- tests/e2e` is empty (test-plan #F12)

## 8. Verification + docs

- [ ] 8.1 Run `node scripts/theme-token-guard.mjs` and `npm run quality:changed`; verify no new violations
- [ ] 8.2 Manual: dialog landing + one wizard per task in Base dark / Base light / one non-base palette at 375 / 768 / 1440 in an isolated env (non-8000 ports) — matches mockup layout, no clipping (test-plan: manual-only, #F13)
- [ ] 8.3 Manual: first-time operator asked to "share over the internet" and "let my phone in" completes without help (test-plan: manual-only, #F14)
- [ ] 8.4 Update DOX rows: new `components/remote-access/AGENTS.md`, new `lib/remote-access/AGENTS.md`, `components/Gateway/AGENTS.md` (GatewayDialog removed, GatewayPage sections, board `active`/`showProviderActions`, split guide/QR), `connectivity/TunnelButton.tsx.AGENTS.md`, `lib/gateway/AGENTS.md`, e2e `*.spec.ts.AGENTS.md` for ported specs; delegate `docs/user-features.md` "Access from anywhere" prose to DocScribe; verify `kb dox lint` reports nothing missing/stale for touched files
