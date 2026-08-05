Test tasks below are folded from `test-plan.md`; each carries its manifest id. The manifest — not any tag here — is the source of truth for automated vs manual.

## 1. Gateway accessors + registry lifecycle

- [ ] 1.1 Implement `hasPendingPromptRequests(sessionId): boolean` in `packages/server/src/pairing/browser-gateway.ts` over the existing `pendingPromptRequests` map, mirroring the adjacent `hasPendingUiRequest()` shape; add to the gateway interface
- [ ] 1.2 Implement `reconcilePromptRequests(sessionId, promptIds)` as a snapshot setter over the same map; keep the map unexported (accessors take/return ids and booleans, never prompt payloads)
- [ ] 1.3 Clear both pending registries in `onUnregister` (`event-wiring.ts:462-482`), alongside the `currentTool: null` broadcast it already performs
- [ ] 1.4 Test: registry with 1 tracked prompt for `s1` · call `hasPendingPromptRequests("s1")` · returns `true` (test-plan #E1) — see `packages/server/src/__tests__/browser-gateway-register-handler.test.ts` for gateway harness glue
- [ ] 1.5 Test: registry where `s1`'s last prompt was just cleared · call the accessor · returns `false` and the inner map is deleted, no empty-map leak (test-plan #E2) — see `packages/server/src/__tests__/browser-gateway-register-handler.test.ts`
- [ ] 1.6 Test: registry with no entry for `s9` · call the accessor · returns `false`, no map allocated (test-plan #E3) — see `packages/server/src/__tests__/browser-gateway-register-handler.test.ts`
- [ ] 1.7 Test: session holding a tracked prompt · session unregistered · `hasPendingPromptRequests` returns `false`, other sessions' prompts untouched (test-plan #X7) — see `packages/server/src/__tests__/browser-gateway-register-handler.test.ts`
- [ ] 1.8 Test: session holding a tracked extension-UI request · session unregistered · `hasPendingUiRequest` returns `false` and the session becomes reapable (test-plan #X8) — see `packages/server/src/embed-lifecycle/__tests__/idle-reaper.test.ts`

## 2. Pure precedence rule in event-status-extraction (M1)

- [ ] 2.1 Add a `hasPendingPrompt: boolean` input to `extractSessionUpdates`; when the derived update would leave `currentTool` empty, write `"ask_user"` instead. Keep the function pure — no gateway, no session manager, no socket
- [ ] 2.2 Test: `hasPendingPrompt: true` · extract `tool_execution_start{toolName:"bash"}` · update is `{currentTool:"bash"}`, registry not consulted (test-plan #E4) — see `packages/server/src/__tests__/event-status-extraction.test.ts`
- [ ] 2.3 Test: `hasPendingPrompt: true` · extract `agent_start` · update is `{status:"streaming", currentTool:"ask_user"}` (test-plan #E5) — see `packages/server/src/__tests__/event-status-extraction.test.ts`
- [ ] 2.4 Test: `hasPendingPrompt: true` · extract `agent_end` · update is `{status:"idle", currentTool:"ask_user"}`, confirming the newly-legal status/tool pair (test-plan #E6) — see `packages/server/src/__tests__/event-status-extraction.test.ts`
- [ ] 2.5 Test: `hasPendingPrompt: true` · extract `tool_execution_end` · update is `{currentTool:"ask_user"}` (test-plan #E7) — see `packages/server/src/__tests__/event-status-extraction.test.ts`
- [ ] 2.6 Test: `hasPendingPrompt: false` across all five handled event types · extract each · every update deep-equals the pre-change output (test-plan #E8) — see `packages/server/src/__tests__/event-status-extraction.test.ts`

## 3. Wire the fold to LIVE events only

- [ ] 3.1 Thread `hasPendingPromptRequests(sessionId)` into the ordinary call site (`event-wiring.ts:615`), gated so it applies only when the session is **not** replaying
- [ ] 3.2 Leave the `skipReplayInsert` fast path (`event-wiring.ts:563`) unfolded — it runs only during replay, and the replay exit owns that case
- [ ] 3.3 Test: replaying session with a tracked prompt · stored `agent_end` processed during replay · `currentTool` is `null` from the event alone, fold does not run (test-plan #R1) — see `packages/server/src/__tests__/faux-session.integration.test.ts`
- [ ] 3.4 Test: replaying session in `skipReplayInsert` with a tracked prompt · `agent_start` on that path · no reconciliation applied (test-plan #R2) — see `packages/server/src/__tests__/faux-session.integration.test.ts`

## 4. Direct writes in the prompt_* handlers (M2)

- [ ] 4.1 Set `currentTool` on `prompt_request` subject to the precedence rule; these sibling branches sit outside the `event_forward` block and never reach the extractor
- [ ] 4.2 Clear `currentTool` to `null` on `prompt_dismiss` / `prompt_cancel` only when the registry is now empty **and** the current value is `"ask_user"`
- [ ] 4.3 Evaluate the unread trigger and the `questionFirst` reorder inside the `prompt_request` branch, under the same not-replaying / not-viewed gates, capturing the before-snapshot prior to the write
- [ ] 4.4 Test: session with 2 tracked prompts · `prompt_cancel` clears one · `currentTool` stays `"ask_user"` (test-plan #E9) — see `packages/server/src/__tests__/faux-session.integration.test.ts`
- [ ] 4.5 Test: session with 1 tracked prompt and `currentTool:"ask_user"` · `prompt_dismiss` clears it · `currentTool` is literal `null`, not `undefined` (test-plan #E10) — see `packages/server/src/__tests__/faux-session.integration.test.ts`
- [ ] 4.6 Test: session with `currentTool:"bash"` and 1 tracked prompt · `prompt_dismiss` empties registry · `currentTool` remains `"bash"` (test-plan #E11) — see `packages/server/src/__tests__/faux-session.integration.test.ts`
- [ ] 4.7 Test: session with no `ask_user` tool call, any placement · `prompt_request` arrives · `currentTool` becomes `"ask_user"`, no placement gating (test-plan #E12) — see `packages/server/src/__tests__/faux-session.integration.test.ts`
- [ ] 4.8 Test: live session at `currentTool:null`, not viewed, `questionFirst` on · `prompt_request` arrives · marked unread exactly once and moved to front exactly once (test-plan #F4) — see `packages/server/src/__tests__/session-card-ordering-gates.test.ts`
- [ ] 4.9 Test: live session at `currentTool:null`, not viewed · `prompt_request` **then** `tool_execution_start{ask_user}` · triggers fire exactly once total, not zero and not twice (test-plan #F5) — see `packages/server/src/__tests__/session-card-ordering-gates.test.ts`
- [ ] 4.10 Test: `prompt_request` for a session that is not replaying · message handled · the `currentTool` change reaches browser subscribers (test-plan #R7) — see `packages/server/src/__tests__/faux-session.integration.test.ts`

## 5. Reconcile + recompute at every replay exit

- [ ] 5.1 Collect promptIds seen during the replay window, per session
- [ ] 5.2 At `replay_complete`, run reconcile → recompute → drain, in that order; the recompute is registry-non-empty ⇒ `"ask_user"`, empty ⇒ leave the event-derived value untouched
- [ ] 5.3 Run the same reconcile → recompute → drain on the replay safety-timeout path
- [ ] 5.4 Guard the `replay_complete` handler with `if (replayingSessions.delete(sessionId))` the way the timeout already is, so only the first exit acts; drain applies to the ephemeral collected set only, never the live registry
- [ ] 5.5 Test: `prompt_dismiss` never delivered leaving a stale entry · bridge reconnects re-sending no `prompt_request` for it · entry dropped at the replay exit and `currentTool` becomes `null` (test-plan #X1) — see `packages/server/src/__tests__/faux-session.integration.test.ts`
- [ ] 5.6 Test: 2 tracked prompts, only 1 re-sent · replay exit · re-sent one retained, other dropped, `currentTool` stays `"ask_user"` (test-plan #X2) — see `packages/server/src/__tests__/faux-session.integration.test.ts`
- [ ] 5.7 Test: `replay_complete` never arrives · 5s safety timeout fires · reconcile and recompute run on that path, stale entry does not survive (test-plan #X3) — see `packages/server/src/__tests__/faux-session.integration.test.ts`
- [ ] 5.8 Test: timeout fires at T, late `replay_complete` at T+1s, live `prompt_request` in between · both exits run · the in-between prompt is not dropped and the second exit is a no-op (test-plan #X4) — see `packages/server/src/__tests__/faux-session.integration.test.ts`
- [ ] 5.9 Test: same interleaving as #X4 · both exits run · subscribers receive exactly one `event_replay` (test-plan #X5) — see `packages/server/src/__tests__/faux-session.integration.test.ts`
- [ ] 5.10 Test: session with a genuinely pending prompt · replay exit drains the collected set · live registry keeps the entry and a browser refreshing afterwards still receives the prompt (test-plan #X6) — see `packages/server/src/__tests__/browser-gateway-snapshot-on-connect.test.ts`
- [ ] 5.11 Test: last replayed event was `tool_execution_start{toolName:"Read"}`, reconciled registry empty · replay exit recompute · `currentTool` stays `"Read"`, not reset to `null` (test-plan #R3) — see `packages/server/src/__tests__/faux-session.integration.test.ts`
- [ ] 5.12 Test: last replayed event was `agent_end`, reconciled registry empty · replay exit recompute · `currentTool` is `null` (test-plan #R4) — see `packages/server/src/__tests__/faux-session.integration.test.ts`
- [ ] 5.13 Test: `prompt_request` arrives for a replaying session · message handled · no `session_updated` broadcast for it, and the subsequent `replay_complete` broadcast carries `currentTool:"ask_user"` (test-plan #R6) — see `packages/server/src/__tests__/faux-session.integration.test.ts`

## 6. Reconnect end-to-end state (server)

- [ ] 6.1 Test: session blocked on `ask_user` with 1 tracked prompt · replay `session_register` → `prompt_request` → `replay_complete` → synthetic `agent_start` in that order · converges to `{status:"streaming", currentTool:"ask_user"}` (test-plan #F1) — see `packages/server/src/__tests__/faux-session.integration.test.ts`
- [ ] 6.2 Test: same messages with `prompt_request` and `agent_start` transposed · converges to `currentTool:"ask_user"` and documents the one spurious unread+reorder that ordering costs, pinning the bridge dependency (test-plan #F2) — see `packages/server/src/__tests__/session-card-ordering-gates.test.ts`
- [ ] 6.3 Test: session already at `currentTool:"ask_user"`, not viewed · synthetic `agent_start` arrives · unread flag unchanged and no `sessions_reordered` broadcast (test-plan #F3) — see `packages/server/src/__tests__/is-unread-trigger.test.ts`
- [ ] 6.4 Test: mid-turn session with a genuinely pending prompt, recompute produced `"ask_user"` · trailing synthetic `agent_start` · `currentTool` remains `"ask_user"` (test-plan #R5) — see `packages/server/src/__tests__/faux-session.integration.test.ts`

## 7. Reaper pending-ask union

- [ ] 7.1 Change `embed-lifecycle-controller.ts:73` to `hasPendingAsk: (id) => hasPendingUiRequest(id) || hasPendingPromptRequests(id)`
- [ ] 7.2 Test: at-rest ephemeral session past idle timeout with a PromptBus prompt tracked and `currentTool` forced to `null` · idle gear verdict · `skip("pending-ask")`, veto independent of `currentTool` (test-plan #X9) — see `packages/server/src/embed-lifecycle/__tests__/quiescence.test.ts`
- [ ] 7.3 Test: streaming ephemeral session past the hard ceiling, ~0-CPU, no children/subscriber, PromptBus prompt tracked · phantom force-reap evaluated · not reaped (test-plan #X10) — see `packages/server/src/embed-lifecycle/__tests__/quiescence.test.ts`
- [ ] 7.4 Test: session with only a `pendingUiRequests` entry · both gears evaluated · pending-ask stays `true` exactly as before the union (test-plan #X11) — see `packages/server/src/embed-lifecycle/__tests__/embed-lifecycle-controller.test.ts`
- [ ] 7.5 Test: session with neither registry populated · both gears evaluated · verdicts identical to pre-change (test-plan #X12) — see `packages/server/src/embed-lifecycle/__tests__/quiescence.test.ts`

## 8. Rendered-UI behaviour (Playwright)

- [ ] 8.1 Confirm the docker harness can restart the dashboard server while keeping the pi session alive; if not, add that affordance before authoring 8.2. Read the port from `.pi-test-harness.json` (`dashboardPort`), never hardcode `:18000`
- [ ] 8.2 Test: harness session parked on `ask_user` · restart the dashboard server so the bridge re-registers · card converges to "Needs you" with input-stripes and the header no longer reads "Thinking…" while the prompt dialog is rendered (test-plan #F6) — see `tests/e2e/faux-ask.spec.ts`
- [ ] 8.3 Test: harness session with a widget-bar-placed prompt and no `ask_user` tool call · prompt raised · card shows `⚡ ask_user`, not `Idle`, pinning the accepted D7 outcome (test-plan #F7) — see `tests/e2e/faux-ask.spec.ts`
- [ ] 8.4 Test: harness session showing "Needs you" · answer the prompt in the dashboard · card leaves the needs-you state and `currentTool` clears (test-plan #F8) — see `tests/e2e/faux-ask.spec.ts`

## 9. Manual verification

- [ ] 9.1 Answer a prompt in the TUI with the dashboard open side by side; confirm the dashboard card clears too (test-plan: manual-only, #M1)
- [ ] 9.2 Restart the server and let session `019fcec6-4587-7e2c-bcec-f8e61bc0ce1b` re-register; confirm it shows "Needs you" (test-plan: manual-only, #M2)

## 10. Ship gates

- [ ] 10.1 `npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error|✗|✘' /tmp/pi-test.log` — full suite green
- [ ] 10.2 `curl -X POST http://localhost:8000/api/restart` (server-only, jiti, no build, no extension reload)
- [ ] 10.3 Run `doubt-driven-review` on the diff, focused on the wire-ordering invariant and on the fold/direct-write pair agreeing about precedence
- [ ] 10.4 Run `review-code` before commit
- [ ] 10.5 `npm run quality:changed`
- [ ] 10.6 Update the purpose rows for `event-status-extraction.ts`, `browser-gateway.ts`, `event-wiring.ts`, and `embed-lifecycle-controller.ts` in their directory `AGENTS.md`, each with `See change: restore-ask-user-tool-state-on-reconnect`
- [ ] 10.7 If `docs/architecture.md` gains prose about the derived-field contract or the two prompt registries, delegate the write to `DocScribe` in caveman style
