# Test Plan — fix-composer-liveness-on-reload

Stage: design   Generated: 2026-05-09

Every Triple slot is decided by design.md D1–D7, the D3 cell table, the spec
deltas, and the human-approved decisions C1–C3 (C1 → E8 keeps the pending-prompt
cancel on an ended session; C2 → F5 pins recovery after the accepted ≤ 15 s
post-restart window, no timing assertion on the window; C3 → E13 includes the
SessionCard `working` fix). Timing values used below come from the artifacts
(`HEARTBEAT_INTERVAL = 15_000` ms, 3 s Force-Stop grace, 200 ms retry-clear) or from the
existing harness convention (20 s = beat + 5 s slack, `streaming-latch-heal.spec.ts`).

Requirement keys:
- R1 play-stop-controls / ADDED "Composer liveness is reconciled with the server session status" (D3 ladder)
- R2 play-stop-controls / ADDED same req — shared working predicate `isComposerWorking` (D7)
- R3 play-stop-controls / MODIFIED "Stop button during streaming" (incl. D6 terminal gate, pendingIdle cancel)
- R4 play-stop-controls / MODIFIED "Killing state feedback"
- R5 flow-controls / MODIFIED "Stop after turn" (visibility + pill)
- R6 composer-grammar-check / MODIFIED "Debounced automatic check" (skip while reconciled streaming)
- R7 ADDED req — no fabricated transcript activity (ChatView keeps raw `selectedState`)
- R8 ADDED req — StatusBar + mobile info strip read reconciled value (D5)
- R9 ADDED req — card / strip / composer agreement (SessionCard + ComposerSessionActions, D7)

L3 driver note: the "server knows, browser doesn't" state is produced by driving the bridge
socket directly (ticketed register, then `session_heartbeat{agentRunning:true}` with NO
`agent_start` → server reconciles `active → streaming`, reducer stays `idle`) — the exact
primitive shipped in `tests/e2e/streaming-latch-heal.spec.ts`. Dashboard port from
`.pi-test-harness.json` / fixtures, gateway port from `/api/health`; never `:18000`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable | harness exemplar |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|------------------|
| E1 | R1 | decision-table (server absent column) | L1 | automated | reducer ∈ {`idle`,`streaming`,`ended`}, serverStatus `undefined` | call `composerLiveness(reducer, undefined)` | returns reducer unchanged: `idle`/`streaming`/`ended` (3 asserts) | `packages/client/src/lib/__tests__/retry-projection.test.ts` |
| E2 | R1 | decision-table (server `ended`) | L1 | automated | reducer ∈ {idle,streaming,ended}, server `ended` | selector call | `ended` for all 3 (latched reducer `streaming` does NOT win) | same |
| E3 | R1 | decision-table (server `streaming`) | L1 | automated | reducer ∈ {idle,streaming,ended}, server `streaming` | selector call | `streaming` for all 3 (incl. reducer `ended` = missed new run) | same |
| E4 | R1 | decision-table (server `idle`) | L1 | automated | reducer ∈ {idle,streaming,ended}, server `idle` | selector call | `idle` for all 3 (reducer `streaming` latch overridden; reducer intermediate `ended` collapses to `idle`) | same |
| E5 | R1 / D1 | decision-table (server `active`) + EP invalid-as-liveness | L1 | automated | reducer ∈ {idle,streaming,ended}, server `active` | selector call | `idle` for all 3; output never equals `"active"` (return union `idle|streaming|ended`) | same |
| E6 | R2 | decision-table (5 status × retrying 2 = 10 rows) | L1 | automated | status ∈ {idle,active,streaming,ended} (+ composer subset), retrying ∈ {true,false} | `isComposerWorking(status, retrying)` | true iff `streaming` OR (`retrying` AND status ≠ `ended`): streaming/*→T; idle+T→T; active+T→T; ended+T→F; idle/active/ended+F→F | same |
| E7 | R3 / D6 | decision-table (terminal gate) | L1 | automated | `<CommandInput sessionStatus="ended" retrying onAbort onForceKill>` | render | `stop-button` count 0, `force-stop-button` count 0, `send-button` present | `packages/client/src/components/__tests__/CommandInput.test.tsx` |
| E8 | R3 / D6 (pendingIdle exception) | decision-table | L1 | automated | `sessionStatus="ended"`, `pendingPrompt={status:"sending"}`, `onCancelPending` spy | render, click stop glyph, then wait 3 s fake-timers | stop glyph rendered; click calls `onCancelPending` ×1 and `onAbort` ×0; after 3 s still no `force-stop-button` | same |
| E9 | R3 regression guard | decision-table | L1 | automated | `sessionStatus="idle"`, `retrying=true` | render | `stop-button` visible (non-terminal retry gap keeps Stop) | same |
| E10 | R3 "Remaining reconciliation cells" | decision-table (6 negative cells) | L1 | automated | (reducer,server) ∈ {(idle,∅),(idle,idle),(idle,ended),(ended,∅),(ended,active),(ended,ended)}, no pending, no retry | selector → `CommandInput sessionStatus` | `stop-button` count 0 in all 6 | same |
| E11 | R3 accepted cost (D6, unknown column) | EP (pins accepted behaviour) | L1 | automated | reducer `ended` (between attempts), server `undefined`, retrying=true | selector → CommandInput | Stop hidden (composer status `ended` → terminal gate); test name documents it as the accepted pre-snapshot cost | same |
| E12 | R2/R9 ComposerSessionActions | decision-table | L1 | automated | `working` fed `isComposerWorking(composerStatus, retry)`: (a) server `ended` + retryState set; (b) server `idle` + retryState set | render `ComposerSessionActions` | (a) Archive / tasks / status group NOT in working-disabled state; (b) working-disabled state present | `packages/client/src/components/__tests__/ComposerSessionActions.test.tsx` |
| E13 | R9 SessionCard | decision-table | L1 | automated | `session.status` ∈ {`ended`,`idle`,`active`} × `isRetrying=true` | render `SessionCard` | `ended` → OpenSpec/worktree actions not working-disabled; `idle`/`active` → working | `packages/client/src/components/session/__tests__/SessionCard-status-shape.test.tsx` |
| E14 | R5 visibility | decision-table | L1 | automated | `sessionStatus` (derived) × `retrying`: (streaming,F), (idle,T), (ended,T), (idle,F) | render CommandInput with stop-after-turn handler | stop-after-turn control present / present / absent / absent — always co-present with `stop-button` | `packages/client/src/__tests__/StopAfterTurnButton.test.tsx` |
| E15 | R6 | EP (status classes) | L1 | automated | grammar autoCheck on, draft ≥ `minChars`, `sessionStatus="streaming"` arriving via panel prop | advance `debounceMs` + 1 ms | check request count 0; then rerender `sessionStatus="idle"` + keystroke + `debounceMs` → count 1 | `packages/grammar-plugin/src/__tests__/useGrammarCheck.test.tsx` |
| E16 | R6 plumbing | EP | L1 | automated | `ComposerPanelSlot` with `sessionStatus="streaming"` | render slot consumer with a probe panel | probe receives `"streaming"` verbatim (no re-derivation in runtime) | `packages/dashboard-plugin-runtime/src/__tests__/slot-consumers.test.tsx` |
| E17 | R8 StatusBar | EP | L1 | automated | `status="streaming"`, `currentTool` undefined, `streamingText` "" | render StatusBar | renders generic `Thinking…` working line (not the idle line) | `packages/client/src/components/__tests__/StatusBar.test.tsx` |

### Performance

None. No latency / throughput / memory requirement in proposal, design or spec deltas; the
selector is a pure O(1) derivation and the one-frame broadcast lag (D3 "Broadcast ordering")
is an accepted, non-thresholded trade-off. Not a gap: nothing in the change claims a budget.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) | harness exemplar |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|------------------|
| F1 | R1/R3/R8/R9 "Card and composer agree after a reload mid-run" | state-convergence | L3 | automated | synthetic bridge: ticketed register, `session_heartbeat{agentRunning:true}`, no `agent_start` ever sent | `page.reload()`, select session | card `data-status-shape="working"` AND composer `stop-button` visible AND StatusBar shows `Thinking…`; `send-button` count 0 | `tests/e2e/streaming-latch-heal.spec.ts` |
| F2 | R7 "No fabricated transcript activity" | invariant | L3 | automated | F1 state | after F1 converges | transcript has 0 streaming-assistant bubbles / no turn-active indicator; reducer-derived chat state still idle (no `agent_start` in WS frames received) | `tests/e2e/streaming-latch-heal.spec.ts` |
| F3 | R7 pending prompt untouched | invariant | L3 | automated | F1 state | user submits prompt "hello" in composer | optimistic user bubble for "hello" stays rendered (not dropped) until echoed; no assistant bubble fabricated | `tests/e2e/replay-delta-on-reload.spec.ts` |
| F4 | R8 mobile info strip | state-convergence | L3 | automated | F1 state, viewport 390×844 (mobile) | reload + open session | mobile info strip shows working label (`Thinking...`); composer `stop-button` visible | `tests/e2e/mobile-viewport-bound.spec.ts` |
| F5 | R1 state-transition `active → streaming` (incl. server-restart re-seed path) | state-transition | L3 | automated | synthetic bridge registered only (server `active`), browser open | assert, then send `session_heartbeat{agentRunning:true}` | before beat: `send-button`, `stop-button` count 0 (connected idle ≠ running); after beat: converges to `stop-button` with no reload | `tests/e2e/streaming-latch-heal.spec.ts` |
| F6 | R1/R3 heal `streaming → idle` | state-transition / convergence | L3 | automated | synthetic bridge: register + `agent_start`, never `agent_end`; composer shows `stop-button` | send `session_heartbeat{agentRunning:false}` | within 20 s (15 s beat + 5 s slack) composer converges to `send-button` AND card leaves working — no reload; both surfaces agree at every poll after convergence | `tests/e2e/streaming-latch-heal.spec.ts` |
| F7 | R3 "Server idle overrides a latched chat streaming state" (missed `agent_end`) | state-transition + frame drop | L3 | automated | live run via synthetic bridge; `page.routeWebSocket` drops the browser-bound `agent_end` frame only | bridge sends `agent_end` (server → `idle`) | reducer stays `streaming` but composer shows `send-button`, `stop-button` count 0 | `tests/e2e/composer-session-strip.spec.ts` (routeWebSocket) |
| F8 | R1 "Ended session never shows a Stop" (latched reducer) | state-transition | L3 | automated | synthetic bridge: register + `agent_start` (no end), then terminal transition so server broadcasts `status:"ended"` | reload, open session (replay re-delivers `agent_start` → reducer `streaming`) | `stop-button` 0, `force-stop-button` 0, `killing-button` 0 | `tests/e2e/streaming-latch-heal.spec.ts` |
| F9 | R1 "Turn end hides Stop without lingering" | convergence (real run) | L3 | automated | real session, faux provider `[[faux:plain-text]]` | `sendPrompt`, await assistant reply | after reply + `agent_settled`: `send-button` visible and `stop-button` count 0 (asserted via web-first `toHaveCount(0)`, no fixed sleep) | `tests/e2e/replay-delta-on-reload.spec.ts` |
| F10 | R3 "Stop button sends abort" on recovered run | state-transition | L3 | automated | F1 state | click `stop-button` | synthetic bridge socket receives `{type:"abort", sessionId}` exactly once | `tests/e2e/streaming-latch-heal.spec.ts` |
| F11 | R5 "Stop after turn offered on a reload-recovered run" | state-transition | L3 | automated | F1 state | click stop-after-turn | control rendered beside `stop-button`; bridge socket receives `{type:"stop_after_turn", sessionId}`; "stopping after this turn…" pill shown | `tests/e2e/streaming-latch-heal.spec.ts` |
| F12 | R4 Killing latch persists while server streaming | state-transition (illegal reset edge) | L1 | automated | CommandInput `sessionStatus="streaming"` | click Stop, advance 3 s → Force Stop, click → `killing-button`; rerender with `sessionStatus` still `"streaming"` (reducer left streaming, server didn't) | `killing-button` still rendered (no reset); rerender `"ended"` → all stop controls hidden | `packages/client/src/components/__tests__/CommandInput.test.tsx` |
| F13 | R3 "Button does not reset while only the server reports the run" | state-transition | L1 | automated | CommandInput `sessionStatus="streaming"`, Stop clicked (abort-sent state) | rerender with same `"streaming"` | abort-sent state retained; advance 3 s → `force-stop-button` appears | same |
| F14 | R5 pill does not clear while server streaming | state-transition | L1 | automated | stop-after-turn clicked, pill shown, `sessionStatus="streaming"` | rerender `"streaming"` (reducer-only change upstream) then rerender `"idle"` | pill present after first rerender; absent after `"idle"` | `packages/client/src/__tests__/StopAfterTurnButton.test.tsx` |
| F15 | R3 retry gap keeps Stop through attempt boundary | state-transition | L1 | automated | selector(reducer `ended`, server `idle`) = `idle`, `retrying=true` | render CommandInput | `stop-button` visible; stop-after-turn co-visible | `packages/client/src/components/__tests__/CommandInput.test.tsx` |
| F16 | R1 real-world reload of a long real run | exploratory | — | manual-only | real pi session on a real provider, run long enough that `agent_start` falls outside the windowed replay | human reloads browser mid-run, clicks Stop | [judgment: live-provider timing + real replay window; L3 covers the state deterministically via F1/F10] | — |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable | harness exemplar |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|------------------|
| X1 | R1 (server status as source) | fault-injection (abort: shed `session_updated`) | L3 | automated | `POST /api/test/force-shed` on; live run starts (`agent_start` + status frame shed) | release injector in test body (and `afterEach`) | composer converges to `stop-button` once the server re-pushes current state; never stuck on `send-button` after drain | `tests/e2e/status-reconcile.spec.ts` |
| X2 | R1 / Risks "bridge disconnected" | fault-injection (abort: bridge socket close) | L3 | automated | F1 state, synthetic bridge socket closed without unregister | observe for 5 s after close | composer keeps `stop-button` AND card stays working (surfaces agree; backstop not suppressed on WS churn, per Risks decision) | `tests/e2e/streaming-latch-heal.spec.ts` |
| X3 | R1 / R3 terminal after kill-in-retry | fault-injection (abort: process killed in retry sleep) | L1 | automated | reducer `retryState` set (no `auto_retry_end`), server `ended` | selector → CommandInput + ComposerSessionActions | no `stop-button`/`force-stop-button`; strip not working (spec "Session-actions strip agrees … killed retrying session") | `packages/client/src/components/__tests__/CommandInput.test.tsx` |
| X4 | R1 unknown → known transition | fault-injection (delay: connect snapshot late) | L1 | automated | reducer `idle`, server `undefined` then `streaming` | rerender with server status populated | first render `send-button`; after server record arrives `stop-button` (continuous derivation, D4 — not a one-shot seed) | `packages/client/src/components/__tests__/CommandInput.test.tsx` |

---

## Coverage summary

- Requirements covered: 9/9 (R1–R9)
- Scenarios by class: edge 17 · perf 0 · frontend 16 · error 4  (total 37)
- Scenarios by level: L1 23 · L2 0 · L3 13 · ci 0 · — 1
- Scenarios by disposition: automated 36 · manual-only 1

## New infra needed

- none. Synthetic bridge driver (`streaming-latch-heal.spec.ts`), force-shed injector
  (`status-reconcile.spec.ts`), `page.routeWebSocket` frame routing
  (`composer-session-strip.spec.ts`) and mobile viewport (`mobile-viewport-bound.spec.ts`) are
  all shipped. Note: there is no App-level (`renderSessionDetail`) vitest harness, so the App
  wiring (tasks 2.1/2.2/2.3/2.3a/2.4/2.4a) is asserted at L3 (F1–F4) rather than by rendering
  `App.tsx` at L1.
