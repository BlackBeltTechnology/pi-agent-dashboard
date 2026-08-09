## Context

`ChatView` windows the transcript with `@tanstack/react-virtual`. Rows are absolutely positioned at `translateY(vi.start)` over a `getTotalSize()` spacer, each carrying `ref={virtualizer.measureElement}`. Row heights start as estimates (`estimateVirtualRowSize`) and are corrected on measurement.

Three prior changes already contest this machinery, and the design must not undo any of them:

| Change | What it established | Why it does not cover this bug |
|---|---|---|
| `preserve-chat-selection-during-churn` | `rangeExtractor` keeps selection-intersecting rows **mounted**; `useActiveChatSelection` publishes `isSelecting` + `selectionSpanRef` | mounted ≠ stationary — a retained row still moves when rows above it resize |
| `preserve-streaming-tail-selection` | freezes streaming text under a selection | gated on the selection being **inside** `tailContainerRef`; a selection in a committed message gets nothing |
| `fix-chat-scroll-to-top-estimate-drift` | decision (2): **no manual `scrollTop += delta`** — TanStack's `resizeItem` already corrects | TanStack corrects only items with `start < scrollOffset` (**strictly above the viewport**); an in-viewport resize is left uncorrected by design |

The user-visible defect: a short drag inside one message runs **upward** when a tool card above it completes mid-drag and renders its output body. The selection is never collapsed — it is retargeted, because selection focus tracks whatever text sits under the pointer, and the content moved.

Constraints inherited from the codebase: no CSS `scroll-behavior: smooth` on the container, `overscroll-behavior: none`, and the DOM scroll machine (`handleScroll` / `stickToBottomRef` / `showScrollButton`) measures the **real** container, not virtual coordinates.

## Goals / Non-Goals

**Goals:**

- While a selection is active, the text under the pointer is the text the pointer addressed before any layout change — regardless of what caused the shift (resize, insertion, reorder, async decode).
- Compensation is provably applied **once**, never doubling TanStack's above-viewport correction.
- Outside an active selection, scroll behaviour is byte-for-byte today's behaviour.
- The arithmetic is unit-testable without a layout engine.

**Non-Goals:**

- Making `estimateVirtualRowSize` collapse-aware. Separate change (see proposal Non-Goals). A better estimate reduces frequency; it cannot fix the class, because a tool result gaining content mid-drag is *real* growth.
- The `CopyButton` defect. Unrelated root cause, separate change.
- Preserving selection across session switches, reloads, or transcript trimming.
- Anchoring anything other than a user text selection (e.g. scroll position during ordinary reading).

## Decisions

### D1 — Compensate the *residual* shift, do not classify resizes

**Decision:** Do not attempt to detect whether a resizing row is above or inside the viewport. Instead, once per commit, measure how far the selection's anchor row actually moved **after every other correction has already been applied**, and cancel whatever is left.

This is the load-bearing decision, and it resolves the double-move hazard by construction rather than by care:

```
   ResizeObserver fires
        │
        ▼
   TanStack resizeItem()
        ├── row above viewport?  ──► adjusts scrollTop itself  ──┐
        └── row in viewport?     ──► no adjustment              ─┤
                                                                 │
        ▼                                                        │
   React re-render (measurementsCache changed)                    │
        │                                                        │
        ▼                                                        │
   OUR useLayoutEffect  ◄─────────────────────────────────────────┘
        │                     measures the world AFTER TanStack
        ▼
   residual = how far the anchor row still moved
        ├── TanStack already fixed it  ──► residual ≈ 0  ──► no-op
        └── TanStack ignored it        ──► residual = delta ──► correct once
```

Because we run downstream of TanStack's own adjustment, an above-viewport resize presents as ~0 residual and we do nothing. The spec scenario *"Above-viewport correction is not doubled"* holds without classifying anything.

Verified against the installed `@tanstack/virtual-core@3.13.12`: `resizeItem` adjusts only when `item.start < getScrollOffset() + scrollAdjustments` (`index.cjs:536` — above-viewport only, as described), and it adjusts by writing `scrollTop = offset + (scrollAdjustments += delta)` (`index.cjs:540-541`). That write is a **programmatic scroll of exactly `delta`**, which is why D2 measures viewport-relative movement and gates on the scroll event rather than summing a scroll term.

**Alternatives rejected:**
- *Classify each resize as above/in viewport and compensate only the latter.* Requires mirroring TanStack's internal `start < scrollOffset` predicate. Any divergence (theirs changes, ours doesn't) silently reintroduces the double-move that decision (2) was written to kill.
- *Fork/patch TanStack's `resizeItem`.* Rejected — pins us to an internal.
- *Re-enable native scroll anchoring.* `ChatView.tsx:780` sets `style={{ overflowAnchor: "none" }}` on the scroll container, explicitly disabling the CSS feature built for this exact problem. Deleting that line is the shortest conceivable fix and will be the first thing a reviewer proposes, so it is recorded here as considered and rejected: native anchoring selects its **own** anchor node by heuristic, which for absolutely-positioned virtual rows over a `getTotalSize()` spacer is unpredictable, and it fights both `scrollToIndex` and the sticky-bottom pin — the reasons it is off. Our compensator anchors a node **we** choose (the selection anchor), only while a selection is held. **Historical reason for `overflowAnchor: "none"`, confirmed (task 1.5):** it was set to `"none"` by `virtualize-chat-transcript-tanstack` (task 9.2, flipping the container from `"auto"`), and reaffirmed by `fix-chat-scroll-to-top-estimate-drift` decision (3). The in-tree comment above the container at `ChatView.tsx:854-859` states the reason directly: TanStack's `resizeItem` drives scroll compensation itself, so browser scroll-anchoring must stay OFF or it double-moves. So the reason very much still applies — and it is the *same* double-move hazard this change navigates in D1/D2. Deleting that line would hand anchor selection to a browser heuristic *and* re-arm the double-move. Rejected on current, not historical, grounds.

### D2 — Measure viewport-relative movement, and let the scroll event veto

**Decision:** The shift is viewport-relative movement of the anchor row,

```
  residual = anchorTop_now − anchorTop_prev
```

and compensation is **vetoed** (re-baseline only, no write) on any commit where a real `scroll` event fired since the last baseline.

Viewport-relative movement alone cannot distinguish "content moved under a still viewport" from "viewport moved over still content" — but the `scroll` event can, and it is the browser's own ground truth for the second. The container already has a `scroll` handler (`handleScroll`); it sets a veto flag that the layout effect consumes.

| Situation | `Δ anchorTop` | scroll event? | residual | action |
|---|---|---|---|---|
| User scrolls down 100px | −100 | yes | — | veto — re-baseline, no write |
| Row above grows 800px (in viewport) | +800 | no | **+800** | `scrollTop += 800` |
| Row above shrinks 300px (in viewport) | −300 | no | **−300** | `scrollTop −= 300` |
| TanStack already corrected (above viewport) | ~0 | yes or not-yet | ~**0** | none — safe either way |
| Drag-autoscroll at viewport edge | −n | yes | — | veto — re-baseline, no write |
| Our own correction write | — | yes | — | veto — re-baseline (D-risk loop guard) |

Ordering is what makes the veto reliable: a user scroll dispatches its `scroll` event **synchronously into `handleScroll` before** the commit it provokes, so the flag is always set in time. TanStack's programmatic write dispatches its `scroll` event asynchronously and may land *after* our layout effect — which is harmless, because that case presents `Δ anchorTop ≈ 0` and so writes nothing whether it is vetoed or not. Both orderings are correct.

**Why not sum a scroll term.** The obvious formula `residual = Δ anchorTop + Δ scrollTop` is what this design originally specified, and it is **unsatisfiable**. Writing the correction as `α·Δtop + β·Δscroll`: the user-scroll row `(−d, +d) → 0` forces `α = β`; the in-viewport-growth row `(+G, 0) → G` forces `α = 1` and hence `β = 1`; but the above-viewport row `(0, +G) → 0` forces `β = 0`. No linear formula over those two numbers satisfies all three, because a programmatic scroll and a user scroll *are the same two numbers*. Summing the scroll term therefore writes a second `scrollTop += delta` on every above-viewport resize — reintroducing exactly the double-move that `fix-chat-scroll-to-top-estimate-drift` decision (2) exists to kill, and failing the spec scenario *"Above-viewport correction is not doubled"*. The veto supplies the missing bit of information from outside the arithmetic.

**Alternatives rejected:**
- *Subtract the virtualizer's own adjustment:* `residual = Δtop + (Δscroll − Δ scrollAdjustments)`. Keeps the summed shape, but `scrollAdjustments` is reset to `0` on every observed scroll offset change (`index.cjs:331`) while `scrollOffset` moves, so the derived user-scroll position is discontinuous and emits a spurious `+G` correction on the commit after the reset. Rejected as fragile, and it leans on a library field this design has no contract over.
- *Track `vi.start` of the anchor row in virtual coordinates.* Cheaper (no `getBoundingClientRect`), but blind to anything the virtualizer does not model — image decode inside a measured row, the non-virtualized streaming tail, container padding. Real geometry is the source of truth.

**Accepted limitation:** a wheel tick *in the same commit as* an in-viewport growth is vetoed, so that one growth goes uncompensated and the baseline absorbs it. Deliberate: mis-firing against a real user scroll is worse than missing one frame of compensation, and wheeling mid-drag is rare.

### D3 — Hook: `useLayoutEffect` after every commit while selecting

**Decision:** Run the compensator in a `useLayoutEffect` with no dependency array, early-returning unless a selection is active. React layout effects run after DOM mutation and **before paint**, which is the only window where a correction is invisible.

Every relevant mutation routes through a React commit: `measureElement` → `resizeItem` → `measurementsCache` setState → render; `tool_execution_end` → reducer → render; reorder/insert → render. So "after every commit" covers the trigger table in the proposal without enumerating it.

**Alternatives rejected:**
- *A dedicated `ResizeObserver` on retained rows.* Observes a row's own **size**, but the anchor row's **position** is a function of `vi.start`, which only updates on the subsequent React render. Fires at the wrong moment and adds a second observer.
- *Reuse the coalesced `measureElement` pass at `ChatView.tsx:584-601`.* Only sees async image loads — misses the reported case entirely.
- *`useEffect`.* Runs after paint. The user would see the jump, then see it undone. Strictly worse than doing nothing.

### D4 — Anchor the drag origin row, held as an element reference

**Decision:** Pin the row containing the selection **anchor** (where the drag began), not the focus (under the pointer). Capture the row element on the collapsed→non-collapsed transition and hold the **`Element`**, never the index.

Focus moves by definition — pinning it would be circular. Anchor is stationary in the user's mental model: it is the point they committed to.

Holding an element rather than a `data-index` matters because `data-index` is positional: inserting a row above (`flushStreamingTextAsAssistantRow`) renumbers it, so an index-based anchor silently retargets to a different row — the same class of bug we are fixing. React keys are message ids, so the DOM node is stable across renders. If the element ever becomes detached (`!node.isConnected`), stop compensating rather than correcting against a stale rect.

**Known limitation (accepted):** growth *inside* the anchor row but *above* the anchor point moves the text without moving the row's top, so it is not compensated. Requires the same row to both contain the selection and grow above it — practically, selecting the tail while it streams, which `preserve-streaming-tail-selection` already covers by freezing.

### D5 — Extract the arithmetic as a pure function

**Decision:** New module `packages/client/src/lib/chat/selection-anchor.ts` exporting a pure
`computeAnchorCorrection({ prevTop, nextTop, userScrolled, epsilon })` → `number`.
`ChatView` keeps only the DOM plumbing: read rect, call it, conditionally write `scrollTop`, re-baseline.

The `userScrolled` boolean is D2's veto, passed in rather than sensed — the function stays pure and the decision table stays directly executable. `prevScrollTop`/`nextScrollTop` are **not** inputs: per D2 no scroll term is summed, so feeding them in would only invite a future reader to reintroduce the unsatisfiable formula.

jsdom has no layout engine — `getBoundingClientRect()` returns zeros — so a DOM-level unit test of this behaviour can only assert a tautology. Isolating the arithmetic makes the decision table in D2 directly executable in vitest, and leaves real-layout verification to Playwright where it means something.

Mirrors the existing `chat-virtual-rows.ts` / `chat-selection-copy.ts` split, where pure logic lives in `lib/chat/` and components stay thin.

### D6 — Publish `isSelecting` on one clock

**Decision:** `useActiveChatSelection` sets an `isSelectingRef` **synchronously** inside the `selectionchange` listener, alongside the existing synchronous `selectionSpanRef`, and returns it. `ChatView` feeds the `virtualizer.onChange` bottom-pin gate from that ref instead of the render-time mirror `isSelectingRef.current = isSelecting`.

Today two guards on one invariant read two different clocks: `selectionSpanRef` is synchronous, while `isSelecting` state crosses a `queueMicrotask` **and** a render before its ref mirror updates. A chunk arriving inside that window still executes `el.scrollTop = el.scrollHeight`. That is the "moves on the very first frame" half of the report.

The debounced `isSelecting` **state** is retained unchanged — the tail-freeze effect and the D2 sticky-bottom layout effect depend on it re-rendering, and making those synchronous would thrash React on a drag that fires `selectionchange` many times per frame. Ref for out-of-render guards, state for render-driven effects.

### D7 — Bound compensation only by the natural `scrollTop` clamp

**Decision:** Compensate for as long as the selection is held. No cap, no "give up if the anchor leaves the viewport". The browser's clamp of `scrollTop` to `[0, scrollHeight − clientHeight]` is the only bound.

Resolves proposal Open Question 3. While a selection is held, the user's intent is the selected text, not the live tail — and the bottom-pin is already suspended for the duration, so compensation is not fighting follow mode. Large corrections are *correct* corrections: pinning the anchor through a 12k px growth means nothing visibly moves, which is exactly the goal. Follow resumes on collapse via the existing `wasSelectingRef` edge.

**Alternative rejected:** stop compensating past a threshold. Adds a magic number and a cliff where behaviour silently reverts to the bug, on precisely the large-growth rows that trigger it most.

### D8 — Settle the geometry in a standalone mockup before touching `ChatView`

**Decision:** Build `mockups/chat-selection-anchor/index.html` — a self-contained page reproducing the essential geometry (a scroll container, absolutely-positioned rows at `translateY`, a "grow row N by X px" button, a `Fixes: ON/OFF` toggle) — and use it to reproduce the defect and validate the correction **before** any change lands in `ChatView.tsx`.

The bug is pure geometry, and geometry is exactly what the existing test layers cannot see: jsdom has no layout engine, and reaching this state in Playwright requires a real streaming turn against the docker harness with a tool card completing at the right moment. The mockup makes the trigger a button press and makes an A–B comparison possible in one page.

Direct precedent: `openspec/changes/fix-openspec-board-drop-targeting/mockup/index.html` (`id="fixToggle"`, `Fixes: ON`) did this for the board drag-and-drop defect, and that proposal's measured evidence came from it.

The mockup additionally resolves the questions that manual QA would otherwise absorb: keyboard (Shift+Arrow) selection is trivially exercised there, and touch behaviour can be checked on a real device by serving it over the LAN URL rather than trusting emulation.

**This does not replace the E2E.** The mockup proves the *correction is right*; the Playwright specs prove the *wiring is right* in the real component. Both are required — a mockup that passes while `ChatView` is mis-wired is the obvious failure mode.

**Alternative rejected:** *Go straight to Playwright.* Slower to author, flaky at the point of interest (timing a tool completion mid-drag), and gives no A–B toggle, so a passing test cannot demonstrate that the fix is what made it pass.

## Risks / Trade-offs

- **Correction feedback loop** — our `scrollTop` write triggers `onChange` → render → the layout effect measures again and sees its own write as new drift. → **Mitigation:** re-baseline `prevTop`/`prevScrollTop` immediately after writing, in the same layout effect, before yielding. Plus an `epsilon` (1px) dead-band so sub-pixel noise cannot sustain a loop.
- **Forced reflow per commit while selecting** — `getBoundingClientRect()` in a layout effect forces layout. → **Mitigation:** one read (and at most one write) per commit, only while a selection is active, at a point where the browser must lay out before paint regardless. Verify with a profile over a streaming turn; treat a regression in the existing `chat-idle-render-cost` budget as a blocker.
- **Fractional pixels** — device pixel ratios and CSS transforms yield sub-pixel rects; naive comparison would fire every frame. → **Mitigation:** the `epsilon` dead-band in D5.
- **Touch / iOS selection** — mobile selection UI (magnifier, handles) plus momentum scrolling may interact badly with programmatic `scrollTop` writes. → **Mitigation:** D2's content-space formula treats momentum scroll as scroll, so it is not fought. Explicit mobile QA before ship; if handles fight the correction, gating compensation to non-touch pointers is a clean fallback that still fixes the reported desktop case.
- **Anchor row unmounts despite D3 retention** — a bug in `rangeExtractor` or a selection past `SELECTION_RETAIN_CAP` would strand the anchor. → **Mitigation:** `isConnected` check; treat a detached anchor as "stop compensating", never as "correct against a stale rect".
- **Smooth scrolling reintroduced** — if `scroll-behavior: smooth` ever lands on the container, every correction animates and the compensator becomes a visible oscillator. → **Mitigation:** the constraint is already load-bearing for `fix-chat-scroll-to-top-estimate-drift` decision (3); add a regression assertion rather than a comment.

## Migration Plan

Pure client-side change: no protocol, persistence, migration, or server involvement. Ships via `npm run build` + `/api/restart` (client-package path in the rebuild matrix). Rollback is a revert of the commit — no state is written, so no cleanup. Not flagged: the behaviour is inert unless a selection is active, which is a narrower guard than a feature flag would give.

## Measured Evidence (D8 mockup)

`mockups/chat-selection-anchor/index.html`, driven by real Chromium input (mouse
down → move → resize a row above → 1px nudge, pointer never travelling backwards).
`ANCHOR DRIFT` is the anchor row's viewport-top movement across the shift.

| Scenario | Fixes | correction | anchor drift | selection |
|---|---|---|---|---|
| Tool row 2 grows +800 mid-drag in row 7 | OFF | 0 px | **+800 px** | 35 → 545 chars — **RETARGETED** |
| same | ON | +800 px | **0 px** | 35 → 35 chars — unchanged |
| Tool row 2 shrinks −800 mid-drag | OFF | 0 px | −32 px | 35 → 112 chars — **RETARGETED** |
| same | ON | −32 px | **0 px** | 35 → 35 chars — unchanged |
| Row ABOVE viewport grows +800 (virtualizer corrects) | ON | **0 px** | 0 px | applied exactly once |
| Wheel 150px during an active selection | ON | 0 px | — | `scrollTop` 480 → 630, not clawed back |

The reported defect reproduces (1.2) and the correction fixes it (1.3), in both
directions. The above-viewport row is the load-bearing one: the compensator
writes **0** there, so the resize is applied once — whereas the summed formula
this design originally specified would have written a second `+800`.

### Keyboard selection — resolves the 1.4 open question

**Finding: compensation is redundant for keyboard-selection correctness, is never
harmful, and is beneficial for visibility. No keyboard-specific gating.**

Two measured facts:

1. `Shift+ArrowRight` inside the transcript is a **no-op**. Transcript rows are
   not editable, and Chromium does not extend a selection with arrow keys in
   non-editable content unless caret browsing (F7) is enabled. So the keyboard
   path is not even reachable by default.
2. Driving the primitive the key handler drives when caret browsing IS on
   (`Selection.modify("extend", "forward", "character")`), the selected string is
   **byte-identical with the fix ON and OFF** — `"age 7: the p"` →
   `"age 7: the prose "`, growing by exactly the 5 characters typed, across an
   +800px shift of a row above.

The asymmetry with the mouse is the root cause, and it explains the whole bug:
keyboard extension advances the focus by **character offset**, so content moving
under the cursor is irrelevant. Mouse extension re-resolves the focus by
**hit-testing a screen point**, so content moving under a stationary pointer
silently retargets it. Only the mouse path can run backwards.

Compensation still helps the keyboard case, just not for correctness: with the
fix OFF the anchor drifted 800px (the selected text scrolls off-screen while the
user keeps extending it); with the fix ON the drift was 0px. Keeping it ungated
is therefore strictly better than special-casing it — and one less conditional.

## Open Questions

- **Touch behaviour is unverified and deliberately out of scope.** Desktop is the acceptance surface for this change. Compensation is NOT gated on `pointerType` — it ships everywhere, because D2's content-space formula already treats momentum scroll and drag-autoscroll as scroll rather than drift, so the expected touch behaviour is "works, or is inert". The unverified residual risk is native selection handles fighting a programmatic `scrollTop` write. If that surfaces later, a `pointerType` gate is a one-line follow-up that leaves the desktop fix intact.

  Explicitly NOT assumed: that iOS lacks text selection. Nothing in the code disables it — `packages/client/src/components/chat/` contains no `select-none` or `userSelect`, `SELECTION_RETAIN_CAP_MOBILE = 40` exists specifically to budget mobile selection, and the container handles `onTouchMove`. Recording the absence of evidence rather than inventing a platform limitation, so a future reader does not inherit a false constraint.
