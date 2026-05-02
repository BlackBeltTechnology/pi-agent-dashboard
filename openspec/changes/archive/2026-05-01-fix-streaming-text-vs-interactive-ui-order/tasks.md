# Tasks — fix-streaming-text-vs-interactive-ui-order

## 1. Reducer — pure helper

- [x] 1.1 Add `streamingTextFlushed?: boolean` field to `SessionState` (locate the type — likely `packages/client/src/types.ts` or `packages/client/src/lib/event-reducer.ts`).
- [x] 1.2 Implement the pure helper `flushStreamingTextAsAssistantRow(state, timestamp): SessionState` in `event-reducer.ts`. Idempotent (no-op if `streamingTextFlushed` is true). Returns state unchanged if `streamingText` is empty.
- [x] 1.3 Document the helper inline (link back to `change: fix-streaming-text-vs-interactive-ui-order`).

## 2. Reducer — wiring

- [x] 2.1 In `message_start` arm: when `msg.role === "assistant"`, set `next.streamingTextFlushed = false`.
- [x] 2.2 In `tool_execution_start` arm: before existing logic, call `flushStreamingTextAsAssistantRow` if `streamingText` is non-empty AND not already flushed.
- [x] 2.3 In `message_update` arm: skip the `next.streamingText = text` assignment when `streamingTextFlushed` is true.
- [x] 2.4 In `message_end` arm: when `streamingTextFlushed` is true, skip the duplicate assistant-row push; still run the reorder pass.

## 3. entryId stamping at `message_end`

The archived `fork-entryid-accuracy` spec mandates that assistant rows obtain `entryId` directly from the `setTimeout(0)`-deferred `message_end` event (no `entry_persisted` back-fill for assistants). Since the flushed row already exists in `messages[]` when `message_end` arrives, we stamp instead of duplicate-push.

- [x] 3.1 Add pure helper `findFlushedAssistantRowIndex(messages: ChatMessage[]): number` returning the index of the most recent `role:"assistant"` row whose `entryId` AND `nonce` are both `undefined`. Scan from the tail with a **hard upper bound**: stop at the first row whose role is in `TURN_BOUNDARY_ROLES` (`user`, `turnSeparator`, `commandFeedback`, `rawEvent`). This clamp prevents R3 cross-message pollution: a prior message's row that never got stamped (e.g. R2 disconnect happened earlier in the session) cannot be matched by a later message's stamp.
- [x] 3.2 In `message_end` (assistant arm), when `streamingTextFlushed` is `true`: locate the flushed row via 3.1 and stamp `entryId` and `nonce` from `data.entryId` / `data.nonce` onto it. Do NOT push a duplicate row.
- [x] 3.3 Test: scenario where flush happens, then `message_end` arrives with `entryId: "abc-123"` — assert the flushed row's `entryId === "abc-123"` after `message_end`.
- [x] 3.4 Test: scenario where two consecutive assistant messages both flush (rare but possible: model emits text → toolCall → model emits another assistant message → text → toolCall) — assert each `message_end` stamps only its own flushed row, not the prior one.
- [x] 3.4a **R3 regression test**: simulate a same-session sequence where message #1 flushes but its `message_end` is never delivered (drop the event), then message #2 starts, flushes, and fires `message_end` with `entryId: "id-2"`. Assert message #2's flushed row gets `id-2` AND message #1's orphan flushed row remains entryId-less (i.e. the scan respected the turn boundary and did NOT pollute). Pin with a `turnSeparator` row inserted between the two messages, since that's the realistic separator the reducer emits.
- [x] 3.4b **R2 regression test**: simulate flush → `tool_execution_start` → (bridge disconnect; no `tool_execution_end`, no `message_end`) → reconnect → replay synthesizes `message_end` carrying `entryId`. Assert the flushed row ends up with the correct entryId. If the synthesized message_end's content does NOT match the flushed row's text (e.g. content was further updated post-disconnect), document the chosen behavior (stamp anyway / push a fresh row / ignore).
- [x] 3.4c **R7 defense-in-depth**: in `message_end` (assistant arm), AFTER stamping/pushing the assistant row, set `next.streamingTextFlushed = false`. This keeps the flag's lifecycle equal to "between message_start and message_end" so a stray `tool_execution_start` arriving before the next `message_start` cannot silently no-op the flush. Test: feed message_end then a stray tool_execution_start with non-empty streamingText — assert flush does fire (the flag was reset by message_end).
- [x] 3.5 Manual verify: Fork button on the flushed bubble works correctly after `message_end` arrives. Acceptable that it's disabled in the brief window between flush and `message_end` arrival (existing fork code already guards on missing `entryId`).

## 4. Reorder helper compatibility

- [x] 4.1 Verify `reorderToolCardsForAssistantMessage` correctly handles the suffix shape `[assistant_flushed, toolResult, interactiveUi]` (K=3 from `[thinking, text, toolCall]`, suffix length may exceed K). Add a regression test asserting the trailing slice matches content-array order.
- [x] 4.1a Verify the `[thinking, text, toolCall]` shape specifically: the `thinking` row is pushed at `thinking_end` (BEFORE the flush); after flush + tool_execution_start, suffix = `[thinking, assistant_flushed, toolResult]`. Assert the helper claims `thinking → thinking row`, `text → assistant_flushed`, `toolCall → toolResult` and produces the suffix unchanged. This pins the dominant ask_user shape from the proposal's session survey.
- [x] 4.1b Verify the long-running bash variant: shape `[text, toolCall]` (no thinking, no prompt). After flush + tool_execution_start, suffix = `[assistant_flushed, toolResult(running)]`. Assert that `tool_execution_update` events that arrive WHILE the tool is still running do NOT mutate the suffix order (`tool_execution_update` updates the toolResult row in place and is not a `message_update` arm — the `streamingTextFlushed` guard is irrelevant here, but the order must still be stable).
- [x] 4.1c **Interleaved free-floating row** (R6 add-on): construct a suffix where, between flush and `message_end`, a row arrives that does NOT belong to the current message's `content[]` (e.g. a `bashOutput` row from a prior still-running tool, or an `interactiveUi` with no `toolCallId`). Assert the reorder helper's `most-recent-unclaimed` rule still claims the correct rows for the current message's content blocks and the free-floater stays in its original relative position. Pin K ≠ suffix length explicitly.
- [x] 4.2 If a `[text, toolCall, text]`-shaped message produces two `text` blocks in `content[]`, decide: do we extend the helper's matching to N:M, or accept that the second text block pushes its own row at `message_end` and lands naturally after the toolCall via the existing logic? Test both shapes and pick the simpler path.

## 5. Tests — reducer

Test file: `packages/client/src/lib/__tests__/event-reducer-streaming-text-flush.test.ts`

- [x] 5.1 Scenario: ask_user blocking flow — assert flushed row appears before toolResult and interactiveUi in `messages[]`; `streamingText === ""` after flush.
- [x] 5.1a Scenario: **long-running bash, no prompt** (the npm-test case from the proposal) — feed `[message_start, partial_message deltas building streamingText="All 63 tests pass. Run full test suite as final guard:", tool_execution_start(bash), tool_execution_update(stdout chunk #1), … (simulated long delay) …, tool_execution_update(stdout chunk #N), tool_execution_end, message_end with content=[text, toolCall]]`. Assert AT EACH STEP between `tool_execution_start` and `message_end`: messages tail = `[…, assistant("All 63…"), toolResult(bash, running)]`, `streamingText === ""`, `streamingTextFlushed === true`, and toolResult row order is index-stable. After `message_end`: no duplicate assistant row, reorder is a no-op.
- [x] 5.1b Scenario: **`[thinking, text, toolCall]` with long-running tool** — same as 5.1a but a `thinking_start` / `thinking_end` precedes the text deltas. Assert `thinking` row sits before the flushed assistant row throughout the running window.
- [x] 5.1c Scenario: **flush + `findActiveInteractiveToolResultIds` interaction** — after flush + tool_execution_start + prompt_request, assert `findActiveInteractiveToolResultIds(messages)` still returns the running toolResult's id (i.e. the helper still pairs the running tool card with the pending `interactiveUi`, and the post-flush layout doesn't break the pairing).
- [x] 5.2 Scenario: non-blocking `[text, toolCall]` — identical observable behavior to current `247df74`-fixed path, no regression.
- [x] 5.3 Scenario: replay (no streamingText ever populates) — flush is no-op; existing message_end reorder produces correct output.
- [x] 5.4 Scenario: `[toolCall]` only (no text) — `streamingTextFlushed` stays false; no extra row.
- [x] 5.5 Scenario: `[text, toolCall, text]` regression — second text appears at message_end, correctly positioned after the toolCall.
- [x] 5.6 Scenario: multiple tool calls `[text, toolCall(t1), toolCall(t2)]` — first tool_execution_start flushes; second is a no-op.
- [x] 5.7 Scenario: idempotent helper — calling the flush helper twice returns state unchanged the second time.
- [x] 5.8 Scenario: `message_start` resets flag — new assistant message starts with `streamingTextFlushed === false`.

## 6. Tests — DOM-level (ChatView)

- [x] 6.1 Render-test in `packages/client/src/__tests__/` (or wherever React Testing Library lives): simulate the live event sequence for an ask_user blocking flow; assert the assistant text bubble's DOM index is LESS THAN the InteractiveUiCard's DOM index (i.e. text rendered above question).
- [x] 6.1a Render-test for the **long-running bash flow**: simulate `[message_start, text deltas, tool_execution_start(bash), tool_execution_update * 5]` without firing `tool_execution_end` or `message_end`. Assert the assistant text bubble's DOM index is LESS THAN the running `ToolCallStep` card's DOM index, and that the streaming-text bubble (the one rendered after `messages.map`) is empty / absent. This is the explicit regression test for the npm-test screenshot.
- [x] 6.2 Render-test for the non-blocking `[text, toolCall]` case: assert order unchanged from current behavior.

## 7. Spec sync

- [x] 7.1 Update `openspec/specs/event-reducer/spec.md` per the spec delta in this change (`specs/event-reducer/spec.md`).
- [x] 7.2 Cross-check no contradictions with the existing "Assistant content-array order preserved in chat" requirement.

## 8. Docs

- [x] 8.1 Update `AGENTS.md` event-reducer entry to mention the new flush behavior and link the change name.
- [x] 8.2 Add a CHANGELOG entry under `## [Unreleased]`: "fix: assistant text now appears before its own ask_user dialog during the live blocking window (fix-streaming-text-vs-interactive-ui-order)".

## 9. Manual QA

- [x] 9.1 Run a real ask_user-bearing pi session (e.g. one of the compsych-letter-framework sessions); confirm the question dialog visually appears BELOW the assistant text bubble during the blocking window.
- [x] 9.1a Run `npm test` (or any 30s+ bash) from a live pi session via the dashboard; confirm the running tool card visually appears BELOW the introducing assistant prose for the entire tool runtime, not just after it completes.
- [x] 9.2 Verify the same in replay (load a session that has an archived ask_user, confirm correct order on replay).
- [x] 9.3 Verify the streaming pulse animation on the assistant bubble is unaffected (no remount when flushed).

## 10. Archive

- [x] 10.1 Move change to `openspec/changes/archive/<date>-fix-streaming-text-vs-interactive-ui-order/` after merge.

## 11. Pre-merge audits & decisions (risk mitigations)

- [x] 11.1 **R1 entryId-consumer audit**: grep `\.entryId` across `packages/client/src/` and classify each consumer:
  - **Tolerates undefined** (e.g. fork button's existing falsy guard) — no action.
  - **Filters by entryId-present** (e.g. selectors that only count "completed" assistants) — document the transient exclusion window in code comments referencing this change name.
  - **Keys data structures by entryId** (e.g. Maps) — verify no key collision between flushed-undefined rows; either gate on entryId-present at insertion or fall back to nonce/`id`.
  Output: short table in design.md listing each consumer and its classification.
- [x] 11.2 **R4 streaming-pulse decision**: pick one and document in design.md:
  - **(a) Accept**: flushed bubble is visually finalized for the tool's runtime; no extra UI hint. Cheapest; matches behavior on fast tools today.
  - **(b) Add a "persisting" hint**: CSS class on assistant rows where `entryId == null && streamingTextFlushed`-equivalent (e.g. dim border, faint pulse). +5 lines, slight reassurance during long tools.
  Default if no decision: (a). Capture the choice + rationale in design.md before implementation begins.
- [x] 11.3 Document both audit results in design.md under a new "Pre-merge audits" section.
