## Why

A short drag inside a **single** chat message extends the selection **upward** instead of following the pointer, whenever the agent is streaming and a long tool-result card sits above the selection in the viewport.

The selection is not being collapsed — it is being **silently retargeted**. Selection focus tracks whatever text is under the pointer. When a row *above* the pointer grows, every row below it shifts down, earlier text slides beneath a stationary cursor, and the focus endpoint runs backwards.

```
    t0                                   t1  (tool_execution_end mid-drag)
    ┌─────────────────────────────┐      ┌─────────────────────────────┐
    │ ▸ Bash  npm test   ⟳ running│ 60px │ ▸ Bash  npm test   ✓ 0      │
    ├─────────────────────────────┤      │ .... 800px of output ....   │
    │ the prose you are selecting │      ├─────────────────────────────┤
    └─────────────────────────────┘      │                             │
              ▲ cursor                   ├─────────────────────────────┤
                                         │ the prose you are selecting │
                                         └─────────────────────────────┘
                                                   ▲ cursor never moved,
                                                     now on text ~40 lines earlier
```

**Why nothing catches it today.** Three mechanisms each stop one step short:

1. `preserve-chat-selection-during-churn` (D3) keeps intersected rows **mounted** via `rangeExtractor`. Mounted is not the same as *stationary* — a retained row still moves when the rows above it resize.
2. `preserve-streaming-tail-selection` freezes content, but **only** when the selection anchor/focus is inside `tailContainerRef`. A selection in an already-committed message gets no freeze.
3. `fix-chat-scroll-to-top-estimate-drift` decision (2) — *"Do NOT add a manual `scrollTop += delta` (built-in `resizeItem` already corrects; a 2nd double-moves)"* — delegates **all** shift compensation to TanStack. TanStack's `resizeItem` correction fires only for items whose `start < scrollOffset`, i.e. **strictly above the viewport**. An in-viewport resize is deliberately uncorrected, which is right for ordinary reading and wrong for an in-flight drag.

The whole existing capability guarantees the selection **survives**. Nothing guarantees the selected content stays **where the user put it**. That is the gap.

**What resizes a row above the pointer mid-turn.** All four are streaming-correlated, and the first is the reported case:

| Trigger | Magnitude |
|---|---|
| `tool_execution_end` fills `result`; a running card renders its output body | hundreds–thousands of px |
| `flushStreamingTextAsAssistantRow` inserts a permanent row at `tool_execution_start` | a whole row |
| `reorderToolCardsForAssistantMessage` re-sorts trailing rows at every `message_end` | reshuffles offsets |
| Async image decode / Mermaid / KaTeX layout → `measureElement` (`ChatView.tsx:584-601`) | tens–thousands of px |

The estimator amplifies every one of them. `estimateVirtualRowSize` sees only `content.length + result.length` — it has **no knowledge of whether a card is collapsed or expanded** — and clamps text reserve at `TEXT_RESERVE_CLAMP = 8000`:

| Row | Estimate | Reality | Delta on measure |
|---|---|---|---|
| Collapsed card, 50k-char result | `120 + min(12500×20, 8000)` = **8120px** | ~60px | shrinks ~8000px |
| Expanded card, 50k-char result | clamped at **8120px** | 20–30k px | **grows 12–22k px** |

So large tool results are guaranteed mis-estimated in one direction or the other, and they are exactly the rows this bug rides on.

## What Changes

- **Anchor the viewport to the selection while a drag is live.** While the active-selection signal is true, pin the selection's anchor row: when its `getBoundingClientRect().top` moves between layout passes, cancel the delta with a compensating `scrollTop` adjustment so the text under the pointer is the text the user is addressing. This is scoped strictly to the duration of an active selection — outside a selection the layout behaves exactly as today.
- **Do not re-introduce the double-move.** Decision (2) of `fix-chat-scroll-to-top-estimate-drift` stands: no unconditional `scrollTop += delta`. Compensation applies only to shifts TanStack leaves uncorrected (resizes of in-viewport rows) and only while selecting, so the built-in above-viewport correction is never doubled.
- **Close the `isSelecting` lag window.** `selectionSpanRef` updates synchronously in `useActiveChatSelection`, but `isSelectingRef` — the ref gating the bottom-pin in `virtualizer.onChange` — only lands after a `queueMicrotask` **and** a render. Publish the boolean through a synchronous ref alongside the span so both guards read one clock. Two clocks currently guard one invariant.
- **Suspend the auto-scroll bottom-pin for the whole drag, not from the second frame.** Falls out of the item above; called out separately because it is the difference between "mostly works" and "works on the first chunk".

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `chat-selection-preservation`: add `Requirement: An active selection is anchored against layout shift`. The existing requirements (detection, row retention, tail preservation, copy fidelity) are unchanged — this adds the geometric-stability guarantee they assume but never state.

## Non-Goals

- **Making `estimateVirtualRowSize` collapse-aware.** This is a real and separate defect (table above) and it will make this bug rarer, but it cannot fix it: a tool result genuinely gaining content mid-drag is *real* growth, not a bad guess. Anchoring works regardless of estimate quality; a better estimate without anchoring still drifts. Kept out so this change stays surgical — worth its own proposal against `chat-transcript-virtualization` `Requirement: Content-aware pre-measure row-height estimate`.
- **The copy-button defect** (`CopyButton` swallowing `writeText` rejections; `writeText("")` succeeding silently and wiping the clipboard). Reported in the same session, unrelated root cause, still awaiting a runtime probe to distinguish empty-payload from promise-rejection. Separate proposal.

## Impact

- `packages/client/src/hooks/useActiveChatSelection.ts` — publish `isSelecting` through a synchronous ref; expose the anchor row/element for the compensator.
- `packages/client/src/components/chat/ChatView.tsx` — anchor-row shift compensation while selecting; `isSelectingRef` fed from the synchronous ref instead of render-time assignment; bottom-pin gate in `virtualizer.onChange`.
- `openspec/specs/chat-selection-preservation/spec.md` — added requirement (via delta).
- Unit tests (`packages/client/src/hooks/__tests__/useActiveChatSelection.test.tsx`) — synchronous ref publication. jsdom has no layout, so shift compensation needs a driven-geometry test (stub `getBoundingClientRect`) rather than a real-layout one.
- Playwright E2E (`tests/e2e/`) — the real-layout acceptance: drag inside one message while a tool card above completes, assert the selected string does not change.
- No server, extension, shared-protocol, or persistence changes. No breaking changes.

## Open Questions

- **Anchor endpoint choice.** Pin the *anchor* row (where the drag began) or the *focus* row (under the pointer)? Anchor is stable and matches user intent; focus moves by definition. Leaning anchor — needs confirming against a drag that crosses rows.
- **Compensation trigger.** `ResizeObserver` on retained rows, or reuse the existing coalesced `measureElement` pass at `ChatView.tsx:584-601`? The latter adds no new observer but only sees the resizes that already route through the coalescer.
- **Off-screen anchor.** If compensation would push the anchor row out of the viewport entirely (a very large growth above), do we keep compensating, or stop and let the view move? Unbounded compensation can strand the user far from the live tail.

## Discipline Skills

- `systematic-debugging` — the diagnosis came from reasoning about which direction content moved ("upper, not right" ⇒ content moved *down* ⇒ a row *above* grew), not from reading the code. Each candidate trigger in the table should be confirmed the same way before the fix is trusted.
- `scenario-design` — the edge cases are the whole risk surface: anchor row itself resizing, drag crossing a resizing row, compensation vs. TanStack's above-viewport correction firing in the same frame, selection released mid-compensation, keyboard (Shift+Arrow) selection, a growth larger than the viewport.
- `performance-optimization` — the compensator runs on every layout pass during a drag; it must be measured, not assumed cheap, and must not add a second forced reflow per frame.
- `review-code` — non-trivial change to shared scroll machinery that three prior changes already fought over.
