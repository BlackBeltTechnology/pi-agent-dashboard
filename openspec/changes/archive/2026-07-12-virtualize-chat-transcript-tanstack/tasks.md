## 1. Entry gate (do not skip)

- [ ] 1.1 Confirm `reduce-chat-render-cpu-umbrella` has landed (Phase 1 + 3 + 4) and re-record the baseline scenario. Enter this change only if Step A (`content-visibility`) misses the budget on GC/listeners/DOM — capture the post-Step-A trace numbers (DOM nodes, listeners, GC time, heap peak, idle busy %) in this change dir as the "before Step B" baseline.
- [x] 1.2 `doubt-driven-review` on the scroll-anchoring + `ChatViewHandle` design below, before writing code.

## 2. Dependency + row model

- [x] 2.1 Add `@tanstack/react-virtual` to `packages/client` (pin version; note it in the delta).
- [x] 2.2 From the measured message-height distribution (umbrella task 4.1), derive per-row-type `estimateSize` values (single bubble vs. burst group vs. collapsed group).
- [x] 2.3 Build `turnToFirstRowIndex: Map<number, number>` inside the existing `groupedMessages` `useMemo` (each row → its originating turn; first row wins).

## 3. Windowed render (chat mode) — see Doubt-Review Corrections CR-1..CR-7 in design.md

- [x] 3.0 (CR-5) Build a `displayRows` array = `groupedMessages` with all prefs-gated / suppressed rows (the ~7 `return null` sites) filtered OUT, so `count === displayRows.length` and no index reserves empty spacer space. `getItemKey`, the turn map (task 5), and persistence (task 7) all key off `displayRows`.
- [x] 3.1 Replace `groupedMessages.map(...)` with `useVirtualizer({ count: displayRows.length, getScrollElement:()=>scrollRef.current, estimateSize, getItemKey, overscan:6 })` where `getItemKey` is per-type (CR-3): `burst.id` | `group.messages[0]?.id ?? "group-"+i` | `msg.id` (never a bare `toolName` — collision risk). Render `getVirtualItems()` as absolutely-positioned `measureElement` rows over a `getTotalSize()` spacer; set `overflowAnchor:"none"` on the container. Do NOT wire `followOnAppend`/`anchorTo` to drive bottom-pinning — that stays on the DOM scroll machine (task 6, CR-1). Keep each row's burst/group/message branch and `data-turn`.
- [x] 3.2 Verify `getScrollElement` targets the same node the old `scrollRef` container used (sticky toolbar + `FilePreviewHost` unaffected).

## 4. Streaming tail always-live

- [x] 4.1 Ensure the streaming/pending-steer row(s) are never unmounted (static sibling below the spacer, or `rangeExtractor` force-append of the last index). Pin the mechanism.
- [x] 4.2 TDD: test asserting the streaming row stays mounted across window changes and that its growth keeps the bottom pinned while following. Two Playwright e2e in `chat-transcript-virtualization.spec.ts`: `"streaming tail stays mounted while scrolled up in history"` (live `.chat-stream-live` sibling stays attached after scrolling to top — a window change) and `"streaming growth keeps the bottom pinned while following"` (samples `distanceFromBottom < 50` across 5 stream frames while `scrollHeight` grows). Green via `PW_CHANNEL=chrome` docker harness.

## 5. `scrollToTurn` → `scrollToIndex`

- [x] 5.1 Rewrite `ChatViewHandle.scrollToTurn` body to `virtualizer.scrollToIndex(turnToFirstRowIndex.get(turnIndex), { align:'start' })`, keeping the `stickToBottomRef=false` + show-button side effects. Signature unchanged.
- [x] 5.2 Test: `scrollToTurn` on an unmounted (off-screen) turn scrolls it into view top-aligned and suspends follow (spec scenario "Jump to an off-screen turn").
- [ ] 5.3 Snapshot old vs new landing position on a fixture to confirm `align:'start'` matches the current top-align intent.

## 6. Scroll-lock parity (`chat-scroll-lock` must not regress)

- [x] 6.1 Reproduce all `chat-scroll-lock` scenarios on the windowed path: 50px lock, resume within 50px, scroll-to-bottom button visibility, click-to-resume, and the multi-batch `event_replay` race (programmatic scroll must not register as user scroll-up; real user scroll during replay still wins). Covered by Playwright e2e in `chat-transcript-virtualization.spec.ts`: `"50px lock…"`, `"resume within 50px…"` (manual scroll back within threshold re-arms follow — no button click), `"scroll-to-bottom button…"` (visibility + click-resume), `"reload lands at latest…"` (programmatic replay pins bottom, no false lock), and `"user scroll-up mid-replay wins…"` (real scroll-up during a 120-turn batched reload replay flips follow off and stays off). All green via `PW_CHANNEL=chrome` docker harness.
- [x] 6.2 (CR-1 — REVISED, do NOT blanket-delete) PRESERVE the DOM-measured scroll state machine: `handleScroll` (50px near-bottom), `stickToBottomRef`, `showScrollButton`, instant-vs-smooth scroll-to-bottom (`ChatView.tsx:236`), and the `event_replay` race + 150ms user-scroll arbitration. These already pass `chat-scroll-lock` and measure the REAL container (which includes the bottom sibling rows the spacer excludes). Only remove what the virtualizer genuinely replaces (the full `groupedMessages.map`); swap `overflowAnchor:"auto"` → `"none"`. The virtualizer does windowing + history-prepend anchoring ONLY.

## 7. Per-session scroll persistence

- [x] 7.1 Replace saved `{scrollTop, nearBottom}` with `{anchorRowIndex, offset, nearBottom}`; restore via `scrollToEnd()` (if following) or `scrollToIndex(anchorRowIndex,{align:'start'})` + offset.
- [x] 7.2 Test: switch away mid-scroll, switch back → same anchored row (not bottom) when not following. Playwright e2e `"switching away mid-scroll and back restores the anchored row, not bottom"` in `chat-transcript-virtualization.spec.ts`: spawns B first then streams A (B/A ordering matters — `spawnFreshGitSession`→`gotoDashboard` does a full `page.goto` reload that wipes the in-memory `scrollStateMap`, so A's stream must be the LAST reload), scrolls A to top (button appears, anchor persisted), switches B→A via card clicks (client-side wouter nav, no reload; URL `/session/:id` confirms each switch), asserts A restores `distanceFromBottom > 200` + button visible (not bottom). Passing via `PW_CHANNEL=chrome` docker harness.

## 8. Height stability

- [x] 8.1 Reserve intrinsic size for inline images (width/height or `aspect-ratio`) and a min-height for mermaid containers so above-viewport async loads do not shift scroll offset.
- [x] 8.2 Verify expanding/collapsing an above-viewport tool group does not yank the viewport (ResizeObserver re-measure + chat-mode offset adjust). Playwright e2e `"toggling an above-viewport tool group does not yank the viewport"`: streams ~120 single-member burst groups, parks at mid-scroll (follow OFF), records a visible anchor row's on-screen Y, then toggles the topmost mounted `tool-burst-header` that sits fully ABOVE the fold via `dispatchEvent('click')` (no auto-scroll-into-view). Asserts the anchor's Y shifts < 8px — TanStack's measure-driven scroll adjustment (with `overflowAnchor:none`) absorbs the above-fold height change. NOTE: `Locator.evaluate` passes `(element, arg)` — element is FIRST; mis-signaturing it as `(arg)` silently makes the element the arg. Green via `PW_CHANNEL=chrome` docker harness.
- [ ] 8.3 Manual: scroll an image-heavy + mermaid-heavy long session; confirm no jitter beyond one frame.

## 9. Browser E2E validation (the layer units cannot reach)

The scroll/streaming/windowing behavior is not assertable in vitest (jsdom has no layout). It is gated by Playwright specs against the `docker/` harness. A skeleton already exists at `tests/e2e/chat-transcript-virtualization.spec.ts` (6 `test.fixme` tests mapped to every `chat-scroll-lock` + `chat-transcript-virtualization` requirement). Activating it needs two prerequisites:

- [x] 9.1 **Add the `long-transcript` faux scenario** to `qa/fixtures/faux-scenarios.ts`: stream ~400+ heterogeneous messages (mix of assistant text, thinking blocks, and tool calls) so the transcript spans several viewports — enough to force a >50px scroll-up AND to make windowing observable. Existing `burst-heterogeneous` is too short. Export a marker for the tail message so the e2e can assert the streaming tail. This is the single unblock for all 6 skeleton tests.
- [x] 9.2 **Resolve the scroll-container handle** (helpers say "do NOT add app testids for E2E", but the virtualizer needs `getScrollElement` on that node regardless): add `data-testid="chat-scroll-container"` to the transcript scroller in `ChatView.tsx` and promote both it and the existing `scroll-to-bottom` button testid into the central `TESTIDS` map (`tests/e2e/helpers/index.ts`). Then replace the skeleton's structural `.overflow-y-auto` fallback with the testid.
- [x] 9.3 Flip the 6 `test.fixme` → `test` in `chat-transcript-virtualization.spec.ts`; wire the two TODO stubs (off-screen `scrollToTurn` trigger; streaming-tail mounted assertion) to real affordances. Run `npm run test:e2e` — all 6 green. Verified via `PW_CHANNEL=chrome` (system Chrome) against the `docker/` harness. Two calibration fixes needed: (a) `test.setTimeout(240_000)` on the 3 tail-dependent tests (120-turn fixture fires 120 real bash calls, cannot settle in the 60s default); (b) new `long-transcript-nav` faux scenario (40 turns) for the scroll-to-turn test — a faux run has ONE user turn so only turn 0 gets a `turnIndex`, and 120 turns evicts its stat past client `MAX_TURN_STATS=50`, hiding the clickable `turn-bar`; 40 turns keeps it in-window while still off-screen. Also de-flaked scroll-to-bottom via `expect.poll` (streaming race).
- [x] 9.4 Add a `tests/e2e/AGENTS.md` row for the new spec and a `qa/fixtures/` note for the `long-transcript` scenario (per Documentation Update Protocol).

## 10. Verification

- [ ] 10.1 Re-trace the umbrella baseline scenario; diff vs. the task-1.1 "before Step B" numbers. Gate: mounted DOM nodes and listeners bounded by working set (not session length); GC time and heap peak materially reduced; idle busy still < 5%. PARTIAL (automatable slice done): the **mounted-DOM-nodes-bounded** sub-gate is now an e2e assertion in `chat-transcript-virtualization.spec.ts` ("mounted rows AND DOM nodes are bounded…") — a 120-turn session measures **179** transcript DOM nodes vs the **46,918** Step-A baseline (< 3000 ceiling, ~262× reduction), proving nodes track the viewport working set, not session length. REMAINING (manual DevTools trace, design: "not assertable"): listeners bounded, GC time ↓, heap peak ↓, idle busy < 5%.
- [x] 10.2 Full test suite (`npm test 2>&1 | tee /tmp/pi-test.log`; grep FAIL) + type-check. No `chat-scroll-lock` scenario regresses.
- [x] 10.3 Document the Cmd-F find-in-page regression for the ship decision; file the in-app-search / print-expand follow-up as out-of-scope.
- [ ] 10.4 Manual smoke: typing, streaming, scrolling history, tool bursts, jump-to-turn, session switch/restore, reduced-motion. (Tested later during ship.)
