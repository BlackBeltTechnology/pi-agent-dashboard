## Why

When an assistant message contains both narrative text and a tool call in the same Anthropic-messages content array (e.g. `[{type:"text", text:"Now mark group 7+8:"}, {type:"toolCall", name:"edit"}]`), the chat panel renders the tool card **above** its own assistant text. Users perceive this as out-of-order messages — the tool appears to come from nowhere, before the agent has explained what it's about to do.

Empirical scan of 20 recent Opus sessions (3,373 assistant messages total) shows **17–28% of assistant messages** ship `[text, toolCall]` content (median ~22%). On a 200-turn implementation session that's ~40 misordered cards. The bug also reproduces in replay, so reloading the dashboard does not heal it.

Root cause is in `packages/client/src/lib/event-reducer.ts`:

1. `tool_execution_start` immediately pushes a `toolResult` bubble (status `"running"`) onto `messages[]` — this is what makes the spinner feel live.
2. The assistant's text streams via `streamingText` and is **only** pushed to `messages[]` on `message_end`.
3. For `[text, toolCall]` messages the tool block streams alongside (or before) the text terminator, so `tool_execution_start` fires before `message_end`. The two pushes happen in event-arrival order, leaving `[..., ToolCard, AssistantText]` in `messages[]` — the reverse of what the model emitted.

Replay reproduces the bug identically (`packages/shared/src/state-replay.ts` emits `tool_execution_start` for each `toolCall` in the content array **before** emitting `message_end`).

Fix: on every assistant `message_end`, the reducer reorders `messages[]` so the assistant text bubble lands at the position dictated by the **content array order** of its parent message. In practice every API normalizes to text-first today, so this means the assistant text bubble moves to *before* its child tool cards. The fix is API-agnostic — it inherits whatever order pi's API shim chose; it never invents one.

## What Changes

- Add a reorder pass in `event-reducer.ts` `case "message_end"` for assistant messages whose `content` array contains at least one `toolCall` block. The pass walks the parent message's content blocks in order; for each `toolCall` block whose `id` is already present as a `tool-<id>` row in `messages[]`, it relocates that row to come **after** the just-pushed assistant text bubble (or after thinking + text bubbles already placed for this message). Stable order is preserved across multiple tool calls in the same message.
- Match each tool card to its parent assistant message by `toolCallId` (already on `ChatMessage` when role `"toolResult"`). Only tool cards belonging to **this** assistant message are reordered. Tool cards from prior or later messages, retried-error pills, thinking bubbles, and any non-`toolResult` rows are untouched.
- The reducer continues to push the `toolResult` bubble immediately on `tool_execution_start` so the spinner still appears live. The reorder happens at `message_end`, when the parent assistant message lands — usually a few hundred ms later. The visible movement is the assistant text bubble being inserted **above** the spinner; the spinner does not jump.
- Replay path: state-replay's emission order is already `tool_execution_start` → `message_update` → `message_end` for every assistant message. The reducer fix runs on the same event stream and produces the correct order. No `state-replay.ts` change is required, but the test suite gains a replay-fixture round-trip.
- The fix is a no-op for tool-only messages (no text bubble to reorder against), text-only messages (no tool cards), and messages where the natural arrival order already matches content-array order (e.g. tool starts and ends before the next message_end).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `event-reducer`: add a requirement that assistant `message_end` ensures the **content-array order** of text and tool blocks is preserved in `messages[]`. The existing requirement `Tool call state machine` (push on `tool_execution_start`) remains unchanged — both spinner-immediacy and final-order are simultaneously satisfied because the reorder runs at `message_end`.

## Impact

- **Code**: `packages/client/src/lib/event-reducer.ts` — one new helper (`reorderToolCardsForAssistantMessage`) called from the assistant arm of `case "message_end"`. ~30–50 lines + one helper unit-test file.
- **Tests**:
  - New unit tests for the reducer covering: text-then-tool, tool-then-text, multiple tool calls in one message, thinking+text+tool, tool-only (no-op), text-only (no-op), and a tool whose `tool_execution_start` arrives **after** `message_end` (replay edge — must still be a no-op since the tool card is not yet present at the reorder point).
  - One round-trip test that runs `replayEntriesAsEvents` against a fixture session JSONL containing `[text, toolCall]` assistant messages and asserts the resulting `messages[]` is `[..., AssistantText, ToolCard]`.
  - No changes to existing tests. The reorder is invisible to all current scenarios because they exercise either tool-only or text-only paths.
- **Compatibility**: pure client-side change. No protocol, server, bridge, replay-emission, or persistence change. Old session JSONLs replay correctly with the new reducer. New session JSONLs replay correctly with the old reducer (same buggy ordering as today). Forward and backward compatible.
- **Model neutrality**: the fix uses only the assistant `message.content` array order, not API-specific fields. Anthropic-messages, Google Generative AI (`parts`), OpenAI Chat Completions (parallel `content` + `tool_calls` flattened by pi's shim), and OpenAI Responses API all reach the reducer in the same normalized shape, so all four are improved equally and none gets worse.
- **No bridge / pi-protocol changes**: the bug exists today even when pi emits events in the canonical order (text deltas → tool start → message end). The fix lives entirely in the rendering layer.
- **Out of scope**: turn-grouping, mid-turn user-prompt rendering (separate concerns surfaced during exploration but distinct from this bug), state-replay refactor to emit `agent_start`/`agent_end`.
