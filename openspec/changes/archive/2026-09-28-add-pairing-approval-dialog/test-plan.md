# Test Plan — add-pairing-approval-dialog

Stage: design   Generated: 2026-09-28

No clarifications outstanding (hard gate passed: every Triple below is concrete).
Requirement refs: R1 = Compare-code approval (MODIFIED), R2 = Operator approval
in the web client (MODIFIED), R3 = App-wide pairing approval dialog, R4 = Operator
can deny, R5 = Pending-request feed. Design refs D1–D8.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 lockout | BVA | L1 | automated | one pending device, `MAX_APPROVE_ATTEMPTS`=5 | 4 wrong `approvePending` calls, then the 5th wrong | calls 1–4 → `mismatch` with `attemptsLeft` 4,3,2,1; call 5 → `locked_out`; a 6th call with the CORRECT code → `locked_out`, no device in registry |
| E2 | R1 shared budget | decision-table | L1 | automated | one pending device | 3 wrong via `approve(code,…)` then 2 wrong via `approvePending(pendingId,…)` | 5th call returns `locked_out` (budget shared across entry points) |
| E3 | R1 budget per pending (D8) | state-transition | L1 | automated | pending A locked out after 5 wrong | same code redeemed again (new pending B) | B has a new confirm code ≠ A's; B approves with its code → ok |
| E4 | R5 label bound | BVA | L1 | automated | `approve-pending` label: absent / `" x "` / 64-byte UTF-8 / 65-byte UTF-8 / 33×`é` (66 bytes) / `123` (number) | POST with correct confirm code | absent → pending label kept; `"x"` (trimmed) stored; 64 B → 200; 65 B, 66 B, number → 400 and registry unchanged |
| E5 | R5 metadata bound | BVA | L1 | automated | `User-Agent` of 256 / 257 / 2000 chars; `Host` of 300 chars; `X-Forwarded-For: 1.2.3.4, 5.6.7.8` | `POST /api/pair/redeem` then `GET /api/pair/pending` | UA length ≤ 256 in all cases; host ≤ 253; `forwardedFor` = `1.2.3.4`; no forwarded field when header absent |
| E6 | R5 no secrets in list | invariant | L1 | automated | one pending device | `GET /api/pair/pending` as operator | JSON contains `pendingId`, metadata, `expiresAt`, `attemptsLeft`; serialized body does NOT contain the pairing code nor the confirm code string |
| E7 | R3 UA → label | EP | L1 | automated | UAs: Chrome/Win, Safari/iOS, Firefox/Linux, Edge/Win, Electron shell, empty, `<script>` junk | client UA parser | "Chrome 140 on Windows", "Safari on iPhone", "Firefox on Linux", "Edge on Windows", "pi-dashboard app", "Unknown browser", "Unknown browser" |
| E8 | R3 short code | EP | L1 | automated | dialog open; typed `1234567` (7 digits) | click Approve device | no API call; field shows "Enter all 8 digits"; Approve was enabled before submit |
| E9 | R3 input format | EP | L1 | automated | typed `12a34 567-89` | onChange | field value `1234 5678` (non-digits stripped, max 8, grouped 4+4); submitted `confirmCode` = `12345678` |
| E10 | R4 deny edges | state-transition | L1 | automated | pendingId states: live / already approved / already denied / expired / unknown uuid | `POST /api/pair/deny` | live → 200; second deny of same id → 404 `no_pending`; approved → 404; expired → 404; unknown → 404 |
| E11 | R4 denied code dead | state-transition | L1 | automated | pending denied | same code `redeem` again | `{ok:false, error:"invalid_code"}`; `poll(oldPendingId)` → `rejected` |
| E12 | R1 premature redemption kept | state-transition | L1 | automated | code redeemed by A (not denied) | B redeems same code, operator approves B's confirm code | ok; `poll(A)` → `unknown`; `poll(B)` → approved + token |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | R3 raise on any page | state-convergence | L3 | automated | operator browser on `/` (session list) | device page `goto('/pair#'+payload)` redeems | `pairing-dialog` visible without reload; contains device browser/OS + via host; does NOT contain the text of `pair-landing-confirm-code` |
| F2 | R3 + R1 happy path | state-convergence | L3 | automated | F1 state; name field edited to `QA phone` | type device's confirm code, click `pairing-approve` | dialog shows success then closes ≤ 5 s; device page `waitForURL('/')`; `/api/paired-devices` has label `QA phone` |
| F3 | R3 wrong code | state-transition | L1 | automated | host with pending list stub; approve returns `{error:"mismatch", attemptsLeft:4}` | submit `1111 1111` | input keeps `1111 1111`; `aria-invalid=true`; error text contains "4 attempts left"; icon rendered |
| F4 | R3 lockout / expired / handled-elsewhere mapping | decision-table | L1 | automated | approve returns `locked_out` / `expired` / `no_pending` | submit | `pairing-dialog-locked` (only Close) / `pairing-dialog-expired` (only Close) / dialog closes + toast "handled in another window" |
| F5 | R3 queue | state-transition | L1 | automated | pending list with 2 entries (oldest A) | host renders; then A resolved (list → [B]) | dialog for A with `+1 more waiting`; after refetch dialog for B, no chip |
| F6 | R3 close keeps pending | state-transition | L3 | automated | F1 state | press Escape; open Settings ▸ Gateway | request still in `GET /api/pair/pending`; `pairing-waiting-list` row present; click Review → dialog reopens for same pendingId |
| F7 | R3 handled elsewhere | state-convergence | L3 | automated | two operator pages A and B, both show the dialog for one pending device | approve in B | A's dialog closes and toast "handled in another window" appears; B shows success |
| F8 | R3 reconnect catch-up | state-convergence | L1 | automated | host mounted, WS disconnected, list stub returns 1 pending | WS reconnect (ws prop null → socket) with no `pair_pending_changed` | `GET /api/pair/pending` called on reconnect; dialog shown |
| F9 | R3 grant precedence (D5) | state-transition | L1 | automated | grant dialog open (GrantPromptHost queue non-empty) + 1 pending pairing | grant dialog answered | pairing dialog hidden while grant open; opens immediately after; pendingId NOT in dismissed set |
| F10 | R3 paired-device browser | invariant | L1 | automated | `getDeviceBearer()` returns a token | `pair_pending_changed` frame arrives | no fetch to `/api/pair/pending`; no dialog rendered |
| F11 | R4 device rejected (browser) | state-transition | L1 | automated | PairLanding polling; poll returns `{status:"rejected"}` | next poll tick | `pair-landing-rejected` shows "The dashboard declined this device"; no `pair-landing-restart` button; polling stops |
| F12 | R4 device rejected (shell) | state-transition | L1 | automated | shell poll outcome helper given `{status:"rejected"}` | map poll response | outcome `rejected` with message "The dashboard declined this device" (distinct from `unknown` → "expired") |
| F13 | R4 deny end-to-end | state-convergence | L3 | automated | F1 state | click `pairing-deny` | operator dialog closes; device page shows `pair-landing-rejected` ≤ 5 s; `/api/paired-devices` unchanged |
| F14 | R3 dialog a11y | invariant | L1 | automated | dialog open | render | `role=dialog`, `aria-modal=true`, labelled by title; initial focus = code input; code input has `inputmode=numeric`, `autocomplete=off`, visible label |
| F15 | R3 visual fidelity vs mockup | visual/subjective | — | manual-only | dialog in dark + light at 375/768/1440 px | human compares with `mockups/pairing-approval/` | [judgment: matches approved mockup; no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R5 operator-only list | decision-table | L1 | automated | caller = paired-device bearer / unauthenticated remote (forwarding headers) / trusted-network-only | `GET /api/pair/pending` | 401 or 403 in all three; genuine-local and session callers → 200 |
| X2 | R4 paired device cannot deny | decision-table | L1 | automated | caller = paired-device bearer | `POST /api/pair/deny {pendingId}` | 401/403; `poll(pendingId)` still `pending` |
| X3 | R1 paired device cannot approve-pending | decision-table | L1 | automated | caller = paired-device bearer with correct confirm code | `POST /api/pair/approve-pending` | 401/403; no device added |
| X4 | R5 hint carries nothing | invariant | L1 | automated | pending add / approve / deny / lockout / expire | capture every broadcast frame | each frame deep-equals `{type:"pair_pending_changed"}` (no extra keys) |
| X5 | R5 hint never shed | invariant | L1 | automated | browser socket under shed pressure | `frameClassOf({type:"pair_pending_changed"})` | class `state`, key `pair_pending` (coalescing, not transcript) |
| X6 | R5 pushed expiry (D4b) | fault-injection (idle) | L1 | automated | fake timers; one pending; no other calls | advance to `expiresAt + 50 ms` | exactly one `pair_pending_changed` emitted; `GET /api/pair/pending` empty; `[pairing] expired id=` logged |
| X7 | R5 timer hygiene | fault-injection | L1 | automated | pending approved at t=10 s / denied / overwritten by re-redeem | advance past original expiry | no extra change emission from the cleared timer; `dispose()` leaves 0 active timers (`vi.getTimerCount()`) |
| X8 | R5 no metadata / secrets in logs | invariant | L1 | automated | redeem with UA `evil\r\n[pairing] approved id=forged`, XFF, Host; then mismatch, approve, deny | capture `console.*` | log lines match `^\[pairing\] (pending|approved|denied|mismatch|locked_out|expired) id=[0-9a-f]{8}`; none contain UA, IP, host, pairing code, confirm code, token, or `\r`/`\n` |
| X9 | R5 untrusted text rendered inert | invariant | L1 | automated | UA `<img src=x onerror=alert(1)>`, host `<b>x</b>` | dialog renders pending entry | no `img`/`b` element created from metadata; strings appear as text; IP from XFF labelled "reported by proxy" |
| X10 | R3 list fetch fails | fault-injection (abort) | L1 | automated | `GET /api/pair/pending` rejects (network error) / returns 500 | hint arrives | no dialog, no crash; next hint or reconnect retries the fetch |
| X11 | R1/R2 old approve route unchanged | regression | L1 | automated | existing `POST /api/pair/approve {code, confirmCode}` | correct code; wrong code | 200 + device; wrong → 400 `mismatch` now with additive `attemptsLeft`, same status codes as before |
| X12 | R4 old device client | compatibility | L1 | automated | PairLanding built before this change's mapping (unknown-status fallback path) | poll returns `rejected` | treated as terminal (no infinite polling); verified by asserting the fallback branch for any status ∉ {pending, approved} |
| X13 | R3 approve submit fails in transport | fault-injection (abort) | L1 | automated | `approve-pending` fetch rejects | submit | dialog stays open, typed code kept, inline error "Couldn't reach the dashboard. Try again."; Approve re-enabled |

### Performance

No performance requirement is stated in the spec; none generated (the hint +
single guarded GET is O(pending) with at most one pending per minted code).

---

## Coverage summary

- Requirements covered: 5/5 (R1–R5); design decisions D1–D8 each exercised (D1 X4/F10, D2 E2/E4, D3 E10/E11, D4 E5/X9, D4b X6/X7, D5 F5/F9, D6 F3/F4, D7 X8, D8 E3)
- Scenarios by class: edge 12 · perf 0 · frontend 15 · error 13
- Scenarios by level: L1 35 · L2 0 · L3 4 · manual 1
- Scenarios by disposition: automated 39 · manual-only 1

## New infra needed

- none. Shell rejected mapping (F12) is tested through a pure poll-outcome helper
  in `packages/shell/src/lib/protocol.ts` (existing `protocol.test.ts` harness);
  no shell component-test harness is introduced.
