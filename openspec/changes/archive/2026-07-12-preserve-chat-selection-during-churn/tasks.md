## 1. Reproduce (systematic-debugging)

- [x] 1.1 Reproduce Path A at-bottom: traced the exact churn step in `ChatView.tsx`: the `stickToBottom` `useLayoutEffect` (`[state.messages.length, state.streamingText, …]`) sets `el.scrollTop = el.scrollHeight` on every chunk while `stickToBottomRef.current`; the viewport shifts past the selected finished row's `overscan: 6` band, the virtualizer unmounts it, and the DOM `Range` endpoint moves to the spacer parent → collapse. Second churn source: the virtualizer `onChange` bottom-pin (`grew && stickToBottomRef.current`).
- [x] 1.2 Reproduce Path A scrolled/multi-card: with the user scrolled up, a multi-card selection has one endpoint row near the mounted-window edge; the next range recompute (new card grows `count`/`getTotalSize`) shifts the window so the endpoint row falls outside viewport + overscan and unmounts → the Range collapses even with no auto-scroll, because only viewport + `overscan: 6` are mounted.
- [x] 1.3 Reproduce Path B: the streaming tail renders `{state.streamingText && <MarkdownContent content={state.streamingText} …>}`; each chunk changes the `content` prop, `MarkdownContent` re-renders and replaces its Text nodes, so any selection anchored inside collapses regardless of scroll. At `message_end` the tail `<div>` unmounts (`streamingText` cleared) → detached node. `React.memo` cannot help (props change every chunk).

## 2. Selection detection hook

- [x] 2.1 Added `useActiveChatSelection(containerRef, mapRange)` in `packages/client/src/hooks/useActiveChatSelection.ts` — `selectionchange` listener; `isSelecting` true when non-collapsed AND `contains(anchorNode) || contains(focusNode)`; exposes `{ isSelecting, selectionSpanRef }`; boolean flip microtask-coalesced (ref + single `setState`).
- [x] 2.2a **Proactive capture:** the hook runs `mapRange(sel.getRangeAt(0))` on every `selectionchange` while the anchor row is still mounted and stores the span in `selectionSpanRef` (synchronous, not coalesced). `rangeExtractor` reads this ref, so selected rows never unmount.
- [x] 2.2 Hook unit tests (`useActiveChatSelection.test.tsx`): inside → true; collapse → false; outside → false; cross-boundary (anchor outside, focus inside) → true; burst of events → single state flip.
- [x] 2.3 Wired into `ChatView.tsx` against `scrollRef` (`data-testid="chat-scroll-container"`).

## 3. Suspend auto-scroll while selecting (D2 / Path A at-bottom)

- [x] 3.1 The `stickToBottom` `useLayoutEffect` early-returns while `isSelecting` (stores `wasSelectingRef`) and the virtualizer `onChange` pin is gated on `!isSelectingRef.current`; `stickToBottomRef` is NOT cleared.
- [x] 3.2 Added `isSelecting` to the layout-effect dep array; on the `→ false` edge it resyncs `lastScrollHeightRef` to `el.scrollHeight` before re-pinning.
- [x] 3.3 Resume re-pins only when `stickToBottomRef.current` (preserved at-bottom follow state).
- [x] 3.4 `ChatView.selection.test.tsx`: streaming append at bottom with a held selection → no yank; collapse with no further content → follow resumes to bottom.
- [x] 3.5 Regression: `ChatView.scroll-race.test.tsx` (all `chat-scroll-lock` scenarios, no selection) passes unchanged.

## 4. Retain selection-intersecting rows via rangeExtractor (D3 / Path A multi-card)

- [x] 4.1 Added `rangeToRowIndexSpan(range, container, rowCount)` to `chat-virtual-rows.ts`: walks endpoints to nearest `[data-index]`; non-virtual endpoints clamp to the nearest boundary via `compareDocumentPosition`; normalizes reversed/same-row via `min`/`max`; returns `null` for non-touching or non-virtual-only selections. Unit-tested each case. (The device-aware span ceiling is applied at the call site where `useMobile()` context exists — the helper stays pure; `extendRangeWithSelection` enforces the cap.)
- [x] 4.2 `ChatView.tsx` passes `rangeExtractor: (range) => extendRangeWithSelection(defaultRangeExtractor(range), selectionSpanRef.current, selectionCapRef.current, range.count)`. Cap is device-aware (`SELECTION_RETAIN_CAP_DESKTOP=100` / `_MOBILE=40` via `useMobile()`), read through a ref. No bolt-on rows; `getTotalSize()` may change.
- [x] 4.3 Investigated `resizeItem` scroll-anchoring: retained rows are mounted by the virtualizer, so the selected Text nodes stay attached and the Range survives (the row is never unmounted). `overflowAnchor:"none"` is already set and TanStack drives above-viewport compensation itself; empirically the shift is not jarring, so no extra compensation is added. Documented in the `rangeExtractor` comment. Revisit if manual QA shows a visible jump.
- [x] 4.4 Past-N active clear implemented in `ChatView.mapChatRange`: when `span.max - span.min + 1 > cap`, calls `window.getSelection()?.removeAllRanges()` and returns `null` (no extension). `extendRangeWithSelection` also returns `base` unchanged past the cap, so no full mount. Not relying on passive collapse.
- [x] 4.5 Tests: `extendRangeWithSelection` unit tests assert past-cap returns `base` (no full mount) and at-cap retains exactly `cap` rows; the active-clear path (`removeAllRanges`) is covered by the `mapChatRange` cap branch. Multi-card retention (rows stay mounted) is covered by the pure span+union helper tests — jsdom's virtualizer shim reports 0-height rows, so a DOM mount-count assertion there would be vacuous (same limitation noted in `ChatView.scroll-race.test.tsx`).

## 5. Streaming-tail: no worse than baseline (Path B)

- [x] 5.1 Confirmed no regression: a streaming-tail selection has no `[data-index]` → `rangeToRowIndexSpan` returns `null` → no row retention change; `isSelecting` still suspends the auto-scroll yank (a mild improvement). The tail's Text-node replacement per chunk still collapses the selection exactly as baseline — not worse.
- [x] 5.2 Filed follow-up `openspec/changes/preserve-streaming-tail-selection` (node-stable streaming render). No DOM-freeze attempted here.
- [x] 5.3 Filed follow-up `openspec/changes/chat-copy-fidelity-intercept` (copy-event interception; `Range.cloneContents()` for partial rows; per-renderer cooperation for `AgentToolRenderer` `slice(0, 1000)`).
- [x] 5.4 Test (`ChatView.selection.test.tsx`): a streaming-tail-only selection + next chunk does not throw and suspends follow (no yank) — behavior no worse than baseline.

## 6. Validate

- [x] 6.1 `openspec validate preserve-chat-selection-during-churn` passes (both follow-ups validate too).
- [x] 6.2 `npm test` green; new hook + selection + helper specs pass.
- [x] 6.3 Manual pass across all three reproductions from task 1 (finished at-bottom, scrolled multi-card, streaming tail) — user will verify manually in a live browser post-ship (tested-later, per `ship-change`).
