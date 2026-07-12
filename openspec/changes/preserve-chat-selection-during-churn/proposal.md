## Why

In `ChatView`, highlighting text inside a transcript message/tool card (to copy
output) frequently collapses the selection the moment the transcript churns — a
new card arrives, the active card streams, or the view auto-scrolls. Users
cannot reliably select-and-copy tool output or assistant text while a run is
live.

A browser selection is a `Range` anchored to **specific live Text nodes**. The
transcript is a `@tanstack/react-virtual` windowed list (only viewport +
`overscan: 6` rows mounted; change `virtualize-chat-transcript-tanstack`). When
the anchored Text nodes leave the DOM, the browser **collapses the selection**;
nothing restores it. Two distinct clobber paths exist:

- **Path A — finished cards (memoized).** `MarkdownContent` is `React.memo`, so a
  completed card renders once and its DOM is stable across reconciliation. Its
  selection dies **only when the virtualizer unmounts the row**, triggered by
  (a) the `stickToBottom` auto-scroll pin shifting the viewport past the row's
  overscan band while following a live stream, or (b) a multi-card selection
  where one endpoint card scrolls out of the mounted window.
- **Path B — the streaming tail (always mounted, never virtualized).** The tail
  card re-renders its markdown on every chunk, replacing its Text nodes, so a
  selection inside the actively-streaming card collapses regardless of scroll
  position. `React.memo` cannot help — the streaming card's props change every
  chunk.

## What Changes

Introduce a single source of truth for "the user is actively selecting text in
the transcript", and gate transcript churn on it. Layered by cost/robustness:

1. **Detect an active transcript selection.** A `selectionchange`-driven hook
   (`useActiveChatSelection` or equivalent) exposes `isSelecting = true` when a
   non-collapsed `Selection` **intersects** the `chat-scroll-container` (tested
   on both anchor and focus, not anchor-containment alone). Clears when the
   selection collapses or moves out.

2. **Suspend the auto-scroll pin while selecting (Path A, at-bottom).** The
   `stickToBottom` auto-scroll `useLayoutEffect` and the virtualizer `onChange`
   bottom-pin SHALL early-return while `isSelecting`. Streaming still updates the
   DOM; the viewport simply stops being yanked to the bottom, so the selected
   row is not scrolled out of its overscan band. On collapse, normal follow
   behavior resumes (re-pin to bottom only if the user was at bottom).

3. **Retain selection-intersecting rows while selecting (Path A, multi-card /
   scrolled).** Track the selection's row span in a ref from selection start
   (**proactively**, while the anchor row is mounted) and feed it to a custom
   `rangeExtractor` (default range ∪ tracked span) so every intersecting row
   stays mounted — the extractor runs *before* the virtualizer unmounts, so
   rows the selection touches never unmount. Proactive is required: DOM Range
   endpoints move synchronously and irreversibly when their row unmounts, so a
   reactive re-mount-after-churn path loses the race. The virtualizer owns
   mount/position/measure; `getTotalSize()` is allowed to change. Bolt-on rows
   are NOT used (a `measureElement` row mutates the size cache). The retained
   set is a **device-aware span ceiling** (desktop ~100 / mobile ~40 rows,
   `min..max` selected index); the full span must mount because native copy
   serializes the DOM *between* the endpoints, so endpoints-only yields a
   silently truncated copy. **Past the cap** (notably `Select All`) the view
   MUST **actively clear** the selection (`removeAllRanges`, optionally a hint)
   or intercept `copy` — NOT rely on passive collapse (a shrunk Range persists
   with garbage offsets and copies silently-wrong text), and NOT force-mount the
   whole transcript.

4. **Streaming tail (Path B) — no worse than baseline; real fix deferred.** The
   actively streaming tail card replaces its Text nodes each chunk and unmounts
   at turn completion, so a selection inside it cannot be preserved by freezing
   its DOM (the node detaches). This change does NOT regress that case; full
   streaming-tail preservation (node-stable streaming render) is a separate
   follow-up.

Non-goals: preserving a selection across a **session switch**, across an
`event_replay` full-transcript rebuild, or in the composer input box (a separate
surface). Copy-button payload correctness is owned by
`fix-table-copy-empty-clipboard`; this change only keeps the *selection* alive so
native Ctrl+C / right-click Copy work.

## Capabilities

### New Capabilities
- `chat-selection-preservation`: while the user holds an active text selection
  inside the transcript, the view SHALL NOT collapse that selection due to
  streaming updates, new cards, auto-scroll, or virtual-window churn, for
  selections anchored in finished cards (normative) and best-effort for the
  streaming tail card.

### Modified Capabilities
- `chat-scroll-lock`: the auto-scroll bottom-pin and `onChange` re-pin gain an
  explicit exception — they are suspended while a transcript selection is
  active, and resume on collapse. All existing lock scenarios (50px threshold,
  scroll-to-bottom button, `event_replay` race) must still pass with no active
  selection.
- `chat-transcript-virtualization`: the mounted working set is extended to
  include rows intersecting an active selection, in addition to viewport +
  overscan.

## Impact

- `packages/client/src/components/ChatView.tsx` — consume `isSelecting`; gate the
  `stickToBottom` layout effect and virtualizer `onChange` pin (+ dep-array fix
  for resume, `lastScrollHeightRef` resync); pass a `rangeExtractor` that unions
  selection-intersecting indices into the mounted range.
- `packages/client/src/hooks/` — new `useActiveChatSelection` (selectionchange
  listener, container-scoped, debounced).
- `packages/client/src/lib/chat-virtual-rows.ts` (or a sibling) — helper to map a
  DOM `Range` to the set of intersecting display-row keys/indices.
- Tests: `ChatView.scroll-race`-style specs asserting selection survives a
  streaming append at bottom, a new-card append while scrolled up, and a
  multi-card selection; plus a hook unit test for `isSelecting` transitions.

## Discipline Skills
- `systematic-debugging` — reproduce each clobber path (at-bottom stream,
  scrolled multi-card, streaming-tail) before touching code; the bug is
  timing/DOM-lifecycle, not logic.
- `performance-optimization` — layer 4 must not regress streaming latency;
  measure flush coalescing before/after.
