# Test Plan — keep-oversized-chat-selection

Stage: design   Generated: 2026-10-23

The hard gate was answered:
- Cross-engine rows become L3 automated through new `firefox` + `webkit`
  Playwright projects scoped to `tests/e2e/large-selection.spec.ts` (user
  decision, option 1).
- iOS touch has no harness, so it is manual-only.

Numbers below use the D3/D5 constants:
- retained ceilings: fine 100, coarse 40;
- placeholder copy ceilings: fine 500, coarse 150.

If calibration (task 3.4) changes the copy ceilings, the rows that name them
use the final values.

L3 fixture: faux `[[faux:long-transcript]]`, about 120 turns of
thinking + text + distinct bash (a few hundred display rows). Tests derive the
row count at runtime from the scroll container (`[data-index]` max after
scrolling to the bottom) and assert that it straddles the ceiling under test.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Finished-card selection survives churn (retained ceiling) | BVA | L1 | automated | `extendRangeWithSelection(base=[10..20], span, cap=100, count=1000)` with span lengths 99 / 100 / 101 starting at 200 | call | 99 and 100 → all span indices present; 101 → only `200` and `300` added; output sorted ascending, within `[0, count)` |
| E2 | Single-clock (retention union) | decision-table | L1 | automated | stored `{0..60}`, live `{50..110}`, cap 100 (hull 111) | retained-set computation | retained extra rows exactly `{0, 60, 50, 110}`; total retained beyond base ≤ max(cap, 4) |
| E3 | Single-clock (retention union) | decision-table | L1 | automated | stored `{10..40}`, live `{10..60}`, cap 100 (hull 51) | retained-set computation | all indices `10..60` retained |
| E4 | Virtualization (transient copy mount) | EP | L1 | automated | base `[10..20]`, retained `{0, 300}`, copy span `{0..300}` | copy-span union | union = `0..300`; copy-only set = `0..300` minus `[10..20]` minus `{0, 300}` |
| E5 | Finished-card selection survives churn (live resolution) | EP | L1 | automated | container with rows keyed `k0..k9`; Range from row `k7` back to `k2`; an endpoint in a non-virtual tail node | `liveSelectionRowSpan(container, keyToIndex, 10)` | reversed → `{2, 7}`; tail endpoint clamps to `9`; collapsed selection → `null` |
| E6 | History splice during an active selection | state-transition | L1 | automated | DOM rows still carry pre-splice `data-index` 0..9; `keyToIndex` reflects 5 rows spliced above (k3 → 8) | live resolution of a Range in row `k3` | returns index `8` (post-splice), not `3` |
| E7 | Active selection detected (page-wide excluded) | EP | L1 | automated | Range from a node before the container to a node after it | `liveSelectionRowSpan` + hook signal | `null`; `isSelecting` stays false; no row beyond base retained |
| E8 | Finished-card selection survives churn (missing key) | error-guessing | L1 | automated | live endpoint row key `kX` absent from `keyToIndex`; stored span `{4..30}` | live resolution | that endpoint falls back to the stored bound (`4` for start, `30` for end); no throw |
| E9 | Copy faithful (three-part) | decision-table | L1 | automated | range positions: before-only, before→inside, inside-only, inside→after, before→after, disjoint | split helper | parts = `{pre}`, `{pre, mid}`, `{mid}`, `{mid, post}`, `{pre, mid, post}`, `null`; assembly drops empties and joins with one `\n` |
| E10 | Copy faithful (outside-part rule) | EP | L1 | automated | `pre` contains `<script>`, `<style>`, `<template>`, `<noscript>`, `[hidden]`, `[aria-hidden="true"]` text plus visible `SIDEBAR-MARK` and a `data-copy-text` element | serialize `pre` scoped to `document.body` | output has `SIDEBAR-MARK` and the full copy-text; none of the hidden/script/style strings |
| E11 | Ceilings keyed by pointer modality | decision-table | L1 | automated | matchMedia mock: (fine, `max-height:599px` true), (coarse, wide), (fine, wide) | ChatView render + oversize span | retained ceiling 100 / 40 / 100; copy ceiling 500 / 150 / 500 |
| E12 | Copy ceiling | BVA | L1 | automated | coarse context; transcript-part span 150 rows, then 151 rows | copy event | 150 → `setData` called with all rows; 151 → `preventDefault`, no `setData`, keyed toast "Selection too large…" rendered, selection range unchanged |
| E13 | Copy from composer not intercepted | EP | L1 | automated | live transcript selection AND copy event whose `target` is the composer `textarea` | dispatch `copy` | handler does not call `setData` or `preventDefault` |
| E14 | Two transcripts on the page | decision-table | L1 | automated | two ChatView containers; one Range intersecting both | dispatch one `copy` | exactly one listener acts: `preventDefault`, no `setData`, one keyed "copy each transcript separately" toast; the second listener is a no-op |
| E15 | Swipe-back yields to selection | state-transition | L1 | automated | non-collapsed page selection; `touchstart` at x=10 | `touchstart` + 3 horizontal `touchmove`s (+30 px each) | `trackingRef` false; no `preventDefault` on any move; `swiping` stays false; `onBack` not called |
| E16 | Swipe-back: editable selection does not block | EP | L1 | automated | text selected in a focused `textarea` | edge swipe past threshold | `onBack` called (existing behavior) |
| E17 | Swipe-back unchanged without selection | EP | L1 | automated | no selection | edge swipe past 40% width | `onBack` called; a touch at x=41 → no tracking |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Drag past the retained ceiling keeps the selection | state-transition | L3 | automated | long-transcript, fine pointer, 1280×700; projects chromium / firefox / webkit | mouse down in row 0 text, wheel or `scrollTop` +400 px × 40 with pointer moves, mouse up | selection non-collapsed; anchor node still inside the row with key of row 0; mounted `[data-index]` ≤ window count + 4; after scrolling back to the middle, every mounted interior row satisfies `containsNode(row, true)` |
| F2 | Late `selectionchange` does not lose the anchor | fault-injection (event suppression) | L3 | automated | same; `addInitScript` swallows `selectionchange` listeners; 3 projects | same drag | anchor stays in row 0 (not the container, not another row); selection non-collapsed |
| F3 | Copy after interior rows unmounted | convergence | L3 | automated | after F1's drag (span > 100 rows); clipboard primed with sentinel `PRIOR`; 3 projects | `ControlOrMeta+C`, then paste into a test textarea | pasted text contains every turn's distinct bash marker between the endpoints, in order, each exactly once |
| F4 | Copy leaves the view undisturbed | invariant | L3 | automated | mid-transcript scroll position; selection > 100 rows; chromium | copy | `scrollTop`, `scrollHeight`, and the top of the first visible row are equal before and right after the copy (±1 px) |
| F5 | Page-wide Select-All includes the whole transcript | convergence | L3 | automated | fine pointer; transcript row count ≤ 500; 3 projects | select-all of `document.body`, copy, paste | pasted text starts with sidebar text present before the transcript, then every turn marker in order, then trailing page text |
| F6 | Selection beyond the copy ceiling | state-transition | L3 | automated | chromium with `hasTouch` + `isMobile`, 390×844 (coarse); row count > 150; clipboard primed `PRIOR` | select-all, copy, paste | paste yields `PRIOR` (clipboard unchanged); toast with "too large" text visible and its rect inside the viewport; selection still non-collapsed |
| F7 | Streaming continues while a past-ceiling selection is held | state-transition | L3 | automated | chromium; selection > 100 rows held while scrolled up; new prompt `[[faux:slow-stream]]` sent | stream arrives | `scrollTop` unchanged (±1 px) during the stream; after the selection collapses, the stream's final text is present in the transcript |
| F8 | Short desktop window uses the fine-pointer ceiling | BVA | L3 | automated | chromium fine pointer, 1280×560 (`useMobile` true); drag over 60 rows | after drag, scroll so the middle rows leave the window | all 60 intersected rows remain mounted (retained ceiling 100, not 40) |
| F9 | Swipe-back yields to text selection (mobile) | state-transition | L3 | automated | chromium mobile 390×844, session detail panel open, transcript text selected | CDP touch: start x=10, move to x=250 in 10 steps, end | URL unchanged (no back navigation); panel `transform` back at rest |
| F10 | History splice during an active selection (ChatView) | state-transition | L1 | automated | ChatView with a held selection in row key `kA`; bump `historySpliceRev` with 20 rows inserted above | re-render | the row with key `kA` stays mounted, and the selection anchor stays inside it |
| F11 | Swipe-back mid-gesture reset | state-transition | L1 | automated | swipe in progress (decided horizontal, offset 80) | selection becomes non-collapsed, then the next `touchmove` | `swipeState` `{offset: 0, swiping: false}`; no `preventDefault` on that move; `onBack` not called on `touchend` |
| F12 | Swipe-back long-press before decision | state-transition | L1 | automated | `touchstart` x=10, selection appears before any 10 px movement | first `touchmove` (+15 px horizontal) | gesture aborted before `preventDefault`; no tracking |
| F13 | Extractor recompute regression | invariant | L1 | automated | ChatView with a stored span change only (no scroll) | re-render | virtualizer range recomputed (retained rows reflect the new span) |
| F14 | Past-ceiling selection stays active | state-transition | L1 | automated | ChatView with a programmatic selection of 150 rows (fine) | `selectionchange` + a streaming chunk | `removeAllRanges` never called (spy after setup); `isSelectingRef` true; bottom-pin does not move `scrollTop` |
| F15 | Late `selectionchange` (unit mechanics) | fault-injection | L1 | automated | ChatView with the `selectionchange` listener suppressed; Range anchored in row `k0` | scroll recompute that excludes `k0` from the default window | row `k0` stays mounted (live read) |
| F16 | Copy completeness (unit) | convergence | L1 | automated | jsdom virtualizer shim; selection over 200 rows, interior unmounted | dispatch `copy` | `setData` text contains every row marker in order, once each; copy-only rows had no `measureElement` ref; mounted set after = mounted set before |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Copy ceiling (coarse budget) | tail-latency | L3 | automated | chromium mobile context, CDP CPU throttle 6×, long-transcript, selection of exactly the coarse copy ceiling rows | copy-handler wall time (`performance.now()` bracket exposed via `window.__piCopyTiming` in test builds) p90 ≤ 1500 ms | 10 copies |
| P2 | Copy ceiling (fine budget) | tail-latency | L3 | automated | chromium desktop, 1× CPU, long-transcript, selection of min(fine ceiling, all rows) | copy-handler wall time p90 ≤ 1500 ms | 10 copies |
| P3 | Live read cost | micro-perf | L1 | automated | `liveSelectionRowSpan` + union with a 2000-entry `keyToIndex` | mean per call < 0.2 ms over 1000 calls | single run |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Copy-time mount released on failure | fault-injection (abort) | L1 | automated | serializer throws | copy of a 200-row span | mounted row set after = before; `copySpanRef` null; the next render mounts only the normal working set; error not swallowed silently (rethrown or logged once) |
| X2 | Copy-time mount released on failure | fault-injection (abort) | L1 | automated | release `flushSync` throws once | copy | fallback `bump()` runs; after the next tick the mounted set returns to the working set |
| X3 | Copy-only rows never feed the size cache | fault-injection (delay) | L1 | automated | a copy-only row queues `requestRowMeasure` (image `load`) that flushes after release | rAF after copy | `virtualizer.measureElement` not called for that node; `getTotalSize()` unchanged |
| X4 | Copy faithful (lazy row) | fault-injection (delay) | L1 | automated | a copy-only row renders a suspended `React.lazy` component | copy | handler completes without throwing; clipboard text contains the Suspense fallback text for that row and the full text of every other row |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | Drag past ceiling / copy / swipe-back on iOS Safari (coarse tier) | exploratory | — | manual-only | real iPhone, long transcript | long-press, drag the selection handle past 40 rows, Copy from the callout, paste into Notes; then an edge swipe with the selection held | [judgment: selection never jumps or disappears; pasted text complete; edge swipe does not navigate back] |

---

## Coverage summary

- Requirements covered: 7/7 delta requirements (chat-selection-preservation ×4, chat-transcript-virtualization ×2, mobile-resilience ×1)
- Scenarios by class: edge 17 · frontend 16 · perf 3 · error 4 · manual 1
- Scenarios by level: L1 29 · L2 0 · L3 11
- Scenarios by disposition: automated 40 · manual-only 1

## New infra needed

- `playwright.config.ts`: add `firefox` and `webkit` projects (`devices["Desktop Firefox"]`, `devices["Desktop Safari"]`) whose `testMatch` is scoped to `large-selection.spec.ts`; the existing chromium project keeps running everything.
- `.github/workflows/ci-e2e-browser.yml`: every shard job installs `firefox webkit` in addition to `chromium` (`pnpm exec playwright install --with-deps chromium firefox webkit`), because `--shard` distributes all projects. The workflow stays advisory (`ci-cd-pipeline`), so cross-engine rows are CI-run but not a required merge gate. The local `run-dashboard-e2e-local-changes` run in tasks 3.10 / 4.16 / 5.7 is the blocking check.
- A test-build timing hook for P1/P2: the copy handler records its wall time on `window.__piCopyTiming` only when a test flag is set (e.g. `import.meta.env.MODE === "test"` or a `?e2eTiming` query flag), not in production.
