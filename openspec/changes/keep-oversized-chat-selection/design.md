# Design

## Context

See proposal.md (Why). Current mechanics in
`packages/client/src/components/chat/ChatView.tsx`:

- **Ceilings.** `SELECTION_RETAIN_CAP_DESKTOP = 100` /
  `SELECTION_RETAIN_CAP_MOBILE = 40` (`ChatView.tsx:449-450`), selected by
  `isMobile` into `selectionCapRef` (`:1182-1183`).
- **Span tracking.** `useActiveChatSelection` records the selection's row span
  in `selectionSpanRef` from the `selectionchange` listener
  (`packages/client/src/hooks/useActiveChatSelection.ts:99-120`). It goes
  through `mapChatRange` → `rangeToRowIndexSpan`, where the row is the closest
  `[data-index]` (`packages/client/src/lib/chat/chat-virtual-rows.ts:259-280`).
  "Active" requires the anchor or focus inside the container
  (`selectionIntersects`, `useActiveChatSelection.ts:46-51`).
- **Clearing.** `mapChatRange` calls `removeAllRanges()` and returns `null` past
  the cap (`ChatView.tsx:1185-1197`).
- **Splice remap.** The stored span is remapped during render across history
  splices (`:1236-1251`, `add-tail-only-replay-window` D7a).
- **Extractor.** `rangeExtractor` =
  `extendRangeWithSelection(default, span, cap, count)` (`:1401-1407`;
  `chat-virtual-rows.ts:290-302`). It unions the whole span within the cap and
  otherwise returns `base`.
- **Copy.** `handleCopy` is a React `onCopy` on the scroll container
  (`:1287-1297`, `:2084`). It returns early when
  `range.commonAncestorContainer` is outside the container and serializes
  `Range.cloneContents()` via `buildSelectionClipboardText(range, container)`
  (`packages/client/src/lib/chat/chat-selection-copy.ts:82`; `container` scopes
  only the `data-copy-text` scan).
  `packages/client/src/components/__tests__/ChatView.copy-fidelity.test.tsx:62-90`
  asserts that a range extending outside the transcript is NOT intercepted.
  This change reverses that.
- **Measurement and pinning.**
  - Row-content growth re-measures through `requestRowMeasure` →
    `virtualizer.measureElement` (`:1583-1595`).
  - The virtualizer `onChange` bottom-pin is gated on `isSelectingRef`
    (`:1408-1450`).
  - The row-growth anchor layout effect reads `getBoundingClientRect` (`:1928+`).
  - Several inline comments describe the clear-past-cap behaviour (`:440-448`,
    `:1186-1193`, `:1396-1400`, `:1928-1931`).
- **Row identity.** Each row carries `data-row-key={vi.key}` (`:2099-2105`), and
  `getItemKey` → `virtualRowKey` gives the stable message id.
- **Row-local state.** UI state such as tool expansion is component `useState`
  (`packages/client/src/components/chat/ToolCallStep.tsx:158,176`). It resets on
  unmount, which already happens under scroll virtualization today.
- **Versions.** `@tanstack/react-virtual` 3.14.10 runs on
  `@tanstack/virtual-core` 3.17.8. The `getIndexes` memo keys on
  `[rangeExtractor, overscan, count, startIndex, endIndex]`
  (`node_modules/@tanstack/virtual-core/dist/esm/index.js` ~L751-775). The
  inline extractor closure is new on every render, so every ChatView render
  recomputes the range.
- **Instances.** ChatView renders in two places: App's main transcript
  (`packages/client/src/App.tsx:2665`) and the plugin embed
  (`packages/client/src/lib/plugins/chat-view-primitive.tsx:70`).

Evidence base: `spike/` (harness + raw results; see `spike/README.md`).
The engines are desktop Playwright (Chromium, Firefox, WebKit 26.5) with mouse,
wheel, or `scrollTop`. No touch or iOS run exists.

| Check | Result |
|---|---|
| Endpoint-only retention past cap (~80-row scrolling drag) | Selection survives with its original anchor in all 3 engines; remounted interior rows re-highlight (`containsNode`) |
| Today's clear-past-cap | Chromium/Gecko: wiped. **Desktop WebKit: drag re-anchors at the current row → silently wrong selection** |
| `flushSync` full-span mount in the copy handler → `cloneContents` | Complete, ordered, no duplicates; 3 engines; 80–1000 synthetic rows |
| Copy-only rows with `measureElement` | `scrollTop` shifted 236px (compensated; size cache mutated). Without: unchanged |
| `<Activity mode="hidden">` | Commits no DOM under `flushSync`, so unusable |
| Passive effects of rows mounted by `flushSync` | Run synchronously |
| `selectionchange` swallowed | Gecko/WebKit re-target the anchor to the container DIV; Chromium re-anchors to a visible row. A live read in the extractor fixes all three, including the **non-persisting** variant (`live=2`) |
| Range starting outside the transcript / `selectAllChildren(body)` | Container React `onCopy` does **not** fire; a `document` `copy` listener does (3 engines) |
| Cancelled copy without `setData` | Prior clipboard contents kept (3 engines, paste round-trip) |
| Real dashboard row mount (315/405-row sessions) | Mean ≈1 ms/row at 1×, ≈3.7 at 6×; **p90 ≈2.1 / ≈7.7 ms/row** (incl. unmount, measure layout, passive effects; serialize not included) |

## Goals / Non-Goals

**Goals:**
- The view never clears, collapses, or re-anchors a selection, whatever its size
  or event timing.
- Copy of any selection intersecting the transcript is complete and ordered up
  to the copy ceiling, with no visible side effect.
- A bounded steady-state mounted set while a large selection is held.

**Non-Goals:**
- Fidelity for selection exits other than `copy` (drag-and-drop of selected text,
  iOS Share/Look Up, `Selection.toString()`). These see only mounted rows. The
  only client `toString()` reader is card-scoped:
  `packages/client/src/components/session/SessionCard.tsx:1176-1177`.
- Copying a transcript part beyond the copy ceiling, for example via a
  data-model serializer.
- Preserving row-local UI state (expansion) for rows that were unmounted.
- Making a range whose endpoints both lie outside the transcript (page-wide
  Select-All) an *active transcript selection*. That means no retention and no
  freezes for it; only its copy is intercepted (D7).
- Changing `useMobile()`, layout breakpoints, or the streaming-tail selection
  mechanism (`preserve-streaming-tail-selection`).

## Decisions

### D1: Past the retained-row ceiling, retain endpoints only and never clear (modifies D3 "actively clear")

`extendRangeWithSelection` gains an endpoint branch. When the span exceeds the
cap, it unions `{span.min, span.max}` (within `[0, count)`) instead of returning
`base`. `mapChatRange` no longer calls `removeAllRanges()` and always returns the
span.

The old D3 rejected "mount only endpoints" for one reason: native copy would be
silently truncated. D2/D7 remove that reason, and D3's "failure stays visible"
claim does not hold on desktop WebKit (spike). Because the endpoint rows stay
mounted, neither Range boundary moves. Interior rows that unmount and remount
fall between the boundaries in DOM order and re-highlight.

**Consequence (intended, declared):** `isSelecting` and `isSelectingRef` stay
true for the whole past-ceiling selection, where the clear used to flip them
false. As for any smaller selection, the `onChange` bottom-pin stays suspended,
the streaming-tail freeze engages when the selection touches the tail, and
row-growth anchor compensation keeps running. Arriving content is not lost; it
is visible on collapse.

*Alternatives:*
- Keep clearing and add a toast. Rejected: WebKit re-anchors mid-drag anyway.
- Only raise the caps. Rejected: any cap can be exceeded.
- A pixel or estimated-size budget. Deferred.

### D2: Mount the full span synchronously inside the copy handler; copy-only rows are unmeasured

The copy handler (D7 decides when it runs) resolves the transcript row span
`[lo, hi]`. If `hi - lo + 1 > copyCapRef.current`, it hands off to D3. Otherwise:

```
try {
  copySpanRef.current = {lo, hi}; flushSync(bump)      // extractor unions it
  text = assemble(pre, serialize(mid), post)            // D7
} finally {
  copySpanRef.current = null
  try { flushSync(bump) } catch { bump() }             // release; never leave rows pinned
}
```

All of this runs in one task, so the transient rows are never painted.

The extractor computes `copyOnly = copySpan \ (default ∪ retained)` and
publishes it in a ref that the row render loop reads. For copy-only rows:
- `ref={virtualizer.measureElement}` is omitted, so the size cache stays
  untouched and there is no scroll compensation.
- `requestRowMeasure` ignores them.

- The rAF flush in `requestRowMeasure` also skips any queued node that is
  `!isConnected` or not among the current virtual items. Otherwise an
  `<img onLoad>` firing after release would measure a detached node into the
  size cache. This guard applies to all rows, not only copy-only ones.

While `copySpanRef` is set, the `onChange` bottom-pin is skipped. A page-wide
copy does not set `isSelectingRef`, so the pin is not otherwise suspended. The
row-growth anchor layout effect is **not** skipped: "An active selection is
anchored against layout shift" still binds. Copy-only rows are absolutely
positioned and unmeasured, so they cause no shift and the effect's early exit
holds. Its single `getBoundingClientRect` read is counted in the copy cost.

Copy-only rows render at their estimated `vi.start`, absolutely positioned. The
spec requires `scrollHeight` and `scrollTop` unchanged after the copy, and tests
assert both before and after.

Recompute mechanism: the extractor stays an inline closure. Every ChatView
render, including the copy `bump` and every selection-driven re-render,
invalidates virtual-core's `getIndexes` memo. No `copyGen` identity key is
introduced. If someone later stabilizes the extractor with `useCallback`, they
must key it on everything it reads (stored span, live selection version, copy
span). A regression test asserts that both a copy and a stored-span change
cause a recompute.

`flushSync` inside an event handler is supported; the spike ran it inside the
copy handler. Passive effects of copy-only rows run synchronously. That is
acceptable because virtualization already requires every row to tolerate
mount/unmount churn, so a copy behaves like a fast scroll through the span. It
is not cheap at hundreds of rows, hence D3.

*Alternatives:*
- `<Activity mode="hidden">`. Rejected: no DOM under `flushSync`.
- `renderToStaticMarkup` into a detached node. Rejected: the zustand server
  snapshot differs from live state, `React.lazy` renders its fallback, and
  mermaid yields source.
- Async mount + `navigator.clipboard.writeText`. Rejected: Safari requires the
  write inside the gesture, and a second copy could race it.
- Data-model text for unmounted rows. Rejected for now: partial-row and
  rendered-vs-source hazards.

### D3: Copy ceiling with an announced decline

Acceptance metric: wall time of the whole copy handler (mount + serialize +
release) at the ceiling, measured end-to-end on real transcripts at p90. The
budget is ≤ ~1.5 s per tier, with fine-pointer measured at 1× CPU and
coarse-pointer at 6×.

Placeholder constants (mount-only, with headroom for serialize and release),
from the p90 per-row mount cost:
- `SELECTION_COPY_CAP_FINE = 500` (≈ 500 × 2.1 ms ≈ 1.05 s of mount)
- `SELECTION_COPY_CAP_COARSE = 150` (≈ 150 × 7.7 ms ≈ 1.15 s of mount)

They are **replaced in group 3** by values from an end-to-end measurement of
the copy handler on the product build: mount + serialize + release at p90, on
real transcripts including a terminal- and mermaid-heavy one. That measurement
comes before the change is complete. Per-row p90s do not add up to the p90 of a
total, so the placeholders carry no acceptance weight.

Both satisfy copy ceiling ≥ retained ceiling (100 / 40).

Decline path, used when the transcript part exceeds the ceiling:
1. `preventDefault()` with **no** `setData`. The spike showed all 3 engines keep
   the previous clipboard contents, so nothing is overwritten and nothing
   truncated is written.
2. Show a keyed toast, variant `warning`, via `i18nT("chat.copyTooLarge", …,
   "Selection too large to copy at once. Copy it in parts.")`. New keys go in
   `packages/client/src/lib/i18n-en-source.json` and its locale siblings.
3. Leave the selection untouched.

Toast host: a ChatView-local `useToast()` + `<Toast>`
(`packages/client/src/components/primitives/Toast.tsx:129`; pattern in
`packages/client/src/components/editor-pane/file-handler/FileHandlerLayer.tsx:25,205`).
Keying makes repeats replace the toast instead of stacking. This also serves
embedders, which do not receive App's `showToast`. Inside `MobileShell` the
detail panel carries a `translateX` transform, so the `fixed` toast positions
relative to that panel. The panel spans the viewport, and a mobile-viewport e2e
asserts the toast is visible.

### D4: Live-selection endpoints in `rangeExtractor`, resolved by row key

Pure helper `liveSelectionRowSpan(container, keyToIndex, rowCount)`:
1. Reads `getSelection()`.
2. Requires a non-collapsed range whose **anchor or focus** is inside the
   container. This is the same test as the hook's `selectionIntersects`, so a
   page-wide range with both endpoints outside returns `null`.
3. Walks the endpoints to the closest `[data-row-key]` and maps them through
   `keyToIndex` (memoized from `displayRows` via `virtualRowKey`).
4. Clamps an endpoint in a non-virtual region, or outside the container, with
   the `clampEndpointToBoundary` rule (`0` / `rowCount - 1`).
5. Returns `{min, max}`, or `null`.

Retained set: let `U` be the min/max hull of the stored span and the live span.
- If `U` is within the cap, retain all of `U`.
- Otherwise retain only the endpoint rows of both spans:
  `{stored.min, stored.max, live.min, live.max}`, at most 4 rows.

The retained set is therefore always ≤ max(cap, 4). A stale stored span can
never turn a live endpoint into an unmounted interior row. While the stored and
live spans disagree past the cap (a late event), interior rows may unmount
briefly. The Range survives because its endpoint rows stay mounted.

If a `data-row-key` is not in `keyToIndex` (a row still in the DOM but already
trimmed from `displayRows`), that endpoint falls back to the stored span's
corresponding bound.

The extractor only reads. It never mutates the Selection and does not persist
the live result, because every render re-reads it.

Evidence and gates:
- The spike validated live-read survival without persistence (`live=2`, 3
  engines).
- The spike did **not** cover key-based resolution or the union rule above: it
  used `data-index` and merged spans before capping. Tasks 1.1, 1.3 and 2.1 are
  the gate for those.

Resolution goes by key because DOM `data-index` still holds pre-splice indices
while rendering right after a splice; reading it would regress D7a/F18.

Scope: the stored `selectionSpanRef` stays positional and keeps its existing
splice remap. The spec's stable-identity rule governs the live resolution.

Relation to "Selection state is published on a single clock": the
active-selection *signal* is unchanged (one clock, set in the listener). Only
*retention* reads two sources, the stored span (event time) and the live
selection (extractor time), and unions them. The delta modifies that requirement
to say so explicitly. Neither source may be removed
without the other covering its case. The stored span covers churn between
events; the live read covers a late event.

Cost per render: one `getSelection()`, two `closest()` walks, two `Map`
lookups (O(1)). `buildRowKeyToIndex` is O(rows), memoized on `displayRows`, so
it reruns only when the transcript changes, as `rowTextChars` already does.

### D5: Ceilings keyed by pointer modality

The retained ceilings `SELECTION_RETAIN_CAP_FINE = 100` and
`SELECTION_RETAIN_CAP_COARSE = 40` (renamed from `_DESKTOP` / `_MOBILE`) and
the copy ceilings (D3) are selected by `useMediaQuery("(pointer: coarse)")`
(`packages/client-utils/src/useMediaQuery.ts`). That hook initializes
synchronously from `matchMedia` and subscribes in an effect, so the first
render is correct. `packages/client/src/components/primitives/PathPicker.tsx:142` and
`packages/client/src/components/workspace/AddFoldersDialog.tsx:164` read the
same media query once, without subscribing. Only the query string is shared
precedent.

Assumption, not verified: hybrid devices follow the browser's *primary* pointer.
A wrong tier only changes a cost bound, never correctness. `isMobile` stays for
layout.

### D6: Swipe-back guard on selection

`useSwipeBack` adds `hasPageTextSelection()`. It returns true when
`getSelection()` is non-collapsed **and** `document.activeElement` is not an
`input`, `textarea`, or `[contenteditable]` **and** the selection anchor is not
inside one. The `activeElement` check covers engines that report a field
selection with its anchor on the field's parent.

- **`touchstart`**: if a page selection exists, set `trackingRef = false` and
  return. The gesture never starts, so no move is ever `preventDefault`ed.
- **`touchmove`**: the selection check runs **first on every move, before**
  direction is decided and before any `preventDefault`. A long-press selection
  forms before the horizontal decision, so it is seen in time. If a page
  selection is present, fully reset:
  `trackingRef = decidedRef = isHorizontalRef = false`, `currentOffsetRef = 0`,
  `setSwipeState({ offset: 0, swiping: false })`. Later moves are not prevented.
  Moves before the selection appeared may already have been prevented.

The hook reads the global selection, with no coupling to `ChatView`.
Consequence: a selection in any non-editable pane blocks back-swipe until it
collapses (tap to clear). This is intended and documented in the spec.

### D7: Document-level copy intercept with three-part serialization

A range that starts outside the transcript never reaches the container's React
`onCopy`; only a `document` listener sees it (spike, 3 engines). ChatView
therefore replaces the container `onCopy` with a `document` `copy` listener
registered in an effect. It acts only when all three hold:

- (a) `event.target` is not inside an `input`, `textarea`, or
  `[contenteditable]`, so copying from the composer is never hijacked;
- (b) `range.intersectsNode(container)`;
- (c) this container is the **first** of
  `document.querySelectorAll('[data-testid="chat-scroll-container"]')` that the
  range intersects. This is deterministic document-order arbitration among
  ChatView instances (App main + plugin embed), and each listener evaluates it
  independently. **If the range intersects more than one transcript
  container**, the arbitrating instance declines the copy via the D3 path
  (toast: copy each transcript separately) instead of truncating the others.

When it acts:
1. **Transcript part.** Take the row span of the range clipped to the
   container. A clipped endpoint at the container edge clamps to `0` or
   `rowCount - 1`. Mount via D2 and serialize `mid`, the range clipped to the
   container.
2. **Outside parts.** `pre` is the range clipped to end before the container;
   `post` is the range clipped to start after it. Each is serialized with the
   same block-aware serializer, scoped to `document.body` so `data-copy-text`
   resolves there too. The serializer also skips `SCRIPT`, `STYLE`, `TEMPLATE`
   and `NOSCRIPT` content and `[hidden]`/`[aria-hidden="true"]` subtrees. It is
   a pure DOM read with no mounting and **not** byte-identical to native copy:
   for example, `user-select: none` is not honored. That is the documented
   outside-part rule.
3. **Assembly.** Join `[pre, mid, post]`, dropping empty parts, with one
   newline; the container is a block boundary. Then `setData` +
   `preventDefault`.

The ceiling (D3) applies to the transcript part's row span. Ranges not
intersecting the container, or copies from editable fields, are ignored and the
browser's native copy runs.

## Risks / Trade-offs

- **[Copy freeze up to ~1.5 s at the ceiling]** → p90 metric and
  end-to-end calibration (D3, group-3 calibration task). The freeze happens only on an explicit
  copy, never during drag or scroll.
- **[Mounting hundreds of heavy rows at once (xterm, mermaid, Prism)]** →
  Calibrate on a terminal- and mermaid-heavy session and lower the ceilings if
  memory or time spike.
- **[Copy-only rows copy a Suspense fallback (unloaded `InlineTerminalCard`
  chunk) or mermaid pre-render text]** → Matches what a freshly scrolled-in row
  shows today. The spec defines unmounted-row text as "as it renders when
  mounted again"; `data-copy-text` is the opt-in for exact text.
- **[Row-local expansion lost for unmounted rows]** → Same as scrolling today,
  and a documented non-goal. Within the retained ceiling every row stays
  mounted, so its expansion is kept.
- **[Past-ceiling selections keep the bottom-pin suspended and the tail
  frozen]** → Intended (D1). Covered by a spec scenario and a test.
- **[Selection exits other than copy see only mounted rows]** → Non-goal.
  Strictly better than today's wipe.
- **[No touch or iOS evidence; the coarse tier is inferred]** → Manual iOS
  acceptance check in the test plan.
- **[Hybrid-device pointer tier assumption]** → Cost-only consequence (D5).
- **[A retained endpoint row re-renders its own text nodes in place (e.g. an
  auto-expand effect)]** → Retention prevents unmount, not node replacement
  inside a row. This is pre-existing and not changed here; a test documents the
  current behaviour.
- **[xterm `Terminal` instances created per copy-only terminal row]** → Memory
  and time are measured in the group-3 calibration; the ceiling is lowered if
  needed.

## Migration Plan

Client-only, with no persisted state or protocol change. Ships with a client
build. Rollback is reverting the commit, which restores clear-past-cap and the
container-only copy intercept.
