## 1. Root-cause the harness symptom (systematic-debugging, design D2)

- [ ] 1.1 Rebuild the docker harness from LOCAL code (`docker/test-up.sh`, per `run-dashboard-e2e-local-changes`) and confirm `tests/e2e/faux-text.spec.ts` is red for the stuck-`sending` reason; read the port from `.pi-test-harness.json#dashboardPort`, never `:18000`.
- [ ] 1.2 Re-confirm the REST control on the same container: `POST /api/session/spawn` + `POST /api/session/:id/prompt` with `[[faux:plain-text]] go` answers normally.
- [ ] 1.3 Determine per leg what reaches the browser for a composer-driven send: bridge emits `prompt_received`; `event-wiring.ts:1482` relays it; the browser is in the subscriber set at that instant (`App.tsx:903-932`); `message_start`/`agent_start` forwarded; `applyPromptReceived` runs on the state entry the composer reads.
- [ ] 1.4 Record the verdict (which legs fail, `fresh` value) in the change folder — it picks the fix site for task 3.2.

## 2. Failing tests first (design D7) — L1 rows from test-plan.md

- [ ] 2.1 Composer gate enabled on `sent`: input `pendingPrompt.status="sent"`, `isWorking=false` · trigger `CommandInput` renders · observable textarea+send ENABLED. Extend `packages/client/src/components/__tests__/CommandInput.test.tsx` (test-plan #E1)
- [ ] 2.2 Composer gate disabled on `sending`: input `status="sending"`, `isWorking=false` · trigger render · observable textarea+send DISABLED. Same file as 2.1 (test-plan #E2)
- [ ] 2.3 Composer gate enabled on `failed`: input `status="failed"` · trigger render · observable textarea+send ENABLED. Same file as 2.1 (test-plan #E3)
- [ ] 2.4 Late ack on a failed prompt is a no-op: input state with `status="failed"` · trigger `applyPromptReceived(state,true)` · observable state UNCHANGED. Extend `packages/client/src/lib/__tests__/event-reducer.test.ts` (test-plan #E4)
- [ ] 2.5 Late ack on a sent prompt is a no-op (non-regression): input `status="sent"` · trigger `applyPromptReceived(state,true)` · observable UNCHANGED. Same file as 2.4 (test-plan #E5)
- [ ] 2.6 `fresh:false` drops the bubble and leaves `pendingQueues` untouched: input `status="sending"` · trigger `applyPromptReceived(state,false)` · observable `pendingPrompt===undefined`. Same file as 2.4 (test-plan #E6)
- [ ] 2.7 `fresh:true` promotes: input `status="sending"` · trigger `applyPromptReceived(state,true)` · observable `status==="sent"`, text+images preserved. Same file as 2.4 (test-plan #E7)
- [ ] 2.8 Failed render arm: input `pendingPrompt={text:"hi",status:"failed"}` · trigger `ChatView` renders · observable failed affordance, NOT the emerald `sent` tick, text `hi` still visible. New sibling of `packages/client/src/components/chat/__tests__/ChatView.replay-in-flight-pill.test.tsx` (test-plan #F3)
- [ ] 2.9 Reset/replay does not resurrect `sending`: input state carrying `status="sending"` · trigger `session_state_reset` + `event_replay` reset branch · observable no `sending` pendingPrompt. Update the existing `sending`-carry assertions in `packages/client/src/__tests__/use-message-handler-pending-prompt.test.ts:100,:122` and `packages/client/src/hooks/__tests__/useSessionState.test.ts:55,:143` (test-plan #F4)
- [ ] 2.10 Settled carry preserved (non-regression vs `preserve-pending-prompt-across-replay`): input state carrying `status="sent"` · trigger same resets · observable bubble survives as `sent`. Same files as 2.9 (test-plan #F5)
- [ ] 2.11 Timeout produces a failed bubble, not a drop: fault ack+`message_start` suppressed · trigger 30s `TIMEOUT_MS` with `status="sending"`, unpaused · observable `status==="failed"` with text preserved AND `lastError` set. Extend `packages/client/src/hooks/__tests__/usePendingPromptTimeout.test.ts` (test-plan #X1)
- [ ] 2.12 Timer does not re-arm on `failed`: input `status="failed"` · trigger a further 30s · observable `pendingPrompt` still `failed`, arming predicate is `status==="sending"` not `!!pendingPrompt`. Same file as 2.11 (test-plan #X2)
- [ ] 2.13 Unsubscribed quick-send settles: input `handleSendPromptToSession` for a NON-selected session, no ack/`message_start` reachable · trigger timeout · observable that session's `pendingPrompt.status==="failed"`. Extend `packages/client/src/hooks/__tests__/useSessionActions.optimistic-prompt.test.tsx` (test-plan #X3)
- [ ] 2.14 Mid-turn semantics unchanged: input session `isStreaming=true` · trigger `handleSend` · observable NO `pendingPrompt` written, `pendingQueues` path unaffected. Same file as 2.13 (test-plan #X4)
- [ ] 2.15 Run the new/updated L1 tests and confirm they are RED on today's code before implementing.

## 3. Implementation

- [ ] 3.1 D1 — make the composer gate status-aware: `App.tsx:1848` derives from `status === "sending"`; reconcile `CommandInput.tsx:79` prop type and `:704` `=== true` comparison, and update the literal-`true` fixtures in `CommandInput.test.tsx`.
- [ ] 3.2 D2 — land the minimal fix at the leg identified in 1.4 (client handler/reducer, or server `event-wiring`/browser-gateway subscription).
- [ ] 3.3 D4 — add `"failed"` to `PendingPrompt.status`; the 30s timeout handler (`App.tsx:1102-1106`) sets it instead of clearing, and KEEPS setting `lastError` (chosen two-surface behaviour).
- [ ] 3.4 D4 — change the timeout arming predicate (`App.tsx:1097`) from `!!pendingPrompt` to `status === "sending"` so a failed bubble is never wiped; keep the existing `paused` mid-turn suppression.
- [ ] 3.5 D4 — extend the `applyPromptReceived` terminal guard (`event-reducer.ts:225`) to cover every settled status, not just `sent`.
- [ ] 3.6 D4 — add the third render arm in `ChatView.tsx:1378-1393` for `failed` (text preserved, clearly not a success tick).
- [ ] 3.7 D5 — at the carry sites (`useMessageHandler.ts:398-400,669-671`; `useSessionState.ts:71-72,103`) stop restoring a `sending` prompt while preserving `sent`/`failed` carry.
- [ ] 3.8 D3 — verify the `message_start` (`event-reducer.ts:1408`) and `agent_start` (`:1209`) clears are left untouched.

## 4. Acceptance

- [ ] 4.1 All L1 tests from §2 green; `npm test` green (pipe once to `/tmp/pi-test.log`, grep the summary).
- [ ] 4.2 `tests/e2e/faux-text.spec.ts` passes: fresh spawned session in the harness, composer text `[[faux:plain-text]] go` · trigger send · observable within **15s** the card shows `sent` (never `failed`), composer re-enabled, scripted answer rendered. Copy harness glue from an existing spec, e.g. `tests/e2e/chat-attachment-two-phase.spec.ts` (test-plan #F1)
- [ ] 4.3 `tests/e2e/faux-ask.spec.ts` passes: `[[faux:ask-select]] pick` · trigger send · observable within **15s** card `sent`, composer enabled, interactive option button rendered, no `sending` card. Same exemplar as 4.2 (test-plan #F2)
- [ ] 4.4 Confirm the ACK settled it, not the timeout — the 15s bound is far below `TIMEOUT_MS` 30s, and `failed` must never appear in a green faux run.
- [ ] 4.5 `review-code` pass on the diff; `npm run quality:changed` clean.
- [ ] 4.6 Manual check: failed bubble + `lastError` banner read as ONE failure, retry affordance obvious (test-plan: manual-only, #M1)

## 5. Optional polish (only after §4 is green)

- [ ] 5.1 Widen the `autoStartServer` readiness recheck window so the cosmetic `Dashboard server failed to start: readiness timeout` notice stops appearing on a healthy boot.
- [ ] 5.2 Update the affected directory `AGENTS.md` rows with `See change: fix-optimistic-prompt-stuck-sending`.
