## 1. Server — PairingManager

- [ ] 1.1 Add redeemer metadata to `PendingDevice` in `packages/server/src/pairing/pairing.ts` (`userAgent` ≤256, `viaHost` ≤253, `remoteAddress`, `forwardedFor` first XFF hop ≤64, `createdAt`); `redeem(code, meta?)` stores it; verify via 2.5
- [ ] 1.2 Add `listPending()` (pendingId, metadata, expiresAt, attemptsLeft; never code/confirmCode), `approvePending(pendingId, confirm, label?)` delegating to the existing approve logic, `deny(pendingId)` (marks rejected, consumes code) and `poll()` → `{status:"rejected"}`; verify via 2.1–2.4, 2.8–2.10
- [ ] 1.3 Return `attemptsLeft` (post-increment) on `mismatch` from `approve()`; verify via 2.1 and 2.20
- [ ] 1.4 Add change listener `onPendingChanged(cb)` fired AFTER state commits on add/approve/deny/lockout/expire, plus per-pending expiry timer (`setTimeout(...).unref()` at `expiresAt + 50ms`) cleared on approve/deny/overwrite and in `dispose()` (design D4b); verify via 2.15, 2.16
- [ ] 1.5 Add `[pairing]` transition logs per design D7 (id = first 8 of pendingId only); verify via 2.17

## 2. Server — tests (L1, vitest)

- [ ] 2.1 Test lockout BVA (test-plan #E1): one pending, 5× wrong `approvePending` → `attemptsLeft` 4,3,2,1 then `locked_out`; 6th with correct code → `locked_out`, registry empty. Exemplar: `packages/server/src/__tests__/pairing.test.ts` "D12 compare-code approval"
- [ ] 2.2 Test shared budget (test-plan #E2): 3 wrong via `approve(code)` + 2 wrong via `approvePending(pendingId)` → 5th returns `locked_out`. Exemplar: `packages/server/src/__tests__/pairing.test.ts` "locks out after repeated wrong confirm codes"
- [ ] 2.3 Test budget per pending device (test-plan #E3): A locked out → same code re-redeemed as B → B confirm code ≠ A's and B approves ok. Exemplar: `packages/server/src/__tests__/pairing.test.ts` "premature redemption does NOT lock out"
- [ ] 2.4 Test approve-pending label BVA (test-plan #E4): absent keeps label; `" x "` → `x`; 64-byte → 200; 65-byte, 66-byte (33×é), number → 400 and registry unchanged. Exemplar: `packages/server/src/__tests__/pairing.test.ts` "E13 — mint label BVA"
- [ ] 2.5 Test metadata bounds (test-plan #E5): UA 256/257/2000 chars → ≤256; Host 300 → ≤253; `X-Forwarded-For: 1.2.3.4, 5.6.7.8` → `forwardedFor=1.2.3.4`; absent header → no field. Exemplar: `packages/server/src/__tests__/pairing.test.ts` "E16 — mint response envelope" (fastify inject)
- [ ] 2.6 Test pending list has no secrets (test-plan #E6): operator `GET /api/pair/pending` → has pendingId/metadata/expiresAt/attemptsLeft; body string contains neither pairing code nor confirm code. Exemplar: `packages/server/src/__tests__/pairing.test.ts` "E16 — mint response envelope"
- [ ] 2.7 Test old approve route regression (test-plan #X11): `POST /api/pair/approve` correct → 200 + device; wrong → 400 `mismatch` with additive `attemptsLeft`, status codes unchanged. Exemplar: `packages/server/src/__tests__/pairing.test.ts` "E7 — approve tier"
- [ ] 2.8 Test deny state edges (test-plan #E10): live → 200; repeat deny → 404 `no_pending`; approved / expired / unknown uuid → 404. Exemplar: `packages/server/src/__tests__/pairing.test.ts` "D12 compare-code approval"
- [ ] 2.9 Test denied code is dead (test-plan #E11): deny then `redeem(code)` → `invalid_code`; `poll(oldPendingId)` → `rejected`. Exemplar: `packages/server/src/__tests__/pairing.test.ts` "one-time code TTL"
- [ ] 2.10 Test premature redemption kept without deny (test-plan #E12): A redeems, B redeems same code, operator approves B → ok; `poll(A)` → `unknown`; `poll(B)` → approved + token. Exemplar: `packages/server/src/__tests__/pairing.test.ts` "premature redemption does NOT lock out"
- [ ] 2.11 Test pending list is operator-only (test-plan #X1): paired-device bearer / remote with forwarding headers / trusted-network-only → 401|403; genuine-local and session → 200. Exemplar: `packages/server/src/__tests__/pairing.test.ts` "X4 — a paired device cannot clone itself" + "X5 — trusted network alone cannot mint"
- [ ] 2.12 Test paired device cannot deny (test-plan #X2): bearer `POST /api/pair/deny` → 401|403; `poll(pendingId)` still `pending`. Exemplar: `packages/server/src/__tests__/pairing.test.ts` "X4 — a paired device cannot clone itself"
- [ ] 2.13 Test paired device cannot approve-pending (test-plan #X3): bearer with correct confirm code → 401|403; no device added. Exemplar: `packages/server/src/__tests__/pairing.test.ts` "X4 — a paired device cannot clone itself"
- [ ] 2.14 Test hint carries nothing (test-plan #X4): on add/approve/deny/lockout/expire every broadcast deep-equals `{type:"pair_pending_changed"}`. Exemplar: `packages/server/src/__tests__/browser-gateway-grant-channel.test.ts`
- [ ] 2.15 Test pushed expiry (test-plan #X6): fake timers, one pending, no calls; advance to `expiresAt+50ms` → exactly one change emission, list empty, `[pairing] expired id=` logged. Exemplar: `packages/server/src/__tests__/tunnel-zrok-v2.test.ts` "X2" (fake timers)
- [ ] 2.16 Test timer hygiene (test-plan #X7): approve at 10s / deny / re-redeem overwrite → no stray emission after original expiry; `dispose()` → `vi.getTimerCount()===0`. Exemplar: `packages/server/src/__tests__/tunnel-zrok-v2.test.ts` "X2"
- [ ] 2.17 Test logs carry no metadata or secrets (test-plan #X8): UA with `\r\n[pairing] approved id=forged`, XFF, Host, then mismatch/approve/deny; every captured line matches `^\[pairing\] (pending|approved|denied|mismatch|locked_out|expired) id=[0-9a-f]{8}` and contains no UA/IP/host/code/token/CR/LF. Exemplar: `packages/server/src/__tests__/browser-gateway-close-diagnostics.test.ts` (console capture)

## 3. Server — routes, frame, protocol

- [ ] 3.1 Add `pair_pending_changed` to `ServerToBrowserMessage` in `packages/shared/src/protocol.ts`; verify `tsc` passes
- [ ] 3.2 Classify the frame in `frameClassOf` (`packages/server/src/pairing/browser-gateway.ts`) as `state`, key `pair_pending`; verify via 3.5
- [ ] 3.3 In `packages/server/src/routes/pairing-routes.ts`: `/redeem` passes headers into `redeem(code, meta)`; add `GET /api/pair/pending`, `POST /api/pair/approve-pending` (label validated with `MAX_DEVICE_LABEL_BYTES`), `POST /api/pair/deny`, ALL with `preHandler: operatorGuard`; map results → status codes (`locked_out` 429, others 400, `no_pending` 404); verify via 2.4–2.13
- [ ] 3.4 Wire `pairing.onPendingChanged` → `browserGateway.broadcastToAll({type:"pair_pending_changed"})` in `packages/server/src/server.ts`; verify via 2.14
- [ ] 3.5 Test hint is never shed (test-plan #X5): `frameClassOf({type:"pair_pending_changed"})` → `{cls:"state", key:"pair_pending"}`. Exemplar: `packages/server/src/__tests__/browser-gateway-critical-frames.test.ts`

## 4. Client — API, UA parser, dialog, host

- [ ] 4.1 Add `listPending()`, `approvePending()`, `denyPending()` to `packages/client/src/lib/pairing/pairing-api.ts`; verify via 4.9–4.20
- [ ] 4.2 Add dependency-free `describeUserAgent(ua)` in `packages/client/src/lib/pairing/describe-user-agent.ts`; verify via 4.6
- [ ] 4.3 Build `PairingApprovalDialog` in `packages/client/src/components/pairing-approval/` on client-utils `Dialog` (`size="md"`) matching `mockups/pairing-approval/` states D1–D6 (testids `pairing-dialog`, `pairing-code-input`, `pairing-name-input`, `pairing-approve`, `pairing-deny`, `pairing-dialog-locked`, `pairing-dialog-expired`, `pairing-dialog-success`); verify via 4.7–4.12, 4.19–4.20
- [ ] 4.4 Build `PairingApprovalHost` (refetch on mount/reconnect/hint; oldest-first queue + `+N more waiting`; per-tab dismissed set; handled-elsewhere toast; waits while a grant dialog is open; skips fetch when `getDeviceBearer()` is set) and mount it in both `App` returns next to `GrantPromptHost`; verify via 4.13–4.18
- [ ] 4.5 Add "Waiting devices" list (`pairing-waiting-list`, Review → reopen dialog) to `packages/client/src/components/Gateway/GatewayPairQR.tsx`; verify via 6.3
- [ ] 4.6 Test UA → label (test-plan #E7): Chrome/Win, Safari/iOS, Firefox/Linux, Edge/Win, Electron, empty, `<script>` junk → "Chrome 140 on Windows", "Safari on iPhone", "Firefox on Linux", "Edge on Windows", "pi-dashboard app", "Unknown browser", "Unknown browser". Exemplar: `packages/client/src/lib/pairing/__tests__/single-encoder.test.ts`
- [ ] 4.7 Test short code on submit (test-plan #E8): typed 7 digits → click Approve → no API call, "Enter all 8 digits" at field, Approve enabled before submit. Exemplar: `packages/client/src/components/access-grant/__tests__/GrantPromptDialog.test.tsx`
- [ ] 4.8 Test input format (test-plan #E9): typed `12a34 567-89` → value `1234 5678`, submitted `confirmCode` `12345678`. Exemplar: `packages/client/src/components/access-grant/__tests__/GrantPromptDialog.test.tsx`
- [ ] 4.9 Test wrong code (test-plan #F3): approve stub → `{error:"mismatch", attemptsLeft:4}`; submit `1111 1111` → value kept, `aria-invalid=true`, text "4 attempts left", icon present. Exemplar: `packages/client/src/components/access-grant/__tests__/GrantPromptDialog.test.tsx`
- [ ] 4.10 Test outcome mapping (test-plan #F4): `locked_out` → `pairing-dialog-locked` + only Close; `expired` → `pairing-dialog-expired` + only Close; `no_pending` → dialog closes + toast "handled in another window". Exemplar: `packages/client/src/components/access-grant/__tests__/GrantPromptHost.test.tsx`
- [ ] 4.11 Test dialog a11y (test-plan #F14): `role=dialog`, `aria-modal=true`, labelled by title; initial focus = code input; input `inputmode=numeric`, `autocomplete=off`, visible label. Exemplar: `packages/client/src/components/access-grant/__tests__/GrantPromptDialog.test.tsx`
- [ ] 4.12 Test untrusted metadata inert (test-plan #X9): UA `<img src=x onerror=alert(1)>`, host `<b>x</b>` → no `img`/`b` elements from metadata, text present; XFF address labelled "reported by proxy". Exemplar: `packages/client/src/components/access-grant/__tests__/GrantPromptDialog.test.tsx`
- [ ] 4.13 Test queue (test-plan #F5): list [A,B] → dialog A + `+1 more waiting`; refetch [B] → dialog B, no chip. Exemplar: `packages/client/src/components/access-grant/__tests__/GrantPromptHost.test.tsx`
- [ ] 4.14 Test reconnect catch-up (test-plan #F8): ws prop null → socket with no hint frame → `GET /api/pair/pending` called, dialog shown. Exemplar: `packages/client/src/components/access-grant/__tests__/GrantPromptHost.test.tsx`
- [ ] 4.15 Test grant precedence (test-plan #F9): grant dialog open + 1 pending → pairing dialog hidden; after grant answered → pairing dialog opens; pendingId not in dismissed set. Exemplar: `packages/client/src/components/access-grant/__tests__/GrantPromptHost.test.tsx`
- [ ] 4.16 Test paired-device browser (test-plan #F10): `getDeviceBearer()` returns token + hint frame → no fetch to `/api/pair/pending`, no dialog. Exemplar: `packages/client/src/components/access-grant/__tests__/GrantPromptHost.test.tsx`
- [ ] 4.17 Test list fetch failure (test-plan #X10): list GET rejects / 500 on hint → no dialog, no throw; next hint retries. Exemplar: `packages/client/src/components/access-grant/__tests__/GrantPromptHost.test.tsx`
- [ ] 4.18 Test approve transport failure (test-plan #X13): approve fetch rejects → dialog open, code kept, "Couldn't reach the dashboard. Try again.", Approve enabled. Exemplar: `packages/client/src/components/access-grant/__tests__/GrantPromptDialog.test.tsx`
- [ ] 4.19 Run Biome on touched client files and verify no new findings vs `develop` (`npm run quality:changed`)
- [ ] 4.20 Verify client build: `npm run build` succeeds

## 5. Device side — /pair landing + Electron shell

- [ ] 5.1 `PairLanding.tsx`: handle `rejected` → `pair-landing-rejected` (severity-error tokens, no restart button, polling stops); treat any status ∉ {pending, approved} as terminal; verify via 5.3, 5.4
- [ ] 5.2 Shell: extract `pollOutcome(status)` into `packages/shell/src/lib/protocol.ts` (`rejected` → declined message, `unknown` → expired message) and use it in `PairView.tsx`; verify via 5.5
- [ ] 5.3 Test browser rejected state (test-plan #F11): poll → `{status:"rejected"}` → `pair-landing-rejected` text "The dashboard declined this device", no `pair-landing-restart`, no further poll. Exemplar: `packages/client/src/components/__tests__/PairLanding.test.tsx`
- [ ] 5.4 Test unknown-status fallback is terminal (test-plan #X12): poll → `{status:"weird"}` → polling stops, terminal error shown. Exemplar: `packages/client/src/components/__tests__/PairLanding.test.tsx`
- [ ] 5.5 Test shell poll mapping (test-plan #F12): `pollOutcome({status:"rejected"})` → `rejected` + "The dashboard declined this device"; `unknown` → expired message. Exemplar: `packages/shell/src/lib/protocol.test.ts`

## 6. End-to-end (L3, Playwright vs docker harness)

- [ ] 6.1 E2E dialog raised on any page (test-plan #F1): operator page on `/`, device `goto('/pair#'+payload)` redeems → `pairing-dialog` visible without reload, shows browser/OS + via host, does not contain the device's `pair-landing-confirm-code` text. Exemplar: `tests/e2e/pairing-qr.spec.ts` test 1 (real payload + redeem under PI_E2E_SEED)
- [ ] 6.2 E2E approve happy path (test-plan #F2): type device confirm code, name `QA phone`, click `pairing-approve` → success then dialog closed ≤5s; device `waitForURL('/')`; `/api/paired-devices` has `QA phone`. Exemplar: `tests/e2e/pairing-qr.spec.ts` test 1
- [ ] 6.3 E2E close keeps pending (test-plan #F6): Escape → request still in `GET /api/pair/pending`; Settings ▸ Gateway shows `pairing-waiting-list` row; Review reopens dialog for same pendingId. Exemplar: `tests/e2e/pairing-qr.spec.ts` test F5 + `tests/e2e/access-grant-dialog.spec.ts`
- [ ] 6.4 E2E handled elsewhere (test-plan #F7): two operator pages A and B show the dialog; approve in B → A closes with "handled in another window" toast; B shows success. Exemplar: `tests/e2e/access-grant-dialog.spec.ts`
- [ ] 6.5 E2E deny (test-plan #F13): click `pairing-deny` → operator dialog closes; device shows `pair-landing-rejected` ≤5s; `/api/paired-devices` unchanged. Exemplar: `tests/e2e/pairing-qr.spec.ts` test 1

## 7. Docs + manual

- [ ] 7.1 Update DOX rows (`pairing.ts.AGENTS.md`, `pairing-routes.ts.AGENTS.md`, `browser-gateway.ts.AGENTS.md`, client `pairing-approval/AGENTS.md` new dir, `PairLanding.tsx.AGENTS.md`, shell `AGENTS.md`) and delegate `docs/architecture.md` pairing section update to DocScribe; verify `kb_search "pair_pending_changed"` finds the rows
- [ ] 7.2 Manual visual check vs approved mockup (test-plan: manual-only, #F15): dialog in dark + light at 375/768/1440 px matches `mockups/pairing-approval/`
