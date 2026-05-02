# Fix streaming-text vs. interactive-UI render order

## Why

When an assistant message ships content `[thinking?, text, toolCall]` in a
single message — the dominant shape for any tool-bearing turn — the user sees
the **tool card (and any prompt dialog) appear above the assistant text that
introduces it**. Live, not replay.

The most visible occurrences are:

1. **`ask_user` tools** — the question dialog renders above its own intro
   prose. Verified against five live sessions in
   `~/.pi/agent/sessions/--Users-robson-Project-compsych-letter-framework--/*.jsonl`,
   all of which show `['thinking', 'text', 'toolCall']` content arrays around
   `ask_user`.
2. **Long-running bash tools** (e.g. `npm test 2>&1 | tee /tmp/pi-test.log`,
   subagents, `pi-agent-browser` commands) — the spinning tool card sits above
   its describing prose for the entire tool runtime, often minutes. Reproduced
   live in this very project: a turn whose content is `[text("All 63 tests
   pass. Run full test suite as final guard:"), toolCall(npm test)]` renders
   the running card above the prose for the full ~4-minute test duration.

The recent fix `247df74` (archived as `2026-04-29-fix-text-tool-render-order`)
correctly reorders `messages[]` at `message_end` so `[text, toolCall]` content
renders as `[assistant_bubble, tool_card]`. It does **not** address the
transient render window between `tool_execution_start` and `message_end`,
which is bounded by the **tool runtime**, not by anything about the dashboard
or the model:

| Tool kind | Bad-render window | Visible? |
|---|---|---|
| `Read`, `Edit`, fast bash | one event-loop tick | invisible |
| Long bash (`npm test`, builds) | seconds → minutes | highly visible |
| Subagent / `pi-agent-browser` | seconds → minutes | highly visible |
| `ask_user` | unbounded (user response) | highly visible |

All four reduce to the same shape and the same fix.

## Root cause

Pi 0.69+ runs `sessionManager.appendMessage` AFTER the awaited extension
dispatcher returns, and the bridge defers the `message_end` SEND via
`setTimeout(0)` so it can carry the just-persisted `entryId`
(`packages/extension/src/bridge.ts:739-757`, locked in by
`fork-entryid-accuracy`). For tool-bearing messages, the dispatcher's await
chain includes the running tool, so the `message_end` event the dashboard
sees lands **after** `tool_execution_start` and (when present) the tool's
`prompt_request`. The gap closes only when the tool resolves.

```
PI EVENT LOOP                          DASHBOARD MESSAGES STATE
═══════════════════════════════════    ═════════════════════════════════════

thinking_end             ─────────▶    push thinking row
text deltas              ─────────▶    streamingText: "All 63 tests pass..."
                                                       (or "I'll ask you...")

tool_execution_start     ─────────▶    push toolResult(running)
                                       streamingText still set

  ┌── tool runs (ms → minutes → blocked-on-user) ──┐
  │                                                 │
  │ prompt_request (ask_user only) ─────▶ push interactiveUi row
  │                                                 │
  └── tool_execution_end ──────────────────────────┘

message_end              ─────────▶    push assistant row
                                       clear streamingText
                                       reorder() corrects state
```

During the gap, ChatView renders both shapes wrong in the same way:

```
ask_user case:                          long-running bash case:
messages.map():                         messages.map():
  thinking                                (prior assistant + toolResult)
  toolResult(running)  [hidden]           toolResult(running, 4m)  ◀ CARD
  interactiveUi        ◀ DIALOG         streamingText:
streamingText:                            "All 63 tests pass..."   ◀ PROSE
  "I'll ask you..."    ◀ PROSE
```

The `streamingText` block in `ChatView.tsx` is rendered *after* `messages.map()`
in the DOM, so any `toolResult` or `interactiveUi` row pushed mid-stream is
positioned above the streaming text bubble. The reorder helper only fires at
`message_end` and operates on `messages[]` only — it cannot re-order the
streaming text block, which is rendered from a separate slot.

The gap window equals the parent tool's runtime. For sub-millisecond tools
(`Read`, `Edit`) the misorder is invisible. For *any* tool that runs longer
than a render frame — long bash commands, subagents, browser tools, or
`ask_user` — the misorder is plainly visible.

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

### API-agnostic and tool-agnostic

The fix is reducer-only. It does not touch `bridge.ts`'s `setTimeout(0)`
defer (which exists for `entry_persisted` correlation — a separate concern
documented in `fix-per-message-fork`). Every API wrapper that emits the
`tool_execution_start` → `message_end` event sequence with streaming text in
between (`anthropic-messages`, `google-generative-ai`, `openai-completions`,
`openai-responses`) benefits equally, and every tool kind benefits equally
(`ask_user`, long-running bash, subagents, browser tools, custom extension
tools). The flush condition is purely "`streamingText` is non-empty when a
child tool starts", with no tool-name allowlist.

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
  - **ask_user blocking flow** (text streams, tool_execution_start fires while
    streamingText set, prompt_request pushes interactiveUi, eventual
    message_end reorder is no-op for assistant push)
  - **long-running bash flow, no prompt** (text streams, tool_execution_start
    fires while streamingText set, multiple `tool_execution_update` events
    arrive over a simulated multi-second window, eventual `tool_execution_end`
    + deferred `message_end`; assert correct order is **stable for the entire
    window**, not just at end — this pins the scenario the user reported)
  - `[thinking, text, toolCall]` shape (verifies the reorder helper's K-suffix
    window still claims `thinking`, `assistant`, `toolResult` correctly when
    the assistant row was flushed earlier than usual)
  - `[text, toolCall]` non-blocking path (should be identical to current
    behavior since message_end already orders correctly when no
    interactiveUi row is involved)
  - replay path (no streamingText ever populates, flush helper is no-op,
    existing message_end reorder still works)
  - `[toolCall]` only (no text, flush helper is no-op)
  - `[text, toolCall, text]` regression: second text appears at message_end,
    correctly ordered after toolCall by the existing reorder
  - interaction with `findActiveInteractiveToolResultIds` (post-flush layout
    `[assistant, toolResult(running), interactiveUi]` still pairs correctly
    so the running tool card stays hidden behind the dialog)
- **No breaking changes**: the reducer's external contract is unchanged. The
  bridge protocol is unchanged. The on-the-wire event stream is unchanged.
