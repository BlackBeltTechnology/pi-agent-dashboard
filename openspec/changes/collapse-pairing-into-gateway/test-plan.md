# Test Plan — collapse-pairing-into-gateway

Stage: design   Generated: 2026-08-20

Two clarifications were raised at the HARD gate and answered before this file was
written, so no `[NEEDS CLARIFICATION]` markers remain:

- **`gateway.pair.empty` → RETIRE.** The old one-sentence message and its key are
  deleted; the new explain/action/note block is the only zero-endpoint message.
  Pins the observable in **E4**.
- **Security link → LAND + SCROLL.** The link navigates to `/settings/gateway`
  *and* brings the Connect-a-device section into the viewport. Pins **F3**.

The dominant risk this plan targets is the D3 condition: the "no secure road"
block must key on the `no_reachable_endpoint` **response**, not on the endpoint
count and not on `payload === null`. Both prior failure shapes (link-only
deployment renders nothing; healthy deployment flashes the block while loading)
get their own falsifying row — **E5** and **E1**.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 "condition not inferred from an unloaded payload" | decision-table (loading row) | L1 | automated | `getPairPayload` pending (never resolves), `getGatewayEndpoints` pending | component mounts | no "no secure road" heading, no setup action, no localhost note anywhere in the tree; a loading affordance instead |
| E2 | R1 "Payload rendered on open" | decision-table (happy row) | L1 | automated | payload `{v:1,id:"3a9f…64ch",code:"482913",urls:["wss://x.example/ws"]}`, endpoints `[https TLS]` | mount, default selection | QR canvas `data-qr-text` starts `https://`, contains `/pair#pi:pair:v1.`; copy-string, fingerprint, countdown all present |
| E3 | R1 "No secure road → empty state" | decision-table (zero-endpoint row) | L1 | automated | `getPairPayload` → `{ok:false,error:"no_reachable_endpoint"}`, endpoints `[]` | mount resolves | explanation + setup action + `http://localhost` note all render |
| E4 | R1 + retire decision | decision-table | L1 | automated | same as E3 | mount resolves | the retired `gateway.pair.empty` string ("No TLS endpoint to pair over…") is **absent**; exactly one message block renders |
| E5 | R1 "No secure road WITH link endpoints" | decision-table (**the regression row**) | L1 | automated | `getPairPayload` → `no_reachable_endpoint`, endpoints `[http://192.168.1.10:8000 link]` | mount resolves | explanation + action + localhost note render **AND** the link-endpoint panel (bare URL + "no pairing, no secret") also renders; both present simultaneously |
| E6 | R2 "Advisory countdown does not gate approval" | BVA (secondsLeft = 1) | L1 | automated | payload loaded, countdown ticked to 1, confirm input `"482913"` | read Approve control | `disabled` is false |
| E7 | R2 same | BVA (secondsLeft = 0, and after further ticks) | L1 | automated | countdown ticked to 0 and past it | read Approve control | `disabled` is false; clicking issues `POST /api/pair/approve` |
| E8 | R1 "Fingerprint shown in full" | EP (full vs prefix) | L1 | automated | payload `id` = 64-char hex | payload rendered | the complete 64-char `id` appears in the DOM and is selectable; the 12-char form may additionally appear as the QR caption |
| E9 | R1 "Advertised urls come from the payload" | EP (two differing sources) | L1 | automated | payload `urls:["wss://tunnel.example/ws"]` while `getGatewayEndpoints` → `[https://other.example, http://lan]` | pairing endpoint selected | the rendered advertised-URL list is `["wss://tunnel.example/ws"]` — not the endpoint list |
| E10 | R4 "One encoder module" | static/structural | L1 | automated | client source tree | grep/AST for a payload encoder | exactly one module defines `encodePayloadString`; no component-local encoder exists |
| E11 | D6 i18n | EP (per catalogue) | L1 | automated | catalogues `i18n.tsx`, `i18n-hu.ts` | after the phase-7 sweep | `tunnel.startATunnel`, `common.localhostEscapeHatch`, `common.pairingNeedsSecureRoad`, `settings.pairDevice` all still present in both; `gateway.pair.empty` absent from both; the new Security-link key present in both |
| E12 | proposal "deleted" | structural | L1 | automated | client source tree | build + grep | `PairingView.tsx`, `PairingView.test.tsx`, `QrCodeDialog.tsx`, `QrCodeDialog.test.tsx` absent; zero imports of either symbol; typecheck clean |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| — | — | — | — | — | — | — | — |

**None applicable.** This is a deletion plus a small port; neither the change nor
the spec states a latency, throughput, or memory budget. Inventing a threshold
here would manufacture a scenario rather than test a requirement. The one
plausible concern — the surviving surface awaits `getGatewayEndpoints()` before
`getPairPayload()` — is a *failure-mode* question, covered by X3/X4, not a
threshold question.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | R1 selection scoping (D7a) | state-transition (legal edge) | L1 | automated | payload loaded, endpoints `[TLS, link]`, TLS selected | operator selects the link row, then re-selects the TLS row | converges: link selected → payload panel replaced by link note; TLS re-selected → fingerprint, countdown, copy-string, approval all present again (no reload needed) |
| F2 | R3 "Security offers a route, not a duplicate" | state (render assertion) | L1 | automated | Settings ▸ Security rendered | mount | zero QR canvases, zero pairing copy-strings, zero approval controls anywhere in the Security tree |
| F3 | R3 + land+scroll decision | state-transition | L3 | automated | dashboard on `/settings/security`, Gateway configured | click the "Pair a device" link | route becomes `/settings/gateway` **and** the Connect-a-device section is within the viewport |
| F4 | R3 "Paired-device management stays on Security" | state (render assertion) | L1 | automated | two paired devices in the registry | Security mounts | both rows render with label, last-seen, and an enabled Revoke control |
| F5 | R1 "Pairing QR is camera-scannable" | state-convergence | L3 | automated | TLS endpoint + valid payload | read the QR's `data-qr-text`, then navigate the browser to that exact URL | the value matches `https://<tls-host>/pair#pi:pair:v1.<b64>`; navigating to it lands on the `/pair` landing which decodes the payload; the one-time code appears only after `#` |
| F6 | R1 camera scannability, physically | visual/hardware | — | manual-only | the rendered QR on a real screen | a physical phone camera is pointed at it | [judgment: the camera surfaces an openable link — no automatable observable; a browser navigating to the decoded string is F5, which is not the same proof] |
| F7 | mockups/ui-plan.md rubric | visual/subjective | — | manual-only | the promoted empty state and Security link | operator views both in dark and light at 375/768/1440 | [judgment: matches the approved mockup; contrast and hierarchy read correctly — no automatable observable beyond the axe floor] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R1 (non-`no_reachable_endpoint` error) | fault-injection (abort) | L1 | automated | `getPairPayload` → `{ok:false,error:"internal"}` | mount resolves | the error message is surfaced; the "no secure road" block does **not** render (it is not a no-secure-road condition) |
| X2 | R4 "TLS re-guard is fail-closed" | fault-injection (poisoned input) | L1 | automated | payload whose `urls[]` contains `http://192.168.1.10:8000` (server gate bypassed/regressed) | payload encode is attempted | `guardPairingUrls` throws; the encode aborts; no QR is rendered carrying that URL; the failure is surfaced, not silently filtered |
| X3 | D8 endpoints-fetch coupling | fault-injection (abort) | L1 | automated | `getGatewayEndpoints` rejects; `getPairPayload` would have succeeded | mount resolves | the surface reports an error to the operator rather than rendering a blank or permanently-loading panel |
| X4 | D8 + E1 interaction | fault-injection (delay) | L1 | automated | `getGatewayEndpoints` resolves after 3s; `getPairPayload` → `no_reachable_endpoint` immediately | mount, observe during the 3s gap | during the gap no "no secure road" block renders; after resolution it renders once |
| X5 | R1 regenerate path | state-transition (illegal edge) | L1 | automated | first load succeeds with a payload; second load returns `no_reachable_endpoint` (tunnel dropped) | operator clicks Regenerate | the stale payload panel is cleared and the "no secure road" block appears — the flag is re-evaluated, not latched from the first load |

---

## Coverage summary

- Requirements covered: 4/4 delta requirements (R1, R2, R3, R4) + 2 design
  decisions carrying observable behaviour (D7a, D8)
- Scenarios by class: edge 12 · perf 0 · frontend 7 · error 5
- Scenarios by level: L1 20 · L2 0 · L3 2 · manual-only 2
- Scenarios by disposition: automated 22 · manual-only 2

## New infra needed

**None.** Every automated row lands in an existing tier:

- L1 → `packages/client/src/components/Gateway/__tests__/GatewayPairQR.test.tsx`
  (exists) and `packages/client/src/components/__tests__/SettingsPanel.test.tsx`
  (exists). The deleted `PairingView.test.tsx` is not replaced.
- L3 → `tests/e2e/` against the docker harness. `tests/e2e/pairing-qr.spec.ts`
  exists and is the harness exemplar for F3 and F5; note it currently approves
  via the `request` fixture, so the UI-driving glue for F3 comes from a
  navigation-style spec instead.
- L2 (`qa/`) is deliberately empty here — nothing about this change touches
  install, spawn, or multi-OS runtime, and no rendered-UI assertion may live in
  a qa smoke row.
