# Tasks

## 1. Spike: hand-off timing inside turn_end

- [x] 1.1 Write a throwaway pi extension that, in an awaited `turn_end` handler gated on `outcome === "completed"`, calls `pi.sendUserMessage("spike", { deliverAs: "steer" })` and yields one macrotask; run a 2-turn tool task in real pi 1.5.0 and verify the steer is delivered before the next LLM call; repeat with two sends under `steeringMode: "all"` and verify delivery order (record in design.md D2)
- [x] 1.2 Repeat 1.1 with a second extension whose `input` handler awaits 50 ms; record whether the steer lands in the same boundary or one later (record in design.md D4)

## 2. Shared protocol

- [x] 2.1 Add `SteerEntryView { id, text, imageCount }` to `packages/shared/src/types.ts`; type `pendingQueues.steering` and `queue_update.steering` (`protocol.ts`) as `(SteerEntryView | string)[]`; add `remove_steering_entry` / `clear_steering_entries` to `browser-protocol.ts`, `protocol.ts` and `ws-message-tiers.ts`; verify `npx tsc -p packages/shared --noEmit` and the `ws-message-tiers` tests pass
- [x] 2.2 Test (test-plan #E28), exemplar `packages/server/src/identity/__tests__/ws-message-tiers.test.ts`: new message types in tier + scope maps · coverage tests re-derive the union · both types present, tests pass

## 3. Bridge steer buffer

- [x] 3.1 Create `packages/extension/src/steer-buffer.ts` (`createSteerBuffer(instanceNonce)`: `<nonce>:<seq>` ids, `views`, `push` with follow-up cap/byte ceiling, `removeById`, `clear`, `take(mode)`, `shift`); verify unit tests for cap, ceiling, id uniqueness across two instances, take order
- [x] 3.2 Route streaming steers into the steer buffer at BOTH sites (`command-handler.ts` passthrough and `bridge.ts` `sessionPrompt` fallback) with follow-up image validation + `command_feedback` on drops/refusal; split routing into `bufferFollowUp` / `bufferSteer` (never route steers to `bridgeFollowUp`); ack without `promptId` and keep it on the entry; keep idle steer direct; delete `bridgeSteering` / `recordSteerSent` and the steer branch of the `message_start` matcher (`bridge.ts`, `bridge-handlers/instance.ts`, `forwarders.ts`); verify routing, ack and matcher tests
- [x] 3.3 Hand off in `registerTurnEnd` (`bridge-handlers/lifecycle.ts`): gate on `outcome === "completed"`, take per `pi.getSettings().steeringMode ?? "one-at-a-time"`, remove + `queue_update` synchronously, then send oldest-first with a macrotask yield after each and `prompt_received { fresh: false, promptId }` per entry; verify tests for one-at-a-time, all-mode order, aborted/error no hand-off, images in content, cancel-during-yield refusal; add a contract test asserting installed pi's `agent-loop.js` emits `turn_end` before `getSteeringMessages()` on completed turns
- [x] 3.4 Generalise the settle drain (`bridge.ts` `drainFollowupQueue`, `followup-drain.ts`): ship the oldest held steer (with images and `promptId` ack) before follow-ups, one per settle, same lock/gates; verify tests for post-last-turn, aborted settle, and steer-before-follow-up ordering
- [x] 3.5 Handle `remove_steering_entry` / `clear_steering_entries` in `bridge-handlers/dispatch.ts` with "already sent or cancelled" `command_feedback` for unknown ids; update `bridge-no-queue-mutation.test.ts` (keep `clear_steering_queue`, `clear_followup_slot`, `edit_followup_slot` asserted deleted; drop its `bridgeSteering.push` model); verify tests
- [x] 3.6 Emit `queue_update` with current buffers (empty included) on every register / re-register; verify a test where a reloaded bridge with empty buffers clears a non-empty server cache
- [x] 3.7 Update `packages/extension/src/AGENTS.md` and `bridge-handlers/AGENTS.md` rows for touched/new files; verify rows name the new symbols
- [x] 3.8 Test (test-plan #E1), exemplar `packages/extension/src/__tests__/command-handler.test.ts`: streaming, empty buffers · `send_prompt` steer with 1 png · `sendUserMessage` 0×, 1 entry, one `queue_update` `{id,text,imageCount:1}`
- [x] 3.9 Test (test-plan #E2), exemplar `packages/extension/src/__tests__/bridge-shadow-queue-gate.test.ts`: idle, fake pi flips streaming inside send · steer `hello` · direct `sendUserMessage` 1×, steer buffer empty, no chip
- [x] 3.10 Test (test-plan #E3), exemplar `packages/extension/src/__tests__/bridge-shadow-queue-gate.test.ts`: streaming · slash-route `sessionPrompt` fallback steer · entry buffered, `sendUserMessage` 0×
- [x] 3.11 Test (test-plan #E4), exemplar `packages/extension/src/__tests__/command-handler.test.ts`: delivery {steer,followUp} × streaming {t,f} · `send_prompt` · steer+stream→steer buffer only; followUp+stream→`bridgeFollowUp` only; idle→direct send
- [x] 3.12 Test (test-plan #E5), exemplar `packages/extension/src/__tests__/command-handler.test.ts`: streaming, `promptId:"p1"` · send steer then completed `turn_end` · first ack no `promptId`; hand-off ack `{fresh:false,promptId:"p1"}`
- [x] 3.13 Test (test-plan #E6), exemplar `packages/extension/src/__tests__/command-handler.test.ts`: held steer `promptId:"p1"` · cancel, then `turn_end` + settle · no ack ever carries `p1`
- [x] 3.14 Test (test-plan #E7), exemplar `packages/extension/src/__tests__/followup-buffer.test.ts`: 19/20 held · push 20th/21st · 20th admitted; 21st refused whole + `command_feedback` `send_prompt`; follow-up buffer unaffected
- [x] 3.15 Test (test-plan #E8), exemplar `packages/extension/src/__tests__/followup-buffer.test.ts`: buffer at ceiling − N · push N / N+1 bytes · N admitted; N+1 refused whole, images not stripped, feedback names limit
- [x] 3.16 Test (test-plan #E9), exemplar `packages/extension/src/__tests__/command-handler.test.ts`: streaming steer with valid + oversized image · admission · entry keeps 1 image; feedback names the dropped image
- [x] 3.17 Test (test-plan #E10), exemplar `packages/extension/src/__tests__/followup-buffer.test.ts`: two buffer instances, 3 pushes each · compare ids · 6 distinct ids, ordered within an instance
- [x] 3.18 Test (test-plan #E11), exemplar `packages/extension/src/__tests__/bridge-followup-queue-drain.test.ts`: outcome {completed,aborted,error} × mode {one-at-a-time,all,undefined} × held {0,1,2} · `turn_end` · completed: oldest / all sent; aborted/error: 0 sends; held 0: no `queue_update`
- [x] 3.19 Test (test-plan #E12), exemplar `packages/extension/src/__tests__/bridge-followup-queue-drain.test.ts`: `all`, held `a`,`b` · completed `turn_end` · one empty `queue_update` before first send; order `a`,`b`; macrotask between sends
- [x] 3.20 Test (test-plan #E13), exemplar `packages/extension/src/__tests__/bridge-followup-queue-drain.test.ts`: held text + 2 images · completed `turn_end` · content `[text,img1,img2]`, `deliverAs:"steer"`
- [x] 3.21 Test (test-plan #E14), exemplar `packages/extension/src/__tests__/bridge-followup-mutation.test.ts`: `all`, held `1`,`2` · remove `2` during yield after sending `1` · feedback "already sent or cancelled"; `2` still sent
- [x] 3.22 Test (test-plan #E15), exemplar `packages/extension/src/__tests__/bridge-followup-mutation.test.ts`: held `1`,`2` · `remove_steering_entry{id:"2"}` · buffer `[1]`, one `queue_update`, no pi call
- [x] 3.23 Test (test-plan #E16), exemplar `packages/extension/src/__tests__/bridge-followup-mutation.test.ts`: held `1` · remove unknown id · buffers unchanged; feedback "already sent or cancelled"
- [x] 3.24 Test (test-plan #E17), exemplar `packages/extension/src/__tests__/bridge-followup-mutation.test.ts`: held `1`,`2`,`3`, follow-up `[b]` · `clear_steering_entries` · steer buffer empty, follow-up `[b]`, one `queue_update`
- [x] 3.25 Test (test-plan #E18), exemplar `packages/extension/src/__tests__/bridge-queue-update-forward.test.ts`: held `hello` · user `message_start` `hello` · steer buffer unchanged, no `queue_update`
- [x] 3.26 Test (test-plan #E19), exemplar `packages/extension/src/__tests__/forwarders-followup-drain.test.ts`: held `a` (p2), follow-up `[b]`, idle, no pending · `agent_settled` ×2 · settle 1 sends `a` + ack p2, keeps `b`; settle 2 sends `b`
- [x] 3.27 Test (test-plan #E20), exemplar `packages/extension/src/__tests__/followup-drain.test.ts`: held `a`; isIdle {t,f} × hasPending {t,f} · `agent_settled` · only idle∧¬pending sends `a`
- [x] 3.28 Test (test-plan #E21), exemplar `packages/extension/src/__tests__/forwarders-followup-drain.test.ts`: held `a`, abort issued · `agent_settled{aborted:true}` · `a` gets the same verdict as a follow-up in that position
- [x] 3.29 Test (test-plan #E22), exemplar `packages/extension/src/__tests__/bridge-followup-mutation.test.ts`: held `a`, follow-up `[b]` · `abort` · both unchanged, no `queue_update` from abort
- [x] 3.30 Test (test-plan #E23), exemplar `packages/extension/src/__tests__/bridge-followup-multi-entry.test.ts`: both buffers non-empty with images · `session_start{reason:"resume"}` · both empty, byte totals 0, one empty `queue_update`
- [x] 3.31 Test (test-plan #E24), exemplar `packages/extension/src/__tests__/bridge-queue-update-forward.test.ts`: fresh bridge, empty buffers · register / re-register · empty `queue_update` on each
- [x] 3.32 Test (test-plan #E25), exemplar `packages/extension/src/__tests__/commit-draft-agent-session.test.ts`: installed pi-agent-core loop, stub stream (tool turn → text), `finishTurn` enqueues a steer · run · steer delivered before 2nd LLM call; aborted stub → no steer poll after `turn_end`
- [x] 3.33 Test (test-plan #E26), exemplar `packages/extension/src/__tests__/bridge-no-queue-mutation.test.ts`: `packages/extension/src` · grep + dispatch `clear_steering_queue`, `clear_followup_slot`, `edit_followup_slot` · 0 `pi.clear*Queue(` calls; deleted types no-op
- [x] 3.34 Test (test-plan #X1), exemplar `packages/extension/src/__tests__/bridge-followup-queue-drain.test.ts`: fake send whose prompt rejects async · completed `turn_end` with held `a` · handler resolves, buffer empty, no retry, no unhandled rejection
- [x] 3.35 Test (test-plan #X2), exemplar `packages/extension/src/__tests__/bridge-followup-queue-drain.test.ts`: `pi.getSettings` throws · completed `turn_end` with held `a` · one-at-a-time fallback, `a` sent, usage drain still runs
- [x] 3.36 Test (test-plan #X5), exemplar `packages/extension/src/__tests__/bridge-followup-mutation.test.ts`: `remove_steering_entry` with missing / non-string id · dispatch · buffers unchanged, no throw, no pi call
- [x] 3.37 Test (test-plan #E35), exemplar `packages/extension/src/__tests__/followup-drain.test.ts`: held `s`, follow-up empty, idle, no pending · `agent_settled` · `s` sent with no `deliverAs`; both buffers empty → bail before idle check

## 4. Server relay

- [x] 4.1 Relay the two messages in `browser-handlers/session-action-handler.ts` and `pairing/browser-gateway.ts`, register them in `identity/ws-message-scope.ts`, and note in `acp-bridge/server-requests.ts` that ACP sessions drop them; verify server tests for pass-through, `ws-message-scope` coverage, and verbatim `pendingQueues.steering` caching (objects and legacy strings)
- [x] 4.2 Update `packages/server/src/**/AGENTS.md` rows for touched files
- [x] 4.3 Test (test-plan #E27), exemplar `packages/server/src/__tests__/session-action-handler-followup-queue.test.ts`: session `S` with bridge · browser sends remove + clear · bridge of `S` receives both unchanged; no other bridge does
- [x] 4.4 Test (test-plan #E29), exemplar `packages/server/src/__tests__/event-wiring-queue-state.test.ts`: `queue_update` with object steering then legacy string steering · event-wiring · cache equals each payload; broadcast has no image `data`
- [x] 4.5 Test (test-plan #X3), exemplar `packages/server/src/__tests__/session-action-handler-followup-queue.test.ts`: bridge of `S` disconnected · browser remove · no throw, nothing forwarded, no broadcast
- [x] 4.6 Test (test-plan #X4), exemplar `packages/server/src/acp-bridge/__tests__/server-requests.test.ts`: ACP session · `remove_steering_entry` arrives · dropped silently, ACP queue unchanged

## 5. Client

- [x] 5.1 Extract `PendingSteerCard` from `ChatView.tsx:2653-2662` (key `id`, `STEERING` header, ✕ in body row, image badge) and `Clear all` below the stack from two entries, sharing class constants with `QueuePanel` / `QueueLane`; invert `components/__tests__/ChatView.inline-steer.test.tsx` no-cancel assertion; verify component tests and the mockup testids
- [x] 5.2 Wire cancel / clear-all dispatch, normalise legacy `string` entries (no cancel), retype `EMPTY_STEERING` (`App.tsx`) / `EMPTY_STEERING_TEXTS` (`ChatView.tsx`), key `lib/chat/live-arrival.ts` by `id`, update `SessionCard.tsx`; verify client tests and client `tsc`
- [x] 5.3 Verify against the accepted mock `mockups/2026-11-12-steer-cancel-images` (minus the dropped Delivering steps) in dark and light (isolated env, non-8000 port); update `packages/client/src/components/chat/AGENTS.md` and `lib/chat/AGENTS.md` rows

- [x] 5.4 Test (test-plan #E30), exemplar `packages/client/src/components/__tests__/ChatView.inline-steer.test.tsx`: entries `{1,x,0}`,`{2,y,2}` · render · cancel controls 1 and 2; attachments badge only on 2 showing `2`; header STEERING
- [x] 5.5 Test (test-plan #E31), exemplar `packages/client/src/components/__tests__/ChatView.inline-steer.test.tsx`: 0 / 1 / 2 entries · render · clear-all absent at 0 and 1, present at 2
- [x] 5.6 Test (test-plan #E32), exemplar `packages/client/src/components/__tests__/ChatView.inline-steer.test.tsx`: entry `1`, confirm spy · click cancel; click clear-all with 2 entries · WS `remove_steering_entry{id:"1"}` / `clear_steering_entries`; confirm 0×
- [x] 5.7 Test (test-plan #E33), exemplar `packages/client/src/components/__tests__/ChatView.inline-steer.test.tsx`: `["focus on X", {id:"2"...}]` · render · 2 STEERING bubbles; cancel only on the object entry
- [x] 5.8 Test (test-plan #E34), exemplar `packages/client/src/lib/chat/__tests__/live-arrival.test.ts`: two entries, same text, ids `1`,`2` · arrival map + render · 2 distinct keys, no duplicate-key warning
- [x] 5.9 Test (test-plan #F1), exemplar `tests/e2e/followup-image-queue.spec.ts`: `[[faux:slow-stream]]` · steer with 2 images via composer · 1 `pending-steer-card` with attachments `2` and a cancel control
- [x] 5.10 Test (test-plan #F2), exemplar `tests/e2e/followup-image-queue.spec.ts`: `[[faux:slow-stream]]`, steers `s-a`,`s-b`,`s-c` · ✕ on `s-b`, then Clear all · 2 → 0 cards; after settle none of the three in transcript
- [x] 5.11 Test (test-plan #F3), exemplar `tests/e2e/followup-settle-drain.spec.ts`: single-turn slow stream, steer `s-late` held · run settles · 0 cards; one user bubble `s-late` below the assistant text
- [x] 5.12 Test (test-plan #F4), exemplar `tests/e2e/followup-settle-drain.spec.ts`: new faux slow-tool→text scenario in `qa/fixtures/faux-scenarios.ts` · steer `s-mid` during tool turn · card gone; `s-mid` bubble before final assistant text in DOM order
- [x] 5.13 Test (test-plan #F5), exemplar `tests/e2e/composer-liveness-reload.spec.ts`: steer held during slow stream · reload the bridge · converges to 0 `pending-steer-card`
- [x] 5.14 Test (test-plan #F6), exemplar `tests/e2e/followup-image-queue.spec.ts`: 2 held steers, one with images · render · each ✕ right edge within 1 px of its bubble's right padding edge, same offset in both
- [ ] 5.15 Manual check (test-plan: manual-only, #F7): compare the chat tail with 2 steers + dock in dark and light against `mockups/2026-11-12-steer-cancel-images`; controls read as the follow-up controls

## 6. Docs + integration

- [x] 6.1 Delegate a DocScribe update of `docs/architecture.md` queue section (steer buffer, completed-turn hand-off, settle drain, re-announce on register, reload drops held steers); verify the doc names `remove_steering_entry` and the hand-off point
- [x] 6.2 Run `npm test` and `npm run quality:changed`; verify both pass

## Workflow follow-up

- Ship via `ship-it` in the worktree; archive after merge.
