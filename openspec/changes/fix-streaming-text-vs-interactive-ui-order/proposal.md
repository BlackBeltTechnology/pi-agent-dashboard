# Fix streaming-text vs. interactive-UI render order

## Why

When an assistant message ships content `[thinking, text, toolCall:ask_user]` in
a single Anthropic-style message — the dominant shape for ask_user calls in
real sessions (verified against five live sessions in
`~/.pi/agent/sessions/--Users-robson-Project-compsych-letter-framework--/*.jsonl`,
all of which show `['thinking', 'text', 'toolCall']` content arrays around
ask_user) — the user sees the **question dialog appear above the assistant text
that introduces it**. Live, not replay.

The recent fix `247df74` (archived as `2026-04-29-fix-text-tool-render-order`)
correctly reorders `messages[]` at `message_end` so `[text, toolCall]` content
renders as `[assistant_bubble, tool_card]`. It does **not** address the
transient render window between `tool_execution_start` and `message_end`, which
for `ask_user` can be arbitrarily long because the tool blocks awaiting user
input.

## Root cause

```
PI EVENT LOOP                          DASHBOARD MESSAGES STATE
═══════════════════════════════════    ═════════════════════════════════════

thinking_end             ─────────▶    push thinking row
text deltas              ─────────▶    streamingText: "I'll ask you..."

message_end              ─────[setTimeout(0)]─── DEFERRED ───┐
  (bridge.ts:721 defers via              (waiting for next   │
   setTimeout(0) for fix-                 macrotask tick)    │
   per-message-fork)                                         │
                                                             │
tool_execution_start     ─────────▶    push toolResult(running)
                                       streamingText still set

prompt_request           ─────────▶    push interactiveUi row
                                                             │
                              ◀──── macrotask fires ─────────┘
                                       push assistant row
                                       clear streamingText
                                       reorder() corrects state
```

During the gap, ChatView renders:

```
messages.map():
  thinking
  toolResult(running)        ← hidden by findActiveInteractiveToolResultIds
  interactiveUi              ◀─ QUESTION DIALOG visible HERE

streamingText (rendered AFTER messages.map):
  "I'll ask you..."          ◀─ TEXT BUBBLE visible HERE (below the dialog)
```

The `streamingText` block in `ChatView.tsx` is rendered *after* `messages.map()`
in the DOM, so any `interactiveUi` row pushed mid-stream is positioned above
the streaming text bubble. The reorder helper only fires at `message_end` and
operates on `messages[]` only — it cannot re-order the streaming text block,
which is rendered from a separate slot.

For non-blocking tools the gap is microseconds and invisible. For `ask_user`
the gap persists until the user answers, so the misorder is highly visible.

## What Changes

The reducer SHALL, on every `tool_execution_start` whose parent assistant
message is still streaming text (`streamingText` non-empty), flush the
current `streamingText` into a permanent assistant `ChatMessage` row **before**
pushing the `toolResult(running)` row. This anchors the assistant text bubble
above any subsequent tool / interactiveUi rows for the same message in the
DOM, eliminating the transient misorder window without depending on
`message_end` arrival timing.

Concretely:

- Add a new requirement to the `event-reducer` capability: "Streaming text is
  flushed at tool_execution_start to preserve content-array order".
- Modify `tool_execution_start` handler in `event-reducer.ts` to call a new
  pure helper `flushStreamingTextAsAssistantRow(state)` if `streamingText` is
  non-empty.
- Track per-message flush state on `SessionState` (`streamingTextFlushed:
  boolean`) so subsequent `message_update` events for the same message do
  **not** re-populate `streamingText` with the already-flushed prefix.
- The existing `message_end` arm SHALL no-op the streamingText push when
  `streamingTextFlushed` is true (the row is already there); the reorder pass
  SHALL still run (the flushed row matches the `text` block, the toolResult
  matches the `toolCall` block, content-array order is preserved).
- `streamingTextFlushed` is reset on the next `message_start` (per-message
  state, not per-session).

### Tradeoff: `[text, toolCall, text]`-shaped messages

If the model emits text *after* a toolCall in the same message (e.g.
`[text("I'll search"), toolCall("search"), text("Done.")]`), the second text
chunk will land at `message_end` only — it will NOT stream live in the bubble
during the tool execution. This is acceptable because:

1. The pattern is **rare** — none of the five surveyed `ask_user` sessions show
   it; Anthropic's models almost never emit text after a tool_use in the same
   message.
2. The first text chunk (the part that introduces the tool) is what matters
   for context — the user already sees it before the dialog.
3. Replay path is unaffected — `message_end`-time reorder handles all blocks
   regardless of live timing.

The existing reorder pass at `message_end` still handles this correctly: the
`text` block matches the flushed assistant row, additional content (e.g.
`text2`, `text3`) blocks following the toolCall match additional assistant
rows that the reorder helper places in correct order. (Implementation detail:
the helper's matching rules need extending to allow multiple `text` blocks per
message; see design.md.)

### API-agnostic

The fix is reducer-only. It does not touch `bridge.ts`'s `setTimeout(0)`
defer (which exists for `entry_persisted` correlation — a separate concern
documented in `fix-per-message-fork`). Every API wrapper that emits the
`tool_execution_start` → `message_end` event sequence with streaming text in
between (`anthropic-messages`, `google-generative-ai`, `openai-completions`,
`openai-responses`) benefits equally.

## Impact

- **Affected specs**: `event-reducer` (one new requirement, supplements
  existing "Assistant content-array order preserved in chat" without breaking
  it).
- **Affected code**:
  - `packages/client/src/lib/event-reducer.ts` (~30 lines net: new pure helper
    `flushStreamingTextAsAssistantRow`, modified `tool_execution_start` arm,
    modified `message_end` arm to skip duplicate push when flushed, modified
    `message_start` arm to reset `streamingTextFlushed`, type addition to
    `SessionState`).
  - `packages/client/src/types.ts` (or wherever `SessionState` lives) — add
    `streamingTextFlushed?: boolean`.
- **Tests**: new reducer-level tests covering
  - ask_user blocking flow (text streams, tool_execution_start fires while
    streamingText set, prompt_request pushes interactiveUi, eventual
    message_end reorder is no-op for assistant push)
  - `[text, toolCall]` non-blocking path (should be identical to current
    behavior since message_end already orders correctly when no
    interactiveUi row is involved)
  - replay path (no streamingText ever populates, flush helper is no-op,
    existing message_end reorder still works)
  - `[toolCall]` only (no text, flush helper is no-op)
  - `[text, toolCall, text]` regression: second text appears at message_end,
    correctly ordered after toolCall by the existing reorder
- **No breaking changes**: the reducer's external contract is unchanged. The
  bridge protocol is unchanged. The on-the-wire event stream is unchanged.
