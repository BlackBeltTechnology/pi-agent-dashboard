# Design — fix-streaming-text-vs-interactive-ui-order

## Problem

Two timing facts compose into a visible bug:

1. `ChatView.tsx` renders `streamingText` in a separate DOM block **after**
   `messages.map()`. Any row pushed into `messages[]` while `streamingText` is
   still set will visually appear ABOVE the streaming text bubble.

2. `bridge.ts:721` defers `message_end` send via `setTimeout(0)`, so by the
   time the dashboard receives `message_end`, the dashboard has already
   received and processed `tool_execution_start` and (for tools that prompt)
   `prompt_request`.

For `ask_user`, the parent tool BLOCKS — the gap between
`tool_execution_start` and `message_end` is bounded only by the user's
response time. The recent `fix-text-tool-render-order` corrects ordering at
`message_end` but is silent during this gap.

## Solution: flush-at-tool-start

```
BEFORE                                  AFTER
══════════════════════════════════      ═══════════════════════════════════

streamingText: "I'll ask…"              streamingText: ""
messages: [thinking, toolRes,           messages: [thinking, ASSIST("I'll
            interactiveUi]                          ask…"), toolRes,
                                                    interactiveUi]
ChatView render:                        ChatView render:
  thinking                                thinking
  [hidden toolRes]                        ASSIST text bubble  ← in correct slot
  interactiveUi  ← QUESTION               [hidden toolRes]
  streamingText  ← TEXT (wrong)           interactiveUi  ← QUESTION
                                          streamingText: ""  (rendered nothing)
```

The flush converts the transient `streamingText` slot into a permanent
`messages[]` row at the moment a sibling row (toolResult) is about to be
pushed, so the DOM ordering matches the model's content-array ordering
immediately, not eventually.

## Algorithm

### State extension

`SessionState` gains one optional boolean:

```ts
type SessionState = {
  // …existing fields…
  /**
   * True iff the current assistant message has already had its streaming
   * text flushed into messages[] via flushStreamingTextAsAssistantRow.
   * Reset to false on every message_start.
   * See change: fix-streaming-text-vs-interactive-ui-order.
   */
  streamingTextFlushed?: boolean;
};
```

### Pure helper

```ts
/**
 * Flush the current streamingText into a permanent assistant ChatMessage row.
 * Called from tool_execution_start when streamingText is non-empty so that
 * any subsequent toolResult / interactiveUi rows pushed during the same
 * message land BELOW the assistant text in messages[], not above it.
 *
 * Idempotent guard: if state.streamingTextFlushed is already true, returns
 * state unchanged (defends against any future code that calls this helper
 * twice for the same message).
 *
 * Returns a new state with:
 * - messages: [...state.messages, new assistant row]
 * - streamingText: ""
 * - streamingTextFlushed: true
 */
function flushStreamingTextAsAssistantRow(
  state: SessionState,
  timestamp: number,
): SessionState {
  if (state.streamingTextFlushed) return state;
  if (!state.streamingText) return state;
  return {
    ...state,
    messages: [
      ...state.messages,
      {
        id: `msg-${state.messages.length}`,
        role: "assistant",
        content: state.streamingText,
        timestamp,
        // entryId/nonce are NOT set here; message_end will back-fill via
        // entry_persisted correlation by matching the row's content text.
        // (See "entry_persisted back-fill" section below for the full plan.)
      },
    ],
    streamingText: "",
    streamingTextFlushed: true,
  };
}
```

### Reducer wiring

#### `message_start` (assistant)

Reset the flush flag for the new message:

```ts
case "message_start": {
  // …existing logic…
  if (msg?.role === "assistant") {
    next.streamingTextFlushed = false;
  }
  break;
}
```

#### `tool_execution_start`

Before existing logic, flush if streamingText is set:

```ts
case "tool_execution_start": {
  if (next.streamingText && !next.streamingTextFlushed) {
    Object.assign(
      next,
      flushStreamingTextAsAssistantRow(next, event.timestamp),
    );
  }
  // …existing logic that pushes the toolResult(running) row…
  break;
}
```

#### `message_update` (assistant)

The current logic recomputes `streamingText` from the full content array's
text blocks on every update:

```ts
const text = msg.content.filter(c => c.type === "text").map(c => c.text).join("");
next.streamingText = text;
```

This will re-populate `streamingText` with the already-flushed prefix and
re-show it below the messages — defeating the flush. Fix:

```ts
if (next.streamingTextFlushed) {
  // The first text block has been flushed into messages[]. Subsequent
  // text in this message will land at message_end via the existing
  // content-array-ordered reorder. Don't re-stream the flushed prefix.
  break;
}
const text = msg.content.filter(...).map(...).join("");
next.streamingText = text;
```

For the rare `[text, toolCall, text]` shape, the live UX regression is: the
second text doesn't stream — it appears in one shot at `message_end`. The
streaming UX for the FIRST text (which the user is reading when the dialog
appears) is unaffected.

#### `message_end` (assistant)

Skip the duplicate assistant-row push if streamingText was flushed:

```ts
case "message_end": {
  const msg = data.message as any;
  if (msg?.role === "assistant") {
    if (next.streamingTextFlushed) {
      // Streaming text was already flushed into messages[] at
      // tool_execution_start time. Do NOT push another assistant row.
      // The existing reorder pass below still runs and will match the
      // flushed row to the content[] text block via the existing
      // text-block matching rule.
    } else if (next.streamingText) {
      // existing path: push from streamingText
    } else {
      // existing replay/fallback path
    }
    // existing reorder call:
    if (Array.isArray(msg?.content)) {
      next.messages = reorderToolCardsForAssistantMessage(next.messages, msg.content);
    }
  }
  break;
}
```

### Reorder helper compatibility

`reorderToolCardsForAssistantMessage` matches `text` blocks against the most
recent `assistant` row in the suffix window. With the flush in place, that
assistant row is pushed earlier (at tool_execution_start time) but still falls
inside the K-sized suffix window: K = count of relevant blocks (thinking +
text + toolCall). For `[thinking, text, toolCall:ask_user]`, K = 3, and the
suffix at message_end is exactly `[assistant_flushed, toolResult(running),
interactiveUi]` (or with thinking too, `[thinking, assistant, toolResult,
interactiveUi]` depending on how many rows fit).

Wait — `interactiveUi` is in the suffix and is unclaimed. The unclaimed-row
guard from `247df74` keeps it at its original suffix index. Let me trace:

Suffix at message_end (after flush at tool_execution_start, after
prompt_request push): `[thinking, assistant, toolResult, interactiveUi]`.
K = 3 (thinking, text, toolCall in content[]).

The suffix length (4) > K (3). Helper takes `Math.max(0, len - K)` = last 3
rows: `[assistant, toolResult, interactiveUi]`.

Pass 1 over content[] in order:
- thinking → looks for `role === "thinking"` in suffix → not found, skipped.
- text → claims `assistant` (suffix idx 0).
- toolCall → claims `toolResult` (suffix idx 1).

Unclaimed: idx 2 (interactiveUi).

Pass 2:
- newSuffix[0] = undefined → fill with claimedInContentOrder[0] = assistant
- newSuffix[1] = undefined → fill with claimedInContentOrder[1] = toolResult
- newSuffix[2] = interactiveUi (kept at original idx)

Result: `[assistant, toolResult, interactiveUi]` — same as before. No movement
needed. ✓

If `thinking` had been in the K-suffix (only 3 rows pre-message_end), the
helper would still produce the right order because the `thinking` block would
claim the thinking row, etc. The flush is benign for the reorder pass.

### Interaction with archived `fork-entryid-accuracy` spec

The `fork-entryid-accuracy` capability (archived 2026-04-30 as part of
`fix-per-message-fork`) locks in two facts that constrain this change:

1. **The `setTimeout(0)` defer in `bridge.ts:721` is a `MUST`.** It cannot be
   narrowed or removed — pi 0.69+ runs `sessionManager.appendMessage` AFTER
   the awaited extension dispatcher returns, so anything earlier than a
   macrotask reads a stale (or null) `entryId`. This rules out the
   alternative "narrow the bridge defer" approach.

2. **Assistant `message_end` carries the correct `entryId` directly** (no
   `entry_persisted` back-fill needed for assistant rows; back-fill is
   user-message-only).

This change preserves both facts. The flush at `tool_execution_start` pushes
an assistant row with `entryId: undefined` (correct — pi has not yet
persisted). When the deferred `message_end` arrives carrying the real
`entryId`, the reducer **stamps** that `entryId` onto the existing flushed
row instead of pushing a duplicate. Externally observable behavior matches
the archived scenario *"Assistant ChatMessage gets entryId directly from
message_end"* exactly — the mechanism is the only thing that shifts (push →
stamp).

### Stamp logic at `message_end`

New branch in the assistant `message_end` arm:

```ts
if (next.streamingTextFlushed) {
  // Find the flushed row: scan messages[] from the tail for the most
  // recent role:"assistant" row with no entryId AND no nonce (= the row
  // pushed by flushStreamingTextAsAssistantRow earlier in this message).
  const idx = findFlushedAssistantRowIndex(next.messages);
  if (idx >= 0) {
    const stamped: ChatMessage = {
      ...next.messages[idx],
      entryId: data.entryId as string | undefined,
      nonce: data.nonce as string | undefined,
    };
    next.messages = [
      ...next.messages.slice(0, idx),
      stamped,
      ...next.messages.slice(idx + 1),
    ];
  }
  // Do NOT push a second assistant row.
} else if (next.streamingText) {
  // existing path: push from streamingText (entryId carried directly)
} else {
  // existing replay/fallback path
}
// reorder pass still runs unchanged below
```

The scan helper `findFlushedAssistantRowIndex` returns the index of the most
recent `role:"assistant"` row whose `entryId` AND `nonce` are both
`undefined`. It scans the suffix of `messages[]` corresponding to the current
message (bounded by the K-window logic from `reorderToolCardsForAssistantMessage`)
so a flushed row from a *prior* message — already stamped with `entryId` —
cannot be matched by accident.

**Fork button on flushed bubble**: between the flush at `tool_execution_start`
and the deferred `message_end` arrival, the flushed row has no `entryId`. If
the user clicks Fork on that bubble during this window, the fork is effectively
disabled (the existing fork code already guards on missing `entryId`). For
`ask_user` the window is bounded by the user's response time + one event-loop
tick, but in practice the bubble is rendered in the chat scroll area while
the dialog is the focal element, so the fork button is unlikely to be the
target. Acceptable narrow regression.

### Replay path

In replay, `streamingText` is never populated (replay synthesizes
`message_end` events directly with `data.message.content` populated). The
flush helper's `if (!state.streamingText) return state;` guard makes it a
no-op. The existing replay-text fallback at `message_end` and the existing
reorder pass continue to handle replay unchanged.

### Failure modes

| Scenario | Outcome |
|---|---|
| `streamingText` never populated (tool-only message) | Flush is no-op (guard). |
| `tool_execution_start` for second tool call in same message | `streamingTextFlushed === true`, flush is no-op (guard). Second `toolResult` lands after first; reorder at `message_end` keeps content-array order. |
| Replay (no streaming) | Flush is no-op (no streamingText). |
| `[text, toolCall, text]` | First text flushed, second text appears at `message_end` (no live streaming for second text — accepted tradeoff). |
| `[toolCall, text]` (model leads with tool) | streamingText empty at `tool_execution_start`. Flush is no-op. Existing reorder at `message_end` produces correct `[toolResult, assistant]` order. |
| User aborts session before `message_end` fires | Flushed row remains in `messages[]` (correct — user did see that text). No reorder happens, but order is already correct. |
| Bridge reconnect mid-message | `streamingTextFlushed` is per-session-state and survives because state is preserved. New `message_start` resets it. |

## Test plan

New test file: `packages/client/src/lib/__tests__/event-reducer-streaming-text-flush.test.ts`

Scenarios:

1. **ask_user blocking flow**: feed `[message_start, text deltas (streamingText="I'll ask"), tool_execution_start(ask_user, t1), prompt_request → addInteractiveRequest, … (long delay), message_end with content=[thinking?, text, toolCall(t1)]]`. Assert:
   - After `tool_execution_start`: messages tail = `[…, assistant("I'll ask"), toolResult(t1, running)]`, `streamingText === ""`, `streamingTextFlushed === true`.
   - After `prompt_request`: messages tail = `[…, assistant, toolResult, interactiveUi]`.
   - After `message_end`: messages tail unchanged (no duplicate assistant push); reorder is a no-op because order is already correct; `streamingTextFlushed` still true.

2. **Non-blocking `[text, toolCall]`**: same shape but no prompt_request. Assert order is `[assistant, toolResult]` after `tool_execution_start`, `[assistant, toolResult]` after `message_end`. Identical to behavior under `247df74` from the user's perspective (which is correct).

3. **Replay**: feed pre-recorded events (no message_update, just message_end with full content). Assert flush is never invoked (`streamingTextFlushed` stays undefined/false), existing reorder produces correct output.

4. **`[toolCall]` only (no text)**: assert `streamingTextFlushed` stays false, no flush happens, no extra row.

5. **`[text, toolCall, text]` regression**: second text appears at message_end as a SECOND assistant row (not concatenated to flushed first row). Reorder places it after the toolCall. _Open question for implementation: do we push it as a separate row, or does the reorder helper need to allow multiple `text → assistant` matches? See implementation-time decision below._

6. **Multiple tool calls `[text, toolCall(t1), toolCall(t2)]`**: flush at first `tool_execution_start`, second `tool_execution_start` is a flush no-op. Final order after message_end: `[assistant, toolResult(t1), toolResult(t2)]`.

7. **Idempotency**: calling the helper twice in the same message returns state unchanged the second time.

8. **`message_start` resets flag**: after a `message_start` for a new assistant message, `streamingTextFlushed === false`.

### Implementation-time decisions

These are deferred to the implementation tasks; the proposal does not lock
them in:

- **Multiple text blocks per message**: does the reorder helper need a list-of-text-blocks → list-of-assistant-rows match (currently 1:1)? Investigation needed; the `[text, toolCall, text]` case may already work because each block ends up on its own row via separate flush + message_end paths. If not, the helper needs a one-line tweak.
- **`entry_persisted` back-fill**: how exactly to identify the flushed row at `message_end`. Sketch above (Option 1) is the recommended path; verify by running the existing entry_persisted tests against a flushed bubble.
- **Whether to expose `streamingTextFlushed` in the SessionState public type or keep it internal**: probably keep it on `SessionState` proper (mirror of how `thinkingStartedAt` is structured).

## Why not the alternatives

- **Narrow the `setTimeout(0)` defer in `bridge.ts`**: tempting (the defer is the proximate cause), but the defer exists specifically because pi 0.69+ runs `appendMessage` AFTER the awaited extension dispatcher returns. Removing or narrowing it would re-introduce the per-message-fork bug. The reducer-level fix is cheaper and orthogonal.

- **Render `streamingText` INSIDE `messages.map()` at a sentinel slot**: invasive ChatView refactor; risks breaking scroll-lock and the streaming bubble's pulse animation.

- **Buffer `interactiveUi` push until `message_end` clears `streamingText`**: requires cross-module coordination and stalls the visible "question available" affordance for a macrotask tick. Worse UX.
