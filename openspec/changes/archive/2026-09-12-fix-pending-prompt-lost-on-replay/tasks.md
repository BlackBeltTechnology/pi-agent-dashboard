## 1. Server — bounded critical-frame delivery (fix A)

- [x] 1.1 Add the `critical` frame class to `sendTo` in `packages/server/src/pairing/browser-gateway.ts` with the 4-frame per-delivery cap and the 5 MB absolute ceiling (design D1, D2); verify via E1–E4
- [x] 1.2 Pass the critical flag from the pending-*prompt* leg of `replayPendingUiRequests` only — not the dead `extension_ui_request` leg, not `replayNotifyLog` (design D3); verify via E6
- [x] 1.3 Split drop counters into transcript vs blocking classes and expose both under `/api/health#droppedFrames`; verify via E2, E5 and the existing `health-shape.test.ts` shape assertion

## 2. Server — resync routing (fix B, server half)

- [x] 2.1 Add the `prompt_resync_request` message type to `packages/shared/src/` (browser→server) plus the `__resyncRequestId` echo field on the bridge reply; verify `npm test` typechecks every package
- [x] 2.2 Add a non-consuming `peek` to `ResyncRequesterRegistry` in `packages/server/src/pairing/subagent-resync-routing.ts`, leaving take-once `take` for subagent events (design D5); verify via E7, E8
- [x] 2.3 Handle `prompt_resync_request` in the browser-handler switch: record the requester (mirror `recordResyncRequester` in `session-action-handler.ts`) and forward to the session's bridge; verify via E16
- [x] 2.4 In the bridge `prompt_request` handler in `packages/server/src/event-wiring.ts`, keep every existing side effect (tracking, `currentTool`, unread, ordering, `replayPromptIds`) and swap only the final delivery: token resolves → critical send to that socket; no token / expired → existing fan-out (design D4); verify via E7, E9, X3

## 3. Bridge — resync emitter (fix B, extension half)

- [x] 3.1 Extract the `onReconnect` pending-prompt emit loop in `packages/extension/src/bridge.ts` into one shared emitter (design D7); verify existing reconnect tests still pass
- [x] 3.2 Handle `prompt_resync_request` by calling the shared emitter with the echoed requester token; verify via E10 and the two-prompt case in E7

## 4. Client — state carry, refresh, affordance (fixes C, B-client, D)

- [x] 4.1 Add `carryInteractiveRequests` to `packages/client/src/lib/chat/event-reducer.ts`, carrying unanswered entries *and* their `ui-<requestId>` rows appended at the tail (design D8); verify via E11, E13
- [x] 4.2 Wire the carry into all five reset sites — `useMessageHandler` `event_replay` + `session_state_reset`, `useSessionState` `applyReplay` + `session_state_reset`, and the refresh reset in `App.tsx`; verify via E12
- [x] 4.3 Add `requestPromptResync` to `RefreshChatDeps` and call it from `refreshChat`, failure-isolated from the transcript refresh (design D9); verify via X1
- [x] 4.4 Wire the dep in `App.tsx` so both the header and mobile refresh paths send `prompt_resync_request` through one callback; verify by asserting a single send per refresh in the extended `refresh-chat.test.ts`
- [x] 4.5 Implement the desync selector as a pure function: `currentTool === "ask_user"` AND no matching request AND not ended AND no replay in flight AND condition held 5 s (design D10); verify via E14, E15
- [x] 4.6 Render the resync affordance in the session view and wire activation to the resync request; verify via F4

## 5. Folded scenarios — L1 edge cases (see `test-plan.md`)

- [x] 5.1 E1 — at-cap delivery (test-plan #E1, automated): 4 pending prompts, stub `bufferedAmount` 4 MB + 1 B · pending-prompt replay runs · all 4 reach `ws.send`, blocking-drop counter 0 — see `packages/server/src/__tests__/browser-gateway-dropped-frames.test.ts` + `helpers/draining-ws.ts`
- [x] 5.2 E2 — cap + 1 (test-plan #E2, automated): 5 pending prompts, 4 MB + 1 B · replay runs · 4 sent, 1 dropped, blocking counter 1, transcript counter unchanged — same exemplar as 5.1
- [x] 5.3 E3 — ceiling boundary (test-plan #E3, automated): 1 pending prompt at exactly 5 MB then 5 MB + 1 B · replay per value · sent, then dropped with blocking counter +1 — same exemplar as 5.1
- [x] 5.4 E4 — nominal buffer (test-plan #E4, automated): 1 pending prompt at 1 MB · replay runs · ordinary path, neither counter moves — same exemplar as 5.1
- [x] 5.5 E5 — transcript frame still shed (test-plan #E5, automated): transcript `event` frame at 4 MB + 1 B · live broadcast · dropped, transcript counter +1, blocking unchanged — see `packages/server/src/__tests__/browser-gateway-load.test.ts`
- [x] 5.6 E6 — notify replay stays guarded (test-plan #E6, automated): 3 retained notify rows at 4 MB + 1 B · `replayNotifyLog` · all dropped as transcript, no exemption — see `packages/server/src/__tests__/ui-modules-replay.test.ts`
- [x] 5.7 E7 — token serves every prompt (test-plan #E7, automated): recorded token, bridge reply with 2 prompts · both routed · both delivered to the recorded socket only, token still resolvable, both re-tracked — see `packages/server/src/pairing/__tests__/subagent-resync-routing.test.ts` + `packages/server/src/__tests__/prompt-derived-tool-state.integration.test.ts`
- [x] 5.8 E8 — TTL boundary (test-plan #E8, automated): token at t0 · reply at t0+29.9 s, fresh token at t0+30.1 s · unicast, then fan-out — see `subagent-resync-routing.test.ts`
- [x] 5.9 E9 — requester socket gone (test-plan #E9, automated): token recorded then socket closed · reply arrives · fan-out fallback, no throw, registry size 0 — see `subagent-resync-routing.test.ts`
- [x] 5.10 E10 — empty pending set (test-plan #E10, automated): bridge `PromptBus.pending` empty · resync received · zero frames, no error — see `packages/extension/src/__tests__/prompt-bus.test.ts`
- [x] 5.11 E11 — status decision table (test-plan #E11, automated): pending / answered / dismissed / cancelled entries · each reset site · only pending entries and rows survive — see `packages/client/src/lib/__tests__/event-reducer.test.ts`
- [x] 5.12 E12 — all five reset sites (test-plan #E12, automated): one pending request · `event_replay`, `session_state_reset`, `applyReplay`, `useSessionState` reset, refresh reset · request + row present after each, no duplicate row — see `packages/client/src/lib/__tests__/event-reducer.test.ts` + `packages/client/src/hooks/__tests__/useSessionState.test.ts`
- [x] 5.13 E13 — pairing invariant (test-plan #E13, automated): carried request with a `toolCallId` · replay rebuilds the tool card, reorder runs · `derivePendingFreeFloating` resolves it, exactly one `ui-` row — see `packages/client/src/lib/__tests__/event-reducer.test.ts`
- [x] 5.14 E14 — detector decision table (test-plan #E14, automated): 5 flags crossed · selector evaluated per cell · affordance true in exactly one cell — colocate with the selector under `packages/client/src/lib/session/__tests__/`
- [x] 5.15 E15 — grace boundary (test-plan #E15, automated): desync established, fake timers · advance 4.9 s then 5.1 s · no affordance, then affordance — same exemplar as 5.14
- [x] 5.16 E16 — no bridge connected (test-plan #E16, automated): session without a bridge · resync received · dropped, pending registry size unchanged — see `packages/server/src/__tests__/browser-gateway-register-handler.test.ts`

## 6. Folded scenarios — L1 performance

- [x] 6.1 P1 — saturating replay invariant (test-plan #P1, automated): 2000-event replay on a non-draining stub socket past 4 MB with 1 pending prompt · one replay · blocking-frame drops 0 and the prompt frame observed after the last batch — see `packages/server/src/__tests__/subscription-handler-window.test.ts` + `helpers/draining-ws.ts`
- [x] 6.2 P2 — bound soak (test-plan #P2, automated): 100 sequential resync deliveries to a never-draining socket · 100 iterations · `bufferedAmount` never exceeds 5 MB + one frame, exempted bytes ≤ 1 MB — see `packages/server/src/__tests__/draining-ws.test.ts`

## 7. Folded scenarios — L1 error handling

- [x] 7.1 X1 — resync send fails (test-plan #X1, automated): send throws / socket closed · `refreshChat` invoked · reset + subscribe still issued, no unhandled rejection — see `packages/client/src/lib/__tests__/refresh-chat.test.ts`
- [x] 7.2 X2 — old bridge (test-plan #X2, automated): bridge without the handler · request forwarded · no reply, no error, registry unchanged — see `packages/extension/src/__tests__/prompt-bus-wiring.test.ts`
- [x] 7.3 X3 — unknown token (test-plan #X3, automated): reply with a never-recorded token · routing runs · ordinary fan-out, no throw — see `subagent-resync-routing.test.ts`
- [x] 7.4 X4 — answer races resync (test-plan #X4, automated): prompt answered while resync in flight · reply arrives for the resolved id · client holds no dialog, bridge ignores a late answer for an unknown id — see `packages/extension/src/__tests__/prompt-bus-inflight-settle.test.ts`
- [x] 7.5 X6 — closed socket (test-plan #X6, automated): target `readyState` ≠ OPEN · pending-prompt replay runs · no send, counters intact, no throw — see `packages/server/src/__tests__/browser-gateway-dropped-frames.test.ts`

## 8. Folded scenarios — L3 Playwright (docker harness, derived port from `.pi-test-harness.json`)

- [x] 8.1 Resolve the two L3 infra gaps named in `test-plan.md` "New infra needed" before authoring F1/F4 — prefer a test-only `MAX_WS_BUFFER` knob for saturation and an in-page state-reset hook for the desync condition; verify by driving F1 red before the fix and green after
- [x] 8.2 F1 — refresh restores the dialog (test-plan #F1, automated): harness session with an unanswered `ask_user` select prompt + saturating replay volume · click the header refresh · exactly one dialog with the original question and options — see `tests/e2e/faux-ask.spec.ts` + `tests/e2e/large-session-replay.spec.ts`
- [x] 8.3 F2 — reply races replay (test-plan #F2, automated): resync reply delivered mid-replay · replay completes · exactly one dialog, no duplicate `ui-` row — see `tests/e2e/replay-delta-on-reload.spec.ts`
- [x] 8.4 F3 — double refresh idempotent (test-plan #F3, automated): `input`-type dialog with half-typed text · click refresh twice · one dialog, typed text preserved — see `tests/e2e/optimistic-prompt.spec.ts`
- [x] 8.5 F4 — affordance appears and repairs (test-plan #F4, automated): client state cleared out-of-band, server still tracking · wait past 5 s · affordance appears, activating it renders the dialog and clears the affordance — see `tests/e2e/replay-in-flight-pill.spec.ts`
- [x] 8.6 F5 — multi-client isolation (test-plan #F5, automated): two browser contexts, A resyncs · A's reply routes · A renders the dialog, B's rendered state unchanged — see `tests/e2e/automation-fanout.spec.ts`
- [x] 8.7 F6 — answered prompt not resurrected (test-plan #F6, automated): prompt answered then refresh · replay rebuilds · no dialog reappears, answer row remains — see `tests/e2e/faux-ask.spec.ts`
- [x] 8.8 F7 — ended session (test-plan #F7, automated): ended session with lingering `ask_user` · view past the grace period · no affordance — see `tests/e2e/ended-session-endedat.spec.ts`
- [x] 8.9 X5 — bridge death (test-plan #X5, automated): bridge killed with a prompt pending · activate the affordance · no dialog, session surfaces its disconnected state — see `tests/e2e/bridge-contention-health.spec.ts`

## 9. Manual verification, quality gates, docs

- [x] 9.1 F8 (test-plan: manual-only) — look at the resync affordance in the session view and confirm it reads as "needs you" rather than an error; no automated assertion
- [x] 9.2 Run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and confirm the summary reports zero failures
- [x] 9.3 Rebuild per the `implement` matrix (extension → `npm run reload`, server → `/api/restart`, client → `npm run build` + restart) and reproduce the original failure shape by hand: subscribe to a large session with a live prompt and confirm the dialog renders
- [x] 9.4 Run `npm run quality:changed` and clear new Biome findings on the touched files
- [x] 9.5 Delegate the `docs/architecture.md` update to DocScribe in caveman style (prompt delivery + resync round trip, the two exemption bounds, the five client reset sites); apply the returned directory `AGENTS.md` rows for every touched file
