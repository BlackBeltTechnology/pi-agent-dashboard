## Context

The chat transcript is a dynamic-height virtual list (`@tanstack/react-virtual`, change `virtualize-chat-transcript-tanstack`). Rows are heterogeneous (message bubbles, thinking blocks, tool bursts, images, inline terminals) with heights spanning ~24 px (turn separator) to several thousand px (a wall-of-text assistant message or a 24 k-char tool result). Off-screen rows are pre-measured by a static per-type estimate; real heights are cached by `measureElement` on mount.

Evidence (session `019f43e4`): the biggest rows sit near the top, and their static estimates under-shoot real height by 10–50×. When they mount during an upward scroll, `getTotalSize()` jumps and the container (`overflowAnchor:"none"`) does not preserve visual position, so the top recedes.

## Goals / Non-Goals

**Goals**
- Scrolling up converges on and lands on the first row (index 0).
- First-paint estimate error is small for large rows, so mount-time corrections are sub-perceptible.
- A deterministic scroll-to-top control exists as an escape hatch.

**Non-Goals**
- Perfect pre-measurement (impossible for async markdown/mermaid/image loads). We reduce error, then anchor-correct the residue.
- Changing rendered row output, the row model, or the bottom-pin/scroll-lock machinery.
- Fixing the known Cmd-F-over-off-screen-rows regression (tracked separately under the parent change).

## Decision 1 — Content-aware `estimateVirtualRowSize` (primary root-cause lever)

This is the fix that actually resolves the bug (see Decision 2 for why): shrinking the estimate error `delta` shrinks TanStack's built-in correction yank below perception. Replace static per-role constants with a payload-scaled estimate. Signal is already on the row:

- **Text rows** (user/assistant/toolResult/bashOutput/rawEvent): estimate ≈ `base + ceil(textChars / CHARS_PER_LINE) * LINE_PX`, clamped to a sane max so a 100 k-char row does not reserve 20 000 px (measurement will correct upward; the clamp just bounds the pre-measure reserve). Derive `textChars` from the same content the row renders (sum of text-block lengths).
- **Image presence** adds a reserve keyed on the row's **renderer kind**, NOT a single global constant. Verified caps differ per renderer: user attachments `max-h-[300px]` (fixed px, `ChatView.tsx:106`), tool-result images `max-h-[512px]`, preview cards `max-h-[40vh]` (viewport-relative). The repro row is a user-image row → a fixed 300 px reserve is correct and O(1). Use the per-kind fixed cap; treat `40vh`-class caps as an approximation (over-reserves small images — a harmless upward drift the corrector absorbs).
- **Burst/group rows carry multi-KB tool JSON.** Their `textChars` is the aggregate serialized length of child tool calls — deriving it requires a descent into the burst/group tree. To keep `estimateSize` O(1), precompute a single aggregate `textChars` int per row in the `displayRows` `useMemo` (below); `estimateSize` reads it, never re-walks.
- **separator/interactiveUi/inlineTerminal**: keep type constants (already close enough; their variance is small relative to text rows).

Must stay **O(1) per row, pure, memo-safe** — the estimate is called during windowing on every scroll. Precompute `textChars` (including the burst/group aggregate) + `imageKind` once when `displayRows` is built (in the same `useMemo`) rather than re-walking content blocks inside `estimateSize`.

**Constants are gated, not deferred.** `CHARS_PER_LINE` / `LINE_PX` / clamp are derived from the real height distribution (reuse the umbrella's height-measurement fixture, or sample rendered heights in the repro session) and **their acceptance is the convergence e2e (Test Strategy below), not a post-hoc "tune if drift persists"**. The e2e is red until the chosen values make scroll-up land on index 0; that test — not intuition — is what fixes the values.

**Image rows: Decision 1 is co-equal with, not primary over, Decision 3.** An image's true height is unknown until it loads (async), so `measureElement` fires twice (pre-load, then post-load) and the char-based estimate cannot pre-empt the second jump on the headline repro row. For image rows the deterministic escape hatch (Decision 3) is the load-bearing fix; Decision 1 only shrinks the *text* portion of the delta.

## Decision 2 — Do not fight TanStack's built-in above-viewport correction

**Source finding (`@tanstack/virtual-core` `resizeItem`, `index.js:534`).** The virtualizer ALREADY anchor-corrects above-viewport rows by default: when a mounting row with `item.start < getScrollOffset()` measures larger by `delta`, it calls `_scrollToOffset(getScrollOffset(), { adjustments: scrollAdjustments += delta })` → `elementScroll` → `element.scrollTo({ top: scrollOffset + adjustments })`. A **manual** `scrollTop += delta` compensation would double-correct and make the jitter worse. So the correct decision is to NOT add manual math, and instead make the built-in correction imperceptible + not defeat it.

**Why the built-in still drifts at large `delta`.** The yank magnitude is proportional to `delta` (the estimate error): with a 96px estimate on a 2300px row, the correction moves the view by ~2204px, wiping out upward progress. Shrink `delta` (Decision 1) → the yank falls below perception → the top becomes reachable.

**Mechanism note (inferred, not version-pinned).** The first draft attributed the yank to a *stale* `this.scrollOffset` (refreshed only by the debounced scroll observer, lagging live DOM `scrollTop`). Cross-model review disputed this: `observeElementOffset` updates `this.scrollOffset` synchronously on each scroll event, so it is largely live during an active scroll; the residual yank is better explained as a frame-level race between the scroll event and the ResizeObserver `resizeItem` correction accumulating `scrollAdjustments`. **Both explanations agree on the lever — shrink `delta`, shrink the yank — so the fix does not depend on which is exact.** Do NOT hard-code behavior against `virtual-core index.js:534`; it is inferred from the installed version, not a pinned contract.

Actions:
- Keep TanStack's default `shouldAdjustScrollPositionOnItemSizeChange` (do NOT override it, do NOT add a parallel manual corrector).
- Preserve `overflowAnchor:"none"` on the container (verified present) and keep no `scroll-behavior: smooth` on the scroll container or ancestors (verified absent) — smooth would animate each synchronous correction and race the next.
- Ensure ChatView's own `scrollTop` writers do not clobber a scroll-locked position: the `onChange` bottom-pin and the auto-scroll `useLayoutEffect` already guard on `stickToBottomRef.current` (following only), so when scrolled up they do not run — confirm this invariant holds and add a regression test.
- Optional tuning (evaluate, only if drift persists after Decision 1): lower `isScrollingResetDelay` and/or set `useScrollendEvent: true` so `this.scrollOffset` refreshes sooner and the stale-offset window shrinks.

## Decision 3 — Scroll-to-top affordance

Mirror the existing scroll-to-bottom button:

- Render a scroll-to-top button when scrolled away from the top (symmetric to `showScrollButton`; add `showScrollTopButton` derived in `handleScroll` from `el.scrollTop > SCROLL_THRESHOLD`).
- Handler: **latch suppression first**, then scroll: `stickToBottomRef.current = false; descendingRef.current = false; ascendingRef.current = true; virtualizer.scrollToIndex(0, { align: 'start' });`.
- **`scrollToIndex` is BOUNDED, not infinite (verified: `maxAttempts = 10` in installed `virtual-core`, then a silent `console.warn`).** The design's earlier "re-targets on every pass until reached" was wrong. For index 0 + `align:'start'` the target offset is always 0, so it *self-corrects toward 0 within the 10-frame window* — but a **late async image-load measurement after the retries exhaust** (the exact repro row) can bump `scrollTop` off 0 with nothing left to re-correct. Guard it: hold a `ascendingRef` latch and re-issue `virtualizer.scrollToIndex(0, { align: 'start' })` on the top image row's `img.onload` (and on `onChange` while `ascendingRef` is set and `scrollTop > 0`), clearing the latch once `scrollTop === 0` after measurements quiesce.
- **Re-arm race guard (do NOT skip).** `handleScroll` fires on every scroll event `scrollToIndex` emits. If the user starts *at the bottom*, an early frame reads `nearBottom` and flips `stickToBottomRef.current = true`; the next `onChange` with `grew` then pins `scrollTop = scrollHeight`, yanking back to bottom. Mirror the existing `descendingRef` pattern: while `ascendingRef.current` is set, `handleScroll` must NOT re-arm `stickToBottomRef` (hold it false and keep `showScrollButton` true), exactly as it holds the pin during an in-flight descent.
- Place it opposite the scroll-to-bottom button (top-right vs bottom-right) so both can be visible mid-scroll.

## Risks / Trade-offs

- **Estimate clamp vs. true tall rows.** Clamping the pre-measure reserve means a genuinely 8 000 px row is under-reserved until measured — the residual `delta` is absorbed by TanStack's built-in correction (Decision 2). The clamp must stay large enough that the residual yank is sub-perceptible; too small a clamp reintroduces the drift. Decision 1 and the built-in corrector are co-dependent.
- **Double-correction (the trap the first draft nearly shipped).** TanStack already fires the above-viewport correction. Adding a manual `scrollTop += delta` on top of it double-moves the view. Do NOT add manual compensation; assert in a test that a single upward mount produces a single net `scrollTop` change.
- **Bottom-pin interference.** ChatView's `scrollTop` writers (`onChange` pin, auto-scroll effect) must stay guarded on `stickToBottomRef.current` so they never run while scroll-locked and clobber the built-in correction.
- **`scrollToIndex(0)` is bounded (`maxAttempts = 10`), and async image load can bump the view off 0 after the retries exhaust.** For index 0 the target is always offset 0, so it self-corrects within the window; the residual risk is a late post-load remeasure of the top image row. Mitigated by the `ascendingRef` re-issue on `img.onload` (Decision 3), NOT by assuming `scrollToIndex` retries forever.
- **Scroll-to-top re-arm race.** Starting the scroll from the bottom lets `handleScroll` flip `stickToBottomRef` back to `true` mid-flight, after which `onChange`'s `grew` branch pins to bottom. Mitigated by the `ascendingRef` latch suppressing re-arm (Decision 3), mirroring `descendingRef`.

## Migration / Rollback

Pure client change, no data/protocol impact. Rollback = revert the diff; behaviour returns to static estimates + top-scroll drift.

## Test Strategy

**The required convergence gate is Playwright e2e, NOT jsdom.** The bug is a browser scroll-timing/ResizeObserver race; jsdom has no layout engine, no real scroll timing, and no ResizeObserver — a jsdom "convergence" test validates the shim's model, not the fix, and can pass green while the real session still drifts. jsdom component tests are kept for the *pure/logic* guards only.

- **Unit (jsdom-free, pure):** `estimateVirtualRowSize` is monotonic in text length up to the clamp, and adds the correct per-kind image reserve (300 px user, 512 px toolResult) when an image block is present.
- **Component (jsdom + `virtualizer-jsdom.ts` shim) — logic guards only:** assert the scroll-to-top handler sets `stickToBottomRef=false`/`ascendingRef=true` and that `handleScroll` does NOT re-arm `stickToBottomRef` while `ascendingRef` is set (the re-arm-race guard). **Precondition:** confirm the shim actually invokes `resizeItem`/`measureElement`; if it stubs them out, the "single net `scrollTop` change" guard is vacuous — in that case drop the jsdom scrollTop assertions and rely on the e2e.
- **E2E (Playwright, REQUIRED gate):** load a fixture/real session reproducing the profile (300 KB-image user row near the top, 24 k-char toolResult mid-list). Scroll up from the bottom and assert the first row reaches full view (`scrollTop === 0`) and stays — **including after the top image finishes loading async** (the post-load remeasure must not bump it off 0). Assert the scroll-to-top button lands on index 0 from the bottom. This test's pass/fail is what gates the Decision-1 constants.
- **Regression:** the full `chat-scroll-lock` scenario suite must still pass (bottom-pin, 50px lock, scroll-to-bottom button, replay race).
