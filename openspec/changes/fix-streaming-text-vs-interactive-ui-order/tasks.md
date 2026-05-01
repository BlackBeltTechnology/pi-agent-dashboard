# Tasks — fix-streaming-text-vs-interactive-ui-order

## 1. Reducer — pure helper

- [ ] 1.1 Add `streamingTextFlushed?: boolean` field to `SessionState` (locate the type — likely `packages/client/src/types.ts` or `packages/client/src/lib/event-reducer.ts`).
- [ ] 1.2 Implement the pure helper `flushStreamingTextAsAssistantRow(state, timestamp): SessionState` in `event-reducer.ts`. Idempotent (no-op if `streamingTextFlushed` is true). Returns state unchanged if `streamingText` is empty.
- [ ] 1.3 Document the helper inline (link back to `change: fix-streaming-text-vs-interactive-ui-order`).

## 2. Reducer — wiring

- [ ] 2.1 In `message_start` arm: when `msg.role === "assistant"`, set `next.streamingTextFlushed = false`.
- [ ] 2.2 In `tool_execution_start` arm: before existing logic, call `flushStreamingTextAsAssistantRow` if `streamingText` is non-empty AND not already flushed.
- [ ] 2.3 In `message_update` arm: skip the `next.streamingText = text` assignment when `streamingTextFlushed` is true.
- [ ] 2.4 In `message_end` arm: when `streamingTextFlushed` is true, skip the duplicate assistant-row push; still run the reorder pass.

## 3. entryId stamping at `message_end`

The archived `fork-entryid-accuracy` spec mandates that assistant rows obtain `entryId` directly from the `setTimeout(0)`-deferred `message_end` event (no `entry_persisted` back-fill for assistants). Since the flushed row already exists in `messages[]` when `message_end` arrives, we stamp instead of duplicate-push.

- [ ] 3.1 Add pure helper `findFlushedAssistantRowIndex(messages: ChatMessage[]): number` returning the index of the most recent `role:"assistant"` row whose `entryId` AND `nonce` are both `undefined`. Scan from the tail; bounded scan window prevents matching a flushed row from a prior message.
- [ ] 3.2 In `message_end` (assistant arm), when `streamingTextFlushed` is `true`: locate the flushed row via 3.1 and stamp `entryId` and `nonce` from `data.entryId` / `data.nonce` onto it. Do NOT push a duplicate row.
- [ ] 3.3 Test: scenario where flush happens, then `message_end` arrives with `entryId: "abc-123"` — assert the flushed row's `entryId === "abc-123"` after `message_end`.
- [ ] 3.4 Test: scenario where two consecutive assistant messages both flush (rare but possible: model emits text → toolCall → model emits another assistant message → text → toolCall) — assert each `message_end` stamps only its own flushed row, not the prior one.
- [ ] 3.5 Manual verify: Fork button on the flushed bubble works correctly after `message_end` arrives. Acceptable that it's disabled in the brief window between flush and `message_end` arrival (existing fork code already guards on missing `entryId`).

## 4. Reorder helper compatibility

- [ ] 4.1 Verify `reorderToolCardsForAssistantMessage` correctly handles the suffix shape `[assistant_flushed, toolResult, interactiveUi]` (K=3 from `[thinking, text, toolCall]`, suffix length may exceed K). Add a regression test asserting the trailing slice matches content-array order.
- [ ] 4.2 If a `[text, toolCall, text]`-shaped message produces two `text` blocks in `content[]`, decide: do we extend the helper's matching to N:M, or accept that the second text block pushes its own row at `message_end` and lands naturally after the toolCall via the existing logic? Test both shapes and pick the simpler path.

## 5. Tests — reducer

Test file: `packages/client/src/lib/__tests__/event-reducer-streaming-text-flush.test.ts`

- [ ] 5.1 Scenario: ask_user blocking flow — assert flushed row appears before toolResult and interactiveUi in `messages[]`; `streamingText === ""` after flush.
- [ ] 5.2 Scenario: non-blocking `[text, toolCall]` — identical observable behavior to current `247df74`-fixed path, no regression.
- [ ] 5.3 Scenario: replay (no streamingText ever populates) — flush is no-op; existing message_end reorder produces correct output.
- [ ] 5.4 Scenario: `[toolCall]` only (no text) — `streamingTextFlushed` stays false; no extra row.
- [ ] 5.5 Scenario: `[text, toolCall, text]` regression — second text appears at message_end, correctly positioned after the toolCall.
- [ ] 5.6 Scenario: multiple tool calls `[text, toolCall(t1), toolCall(t2)]` — first tool_execution_start flushes; second is a no-op.
- [ ] 5.7 Scenario: idempotent helper — calling the flush helper twice returns state unchanged the second time.
- [ ] 5.8 Scenario: `message_start` resets flag — new assistant message starts with `streamingTextFlushed === false`.

## 6. Tests — DOM-level (ChatView)

- [ ] 6.1 Render-test in `packages/client/src/__tests__/` (or wherever React Testing Library lives): simulate the live event sequence for an ask_user blocking flow; assert the assistant text bubble's DOM index is LESS THAN the InteractiveUiCard's DOM index (i.e. text rendered above question).
- [ ] 6.2 Render-test for the non-blocking `[text, toolCall]` case: assert order unchanged from current behavior.

## 7. Spec sync

- [ ] 7.1 Update `openspec/specs/event-reducer/spec.md` per the spec delta in this change (`specs/event-reducer/spec.md`).
- [ ] 7.2 Cross-check no contradictions with the existing "Assistant content-array order preserved in chat" requirement.

## 8. Docs

- [ ] 8.1 Update `AGENTS.md` event-reducer entry to mention the new flush behavior and link the change name.
- [ ] 8.2 Add a CHANGELOG entry under `## [Unreleased]`: "fix: assistant text now appears before its own ask_user dialog during the live blocking window (fix-streaming-text-vs-interactive-ui-order)".

## 9. Manual QA

- [ ] 9.1 Run a real ask_user-bearing pi session (e.g. one of the compsych-letter-framework sessions); confirm the question dialog visually appears BELOW the assistant text bubble during the blocking window.
- [ ] 9.2 Verify the same in replay (load a session that has an archived ask_user, confirm correct order on replay).
- [ ] 9.3 Verify the streaming pulse animation on the assistant bubble is unaffected (no remount when flushed).

## 10. Archive

- [ ] 10.1 Move change to `openspec/changes/archive/<date>-fix-streaming-text-vs-interactive-ui-order/` after merge.
