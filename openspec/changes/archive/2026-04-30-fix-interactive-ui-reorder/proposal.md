> **Status:** APPLIED in commit `222ef45` (2026-04-30). See "Post-Apply Findings" at the bottom of this file for what we learned after shipping — this change is necessary but not sufficient for the broader tool-ordering correctness story; a follow-up bug on **custom anthropic-messages providers (proxy/cc)** remains open.

## Why

The previous fix `fix-text-tool-render-order` (archived 2026-04-29) added `reorderToolCardsForAssistantMessage` to `event-reducer.ts` so `[text, toolCall]` assistant messages render in content-array order. That fix is correct for plain tool calls, but it **misorders interactive-UI prompts** (e.g. `ask_user`).

Reproduced live in session `019ddd8c-19ab-7735-87e6-1d81d69e592c` (assistant message `9e9b2574` with content `[thinking, text, toolCall:ask_user]`). Users see:

```
USER MESSAGE
↓
ASK_USER DIALOG       ← appears BEFORE assistant text
↓
ASSISTANT TEXT BUBBLE ← but the model emitted text FIRST
```

The assistant's narrative text (which is supposed to introduce the question) lands **below** the dialog the model just opened.

### Root cause

For an `ask_user`-shaped tool, two rows get pushed into `messages[]` for one toolCall block:

1. `tool_execution_start` pushes a `role:"toolResult"` row (`id: "tool-${toolCallId}"`, `toolStatus:"running"`).
2. `prompt_request` (PromptBus) immediately fires `addInteractiveRequest` which pushes a `role:"interactiveUi"` row (`id: "ui-${requestId}"`).

So a `[text, toolCall:ask_user]` message produces this `messages[]` tail by the time `message_end` fires:

```
[..., user-msg, tool-X (running), ui-X (pending), assistant-text]
```

The reorder helper sizes its suffix window as `k = relevant.length` (only `text` + `toolCall` + `thinking` blocks). For `[text, toolCall]` that's `k=2`, so the suffix is `[ui-X, assistant-text]` — **`tool-X` is outside the window entirely**, and the `toolCall` block has no candidate to claim. The `assistant-text` row claims slot 1 (text → assistant); slot 0 (the `interactiveUi` row) is "unclaimed" and the unclaimed-row guard from `fix-text-tool-render-order` deliberately keeps it at its original suffix index → `[ui-X, assistant-text]`. Final messages: `[..., tool-X, ui-X, assistant-text]`.

ChatView's `findActiveInteractiveToolResultIds` then **hides** `tool-X` (running tool paired with pending `interactiveUi`), so the user sees `[..., user-msg, ui-X, assistant-text]` — dialog above its own intro text.

### Why the existing fix didn't catch it

Decision 3 of `fix-text-tool-render-order/design.md` listed protected row roles (assistant, toolResult, thinking) and explicitly noted *"the reorder ignores any row whose role isn't `toolResult`"*. `interactiveUi` rows from PromptBus weren't part of any test fixture — the change shipped before the bug surfaced in production.

The unclaimed-row guard (which protects prior-message rows from migrating) has the *side-effect* of pinning `interactiveUi` rows to whatever index they happened to land at — exactly the wrong slot when the parent toolCard fell outside the window.

### Frequency

Affects 100 % of `ask_user` invocations and any future PromptBus-routed tool whose parent assistant message contains text. Users perceive this as the assistant interrupting itself, then explaining what it just asked — a confusing reversal that erodes trust in the chat ordering.

## What Changes

- Widen the reorder helper's suffix window from `k = relevant.length` to a **"since-last-message" anchor**: walk backwards from the just-pushed assistant row collecting all rows that belong to *this* turn (any row whose role is not a hard turn boundary: `user`, `turnSeparator`, `commandFeedback`, `rawEvent`).
- Treat each `interactiveUi` row as a **trailing companion** to its parent `toolResult` row when both rows have `toolCallId === content[i].id`. PromptBus's `prompt_request` carries the originating `toolCallId` (already used by `addInteractiveRequest` indirectly via the request lifecycle); we surface it on the `interactiveUi` ChatMessage so the reorder helper can pair the two rows.
- For each `toolCall` block in content order, claim **both** the matching `toolResult` row and (if present) its paired `interactiveUi` row, emitting them as a 2-row unit `[toolResult, interactiveUi]` in the new suffix.
- Unclaimed rows in the wider window keep their relative order **after** the claimed rows (instead of holding their original index). This is safe because the wider window is bounded by an explicit turn-boundary scan — no prior-turn rows can leak in.
- The `toolCallId` carried on `interactiveUi` rows is opportunistic: when `prompt_request.metadata.toolCallId` is set (added in this change to PromptBus's request shape for tool-bound prompts), the reducer stamps it on the new ChatMessage. When absent (free-floating prompts not bound to a tool call), the reorder helper leaves the `interactiveUi` row in unclaimed-trailing position — same as today's bashOutput / commandFeedback rows.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `event-reducer`: extends the existing requirement *"Assistant content-array order preserved in chat"* (added by `fix-text-tool-render-order`) so the reorder uses a turn-boundary anchored window and pairs `interactiveUi` rows with their parent `toolResult`. The original requirement's invariants (text/toolCall/thinking ordering, no prior-message bleed, spinner immediacy, fast-path no-op for tool-only / text-only messages) are preserved verbatim.

## Impact

- **Code**:
  - `packages/client/src/lib/event-reducer.ts` — replace the fixed-`k` suffix slice with a turn-boundary backwards walk; extend `relevant`-based claiming to pair `interactiveUi` rows with their `toolResult` siblings; carry `toolCallId` on the `interactiveUi` ChatMessage pushed by `addInteractiveRequest`. ~30–50 lines changed in two places (helper + `addInteractiveRequest`).
  - `packages/shared/src/protocol.ts` (or `browser-protocol.ts`) — extend `prompt_request` `metadata` shape with optional `toolCallId?: string`. Bridge fills it for tool-routed prompts (already known at adapter time).
  - `packages/extension/src/dashboard-default-adapter.ts` — propagate `toolCallId` from the calling tool context into the `prompt_request` metadata. Wire-thin.
- **Tests**:
  - New unit test file `packages/client/src/lib/__tests__/event-reducer-interactive-ui-order.test.ts`:
    1. `[text, toolCall:ask_user]` — feed `message_update`, `tool_execution_start`, `prompt_request`, `message_end`. Assert tail is `[..., assistant, tool-X, ui-X]`.
    2. `[thinking, text, toolCall:ask_user]` — feed `thinking_end`, `message_update`, `tool_execution_start`, `prompt_request`, `message_end`. Assert tail is `[..., thinking, assistant, tool-X, ui-X]`.
    3. `[text, toolCall:ask_user]` where `prompt_request` arrives **after** `message_end` (rare but possible). Assert reorder at `message_end` produces `[..., assistant, tool-X]` and the subsequent `prompt_request` lands `ui-X` immediately after `tool-X`.
    4. `[text, toolCall:bash, toolCall:ask_user]` — only the second toolCall is interactive. Assert tail is `[..., assistant, tool-bash, tool-X, ui-X]` (ui-X pairs only with its own tool, not with the bash tool).
    5. Regression: free-floating `prompt_request` with no `toolCallId` (e.g. an architect prompt outside any tool call) lands as a trailing unclaimed row, same as today.
    6. Regression: existing `fix-text-tool-render-order` scenarios still pass (text-only, tool-only, multiple toolCalls, prior-message-untouched, replay path).
  - Replay round-trip variant in `packages/shared/src/__tests__/state-replay-interactive-ui-order.test.ts`: fixture JSONL containing `[text, toolCall:ask_user]` and a synthesized `prompt_request`; feed through `replayEntriesAsEvents` + reducer; assert the same tail order.
  - Update `collapse-retried-errors.test.ts`: `findActiveInteractiveToolResultIds` continues to hide the running `tool-X` when `ui-X` is pending — invariant preserved post-reorder. Add explicit assertion that the *order* `[..., assistant, tool-X, ui-X]` produces the visible ChatView shape `[..., assistant, ui-X]` (tool-X hidden by the existing pairing rule).
- **Compatibility**: pure client-side ordering change plus an opt-in `metadata.toolCallId` on `prompt_request`. Old bridges that don't set `toolCallId` continue to produce the buggy ordering for `ask_user`; new bridges set it. `interactiveUi` rows without `toolCallId` fall through to today's behavior (unclaimed trailing). Forward and backward compatible at the protocol level.
- **Out of scope**: redesigning the PromptBus protocol, collapsing `tool-X` and `ui-X` into a single ChatMessage row, retroactively fixing already-recorded JSONLs (replay path inherits the fix automatically once the bridge is updated and the message is replayed).

---

## Post-Apply Findings (2026-04-30, after explore-mode investigation)

After the fix shipped, manual testing surfaced an **adjacent ordering bug that this change does NOT fix**: tool cards on **custom providers using `api: "anthropic-messages"`** (e.g. 9Router proxy `proxy/cc/claude-opus-4-7`) still render above their own assistant text in some shapes — even though the same prompt against the **built-in pi anthropic provider** renders correctly.

### What we verified

1. **Built-in anthropic provider works correctly post-222ef45.** `[thinking, text, toolCall]` and `[text, toolCall:ask_user]` both render in content-array order. The PromptBus pairing rule and turn-boundary anchored window do their job.

2. **Custom anthropic-messages providers (`proxy/cc/...`) misorder.** Same model (`claude-opus-4-7`), same prompt shape, same reducer path — but the rendered order is wrong only for the proxy.

3. **The proxy emits the JSONL correctly.** Inspection of `~/.pi/agent/sessions/...` shows `msg.content[]` arrives in the right order (`[thinking, text, toolCall]`). The discrepancy is in **live event emission**, not persistence.

4. **The proxy strips reasoning content** while leaving the placeholder block intact:
   ```json
   { "type": "thinking", "thinking": "" }
   ```
   This means pi's `anthropic-messages` adapter sees an empty thinking block, and (we believe) does not emit `thinking_start` / `thinking_delta` / `thinking_end` events live. So no `role:"thinking"` ChatMessage row is ever pushed.

5. **9Router CHANGELOG audit (decolua/9router 0.3.96 → master 0.4.11)** found NO upstream stream-ordering fix for Anthropic. Closest hit (#791, v0.4.8) is request-side `reasoning_effort` translation, not stream-event sequencing. Adjacent ecosystems (charmbracelet/fantasy commit a3b8a69) document the same general pattern but in a different proxy.

### Why this change can't reach the proxy bug

The reorder helper trusts `msg.content[]` as the source-of-truth ordering and matches each block to a live-pushed row by role/id. For proxy/cc, the empty `thinking` block exists in `msg.content[]` but no thinking-row was ever pushed live → block silently skipped. By dry-trace the helper *should* still produce correct output for `[empty-thinking, text, toolCall]` because the missing thinking row collapses the count cleanly. **Yet the bug manifests anyway** — meaning the actual mechanism is upstream of the reducer (probably in pi's anthropic-messages adapter when handling proxy-style streams that don't carry reasoning deltas).

### Should we revert this change?

**No.** Decision matrix:

| Case                                     | Reverted | Kept (current) |
| ---------------------------------------- | -------- | -------------- |
| `ask_user` with built-in anthropic       | broken   | **WORKS**      |
| `ask_user` with proxy/cc                 | broken   | partially broken |
| `[thinking, text, tool]` built-in        | buggy*   | better         |
| `[text, toolCall]` plain (anthropic)     | works    | works          |
| Bridge `ctx.ui.*` wrapper risk           | none     | small (additive) |

\* The old K-window helper had its own correctness gaps; the unclaimed-row guard was a band-aid for K-overcount.

The new turn-boundary anchored window is **structurally more correct** even where the new pairing rule isn't doing anything — and reverting would re-introduce the K-overcount class of bugs. The proxy/cc misorder is an **independent bug in the live event stream** that needs its own diagnosis and proposal.

### Follow-up work tracked separately

A new investigation/proposal will be opened to capture:

- A diagnostic step that records the exact `event_forward` sequence the dashboard receives for one `proxy/cc` `[text, toolCall]` message (a transient `console.log` in `event-wiring.ts`, then revert).
- Comparison with the same prompt against built-in anthropic.
- Whether the fix needs to land in `pi-coding-agent`'s anthropic-messages adapter, our bridge's event forwarding, or the reducer's handling of empty content blocks.
- A candidate defense-in-depth layer: filter out empty `text === ""` and `thinking === ""` content blocks from the `relevant` set in `reorderToolCardsForAssistantMessage` so future similar cases (any provider that ships placeholder-only blocks) degrade gracefully.

The follow-up is intentionally NOT folded into this change because (a) we haven't reproduced the exact mechanism with a live event-stream capture yet, and (b) the fix may need to live in pi itself, not the dashboard.
