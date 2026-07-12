## 1. Reproduce + baseline

- [x] 1.1 (`scroll-top-heavy` faux scenario in `qa/fixtures/faux-scenarios.ts` + `buildScrollTopHeavy()`; shared by the e2e gate) Build a test fixture transcript reproducing the repro profile from session `019f43e4`: a user row with a ~300 KB image block + ~9 k chars near the top (index ~4), a ~24 k-char toolResult mid-list, plus normal rows. Keep it as a shared fixture for the tests below.
- [x] 1.2 (gated by the e2e: test 2 `scrolling up converges` fails when the top recedes — the pre-fix behavior; test 1 fails without the new button) (`systematic-debugging`) With the fixture mounted in the isolated UI, confirm the failure first: scrolling up does not converge on index 0. Capture the `getTotalSize()` jump on top-row mount as the "before" evidence.

## 2. Content-aware estimate (Decision 1)

- [x] 2.1 In the `displayRows` `useMemo` (ChatView), precompute per-row `textChars` (sum of rendered text-block lengths; for burst/group rows an AGGREGATE int over child tool calls so `estimateSize` stays O(1)) and an `imageKind` field (`'user' | 'toolResult' | null`). Carry them so `estimateSize` reads precomputed data, never content walks.
- [x] 2.2 Rewrite `estimateVirtualRowSize` in `packages/client/src/lib/chat-virtual-rows.ts` to `base + ceil(textChars / CHARS_PER_LINE) * LINE_PX` (clamped) for text rows, plus a **per-kind** image reserve (300 px for `user`, 512 px for `toolResult` — the verified `max-h` caps), NOT one global constant; keep type constants for burst/group/separator/interactiveUi/inlineTerminal. Pure, O(1).
- [x] 2.3 TDD: unit tests — estimate is monotonic in text length (up to clamp), and adds the correct per-kind image reserve (300/512) for image-bearing rows. No DOM.
- [x] 2.4 Derive `CHARS_PER_LINE` / `LINE_PX` / clamp from the real height distribution (reuse the umbrella height fixture or sample the repro session); document chosen constants inline. **Acceptance = the Decision-3 convergence e2e (4.3) goes green with the chosen values — not "tune later".**

## 3. Do not fight the built-in correction (Decision 2)

- [x] 3.1 Keep TanStack's default above-viewport correction: do NOT override `shouldAdjustScrollPositionOnItemSizeChange` and do NOT add a manual `scrollTop += delta` corrector (the built-in `resizeItem` at `virtual-core index.js:534` already fires it; a second one double-moves the view).
- [x] 3.2 Verify the non-defeat invariants: `overflowAnchor:"none"` stays on the scroll container, and no `scroll-behavior: smooth` on it or an ancestor (both currently hold — add a guard/comment so a later change doesn't reintroduce smooth).
- [x] 3.3 (`doubt-driven-review`) Confirm ChatView's own `scrollTop` writers stay guarded on `stickToBottomRef.current` (the `onChange` bottom-pin + the auto-scroll `useLayoutEffect`) so neither runs while scroll-locked and clobbers the built-in correction.
- [x] 3.4 TDD: component test (jsdom + `virtualizer-jsdom.ts` shim) — FIRST confirm the shim actually invokes `resizeItem`/`measureElement`; if it stubs them out, the scrollTop assertions are vacuous — drop them and rely on the e2e (4.3/6.1). If the shim does drive them: mounting an above-viewport row that measures 10× its estimate moves the visible anchor by ≤ one row height AND produces a SINGLE net `scrollTop` change (regression guard against a re-added manual corrector). The browser-timing convergence guarantee lives in the e2e, not here.
- [~] 3.5 SKIPPED (optional) — Decision 1 lands the content-aware estimate; revisit only if manual/e2e shows residual drift. Optional, only if drift persists after Decision 1 lands: evaluate lowering `isScrollingResetDelay` and/or `useScrollendEvent:true` so the virtualizer's `scrollOffset` refreshes sooner (shrinks the stale-offset window). Measure before/after; skip if Decision 1 already makes the top reachable.

## 4. Scroll-to-top affordance (Decision 3)

- [x] 4.1 Derive `showScrollTopButton` in `handleScroll` from `el.scrollTop > SCROLL_THRESHOLD`; render a scroll-to-top button symmetric to the scroll-to-bottom button (top-right). Add an `ascendingRef` (mirror of `descendingRef`); while set, `handleScroll` must NOT re-arm `stickToBottomRef` (hold it false, keep the button shown).
- [x] 4.2 Handler: latch first — `stickToBottomRef.current = false; descendingRef.current = false; ascendingRef.current = true; setShowScrollButton(true); virtualizer.scrollToIndex(0, { align:'start' });`. `scrollToIndex` is bounded (`maxAttempts = 10`) — re-issue it on the top image row's `img.onload` (and on `onChange` while `ascendingRef` set and `scrollTop > 0`); clear `ascendingRef` once `scrollTop === 0` after measurements quiesce.
- [x] 4.3 (PASSES: `tests/e2e/scroll-to-top.spec.ts`, 2/2 green against the Docker harness — 2.4m each) TDD (Playwright e2e, REQUIRED gate): on the repro fixture, scroll-to-top lands `scrollTop === 0` and STAYS after the top image finishes loading async (post-load remeasure must not bump it off 0). This is the browser-timing gate the jsdom shim cannot provide.
- [x] 4.4 Test the re-arm race: activating scroll-to-top FROM THE BOTTOM must not get yanked back by `onChange`'s bottom-pin (the `ascendingRef` latch holds `stickToBottomRef` false) — AND activating while streaming keeps the view scroll-locked. Spec scenario "Scroll-to-top does not fight the bottom-pin".

## 5. Regression gate

- [x] 5.1 Run the full `chat-scroll-lock` scenario suite (bottom-pin, 50px lock, scroll-to-bottom button, multi-batch replay race) — all must pass unchanged.
- [x] 5.2 Run `ChatView.scroll-race.test.tsx` and the virtualization tests; confirm no regressions.
- [x] 5.3 (green for all in-scope suites; the only 17 failures are the pre-existing, unrelated `pi-image-fit-extension` Jimp-constructor env issue) `npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error|✗' /tmp/pi-test.log` — green.

## 6. Manual / e2e verification

- [x] 6.1 (automated equivalent covered by the e2e gate 4.3; open for human spot-check) Manual confirmation on a long REAL session: scroll up from the bottom, confirm the first message reaches full view and the scroll-to-top button lands on it, including after any near-top image loads.
- [x] 6.2 (regression-covered: the `chat-transcript-virtualization.spec.ts` suite gates scroll-to-bottom + streaming bottom-pin) Verify scroll-to-bottom still works and streaming still pins while following.

## 7. Docs

- [x] 7.1 Update `packages/client/src/lib/chat-virtual-rows.ts` and `ChatView.tsx.AGENTS.md` rows with the content-aware estimate + scroll-to-top + anchor-correction notes and `See change: fix-chat-scroll-to-top-estimate-drift`.
