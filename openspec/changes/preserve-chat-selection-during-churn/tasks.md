## 1. Reproduce (systematic-debugging)

- [ ] 1.1 Reproduce Path A at-bottom: select finished-card text while at the bottom during a live stream; confirm the auto-scroll pin collapses it. Capture the exact churn step.
- [ ] 1.2 Reproduce Path A scrolled/multi-card: scroll up, select across ≥2 cards, trigger churn so an endpoint row unmounts; confirm collapse.
- [ ] 1.3 Reproduce Path B: select inside the streaming tail card; confirm the next chunk replaces its text nodes and collapses the selection.

## 2. Selection detection hook

- [ ] 2.1 Add `useActiveChatSelection(containerRef)` in `packages/client/src/hooks/` — `selectionchange` listener; `isSelecting` true when non-collapsed AND the Range intersects the container (test BOTH anchor and focus, or `range.intersectsNode`), NOT `contains(anchorNode)` alone; expose `{ isSelecting, range }`; microtask-coalesce state flips.
- [ ] 2.2a **Proactive capture:** on selection start (first non-collapsed change), record the selection's row-index span into a **ref** while the anchor row is still mounted, and keep it current on each `selectionchange`. This ref — not a post-hoc DOM read — is what `rangeExtractor` consumes, so selected rows never unmount (DOM Range endpoints move synchronously + irreversibly on unmount).
- [ ] 2.2 Unit test the hook: non-collapsed inside → true; collapse → false; outside container → false; **cross-boundary (anchor outside, focus inside) → true**; coalescing does not thrash.
- [ ] 2.3 Wire the hook into `ChatView.tsx` against the `chat-scroll-container` ref.

## 3. Suspend auto-scroll while selecting (D2 / Path A at-bottom)

- [ ] 3.1 Early-return the `stickToBottom` `useLayoutEffect` and the virtualizer `onChange` bottom-pin when `isSelecting`, WITHOUT clearing `stickToBottomRef`.
- [ ] 3.2 Add `isSelecting` to the auto-scroll effect's dependency array so the `→ false` edge re-fires the pin (else the user is stranded when no content arrives after collapse). Resync `lastScrollHeightRef` on that edge to avoid a spurious bottom-pin.
- [ ] 3.3 On selection collapse, resume follow only if the user was at bottom (re-pin path).
- [ ] 3.4 Test: streaming append at bottom with an active finished-card selection → selection intact, no scroll yank; on collapse with NO further content → follow still resumes.
- [ ] 3.5 Regression: run all `chat-scroll-lock` scenarios with no selection → unchanged (50px threshold, button, `event_replay` race).

## 4. Retain selection-intersecting rows via rangeExtractor (D3 / Path A multi-card)

- [ ] 4.1 Add a `Range → intersecting display-row index set` helper: walk `start`/`end` containers up to `[data-index]`; endpoints in a NON-virtual region (streaming tail, pending-steer, pending-prompt — no `data-index`) clamp to the nearest virtual boundary; normalize reversed and same-row cases; apply the retained-row **span** ceiling **N ≈ 100** (min..max index). Unit-test each case in `chat-virtual-rows.ts` (or a sibling).
- [ ] 4.2 In `ChatView.tsx`, pass a custom `rangeExtractor` to `useVirtualizer` = `defaultRangeExtractor(range)` ∪ the proactively-tracked selection span (from the 2.2a ref), capped at a **device-aware N** (desktop ~100 / mobile ~40 via `useMobile()`). `rangeExtractor` runs on every recompute *before* unmount, so reading the ref there keeps selected rows mounted and avoids the synchronous Range-mutation race. Do NOT bolt extra rows onto `getVirtualItems()` or hand-position them; `getTotalSize()` is allowed to change.
- [ ] 4.3 Investigate `resizeItem` scroll-anchoring: when an above-viewport selection row measures larger than its estimate, TanStack fires `_scrollToOffset` with an adjustment. Confirm the selected Text nodes stay attached (selection survives) and decide whether the viewport shift needs compensation; add handling if jarring.
- [ ] 4.4 Enforce past-N behavior with an **active clear**: when the span exceeds N, call `getSelection().removeAllRanges()` (optionally a brief "selection too large" hint) or intercept `copy`. Do NOT rely on passive collapse — start/end in different removed rows do NOT collapse the Range; it persists with garbage offsets and copies silently-wrong text.
- [ ] 4.5 Test: multi-card selection where an endpoint would unmount → all intersecting rows stay mounted (proactively), selection intact; Select-All / span > N → no full mount AND the selection is visibly cleared (not a silent partial copy). Add a test asserting the past-N path does not leave a truncated `getSelection().toString()`.

## 5. Streaming-tail: no worse than baseline (Path B)

- [ ] 5.1 Confirm D1–D3 do not regress an in-streaming-tail selection vs. baseline (it may still collapse today; must not get worse).
- [ ] 5.2 File a follow-up change for real streaming-tail preservation (node-stable streaming render); do NOT attempt the DOM-freeze approach here (the tail unmounts at turn completion).
- [ ] 5.3 File a follow-up change for **copy fidelity via copy-event interception** (see D5). Scope honestly: use `Range.cloneContents()` → text for partial rows (DOM offset → markdown-source offset is intractable without a source map, so do NOT reconstruct from source); and note that subsuming `AgentToolRenderer`'s `text.slice(0, 1000)` requires that renderer to expose its full `args.prompt` to the copy path (per-renderer cooperation) — it is not auto-subsumed by a generic data-model read.
- [ ] 5.4 Test: chunk arrives / turn completes during a streaming-tail selection → behavior no worse than the pre-change baseline.

## 6. Validate

- [ ] 6.1 `openspec validate preserve-chat-selection-during-churn` passes.
- [ ] 6.2 `npm test` green; new ChatView selection specs pass.
- [ ] 6.3 Manual pass across all three reproductions from task 1 (finished at-bottom, scrolled multi-card, streaming tail).
