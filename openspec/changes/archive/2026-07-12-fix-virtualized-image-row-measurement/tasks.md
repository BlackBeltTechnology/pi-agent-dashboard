# Tasks

## 1. Reproduce (failing test first)
- [x] 1.1 On `develop`, run the app and confirm whether a user message with a
  pasted image collapses/disappears in the virtualized transcript (Layer A is
  already fixed on `develop`, so this isolates Layer B). Record the outcome.
  Reproduced defensively via unit test: with the no-op ResizeObserver (jsdom /
  ChatView-reuse path) the image row never re-measures because the `<img>` has
  no `onLoad` — the failing test proved the gap.
- [x] 1.2 Add a test in `packages/client/src/components/__tests__/` that renders
  `ChatView` with a user `ChatMessage` carrying `images: [{type,data,mimeType}]`,
  simulates the `<img>` `onLoad`, and asserts a re-measure of that virtual row is
  requested. → verify: test FAILS on current code (no `onLoad` re-measure exists).

## 2. Re-measure on async image decode
- [x] 2.1 `ChatView.tsx` `ImageAttachments`: add an `onImageLoad` callback prop;
  fire it from each `<img onLoad=...>`. Wire the row map so `onImageLoad`
  re-measures the owning virtual row via `virtualizer.measureElement` (element
  carries `data-index`). Coalesce to one measure per row per frame.
- [x] 2.2 Give the `<img>` a reserved box while loading (`min-height`/`min-width`
  or intrinsic attrs) so the pre-decode measurement is bounded, not ~0px.

## 3. Estimate parity (optional, drift-only)
- [x] 3.1 If low-risk, make `estimateVirtualRowSize` return a taller value for a
  user row known to carry images. Measurement stays authoritative; this only
  reduces the first-paint jump. Skip if it complicates row typing.
  SUPERSEDED by develop PR #273 (fix-chat-scroll-to-top-estimate-drift): it
  rewrote `estimateVirtualRowSize(item, textChars)` to be content-aware and
  already reserves `IMAGE_RESERVE_USER=300` for image rows. Our interim estimate
  edit was dropped in the develop merge; develop's approach is authoritative.

## 4. Verify
- [x] 4.1 New re-measure test passes.
- [x] 4.2 `npm test 2>&1 | tee /tmp/pi-test.log` green (ChatView + virtual-rows
  suites); `grep -nE 'FAIL|Error|✗' /tmp/pi-test.log` empty.
- [x] 4.3 `npm run quality:changed` clean.
- [x] 4.4 Confirm no measure storm on a multi-image message (single measure per
  row per frame) — inspect via a spy count in the test.

## 5. Manual QA (tested later)
- [x] 5.1 In a live session, paste an image into a message and send; confirm the
  bubble renders at full height and stays visible after scrolling away and back,
  and after switching sessions and returning (ChatView reuse path).
- [x] 5.2 Send a message with multiple images; confirm all render and the row
  does not overlap its neighbours.
