# Design — fix-streaming-text-vs-interactive-ui-order

## Problem

Two timing facts compose into a visible bug:

1. `ChatView.tsx` renders `streamingText` in a separate DOM block **after**
   `messages.map()`. Any row pushed into `messages[]` while `streamingText` is
   still set will visually appear ABOVE the streaming text bubble.

2. Pi 0.69+ runs `sessionManager.appendMessage` AFTER the awaited extension
   dispatcher returns, and `bridge.ts:739-757` defers the `message_end` SEND
   via `setTimeout(0)` so it carries the just-persisted `entryId`. For
   tool-bearing messages the dispatcher's await chain includes the running
   tool, so `message_end` reaches the dashboard only AFTER the tool resolves.

The gap between `tool_execution_start` and `message_end` therefore equals
the parent tool's full runtime. For sub-millisecond tools the gap is
invisible. For long bash commands, subagents, browser tools, and `ask_user`,
the gap is plainly visible — minutes for `npm test`, unbounded for
`ask_user`. The recent `fix-text-tool-render-order` corrects ordering at
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
| Long-running bash, no prompt (npm test, builds) | Flush at `tool_execution_start`, layout `[…, assistant_flushed, toolResult(running)]` is index-stable for the entire tool runtime. `tool_execution_update` events update toolResult in place; layout unchanged. |
| `tool_execution_start` for second tool call in same message | `streamingTextFlushed === true`, flush is no-op (guard). Second `toolResult` lands after first; reorder at `message_end` keeps content-array order. |
| Replay (no streaming) | Flush is no-op (no streamingText). |
| `[text, toolCall, text]` | First text flushed, second text appears at `message_end` (no live streaming for second text — accepted tradeoff). |
| `[toolCall, text]` (model leads with tool) | streamingText empty at `tool_execution_start`. Flush is no-op. Existing reorder at `message_end` produces correct `[toolResult, assistant]` order. |
| `[thinking, text, toolCall]` (dominant ask_user shape) | `thinking` row pushed at `thinking_end` BEFORE the flush; suffix at message_end is `[thinking, assistant_flushed, toolResult, interactiveUi?]`; reorder claims thinking→thinking, text→assistant, toolCall→toolResult; interactiveUi (unclaimed) trails correctly. |
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

## Risk register

The risks below were surfaced during exploration of the widened scope. Each
is tracked in `tasks.md` either as a regression test (R2, R3, R6, R7) or as
a pre-merge audit/decision (R1, R4). R5 is an accepted tradeoff and needs
no further work beyond the existing test in §5.5.

| ID | Risk | Likelihood | Impact | Mitigation site |
|----|------|-----------:|-------:|-----------------|
| R1 | Flushed row exists without `entryId` for the entire tool runtime; downstream consumers may misbehave. | certain (by design) | low–medium | Task 11.1 (audit), 11.2 (UI decision) |
| R2 | `message_end` never arrives (crash / disconnect / abort) — flushed row stays entryId-less even after replay. | low per session, certain at fleet scale | low | Task 3.4b (regression test) |
| R3 | `findFlushedAssistantRowIndex` matches a prior message's orphan flushed row → cross-message entryId pollution. | low | **medium (data correctness)** | Task 3.1 (hard turn-boundary clamp), 3.4a (regression test) |
| R4 | Loss of streaming pulse animation — flushed bubble looks finalized for the entire tool runtime. | certain (by design) | low | Task 11.2 (decision) |
| R5 | `[text, toolCall, text]` — second text doesn't stream live; appears in one shot at `message_end`. | low (rare model shape) | low | Accepted tradeoff; pinned by Task 5.5 |
| R6 | Suffix K-window math regresses when free-floating rows (bashOutput, unrelated interactiveUi) interleave with the current message's window. | medium | medium | Task 4.1c (interleaved-row regression) |
| R7 | `streamingTextFlushed` flag stays true between message_end and the next message_start; a stray `tool_execution_start` would silently no-op the flush. | low | low | Task 3.4c (reset flag at message_end too) |

### Risk surface NOT increased

These were checked and confirmed unaffected:

- **Bridge protocol** — untouched, no version-skew risk.
- **Replay path** — flush is no-op (no streamingText), existing reorder still runs, identical outcome.
- **Performance** — one extra spread copy of `messages` per tool start; trivial.
- **Persistence** — `SessionState` isn't serialized; new field is in-memory only.
- **React keys** — flushed row's `id: msg-${messages.length}` is stable through reorder.
- **`tool_execution_update`** — different reducer arm; flush flag has no effect; toolResult updates in place.

## Pre-merge audits

### R1: entryId-consumer audit (task 11.1)

Result of `grep -rn "\.entryId" packages/client/src/ --include='*.ts' --include='*.tsx'` (excluding `__tests__/` and `event-reducer.ts` itself):

| Consumer | Site | Classification | Notes |
|---|---|---|---|
| `MessageBubble` fork button | `ChatView.tsx:80` (renders), `:291`, `:412` (passes prop) | **Tolerates undefined** | Already gated by `{entryId && onFork && (<button …>)}`. Fork button is silently absent until `message_end` stamps the flushed row — the user-visible regression is exactly what `fork-entryid-accuracy` already documented as acceptable. |
| `useSessionActions.handleResumeSession` | `hooks/useSessionActions.ts:136,146` | **Tolerates undefined** | The `entryId` parameter is optional; `...(entryId ? { entryId } : {})` spread cleanly omits it from the WS payload when absent. Server treats absent `entryId` as "resume from leaf". |
| App.tsx onFork passthrough | `App.tsx:1091` | **Pure passthrough** | Receives the typed `entryId: string` from `MessageBubble`'s gated callsite — already cannot be undefined here. |

No consumers filter, key, or fail on undefined `entryId`. **No additional code changes required.**

### R4: streaming-pulse animation decision (task 11.2)

**Decision: (a) Accept.** The flushed assistant bubble is rendered as a finalized `assistant` ChatMessage with no pulsing cursor span. For long-running tools (`npm test`, `ask_user`) this means the bubble stays static-looking for the tool runtime instead of carrying a streaming-cursor pulse.

Rationale:
- For the dominant fast-tool case (`Read`, `Edit`, sub-second bash) the streaming pulse already vanishes at `message_end` within ms; users never see it pulse on a tool-bearing message anyway.
- The `ask_user` shape spends 90%+ of its visible window with the question dialog as the user's focal point, not the assistant prose above it.
- Adding a "persisting" CSS hint (option b) would require a second render path keyed on `entryId == null && streamingTextFlushed`-equivalent, plus tests for both paths. The marginal UX clarity isn't worth the surface.
- The `MessageBubble` already shows the timestamp; users have a temporal anchor.

If real-world feedback after merge surfaces the static-looking bubble as confusing, option (b) can be added later as a CSS-only tweak with no reducer changes.

## Why not the alternatives

- **Narrow the `setTimeout(0)` defer in `bridge.ts`**: tempting (the defer is the proximate cause), but the defer exists specifically because pi 0.69+ runs `appendMessage` AFTER the awaited extension dispatcher returns. Removing or narrowing it would re-introduce the per-message-fork bug. The reducer-level fix is cheaper and orthogonal.

- **Render `streamingText` INSIDE `messages.map()` at a sentinel slot**: invasive ChatView refactor; risks breaking scroll-lock and the streaming bubble's pulse animation.

- **Buffer `interactiveUi` push until `message_end` clears `streamingText`**: requires cross-module coordination and stalls the visible "question available" affordance for a macrotask tick. Worse UX.
