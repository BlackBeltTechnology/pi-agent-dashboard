## Context

The dashboard's chat panel is driven by a pure event-sourced reducer in `packages/client/src/lib/event-reducer.ts`. The reducer accepts `DashboardEvent`s in arrival order and mutates `SessionState.messages: ChatMessage[]` append-style. The reducer is shared by both the live WebSocket path and the state-replay path (`packages/shared/src/state-replay.ts`), so any fix here covers both reload-after-disconnect and fork/resume.

Two reducer cases interact to produce the bug:

```
case "tool_execution_start"          // event-reducer.ts:481-516
  ─ creates toolCalls.set(id, {status:"running"})
  ─ pushes a ChatMessage { role:"toolResult", id:`tool-${id}`,
                           toolStatus:"running", toolCallId:id, ... }
                           onto messages[] **immediately**

case "message_end"                    // event-reducer.ts:425-475
  ─ for role:"assistant":
      ─ if streamingText is non-empty:
          push ChatMessage { role:"assistant", content:streamingText, ... }
                           onto messages[]
      ─ clears streamingText
```

For a single Anthropic-messages assistant message with content `[{type:"text"}, {type:"toolCall"}]`, the live event sequence is:

```
message_start (assistant)            ─ no-op for assistant in reducer
message_update (text delta...)        ─ streamingText += "..."
message_update (text delta...)        ─ streamingText += "..."
tool_execution_start (toolCall id=X)  ─ push tool-X bubble (running)  ← FIRST
message_end (assistant)               ─ push assistant text bubble    ← SECOND
```

`messages[]` ends up `[..., tool-X, AssistantText]`. ChatView renders them top-to-bottom in that order. The user sees the tool card above the assistant text that was supposed to introduce it.

The same shape repeats in `state-replay.ts:60-78`:

```js
for (const part of content) {
  if (part.type === "toolCall") {
    messages.push(makeEvent(... "tool_execution_start" ...));   // emitted first
  }
}
messages.push(makeEvent(... "message_update" ...));
messages.push(makeEvent(... "message_end" ...));                 // emitted last
```

So replay's synthetic event order matches live's wall-clock order, and the same reducer produces the same misordering. There is no live-vs-replay asymmetry to design around.

## Goals / Non-Goals

### Goals
- Render `[text, toolCall]` assistant messages in content-array order (text bubble before its child tool cards) on both live and replay paths.
- Preserve the live spinner: the tool card SHALL still appear immediately when `tool_execution_start` fires, so users see "tool started" without waiting for `message_end`.
- Stay model- and API-agnostic: the reorder rule reads only `assistant.content[]` block order, which every supported API normalizes into.
- Stay strictly local to the assistant message that just ended: never reorder tool cards belonging to other messages, never reorder thinking bubbles, never reorder retried-error pills.

### Non-Goals
- Turn grouping (`agent_start`/`agent_end` frames).
- Synthesizing `agent_start`/`agent_end` in replay.
- Mid-turn user prompt rendering (separate concern; not actually a bug per JSONL inspection).
- Changing emission order in `state-replay.ts` (the reducer fix makes this unnecessary).
- Changing tool execution timing or spinner UX.

## Decisions

### Decision 1: Reorder at `message_end`, not at `tool_execution_start`

**Alternative considered**: defer the tool-card push until `message_end` fires. This would naturally produce the correct order since the assistant text bubble is pushed first.

**Rejected because**: it delays the live spinner. For long-running tools (npm test, large bash commands), the user would see no UI feedback for ~hundreds of ms while text streaming finishes. Current behavior (spinner appears immediately) is desirable; only the final post-`message_end` order is wrong.

**Chosen approach**: keep `tool_execution_start` pushing the tool card immediately. At `message_end` for the parent assistant message, perform a localized reorder so the assistant text bubble (just pushed) is positioned **before** any tool cards whose `toolCallId` appears in this message's content array. The reorder is a single splice, O(K) where K = number of recently-pushed siblings (typically 1–3).

### Decision 2: Use content-array order, not "always text first"

**Alternative considered**: hardcode "assistant text always before tool cards in messages[]".

**Rejected because**: it bakes in a model assumption. If a future model or API shim emits `[toolCall, text]` (e.g. tool first, then narrative explaining the call), the reducer should faithfully render that. Hardcoding text-first is one bug-fix today and one bug-introduction tomorrow.

**Chosen approach**: walk the just-finalized assistant message's `content[]` in order. For each block, locate the corresponding `ChatMessage` (text → the just-pushed assistant bubble; toolCall → the existing `tool-<id>` bubble matched by `toolCallId`; thinking → already a separate bubble pushed at `thinking_end`). Compute the desired index range inside `messages[]` and relocate so they end up in content-array order. Stable for blocks not produced by the reducer (e.g. images in user messages — irrelevant here since user messages are not the target).

### Decision 3: Match tool cards by `toolCallId`, scope to the just-ended message only

The reducer already carries `toolCallId` on every `toolResult` ChatMessage (`event-reducer.ts:498-509`). The fix uses this id to look up which tool cards in `messages[]` belong to **this** assistant message — the message's `content[]` lists each `toolCall.id`. Tool cards whose ids are not in the content array are ignored.

This scoping protects against:
- Tool cards from a prior assistant message whose tool finished after this `message_end` (they have different ids).
- Tool cards from a later assistant message that started before this one completed (impossible in practice for Anthropic, but defensively correct).
- Retried-error pills (different `id` shape `retried-${...}` and they're a virtual ChatMessage produced by `findRetriedErrorIds`, not by this reducer arm — though as an additional safety measure the reorder ignores any row whose role isn't `toolResult`).

### Decision 4: Replay path uses the same reducer; no `state-replay.ts` change

`state-replay.ts` emits exactly the same event stream a live session would (modulo the absence of `agent_start`/`agent_end`). Because the reducer fix is at `message_end` time and that event IS emitted in replay, the fix applies symmetrically. We do **not** change emission order in state-replay because:

- Changing emission order would also need to change the test fixtures used by the existing reducer tests, multiplying churn.
- The reducer fix is the single source of truth for ordering; emission order becomes irrelevant as long as `message_end` fires after both `message_update` and `tool_execution_start` for the same assistant message — which is already true in both paths.

### Decision 5: Empty-text edge case

If `streamingText` is empty at `message_end` for an assistant message that has only `toolCall` blocks (no text), there is no assistant text bubble pushed and no reorder needed. The reducer's existing tool-only path is correct and the fix is a no-op.

If `streamingText` is empty but `msg.content` has a non-empty text block (the replay/fork path), the reducer already falls through to a `replayText` push at `event-reducer.ts:442-462`. The reorder runs against this fallback push exactly as it would against the live push.

## Risks / Trade-offs

### Risk 1: Reorder makes the live UI flicker
A tool card appears at index N during streaming, then `message_end` lands and the same tool card jumps to index N+1 (or further) as the assistant text is inserted above it.

Mitigation: React's keyed reconciliation uses `id` (e.g. `tool-${toolCallId}`), so the bubble's DOM node is preserved across the reorder — no remount, no fade. Visually the user sees the assistant text bubble appear **above** the running tool card. The tool card itself doesn't move on screen relative to its surroundings except by the height of the inserted text bubble, which is exactly what the user expects.

### Risk 2: Multiple tool calls in one message
Anthropic occasionally emits `[text, toolCall, toolCall, toolCall]`. The reorder must place all three tool cards after the text bubble in their content-array order. The implementation walks `content[]` in order and emits a stable target index sequence; an O(K log K) sort by content-array index over the K affected rows guarantees correctness regardless of arrival interleaving.

### Risk 3: Tool starts after message_end
Replay can synthesize a `tool_execution_start` after `message_end` for the same parent message (depends on iteration order of `content`). In current state-replay code the order is `for (toolCall blocks) emit tool_execution_start; emit message_update; emit message_end` — so `tool_execution_start` precedes `message_end`. Verified at `state-replay.ts:60-78`. If a future change inverts this, the reorder at `message_end` simply finds no tool card to move, and the next `tool_execution_start` pushes correctly **after** the already-placed assistant bubble. Either order produces the right result.

### Risk 4: Fix interacts with retried-error pill collapsing
`findRetriedErrorIds` (`packages/client/src/lib/collapse-retried-errors.ts`) computes its set from the `messages[]` snapshot at render time. The reorder changes the array order but not the role/identity of rows, so the same pairs still collapse. Adding tests in `collapse-retried-errors.test.ts` to cover a `[text, toolCall]` parent where the tool errors then is retried in the next message — to confirm the pill still forms post-reorder.

### Trade-off: the reducer becomes slightly less "pure-append"
Currently every reducer case appends to or replaces `messages[]` from the tail. The fix introduces a controlled splice in the middle of the array (relative to the just-pushed assistant bubble). Acceptable because:

- The splice operates on a small bounded suffix (last 1–K rows, where K = `content.length`).
- The reducer remains pure (input event → new state, no side effects).
- The "pure append" property has not been a load-bearing invariant for any other code; no downstream consumer assumes it.

## Migration Plan

None — pure client-side bug fix. Old session JSONLs render correctly with the new reducer (the same fix applies during replay). Users who reload after the change ship is deployed see correctly-ordered messages immediately, including for sessions recorded under the old code path.

## Open Questions

(none at design time — exploration confirmed the bug shape, frequency, and replay symmetry; the fix is unambiguous and tightly scoped)
