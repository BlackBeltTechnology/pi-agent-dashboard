## Context

Prior change `fix-text-tool-render-order` (archived 2026-04-29) added the suffix-reorder helper `reorderToolCardsForAssistantMessage`. It uses `k = relevant.length` (count of `text` / `toolCall` / `thinking` blocks in the assistant's content array) to size the suffix it inspects — on the assumption that exactly one ChatMessage row was pushed per content block during the message lifecycle.

That assumption is wrong for `ask_user` and any other PromptBus-routed tool. For these tools, **two** rows are pushed per `toolCall` block:

```
content[i] = { type: "toolCall", id: "X", name: "ask_user" }

  pushes role: "toolResult"      id: "tool-X"     ← tool_execution_start
  pushes role: "interactiveUi"   id: "ui-X"       ← prompt_request (PromptBus)
```

So for `[text, toolCall:ask_user]` the rows pushed before `message_end` are 3 (`tool-X`, `ui-X`, plus the `assistant-text` pushed by `message_end` itself), but the helper only inspects 2. The toolCard `tool-X` falls outside the suffix window and is never claimed — final order becomes `[..., tool-X, ui-X, assistant-text]`.

Live trace from session `019ddd8c-...`, message `9e9b2574`:

```
message_update           streamingText += "Now I'll ask..."
thinking_end             push thinking-row
tool_execution_start     push tool-X (running)
prompt_request           push ui-X (pending)
message_end              push assistant-text
                         reorder runs:
                           k = relevant.length = 3 (thinking, text, toolCall)
                           suffix = last 3 = [tool-X, ui-X, assistant-text]
                                                ↑ the thinking-row is at idx -4, OUTSIDE
                           thinking block → looks for thinking-row in suffix → NOT FOUND
                           text block     → claims assistant-text at idx 2
                           toolCall block → claims tool-X at idx 0
                           unclaimed: ui-X at idx 1 → STAYS at idx 1
                           newSuffix = [tool-X, ui-X, assistant-text]    (UNCHANGED!)
```

The visible bug surfaces because of the second-order interaction with `findActiveInteractiveToolResultIds` (added in `collapse-duplicate-tool-cards`): when a `toolResult` row is `running` and immediately followed by a `pending` `interactiveUi` row, the toolCard is **hidden** from ChatView. So the misordered tail `[tool-X, ui-X, assistant-text]` renders as `[ui-X, assistant-text]` — dialog above text.

If the original fix had run first and produced `[assistant-text, tool-X, ui-X]`, the same pairing rule would render `[assistant-text, ui-X]` — dialog under text, as the user expects.

## Goals / Non-Goals

### Goals
- For any assistant message containing a `toolCall:ask_user`-style block (or any future PromptBus-routed tool), render the assistant text bubble **above** the resulting interactive dialog on both live and replay paths.
- Preserve every invariant of `fix-text-tool-render-order`: text/toolCall/thinking content-array ordering, no prior-message bleed, spinner immediacy, fast-path no-op for tool-only / text-only messages.
- Keep the fix protocol-additive: extending `prompt_request.metadata.toolCallId` is opt-in. Old bridges keep today's ordering for `ask_user`; new bridges produce correct ordering.
- Preserve `findActiveInteractiveToolResultIds`'s pairing rule (running tool + pending dialog → hide running tool). The fix corrects the *order* the rule operates on; it does not change the rule itself.

### Non-Goals
- Collapsing `toolResult` and `interactiveUi` into a single ChatMessage row (a larger refactor — many components depend on the current two-row shape).
- Redesigning PromptBus or its protocol envelope.
- Retroactively fixing already-recorded session JSONLs that lack `toolCallId` on `prompt_request` metadata. Replay through the new reducer + new bridge produces correct ordering for *new* sessions; old replayed sessions inherit the buggy ordering until the bridge re-emits the prompt with the new metadata (which it does on every reconnect).
- Synthesizing `prompt_request` events in `state-replay.ts` for archived sessions that never had one (those sessions had ad-hoc UI dialogs that aren't reproducible from the JSONL anyway).

## Decisions

### Decision 1: Widen the suffix window using a turn-boundary anchor (not a wider `k`)

**Alternative considered**: bump `k` to `relevant.length + countInteractiveToolCalls`. Computing the count requires inspecting each `toolCall.name` in the content array against an allowlist of "PromptBus tools" — couples the reducer to the tool-name vocabulary.

**Rejected because**: the reducer must not know which tool names route through PromptBus. That coupling would re-break the moment a new interactive tool is added to the bridge.

**Chosen approach**: walk `messages[]` backwards from the tail collecting all rows whose role is **not** a hard turn boundary. Hard boundaries are `user`, `turnSeparator`, `commandFeedback`, `rawEvent` — any of these terminates the walk. The collected window is "every row pushed during this assistant turn".

```
turn boundary scan (from messages.length - 1 down):
  if role ∈ {user, turnSeparator, commandFeedback, rawEvent} → STOP
  else → include in window, continue

window = messages[boundaryIdx + 1 ..]
```

The turn-boundary set is stable: `assistant`, `toolResult`, `thinking`, `interactiveUi`, `bashOutput` are all part of "this turn" and must be reorderable; `user` / `turnSeparator` / `commandFeedback` / `rawEvent` are hard separators by construction (the reducer pushes `turnSeparator` between tool-only assistant turns; `commandFeedback` is the `!`/`!!` bash echo before user prompts; `rawEvent` is debug-only).

### Decision 2: Pair `interactiveUi` with its `toolResult` via `toolCallId`

**Alternative considered**: pair by index proximity ("the `interactiveUi` row immediately following a `toolResult` belongs to it"). Already what `findActiveInteractiveToolResultIds` does for visibility.

**Rejected because**: the proximity rule depends on arrival order, which is exactly what the reorder is fixing. Once the helper widens its window, the `interactiveUi` row may be at any position in the unsorted suffix — proximity is no longer a reliable signal.

**Chosen approach**: thread `toolCallId` from `prompt_request` metadata through `addInteractiveRequest` onto the pushed `ChatMessage`. The reducer's claiming pass then matches `interactiveUi.toolCallId === content[i].id` exactly the same way it matches `toolResult.toolCallId === content[i].id`.

```
for each content[] block in order:
  if block.type === "toolCall":
    claim toolResult row where toolCallId === block.id    (existing)
    AND claim interactiveUi row where toolCallId === block.id  (new — paired)
    emit as [toolResult, interactiveUi] in that order in the new suffix
```

`addInteractiveRequest` gets a new optional parameter `toolCallId?: string` (extracted from `prompt_request.metadata.toolCallId`). When set, the pushed ChatMessage carries it on a new `toolCallId` field of the `interactiveUi` row. When absent (free-floating prompt), the row has no `toolCallId` and the reorder helper leaves it as an unclaimed trailing row — same as bashOutput today.

### Decision 3: Bridge-side: `prompt_request.metadata.toolCallId`

The bridge's `dashboard-default-adapter.ts` (and any custom PromptBus adapter that emits `prompt_request`) already knows the originating tool's `toolCallId` from the surrounding tool execution context. The change is wire-thin:

```ts
// dashboard-default-adapter.ts
send({
  type: "prompt_request",
  promptId,
  prompt,
  component,
  placement,
  metadata: {
    ...prompt.metadata,
    toolCallId: ctx.currentToolCallId,   // already available in extension context
  },
});
```

Old dashboards (without the reducer fix) ignore unknown metadata fields — the field is invisible to them. Old bridges (without this metadata) skip the pairing → reducer falls through to unclaimed-trailing → today's buggy order. Both halves of the protocol must update before the fix takes effect for `ask_user`.

### Decision 4: Unclaimed trailing rows go *after* claimed rows (not at original positions)

The original fix's unclaimed-row guard kept rows at their **original suffix index** to protect against K-overcount slurping prior-message rows. With the wider, turn-boundary-anchored window, that protection is no longer needed because the window can no longer extend across a hard turn boundary.

So unclaimed rows in the wider window simply trail after the claimed rows in their original relative order. This handles future row types (e.g. `bashOutput` if a future tool emits one mid-message) without special-casing each.

```
new suffix layout:
  [claimedInContentOrder...]  +  [unclaimedInOriginalRelativeOrder...]
```

For the `[text, toolCall:ask_user]` case:
- Wider window = `[tool-X, ui-X, assistant-text]` (3 rows, no thinking, all post-`user-msg`).
- text claims `assistant-text`; toolCall claims `[tool-X, ui-X]` as a 2-row pair.
- Unclaimed: none.
- New suffix: `[assistant-text, tool-X, ui-X]`. ✓

For `[text, toolCall:bash, toolCall:ask_user]`:
- Wider window = `[tool-bash, tool-ask, ui-ask, assistant-text]`.
- text claims `assistant-text`; first toolCall claims `tool-bash`; second toolCall claims `[tool-ask, ui-ask]`.
- Unclaimed: none.
- New suffix: `[assistant-text, tool-bash, tool-ask, ui-ask]`. ✓

For free-floating `prompt_request` (no `toolCallId`):
- ui row has no `toolCallId` → not claimed by any toolCall block → trails after claimed rows.
- New suffix: `[..., assistant-text, tool-X, ui-floating]` (or wherever it lands relative to claimed rows).

### Decision 5: Replay path needs no `state-replay.ts` change

`state-replay.ts` does not synthesize `prompt_request` events — those come from the live bridge re-running the PromptBus adapter on reconnect (or never, for sessions that already resolved their prompts before the JSONL was archived).

Live + reconnect path:
- Bridge re-emits `prompt_request` for any pending PromptBus prompt on reconnect.
- New bridge sets `metadata.toolCallId`; old bridge does not.
- Reducer claims pairing only when `toolCallId` is set.

This means archived sessions reloaded with the new client + new bridge will display correctly **once the bridge re-emits the prompt**. Sessions whose `ask_user` already resolved are static replay-only — no `prompt_request` ever fires — so the `interactiveUi` row is absent from `messages[]` entirely, and the reorder behaves identically to a plain `[text, toolCall]` message (which the original fix already handles correctly).

So no change to `state-replay.ts` is needed. The fix is fully covered by reducer + bridge.

## Risks / Trade-offs

### Risk 1: Window walks too far and slurps prior-turn rows
The turn-boundary set must be exhaustive. If we miss a separator role (e.g. a future `agentBoundary` row), the walk could span turns and reorder rows from the previous assistant message.

**Mitigation**: the boundary set is small and well-defined (`user`, `turnSeparator`, `commandFeedback`, `rawEvent`). New row roles added in the future MUST be classified by the author — the reducer test suite includes a regression that asserts adjacent assistant turns don't bleed (`prior assistant message stays put`).

### Risk 2: Bridge protocol fan-out
Three call sites in the bridge currently emit `prompt_request`: `dashboard-default-adapter.ts`, custom PromptBus adapters in `prompt-bus.ts`, and the reconnect-replay path. All three must set `metadata.toolCallId` for the fix to be complete.

**Mitigation**: search for `"prompt_request"` literal in the bridge package and audit all emitters. The change adds a typed `toolCallId?: string` to the `PromptRequestMessage` type so TypeScript surfaces missed sites at compile time.

### Risk 3: `interactiveUi` rows from non-tool sources lose their slot
A few PromptBus prompts are free-floating (architect mode prompts, user-initiated dialogs). These have no `toolCallId` and end up trailing after claimed rows. If they're currently rendered at a specific position in the chat (e.g. immediately after the user's command), the reorder may move them.

**Mitigation**: free-floating `interactiveUi` rows stay in their relative order *within the unclaimed trailing block*. The only visible difference is they appear after claimed rows. Add a regression test that exercises a sole free-floating prompt (no toolCalls in the message) and asserts the row ends up exactly where it would today.

### Risk 4: React reconciliation cost
Wider window = more rows touched per `message_end`. In practice the window is bounded by the size of one assistant turn (typically ≤ 10 rows). The reorder is still O(W²) where W is window size, dominated by the small constant factor.

**Mitigation**: the existing fast-path skip (no toolCall blocks → no reorder) is preserved. Performance is unchanged for text-only messages, which dominate.

### Trade-off: `toolCallId` on `interactiveUi` rows is not removed when prompt resolves
After the user answers, the `interactiveUi` row's `args.status` flips to `resolved` / `cancelled` but its `toolCallId` field stays. This is fine because the reorder helper only runs at `message_end` for *fresh* messages — resolved prompts are never re-reordered. Carrying the id is cheap.

## Migration Plan

None for end users. Bridge update + client update ship together as the fix; old client + new bridge → fix doesn't take effect (client ignores the new metadata field, runs old reorder); new client + old bridge → fix doesn't take effect for `ask_user` but no regression for any existing scenario.

For developers: extension authors using the PromptBus public adapter API who emit their own `prompt_request` envelopes should populate `metadata.toolCallId` when the prompt is bound to a tool execution. Document in `packages/extension/src/prompt-bus.ts` JSDoc.

## Open Questions

(none at design time — exploration verified the bug shape, the reducer trace, and the symmetric replay behavior; the fix is unambiguous and the boundary set is small enough to enumerate)

---

## Post-Apply Findings (2026-04-30)

This change shipped in commit `222ef45`. Subsequent manual testing surfaced an asymmetry the original design did NOT anticipate:

### The asymmetry

```
BUILT-IN ANTHROPIC PROVIDER         CUSTOM api:"anthropic-messages" PROVIDER
────────────────────────────    (e.g. 9Router proxy/cc/claude-opus-4-7)
  thinking_start            ─┐   ───────────────────────────────────
  thinking_delta            │   (NO thinking_start)
  thinking_end              ─┘   (NO thinking_delta)
  → pushes role:"thinking" row     (NO thinking_end)
  message_update (text)           message_update (text)
  tool_execution_start            tool_execution_start
  message_end                     message_end
    msg.content =                   msg.content =
      [{thinking:"..."},              [{thinking:""},  ← EMPTY placeholder!
       {text:"..."},                   {text:"..."},
       {toolCall}]                     {toolCall}]
```

Proxy implementations strip reasoning *content* while the upstream payload still emits a thinking content block. Pi's anthropic-messages adapter (we believe) skips live `thinking_*` events when the content is empty — so the row is never pushed. But the placeholder block STILL appears in `msg.content[]` at `message_end`.

### Why this change's reorder helper doesn't fix the proxy bug

Dry-tracing the post-222ef45 helper against `[empty-thinking, text, toolCall]`:

```
Turn-boundary window walks back to user-msg, stops.
Window = [tool-X (running), assistant-text]   (size 2)

content = [thinking, text, toolCall]   (length 3)

Pass 1 claims:
  thinking → findLastUnclaimed(role:"thinking") → NOT FOUND → silent skip
  text     → findLastUnclaimed(role:"assistant")  → idx 1 → claim
  toolCall → findLastUnclaimed(role:"toolResult" w/ id) → idx 0 → claim
  unclaimed: (none)

newSuffix = [assistant-text, tool-X]    → LOOKS correct in dry trace
```

By this trace, the proxy bug **should not manifest**. Yet manual testing confirms it does. This means the actual mechanism is **upstream of the reducer** — either:

1. Pi's anthropic-messages adapter emits `tool_execution_start` BEFORE the text content has streamed (so `streamingText` is empty when `message_end` lands, triggering the replay-fallback branch which pushes the assistant bubble at a different point in `messages[]`).
2. Pi's adapter handles the `content_block_start` events differently for empty thinking blocks vs real ones, causing the text/tool event ordering to diverge.
3. Some other adapter-level state that this change has no visibility into.

### What this finding tells us about the design

The original design's Decision 2 ("use content-array order, not 'always text first'") was correct for the cases it considered: it trusts the model's `msg.content[]` ordering as source of truth. But that contract assumes **every content block has a live row** to claim. When the upstream stream omits live events for placeholder content (empty thinking, possibly other shapes), the helper has no row to relocate — so it cannot fix a misorder that's already baked into `messages[]` by event arrival order.

Decision 5 ("Replay path uses the same reducer; no `state-replay.ts` change") still holds for replay. The asymmetry is in **live emission**, not replay.

### Follow-up work

A separate proposal will investigate:

- Diagnostic capture: transient log in `event-wiring.ts` to record the actual live `event_forward` sequence for one proxy/cc `[text, toolCall]` message; compare to the same prompt against built-in anthropic.
- Audit pi's `anthropic-messages` adapter source (in `pi-coding-agent`) for its handling of empty thinking blocks and tool-block ordering when reasoning is absent from the SSE stream.
- A candidate defense-in-depth filter at the reducer's `relevant` predicate to ignore empty content blocks (`thinking === ""`, `text === ""`). This wouldn't fix the root cause if the bug is upstream, but it removes one class of edge cases.
- Whether the fix should live in pi (correct event emission), the bridge (re-emit reordering), or stay in the reducer.

### Should this change be reverted?

No. Even though it doesn't fix the proxy/cc bug, it (a) genuinely fixes `ask_user` ordering for built-in anthropic, (b) replaces the K-overcount-prone fixed-window with a structurally correct turn-boundary anchor, and (c) the bridge `ctx.ui.*` wrapper changes are additive and don't affect callers that don't opt into `opts.toolCallId`. Reverting would re-introduce the K-overcount class of bugs without addressing the proxy/cc bug, which is independent.
