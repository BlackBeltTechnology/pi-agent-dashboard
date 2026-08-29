> Approved design + scored rubric: `mockups/ui-plan.md`. Live mockups:
> `mockups/gateway-empty.html` (phase 2), `mockups/security-pair.html` (phase 4).
> Scenario manifest: `test-plan.md` — it, not any tag here, is the source of
> truth for automated-vs-manual.
>
> L1 exemplars: `packages/client/src/components/Gateway/__tests__/GatewayPairQR.test.tsx`,
> `packages/client/src/components/__tests__/SettingsPanel.test.tsx`.
> L3 exemplar: `tests/e2e/pairing-qr.spec.ts`.

## 1. Establish the ground truth before deleting anything

- [x] 1.1 Update `docs/architecture.agent.md` (names `PairingView`); leave `docs/qa/archived-frontend-test-cases.md` — archived QA history. Re-grep `docs/`, `README.md`, `docs/faq.md` for any further Settings▸Security pairing instruction
- [x] 1.2 Confirmed during doubt-review: NO e2e spec drives the Security pairing testids (`tests/e2e/pairing-qr.spec.ts` approves via the `request` fixture, not the UI). Re-verify with one grep, then treat phase 5 as a clean delete
- [x] 1.3 Confirm `QrCodeDialog` is orphaned: no component imports it; `rg QrCodeDialog` outside markdown returns only the component, its own test, and the `PairingView` comment
- [x] 1.4 Confirm `packages/shell/src` has zero references to `/settings/security`

## 2. Port the no-secure-road block up (D3) — before any delete

Tests first; 2.7 is the red→green gate.

- [x] 2.1 L1 test — `getPairPayload` pending and `getGatewayEndpoints` pending (input) · component mounts (trigger) · no "no secure road" heading, no setup action, no localhost note in the tree; a loading affordance instead (observable). see `GatewayPairQR.test.tsx` (test-plan #E1)
- [x] 2.2 L1 test — payload `{v:1,id:<64ch>,code:"482913",urls:["wss://x.example/ws"]}` + one TLS endpoint (input) · mount, default selection (trigger) · QR `data-qr-text` starts `https://` and contains `/pair#pi:pair:v1.`; copy-string, fingerprint, countdown present (observable). see `GatewayPairQR.test.tsx` (test-plan #E2)
- [x] 2.3 L1 test — `getPairPayload` → `no_reachable_endpoint`, endpoints `[]` (input) · mount resolves (trigger) · explanation + setup action + `http://localhost` note all render (observable). see `GatewayPairQR.test.tsx` (test-plan #E3)
- [x] 2.4 L1 test — `getPairPayload` → `no_reachable_endpoint`, endpoints `[]` (input) · mount resolves (trigger) · the retired `gateway.pair.empty` string "No TLS endpoint to pair over…" is ABSENT and exactly one message block renders (observable). see `GatewayPairQR.test.tsx` (test-plan #E4)
- [x] 2.5 L1 test — `getPairPayload` → `no_reachable_endpoint`, endpoints `[http://192.168.1.10:8000]` (input) · mount resolves (trigger) · explanation + action + localhost note render AND the link-endpoint panel renders, both simultaneously (observable). This is the regression the naive port ships. see `GatewayPairQR.test.tsx` (test-plan #E5)
- [x] 2.6 Confirm 2.1–2.5 fail against current `main` for the stated reason — task 2.5 in particular must fail because `state` is `"ready"`, not `"empty"`
- [x] 2.7 Add an explicit `noSecureRoad` boolean set ONLY in the `res.error === "no_reachable_endpoint"` branch of `load()` and cleared at the top of every `load()`. Do NOT derive it from `payload === null` — payload is null while loading (D3)
- [x] 2.8 Extract the explain/action/escape-hatch block and render it on `noSecureRoad`, not inside the `state === "empty"` branch. Match `mockups/gateway-empty.html`: outcome headline → why → one primary CTA → rule-separated "On this machine" escape hatch → dashed QR placeholder
- [x] 2.9 RETIRE the pre-existing `state === "empty"` paragraph (`gateway.pair.empty`, ~line 340) and its i18n key — decided at the scenario-design gate. The new block is the only zero-endpoint message
- [x] 2.10 Wire `GatewayDialog` to pass `() => setTab("setup")`
- [x] 2.11 Wire `GatewayPage` to pass a focus handler (REQUIRED, not optional — D3a: the bare `navigate("/settings/gateway")` fallback is a no-op on the page that IS that route). Add the `id`/`ref` on the Connect-a-device section; it does not exist yet and phase 4 needs the same anchor
- [x] 2.12 Make the fallback scroll the Connect-a-device section into view when the current route is already `/settings/gateway`, so an unwired future host still does something real
- [x] 2.13 Make 2.1–2.5 pass

## 2b. Display parity (D7) — two more clauses the survivor owes

- [x] 2b.1 L1 test — payload `id` = 64-char hex (input) · payload rendered (trigger) · the complete 64-char `id` is in the DOM and selectable; the 12-char form may additionally appear as the QR caption (observable). see `GatewayPairQR.test.tsx` (test-plan #E8)
- [x] 2b.2 L1 test — payload `urls:["wss://tunnel.example/ws"]` while `getGatewayEndpoints` → `[https://other.example, http://lan]` (input) · pairing endpoint selected (trigger) · the rendered advertised-URL list is exactly `["wss://tunnel.example/ws"]`, not the endpoint list (observable). see `GatewayPairQR.test.tsx` (test-plan #E9)
- [x] 2b.3 Render the full `id`; keep `id.slice(0, 12)` only as the compact QR caption
- [x] 2b.4 Render `payload.urls[]` in the pairing context panel
- [x] 2b.5 Make 2b.1–2b.2 pass

## 3. Pin the surviving surface's invariants and failure modes

- [x] 3.1 L1 test — payload loaded, countdown ticked to 1, confirm input `"482913"` (input) · read the Approve control (trigger) · `disabled` is false (observable). see `GatewayPairQR.test.tsx` (test-plan #E6)
- [x] 3.2 L1 test — countdown ticked to 0 and past it (input) · read/click Approve (trigger) · `disabled` is false and clicking issues `POST /api/pair/approve` (observable). see `GatewayPairQR.test.tsx` (test-plan #E7)
- [x] 3.3 Add a comment at the `disabled=` expression naming the spec scenario, so a future `|| expired` cannot be added without contradicting a cited rule
- [x] 3.4 L1 test — `getPairPayload` → `{ok:false,error:"internal"}` (fault) · mount resolves (trigger) · the error is surfaced AND the "no secure road" block does NOT render (observable). see `GatewayPairQR.test.tsx` (test-plan #X1)
- [x] 3.5 L1 test — payload whose `urls[]` contains `http://192.168.1.10:8000` (fault) · payload encode attempted (trigger) · `guardPairingUrls` throws, the encode aborts, no QR carries that URL, the failure is surfaced rather than silently filtered (observable). see `GatewayPairQR.test.tsx` (test-plan #X2)
- [x] 3.6 L1 test — `getGatewayEndpoints` rejects while `getPairPayload` would have succeeded (fault) · mount resolves (trigger) · an error is reported to the operator, not a blank or permanently-loading panel (observable). Pins the D8 accepted regression. see `GatewayPairQR.test.tsx` (test-plan #X3)
- [x] 3.7 L1 test — `getGatewayEndpoints` resolves after 3s, `getPairPayload` → `no_reachable_endpoint` immediately (fault) · observe during the 3s gap (trigger) · no block during the gap, renders once after resolution (observable). see `GatewayPairQR.test.tsx` (test-plan #X4)
- [x] 3.8 L1 test — first load succeeds with a payload, second returns `no_reachable_endpoint` (input) · operator clicks Regenerate (trigger) · the stale payload panel clears and the block appears — the flag is re-evaluated, not latched (observable). see `GatewayPairQR.test.tsx` (test-plan #X5)
- [x] 3.9 L1 test — payload loaded, endpoints `[TLS, link]`, TLS selected (input) · select the link row, then re-select the TLS row (trigger) · link → payload panel replaced by the link note; TLS re-selected → fingerprint, countdown, copy-string, approval all present again without a reload (observable). Pins D7a's deliberate coupling. see `GatewayPairQR.test.tsx` (test-plan #F1)

## 4. Security routes to Gateway (D2)

- [x] 4.1 L1 test — Settings ▸ Security rendered (input) · mount (trigger) · zero QR canvases, zero pairing copy-strings, zero approval controls anywhere in the Security tree (observable). see `SettingsPanel.test.tsx` (test-plan #F2)
- [x] 4.2 L1 test — two paired devices in the registry (input) · Security mounts (trigger) · both rows render with label, last-seen, and an enabled Revoke (observable). see `SettingsPanel.test.tsx` (test-plan #F4)
- [x] 4.3 L3 test — dashboard on `/settings/security` with Gateway configured (input) · click the "Pair a device" link (trigger) · route becomes `/settings/gateway` AND the Connect-a-device section is within the viewport (observable). Land+scroll decided at the scenario-design gate. see `tests/e2e/pairing-qr.spec.ts` for harness glue (test-plan #F3)
- [x] 4.4 Replace `<PairingView />` in `SettingsPanel.tsx` with the inline link under the existing `settings.pairDevice` section title, matching `mockups/security-pair.html` variant A1 (body names the destination and what happens there; button mirrors the Gateway page's `Open Security →` shape)
- [x] 4.5 Give the link a stable testid for the e2e layer, and point it at the Connect-a-device anchor added in 2.11
- [x] 4.6 Copy check: the surface is named **"Connect a device"**, NOT "Access & QR" — the latter is a dialog-tab label and the Gateway page has no tabs (D1)
- [x] 4.7 Add the new Security-link copy as a NEW i18n key. There is no English catalogue — English is the inline `t(key, undefined, "default")` third argument. So: inline default at the call site, plus a real entry in `i18n.tsx` (zh-CN) and `i18n-hu.ts`
- [x] 4.8 Make 4.1–4.3 pass
- [x] 4.9 Verify the Gateway → Security cross-links (`GatewayPage`, `GatewayDialog`) still resolve, so the relationship is bidirectional and neither side dead-ends

## 5. Delete the duplicate

- [x] 5.1 Delete `packages/client/src/components/connectivity/PairingView.tsx`
- [x] 5.2 Delete `packages/client/src/components/__tests__/PairingView.test.tsx`. Per 1.2 there is nothing to relocate — every test in it covers behaviour being deleted. Do NOT go hunting for tests to move
- [x] 5.3 Remove the `PairingView` import from `SettingsPanel.tsx`
- [x] 5.4 L1 test — client source tree (input) · grep/AST for a payload encoder (trigger) · exactly one module defines `encodePayloadString` and no component-local encoder exists (observable). see `packages/client/src/lib/pairing/__tests__/` (test-plan #E10)

## 6. Delete the orphaned QrCodeDialog (D5)

- [x] 6.1 Delete `packages/client/src/components/connectivity/QrCodeDialog.tsx`
- [x] 6.2 Delete `packages/client/src/components/__tests__/QrCodeDialog.test.tsx`
- [x] 6.3 L1 test — client source tree (input) · build + grep (trigger) · all four deleted files absent, zero imports of either symbol, typecheck clean (observable). (test-plan #E12)

## 7. i18n cleanup (D6)

- [x] 7.1 List every i18n key referenced by the deleted `PairingView` and `QrCodeDialog`
- [x] 7.2 For each, grep `packages/client/src` for remaining references; zero-hit keys retire
- [x] 7.3 Remove retired keys from every catalogue (`i18n.tsx`, `i18n-hu.ts`, siblings), and check `i18n-legacy-aliases.ts` for aliases pointing at them
- [x] 7.4 L1 test — catalogues `i18n.tsx` and `i18n-hu.ts` (input) · after the sweep (trigger) · `tunnel.startATunnel`, `common.localhostEscapeHatch`, `common.pairingNeedsSecureRoad`, `settings.pairDevice` all still present in both; `gateway.pair.empty` absent from both; the new Security-link key present in both (observable). (test-plan #E11)

## 8. Documentation

- [x] 8.1 Update `packages/client/src/components/connectivity/AGENTS.md`: drop the `PairingView.tsx` and `QrCodeDialog.tsx` rows, and delete both `*.tsx.AGENTS.md` sidecars. `components/__tests__/` carries no per-test rows — nothing to remove there. Leave the `QrCodeDialog` mention in `TunnelButton.tsx.AGENTS.md` (immutable `See change:` history)
- [x] 8.2 Update `packages/client/src/components/Gateway/AGENTS.md`: `GatewayPairQR` is now the sole operator pairing surface; note the `noSecureRoad` flag, the required `onSetupRequested` on the page host, and the full-fingerprint / payload-`urls[]` rendering
- [x] 8.3 Delegate any `docs/` prose fix from 1.1 to DocScribe (caveman style), including `docs/architecture.md`'s pairing-view paragraph
- [x] 8.4 Run `kb dox lint` and clear anything it flags

## 9. Verify

- [x] 9.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep the summary pattern
- [x] 9.2 `npm run quality:changed`
- [x] 9.3 L3 test — TLS endpoint + valid payload (input) · read the QR's `data-qr-text`, then navigate the browser to that exact URL (trigger) · the value matches `https://<tls-host>/pair#pi:pair:v1.<b64>`, navigating lands on `/pair` which decodes it, and the one-time code appears only after `#` (observable). see `tests/e2e/pairing-qr.spec.ts` (test-plan #F5)
- [ ] 9.4 Manual — point a physical phone camera at the rendered QR; confirm the camera surfaces an openable link (test-plan: manual-only, #F6)
- [ ] 9.5 Manual — view the promoted empty state and the Security link in dark and light at 375/768/1440; confirm they match the approved mockup and that contrast and hierarchy read correctly (test-plan: manual-only, #F7)
- [x] 9.6 Re-score the promoted components against `mockups/ui-plan.md`'s rubric in an ISOLATED env on non-8000 ports; confirm `lsof -i:8000` shows the same PID before and after
- [x] 9.7 `openspec validate collapse-pairing-into-gateway --strict`
