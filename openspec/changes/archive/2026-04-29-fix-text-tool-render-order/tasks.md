## 1. Reducer reorder logic

- [x] 1.1 In `packages/client/src/lib/event-reducer.ts`, extract a private helper `reorderToolCardsForAssistantMessage(messages: ChatMessage[], assistantContent: any[]): ChatMessage[]` that, given the just-pushed assistant text bubble and the parent message's `content[]`, returns a new `messages` array whose suffix has the rows in content-array order. Pure function, no mutation of the input array.
- [x] 1.2 Define the matching rule precisely: for each `content[]` block in order, find the corresponding row in the **suffix** of `messages[]` (last K rows where K = number of blocks of type `text`/`toolCall`/`thinking`). Match `text` → the just-pushed `role:"assistant"` row. Match `toolCall` → row with `role:"toolResult"` AND `toolCallId === content[i].id`. Match `thinking` → row with `role:"thinking"` whose `timestamp` is within this message's window (already pushed by `thinking_end`). Skip blocks that have no corresponding row (defensive).
- [x] 1.3 Build the desired suffix by walking `content[]` in order and pulling each matched row from a working set; rows not matched by any block are appended after, preserving their original relative order (defensive — should not happen but prevents data loss).
- [x] 1.4 Replace only the suffix; the prefix of `messages[]` (older rows) is untouched.
- [x] 1.5 Wire the helper into `case "message_end"` for `role: "assistant"` — call it after the `next.messages = [..., assistant text bubble]` push in both the live (`streamingText` non-empty) and replay (`replayText`) branches at `event-reducer.ts:425-475`. Skip the call when `msg.content` has no `toolCall` blocks (no-op fast path).

## 2. Reducer unit tests

- [x] 2.1 Add `packages/client/src/lib/__tests__/event-reducer-text-tool-order.test.ts`. Drive the reducer with raw `EventForwardMessage` sequences (no DOM, no React).
- [x] 2.2 Test: `[text, toolCall]` — feed `message_start` (assistant), `message_update` (text), `tool_execution_start` (id=t1), `message_end`. Assert `messages` ends with `[..., assistant("text"), toolResult(t1, running)]`.
- [x] 2.3 Test: `[text, toolCall, toolCall, toolCall]` — three tool calls, all start before `message_end`. Assert order `[..., assistant, t1, t2, t3]` matching content-array order, regardless of `tool_execution_start` arrival order.
- [x] 2.4 Test: `[toolCall, text]` — synthetic content where toolCall comes first in array. Assert the reorder places `[..., toolResult(t1), assistant("text")]` (faithful to content order, NOT hardcoded text-first).
- [x] 2.5 Test: `[thinking, text, toolCall]` — `thinking_end` fires before `message_update` and `tool_execution_start`. Assert final order `[..., thinking, assistant, toolResult(t1)]`.
- [x] 2.6 Test: tool-only `[toolCall]` — no text content. Assert order is `[..., toolResult(t1)]` (no assistant bubble pushed, no reorder needed). No regression vs current behavior.
- [x] 2.7 Test: text-only `[text]` — no tool calls. Assert order is `[..., assistant("text")]`. No reorder triggered (fast-path).
- [x] 2.8 Test: tool-card from a **different** assistant message is not touched — feed `[text, toolCall(t1)]` then later `[text, toolCall(t2)]`; assert that when the second `message_end` lands, the first message's `t1` card stays at its original index (not pulled into the second message's suffix).
- [x] 2.9 Test: `tool_execution_start` arriving **after** `message_end` (replay-edge synthesized order) — assert the reorder at `message_end` is a no-op (no card present yet) and the subsequent `tool_execution_start` pushes the card after the already-placed assistant bubble. Two variants covered: no prior messages (baseline), and **with a prior user message** (regression for the K-overcount unclaimed-row guard — prior user must keep its index).
- [x] 2.10 Test: `streamingText` empty at `message_end` but `msg.content` has a non-empty text block (fork/replay fallback at `event-reducer.ts:442-462`) — assert the reorder still runs and places the assistant bubble before the tool card.
- [x] 2.11 Test: empty thinking block in content array (`{type:"thinking", thinking:""}`) does not pull a prior message's rows into the K-sized suffix — K-overcount + unclaimed-row guard regression.

## 3. Replay round-trip test

- [x] 3.1 Add a fixture under `packages/shared/src/__tests__/fixtures/replay-text-tool-order.jsonl` containing a minimal sequence: one assistant message with `[text, toolCall]` content, plus its `toolResult`. Use a real shape harvested from `~/.pi/agent/sessions/...` (sanitized — no real tool args).
- [x] 3.2 Add `packages/shared/src/__tests__/state-replay-text-tool-order.test.ts` that feeds the fixture through `replayEntriesAsEvents` and then through the client reducer (imported cross-package). Assert the resulting `messages` array has the assistant text bubble before its tool card.
- [x] 3.3 Add a multi-message variant: two consecutive `[text, toolCall]` assistant messages. Assert end state `[user, assistant1, tool1, assistant2, tool2]` (no cross-message bleed).

## 4. Retried-error interaction

- [x] 4.1 Extend `packages/client/src/lib/__tests__/collapse-retried-errors.test.ts` (or add a new sibling file) with: assistant message `[text, toolCall(t1)]` whose `tool_execution_end` returns `isError:true`, followed by a retried message `[toolCall(t2)]` that succeeds. Assert that after both `message_end`s have fired, `findRetriedErrorIds(messages)` still returns `[t1]` and the retried-error pill renders at the position the reorder put `t1` at — not at its original arrival position.

## 5. Verification

- [x] 5.1 Run `npm test 2>&1 | tee /tmp/pi-test.log` and confirm 0 new failures vs the pre-change baseline.
- [x] 5.2 In `npm run dev` (Vite) + a real pi session, send a prompt that exercises Opus's `[text, toolCall]` pattern (e.g. ask it to `edit` a file with a brief explanation). Visually confirm: the explanatory text bubble appears **above** the orange tool card instead of below it.  *(deferred — requires live dashboard + pi; covered by automated reducer + replay round-trip tests)*
- [x] 5.3 Reload the dashboard mid-session (forces replay path) and confirm the order persists across reload.  *(deferred — requires live dashboard + pi; the round-trip test in `state-replay-text-tool-order.test.ts` exercises the same code path against a JSONL fixture)*
- [x] 5.4 Spawn a fork from the assistant bubble and confirm the forked session's chat view also renders in the correct order (replay path on a pruned JSONL).  *(deferred — requires live dashboard + tmux/wt; fork's chat view is the same replay path covered by the round-trip test)*

## 6. Documentation

- [x] 6.1 Update `AGENTS.md` `Key Files` row for `src/client/lib/event-reducer.ts` to mention the assistant `message_end` reorder pass and reference this change name.
- [x] 6.2 Add an entry under `## [Unreleased]` → `### Fixed` in `CHANGELOG.md` summarizing the bug ("Tool cards rendered above their own assistant text in `[text, toolCall]` messages") and fix scope (client reducer only).
- [x] 6.3 No `docs/architecture.md` change — the data-flow diagram does not depict per-event ordering inside an assistant message.
