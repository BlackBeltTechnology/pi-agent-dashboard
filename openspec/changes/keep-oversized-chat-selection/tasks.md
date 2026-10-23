# Tasks

## 1. Pure helpers (row-span math, live selection by row key, three-part serialization)

- [ ] 1.1 Replace the superseded test `does NOT extend past the cap (no full mount) — caller actively clears` (`packages/client/src/lib/__tests__/chat-virtual-rows.test.ts:355`) with a failing L1 test (test-plan #E1), using the same file's existing `extendRangeWithSelection` cases as the harness exemplar.
  - Input: base `[10..20]`, cap 100, count 1000, spans of length 99 / 100 / 101 starting at 200.
  - Trigger: `extendRangeWithSelection`.
  - Observable: 99 and 100 add the whole span; 101 adds only `200` and `300`; output is sorted and within `[0, count)`.

  Verify it fails with `npx vitest run packages/client/src/lib/__tests__/chat-virtual-rows.test.ts`.
- [ ] 1.2 Write a failing L1 test (test-plan #E2) in `chat-virtual-rows.test.ts` (exemplar: the same file).
  - Input: stored `{0..60}`, live `{50..110}`, cap 100.
  - Trigger: retained-set computation.
  - Observable: the extra retained rows are exactly `{0, 60, 50, 110}`, and the count beyond base is ≤ max(cap, 4).

  Verify it fails.
- [ ] 1.3 Write a failing L1 test (test-plan #E3) in `chat-virtual-rows.test.ts` (exemplar: the same file).
  - Input: stored `{10..40}`, live `{10..60}`, cap 100.
  - Trigger: retained-set computation.
  - Observable: all of `10..60` is retained.

  Verify it fails.
- [ ] 1.4 Write a failing L1 test (test-plan #E4) in `chat-virtual-rows.test.ts` (exemplar: the same file).
  - Input: base `[10..20]`, retained `{0, 300}`, copy span `{0..300}`.
  - Trigger: copy-span union.
  - Observable: the union is `0..300`, and the copy-only set is `0..300` minus base minus `{0, 300}`.

  Verify it fails.
- [ ] 1.5 Implement the endpoint branch, the D4 retained union rule, and the copy-span union with copy-only set output in `packages/client/src/lib/chat/chat-virtual-rows.ts` (design D1/D2/D4). Verify that 1.1–1.4 pass.
- [ ] 1.6 Write a failing L1 test (test-plan #E5) for `liveSelectionRowSpan(container, keyToIndex, rowCount)` in `chat-virtual-rows.test.ts`. Use the DOM-building helpers of `packages/client/src/hooks/__tests__/useActiveChatSelection.test.tsx` as the exemplar.
  - Input: rows keyed `k0..k9`; a Range from `k7` back to `k2`; an endpoint in a non-virtual tail node.
  - Trigger: call.
  - Observable: the reversed range gives `{2, 7}`; the tail endpoint clamps to `9`; a collapsed selection gives `null`.

  Verify it fails.
- [ ] 1.7 Write a failing L1 test (test-plan #E6) in `chat-virtual-rows.test.ts` (exemplar: as 1.6).
  - Input: DOM rows still carrying pre-splice `data-index` 0..9, while `keyToIndex` has 5 rows spliced above (`k3` → 8).
  - Trigger: live resolution of a Range in `k3`.
  - Observable: returns `8`, not `3`.

  Verify it fails.
- [ ] 1.8 Write a failing L1 test (test-plan #E7) in `chat-virtual-rows.test.ts` and `packages/client/src/hooks/__tests__/useActiveChatSelection.test.tsx` (exemplar: that hook test's selection helpers).
  - Input: a Range from a node before the container to a node after it.
  - Trigger: `liveSelectionRowSpan` plus the hook signal.
  - Observable: `liveSelectionRowSpan` returns `null`, and `isSelecting` stays false.

  Verify it fails.
- [ ] 1.9 Write a failing L1 test (test-plan #E8) in `chat-virtual-rows.test.ts` (exemplar: as 1.6).
  - Input: the live endpoint's key `kX` is absent from `keyToIndex`; stored span `{4..30}`.
  - Trigger: live resolution.
  - Observable: it falls back to the stored bound (`4` for start, `30` for end), with no throw.

  Verify it fails.
- [ ] 1.10 Write a failing L1 timed test (test-plan #P3) in `chat-virtual-rows.test.ts`, using an existing timed `it` in `packages/client/src/lib/__tests__/` as the exemplar.
  - Input: a 2000-entry `keyToIndex`.
  - Trigger: 1000 calls of `liveSelectionRowSpan` plus the union.
  - Observable: mean time per call < 0.2 ms.

  Verify it fails, or fails to compile while the helper does not exist yet.
- [ ] 1.11 Implement `liveSelectionRowSpan` (with clamp and missing-key fallback) and `buildRowKeyToIndex(displayRows)` keyed by `virtualRowKey`. Verify that 1.6–1.10 pass.
- [ ] 1.12 Write a failing L1 test (test-plan #E9) in `packages/client/src/lib/__tests__/chat-selection-copy.test.ts` (exemplar: the same file).
  - Input: range positions before-only, before→inside, inside-only, inside→after, before→after, and disjoint.
  - Trigger: the split helper.
  - Observable: parts `{pre}`, `{pre, mid}`, `{mid}`, `{mid, post}`, `{pre, mid, post}` and `null`; assembly drops empty parts and joins with one `\n`.

  Verify it fails.
- [ ] 1.13 Write a failing L1 test (test-plan #E10) in `chat-selection-copy.test.ts` (exemplar: the same file).
  - Input: `pre` holding `script`/`style`/`template`/`noscript`/`[hidden]`/`[aria-hidden="true"]` text, a visible `SIDEBAR-MARK`, and a `data-copy-text` element.
  - Trigger: serialize `pre` scoped to `document.body`.
  - Observable: `SIDEBAR-MARK` and the full copy-text are present; no hidden, script or style strings.

  Verify it fails.
- [ ] 1.14 Implement the split, assembly, and outside-part filter in `packages/client/src/lib/chat/chat-selection-copy.ts`, reusing `buildSelectionClipboardText`. Verify that 1.12–1.13 pass. Update the `chat-virtual-rows.ts` and `chat-selection-copy.ts` AGENTS sidecars with the new exports and `See change: keep-oversized-chat-selection`. Verify that `kb_search` (doc_type `agents`) for `liveSelectionRowSpan` returns the updated row.

## 2. E2E infrastructure (cross-engine projects, CI install, timing hook)

- [ ] 2.1 In `playwright.config.ts`, add `firefox` (`devices["Desktop Firefox"]`) and `webkit` (`devices["Desktop Safari"]`) projects whose `testMatch` is scoped to `large-selection.spec.ts`. The chromium project stays unchanged. Verify that `npx playwright test --list --project=firefox` lists only `large-selection.spec.ts` tests, and that the chromium list is unchanged apart from the new spec.
- [ ] 2.2 In `.github/workflows/ci-e2e-browser.yml`, install `chromium firefox webkit` (`pnpm exec playwright install --with-deps chromium firefox webkit`) in **every shard job**. `playwright test --shard` distributes the firefox and webkit project tests across shards. Keep the workflow advisory, per the `ci-cd-pipeline` requirement "Sharded browser-E2E workflow runs on schedule, dispatch, and label". Verify with a workflow lint (`actionlint` if available) and a dispatch run on a throwaway branch (see the `validate-ci-workflow-pre-merge` skill), confirming all three projects execute.
- [ ] 2.3 Create `tests/e2e/large-selection.spec.ts`, using `tests/e2e/chat-transcript-virtualization.spec.ts` as the exemplar for the `[[faux:long-transcript]]` session bootstrap and the `chatScroll` helpers. Add shared helpers:
  - a drag with a wheel or `scrollTop` loop;
  - clipboard sentinel priming plus a paste round-trip into a test textarea;
  - the runtime row count.

  Add the `tests/e2e/large-selection.spec.ts.AGENTS.md` sidecar and its row in `tests/e2e/AGENTS.md`. Verify that `npx playwright test --list tests/e2e/large-selection.spec.ts` succeeds.

## 3. ChatView retention (no clearing, live read, modality ceilings)

- [ ] 3.1 Write a failing L1 test (test-plan #E11) in `packages/client/src/components/__tests__/ChatView.selection.test.tsx` (exemplar: `ChatView.selection-anchor.test.tsx` for the matchMedia/virtualizer shim).
  - Input: matchMedia (fine, `max-height:599px`), (coarse, wide), (fine, wide).
  - Trigger: render plus an oversize span.
  - Observable: retained ceiling 100 / 40 / 100 and copy ceiling 500 / 150 / 500.

  Verify it fails.
- [ ] 3.2 Write a failing L1 test (test-plan #F10) in `ChatView.selection.test.tsx` (exemplar: the rerender-with-props harness in `ChatView.selection-anchor.test.tsx`; the behavioural reference is `tests/e2e/history-backfill-gap.spec.ts` F4).
  - Input: a held selection in row key `kA`.
  - Trigger: bump `historySpliceRev` with 20 rows inserted above.
  - Observable: row `kA` stays mounted and the anchor is still inside it.

  Verify it fails.
- [ ] 3.3 Write a failing L1 test (test-plan #F13) in `ChatView.selection.test.tsx` (exemplar: the same file).
  - Input: only the stored span changes.
  - Trigger: re-render.
  - Observable: the virtualizer range recomputes and the retained rows reflect the new span.

  Verify it fails.
- [ ] 3.4 Write a failing L1 test (test-plan #F14) in `ChatView.selection.test.tsx` (exemplar: the same file). Install the `removeAllRanges` spy after the setup helpers at `:62`, `:68` and `:155`.
  - Input: a 150-row selection (fine).
  - Trigger: `selectionchange` plus a streaming chunk.
  - Observable: `removeAllRanges` is never called, `isSelectingRef` is true, and the bottom-pin leaves `scrollTop` unchanged.

  Verify it fails.
- [ ] 3.5 Write a failing L1 test (test-plan #F15) in `ChatView.selection.test.tsx` (exemplar: the same file).
  - Input: the `selectionchange` listener suppressed; a Range anchored in `k0`.
  - Trigger: a scroll recompute that excludes `k0` from the default window.
  - Observable: `k0` stays mounted.

  Verify it fails.
- [ ] 3.6 Write a failing L3 test (test-plan #F1) in `tests/e2e/large-selection.spec.ts`, running in all three projects (exemplar: `tests/e2e/selection-anchor.spec.ts`).
  - Input: long-transcript, fine pointer, 1280×700.
  - Trigger: mouse down in row 0 text, wheel or `scrollTop` +400 px × 40 with pointer moves, mouse up.
  - Observable:
    - the selection is non-collapsed and the anchor is in row 0's key;
    - mounted `[data-index]` ≤ window + 4;
    - after scrolling back to the middle, interior rows satisfy `containsNode(row, true)`.

  Verify it fails on the unchanged build with `npm run test:e2e -- tests/e2e/large-selection.spec.ts -g F1`.
- [ ] 3.7 Write a failing L3 test (test-plan #F2) in `large-selection.spec.ts`, running in all three projects (exemplar: 3.6).
  - Input: `addInitScript` swallows `selectionchange` listeners.
  - Trigger: the same drag as 3.6.
  - Observable: the anchor stays in row 0 (not the container, not another row) and the selection stays non-collapsed.

  Verify it fails on the unchanged build.
- [ ] 3.8 Write a failing L3 test (test-plan #F7) in `large-selection.spec.ts`, chromium only (exemplar: the scroll-lock streaming test in `tests/e2e/chat-transcript-virtualization.spec.ts`).
  - Input: a selection over more than 100 rows held while scrolled up.
  - Trigger: a `[[faux:slow-stream]]` prompt.
  - Observable: `scrollTop` stays unchanged (±1 px) during the stream, and the final stream text is present after the selection collapses.

  Verify it fails on the unchanged build.
- [ ] 3.9 Write a failing L3 test (test-plan #F8) in `large-selection.spec.ts`, chromium (exemplar: 3.6).
  - Input: fine pointer, 1280×560.
  - Trigger: drag over 60 rows, then scroll the middle rows out of the window.
  - Observable: all 60 intersected rows stay mounted.

  Verify it fails on the unchanged build.
- [ ] 3.10 In `packages/client/src/components/chat/ChatView.tsx`:
  - remove `removeAllRanges()` from `mapChatRange`;
  - rename the ceilings to `SELECTION_RETAIN_CAP_FINE`/`_COARSE`, keyed on `useMediaQuery("(pointer: coarse)")`;
  - memoize `keyToIndex`;
  - make `rangeExtractor` build the D4 retained union of `selectionSpanRef` and `liveSelectionRowSpan(...)` (read-only);
  - rewrite the stale clear-past-cap comments at `:440-448`, `:1186-1193`, `:1396-1400` and `:1928-1931`.

  Verify that 3.1–3.9 pass (L3 via the `run-dashboard-e2e-local-changes` skill), and that `ChatView.selection-anchor.test.tsx` stays green.
- [ ] 3.11 Update the `useActiveChatSelection.ts` doc comment and its `.AGENTS.md` sidecar to cover:
  - the span ref is no longer the sole retention source;
  - `mapRange` never clears;
  - past-ceiling selections stay active;
  - the D4 single-clock note.

  Update the `ChatView.tsx` sidecar with D1/D4/D5 and `See change: keep-oversized-chat-selection`. Verify that `npx vitest run packages/client/src/hooks/__tests__/useActiveChatSelection.test.tsx` stays green and the sidecar diff names every changed symbol.

## 4. Copy: document-level intercept, full-span mount, copy ceiling

- [ ] 4.1 Rewrite `skips a selection that extends outside the transcript (native copy owns it)` (`packages/client/src/components/__tests__/ChatView.copy-fidelity.test.tsx:62-90`) to the D7 three-part expectation. Verify it fails.
- [ ] 4.2 Write a failing L1 test (test-plan #E12) in `ChatView.copy-fidelity.test.tsx` (exemplar: the same file's partial-row copy test).
  - Input: coarse context; transcript-part spans of 150 and 151 rows.
  - Trigger: a `copy` event.
  - Observable: 150 → `setData` with every row; 151 → `preventDefault`, no `setData`, the keyed "too large" toast rendered, and the selection unchanged.

  Verify it fails.
- [ ] 4.3 Write a failing L1 test (test-plan #E13) in `ChatView.copy-fidelity.test.tsx` (exemplar: the same file).
  - Input: a live transcript selection and a copy event whose `target` is the composer `textarea`.
  - Trigger: dispatch `copy`.
  - Observable: no `setData` and no `preventDefault`.

  Verify it fails.
- [ ] 4.4 Write a failing L1 test (test-plan #E14) in `ChatView.copy-fidelity.test.tsx` (exemplar: the same file).
  - Input: two ChatView containers and one Range intersecting both.
  - Trigger: a single `copy`.
  - Observable: exactly one listener acts (`preventDefault`, no `setData`, one keyed "copy each transcript separately" toast).

  Verify it fails.
- [ ] 4.5 Write a failing L1 test (test-plan #F16) in `ChatView.copy-fidelity.test.tsx` (exemplar: the same file plus `packages/client/src/test-support/virtualizer-jsdom.ts`).
  - Input: a 200-row selection with its interior unmounted.
  - Trigger: `copy`.
  - Observable:
    - the `setData` text has every row marker in order, once each;
    - copy-only rows had no `measureElement` ref;
    - the mounted set afterwards equals the mounted set before.

  Verify it fails.
- [ ] 4.6 Write a failing L1 test (test-plan #X1) in `ChatView.copy-fidelity.test.tsx` (exemplar: the same file).
  - Input: the serializer throws.
  - Trigger: a copy of a 200-row span.
  - Observable: the mounted set equals the pre-copy set, `copySpanRef` is null, the next render uses the normal working set, and the error is surfaced, not swallowed silently.

  Verify it fails.
- [ ] 4.7 Write a failing L1 test (test-plan #X2) in `ChatView.copy-fidelity.test.tsx` (exemplar: the same file).
  - Input: the release `flushSync` throws once.
  - Trigger: `copy`.
  - Observable: the fallback `bump()` runs, and after a tick the mounted set returns to the working set.

  Verify it fails.
- [ ] 4.8 Write a failing L1 test (test-plan #X3) in `ChatView.copy-fidelity.test.tsx` (exemplar: the same file).
  - Input: a copy-only row queues `requestRowMeasure` (simulated image `load`) that flushes after release.
  - Trigger: the rAF after the copy.
  - Observable: no `measureElement` call for that node, and `getTotalSize()` is unchanged.

  Verify it fails.
- [ ] 4.9 Write a failing L1 test (test-plan #X4) in `ChatView.copy-fidelity.test.tsx` (exemplar: the same file).
  - Input: a copy-only row renders a suspended `React.lazy` component.
  - Trigger: `copy`.
  - Observable: no throw; the clipboard holds the fallback text for that row and the full text of the other rows.

  Verify it fails.
- [ ] 4.10 Write a failing L3 test (test-plan #F3) in `large-selection.spec.ts`, running in all three projects (exemplar: 3.6 plus the paste-round-trip helper from 2.3).
  - Input: after the F1 drag (more than 100 rows), clipboard primed with `PRIOR`.
  - Trigger: `ControlOrMeta+C`, then paste.
  - Observable: every turn's bash marker between the endpoints, in order, once each.

  Verify it fails on the unchanged build.
- [ ] 4.11 Write a failing L3 test (test-plan #F4) in `large-selection.spec.ts`, chromium (exemplar: 3.6).
  - Input: mid-transcript scroll position and a selection over more than 100 rows.
  - Trigger: copy.
  - Observable: `scrollTop`, `scrollHeight` and the first visible row's top are equal before and right after the copy (±1 px).

  Verify it fails on the unchanged build.
- [ ] 4.12 Write a failing L3 test (test-plan #F5) in `large-selection.spec.ts`, running in all three projects (exemplar: 4.10).
  - Input: fine pointer and ≤ 500 rows.
  - Trigger: `selectAllChildren(document.body)`, copy, paste.
  - Observable: the leading page text, then every turn marker in order, then the trailing page text.

  Verify it fails on the unchanged build.
- [ ] 4.13 Write a failing L3 test (test-plan #F6) in `large-selection.spec.ts`, chromium with `hasTouch` + `isMobile` at 390×844 (exemplar: the coarse-pointer `test.use` block in `tests/e2e/add-folder-file-manager.spec.ts`).
  - Input: more than 150 rows and the clipboard primed with `PRIOR`.
  - Trigger: select-all, copy, paste.
  - Observable: the paste yields `PRIOR`; the "too large" toast is visible inside the viewport; the selection is still non-collapsed.

  Verify it fails on the unchanged build.
- [ ] 4.14 Write a failing L3 perf test (test-plan #P1) in `large-selection.spec.ts`, chromium mobile context with CDP `Emulation.setCPUThrottlingRate` 6 (exemplar: `tests/e2e/chat-render-perf.spec.ts`).
  - Input: a selection of exactly the coarse copy-ceiling rows.
  - Trigger: 10 copies.
  - Observable: the p90 of `window.__piCopyTiming` is ≤ 1500 ms.

  Verify it fails, since the hook does not exist yet.
- [ ] 4.15 Write a failing L3 perf test (test-plan #P2) in `large-selection.spec.ts`, chromium desktop at 1× (exemplar: `tests/e2e/chat-render-perf.spec.ts`).
  - Input: a selection of min(fine ceiling, all rows).
  - Trigger: 10 copies.
  - Observable: the p90 of `window.__piCopyTiming` is ≤ 1500 ms.

  Verify it fails.
- [ ] 4.16 Replace the container `onCopy` with a `document` `copy` listener registered in an effect and gated by D7 (a), (b) and (c). Implement the D2 mount:
  - `copySpanRef` with `flushSync` mount, serialize, release in `try/finally` and the fallback `bump`;
  - a copy-only `Set` ref that the row render loop reads to omit `measureElement`;
  - `requestRowMeasure` ignores copy-only rows, and its rAF skips nodes that are `!isConnected` or not current;
  - the bottom-pin is skipped while `copySpanRef` is set (the anchor effect is not);
  - a test-only `window.__piCopyTiming` hook, enabled by a test flag only.

  Verify that 4.1 and 4.3–4.12 and 4.15 pass.
- [ ] 4.17 Implement the D3 decline path:
  - placeholder `SELECTION_COPY_CAP_FINE = 500` / `_COARSE = 150`;
  - `preventDefault` with no `setData`;
  - keyed "too large" and "copy each transcript separately" toasts through a ChatView-local `useToast()` + `<Toast>`, with `i18nT` keys added to `packages/client/src/lib/i18n-en-source.json` and its locale siblings.

  Verify that 4.2, 4.4 and 4.13 pass, along with the existing partial-row and `data-copy-text` tests, `npm run i18n:parity` and `npm run i18n:lint`.
- [ ] 4.18 Calibration gate. Measure the copy handler end to end (mount + serialize + release, p90) on the product build against real transcripts, using the `spike/real.mjs` pattern adapted to dispatch a copy. Include one terminal- and mermaid-heavy session, and record heap growth. Run fine at 1× CPU and coarse at 6×. Set `SELECTION_COPY_CAP_FINE`/`_COARSE` so that each tier's p90 is ≤ ~1.5 s, and record the measurements and the chosen values in `design.md` D3. Verify that 4.14 passes, the recorded p90 per tier is ≤ ~1.5 s, and the code constants match `design.md`.
- [ ] 4.19 Update the `chat-selection-copy.ts` and `ChatView.tsx` sidecars to cover:
  - the document-level intercept with arbitration and the multi-transcript decline;
  - copy fidelity independent of the mounted window;
  - copy-only rows are unmeasured;
  - the copy ceiling and the toast.

  Replace the stale `handleCopy` comment ("never what happens to be mounted"). Verify that the sidecar diff and the comment name the listener, the arbitration rule and the ceiling constants.

## 5. Swipe-back yields to selection

- [ ] 5.1 Write a failing L1 test (test-plan #E15) in `packages/client/src/hooks/__tests__/useSwipeBack.test.tsx`; create the file if absent, using the `renderHook` harness in `useActiveChatSelection.test.tsx` as the exemplar.
  - Input: a non-collapsed page selection.
  - Trigger: `touchstart` at x=10, then 3 horizontal `touchmove`s of +30 px each.
  - Observable: no tracking, no `preventDefault`, `swiping` stays false, and no `onBack`.

  Verify it fails.
- [ ] 5.2 Write a failing L1 test (test-plan #E16) in `useSwipeBack.test.tsx` (exemplar: 5.1).
  - Input: text selected in a focused `textarea`.
  - Trigger: an edge swipe past the threshold.
  - Observable: `onBack` is called.

  Verify it fails, or passes already as a regression guard. Record which.
- [ ] 5.3 Write an L1 regression test (test-plan #E17) in `useSwipeBack.test.tsx` (exemplar: 5.1).
  - Input: no selection.
  - Trigger: an edge swipe past 40% of the width, and a separate touch at x=41.
  - Observable: the swipe calls `onBack`; the touch at x=41 is not tracked.

  Verify it passes before and after the change.
- [ ] 5.4 Write a failing L1 test (test-plan #F11) in `useSwipeBack.test.tsx` (exemplar: 5.1).
  - Input: a swipe in progress (horizontal decided, offset 80).
  - Trigger: the selection becomes non-collapsed, then the next `touchmove`.
  - Observable: `swipeState` is `{offset: 0, swiping: false}`, that move is not `preventDefault`ed, and `touchend` does not call `onBack`.

  Verify it fails.
- [ ] 5.5 Write a failing L1 test (test-plan #F12) in `useSwipeBack.test.tsx` (exemplar: 5.1).
  - Input: `touchstart` at x=10, with the selection appearing before 10 px of movement.
  - Trigger: the first `touchmove` (+15 px horizontal).
  - Observable: the gesture aborts before any `preventDefault`.

  Verify it fails.
- [ ] 5.6 Write a failing L3 test (test-plan #F9) in `large-selection.spec.ts`, chromium mobile 390×844 (exemplar: the `hasTouch` block in `tests/e2e/add-folder-file-manager.spec.ts`).
  - Input: the session detail panel open with transcript text selected.
  - Trigger: a CDP touch from x=10 to x=250 in 10 steps.
  - Observable: the URL is unchanged and the panel transform is back at rest.

  Verify it fails on the unchanged build.
- [ ] 5.7 Implement D6 in `packages/client/src/hooks/useSwipeBack.ts`:
  - `hasPageTextSelection()`, checking `activeElement` and the anchor for editable fields;
  - the `touchstart` guard;
  - a selection check first on every `touchmove`, followed by a full reset with no `preventDefault`.

  Verify that 5.1–5.6 pass. Update `packages/client/src/hooks/useSwipeBack.ts.AGENTS.md` and the pointer row in `packages/client/src/hooks/AGENTS.md`, and verify that both name the guard.

## 6. Integration: regression run and manual acceptance

- [ ] 6.1 Run the existing selection e2e specs against the docker harness, each with `npm run test:e2e -- <spec>` (local build via `run-dashboard-e2e-local-changes`):
  - `tests/e2e/selection-anchor.spec.ts`
  - `tests/e2e/tool-output-selection.spec.ts`
  - `tests/e2e/background-stream-selection.spec.ts`
  - `tests/e2e/chat-transcript-virtualization.spec.ts`
  - `tests/e2e/table-copy.spec.ts`
  - `tests/e2e/history-backfill-gap.spec.ts`

  Verify that all pass with no change to their assertions.
- [ ] 6.2 Run the full client suite with `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`, then `grep -nE 'FAIL|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log`. Verify there are zero failures.
- [ ] 6.3 Manual iOS Safari acceptance (test-plan: manual-only, #M1). On a real iPhone with a long transcript:
  - long-press, then drag the selection handle past 40 rows;
  - Copy from the callout and paste into Notes;
  - do an edge swipe while the selection is held.

  Record whether the selection never jumps or disappears, the paste is complete, and the swipe does not navigate back.
