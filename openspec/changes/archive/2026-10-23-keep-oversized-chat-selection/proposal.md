# Proposal

## Why

Drag-selecting more than the retained-row ceiling (100 rows, or 40 when
`useMobile()` matches) in the chat transcript destroys the user's selection
(GitHub issue #1037). The 40-row cap is reached in normal use: rows are not turns,
and a few tool calls cover 40 rows quickly. The shipped D3 design
(`preserve-chat-selection-during-churn`) calls `removeAllRanges()` past the cap so
the failure is *visible*. A cross-engine spike (`spike/`, desktop Playwright Chromium /
Firefox / WebKit, real `@tanstack/react-virtual` 3.14.10 + React 19.2) shows that
premise is false on WebKit. During an active drag, desktop WebKit re-anchors the
selection at the current row after `removeAllRanges()`. That is very likely the same
on iOS Safari, the platform where the 40-row cap applies, although no touch run exists. The
result is a silently wrong selection, which is the truncation D3 meant to rule out.

The spike also reproduced a second, timing-dependent loss. Retention reads a span
captured in `selectionchange`. If that event lags a virtualizer recompute, the anchor
row unmounts:
- Gecko and WebKit re-target the anchor to the container ("everything above my
  cursor got selected").
- Chromium re-anchors to the visible row.

The ceiling exists only because native copy serializes mounted DOM.
`chat-copy-fidelity-intercept` already intercepts `copy`, but:
- its serializer reads `Range.cloneContents()`, so fidelity still depends on what
  is mounted;
- it returns early for ranges that start or end outside the transcript, such as
  page-wide Select-All. Native copy then takes only the ~20 mounted rows.

The spec's claim "not by what happens to be mounted" is not true today.

## What Changes

- **Past the retained-row ceiling, keep the selection alive.** Stop calling
  `removeAllRanges()`. Keep the two endpoint rows mounted, plus the viewport +
  overscan. Interior rows may unmount while the selection is held. The spike
  verified that the Range survives in all three engines, and that interior rows
  remounted later re-highlight. This replaces the D3 "actively clear" rule and
  modifies the "Very large selection is bounded" scenario.
  - Consequence: a past-ceiling selection is now an *active* selection for its
    whole lifetime, as any smaller selection already is. Bottom-pin stays
    suspended, the streaming-tail freeze and row-growth anchor compensation stay
    engaged, and they release on collapse. Previously the clear ended these early.
- **Mount the full selected span on copy.** In the copy intercept:
  1. `flushSync` mount the full selected span.
  2. Serialize with the existing `buildSelectionClipboardText`.
  3. `flushSync` release the span.

  Rows mounted only for copy skip `measureElement` and the `requestRowMeasure`
  path, so neither the size cache nor the scroll position changes. Rows that were
  unmounted copy in their current render state: expansion state that is local to
  a row resets on unmount, just as it does when the row is scrolled back into view.
- **Copy ranges that extend beyond the transcript.** The copy intercept moves to
  a document-level listener. A range that contains or partly overlaps the
  transcript (for example page-wide Select-All) is serialized in three parts:
  - text before the transcript, from the DOM;
  - the transcript, through the span mount;
  - text after the transcript, from the DOM, skipping hidden and script/style
    content.

  Ranges that do not touch the transcript, and copies from editable fields such
  as the composer, are left to the browser. A copy whose range spans more than one
  mounted transcript is declined with a toast rather than truncating either.
- **Copy ceiling.** A transcript part wider than the copy-mount ceiling is not
  mounted. The copy is declined and the previous clipboard contents are left
  unchanged; the spike verified this in all three engines. A "selection too
  large" toast tells the user to copy in parts. Nothing is copied silently
  truncated. Interim, provisional values
  come from the spike's measured real-row cost, budgeted per input tier. They are
  calibrated in tasks.
- **Retention independent of event timing.** `rangeExtractor` also reads the live
  `Selection` and unions its endpoint rows into the retained span. Live endpoints
  are resolved through `data-row-key` → current index, never DOM `data-index`,
  which is stale while rendering after a history splice
  (`add-tail-only-replay-window` D7a).
- **Ceilings keyed by input modality, not viewport.** The retained-row ceiling
  (fine 100 / coarse 40) and the copy ceiling depend on the `(pointer: coarse)`
  media query instead of `useMobile()`, which also matches short desktop windows
  (`max-height: 599px`). `useMobile()` itself is unchanged.
- **Swipe-back yields to text selection.** `useSwipeBack` does not start, and
  fully abandons, a back-swipe while a non-collapsed document selection exists
  outside editable fields. The left 40px zone currently turns a horizontal
  selection-extend into a back navigation.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `chat-selection-preservation`: Large-selection behavior changes from "clear past
  the ceiling" to "keep endpoints mounted and the selection alive". Active-selection
  detection states explicitly that a page-wide range with both endpoints outside the
  transcript is not an active transcript selection. Retention no
  longer depends on `selectionchange` timing. The copy requirement gains
  span-mounting-on-copy, transcript-containing ranges, and an announced copy
  ceiling.
- `chat-transcript-virtualization`: The off-screen bound gains two bounded
  exceptions: a held selection's endpoint rows, and the transient copy mount. The
  mounted working set past the retained-row ceiling is the endpoint rows only. There is a transient, unmeasured
  full-span mount during `copy`. Ceilings are keyed by pointer modality.
- `mobile-resilience`: The swipe-back gesture does not activate while a text
  selection is active.

## Impact

- `packages/client/src/components/chat/ChatView.tsx`:
  - `mapChatRange` (drop `removeAllRanges`);
  - `rangeExtractor`;
  - copy intercept (React `onCopy` → document `copy` listener);
  - ceiling constants;
  - row render (copy-only rows unmeasured);
  - `requestRowMeasure` and row-growth anchor effect guards during copy;
  - a local `useToast()` host.
- `packages/client/src/lib/chat/chat-virtual-rows.ts`: endpoint-only branch of
  `extendRangeWithSelection`, copy-span union, and a live-selection span helper
  keyed by row key.
- `packages/client/src/lib/chat/chat-selection-copy.ts`: three-part serialization
  helper for ranges that extend beyond the transcript.
- `packages/client/src/hooks/useActiveChatSelection.ts`: doc and contract updates.
- `packages/client/src/hooks/useSwipeBack.ts`: selection guard.
- No server, protocol, or persistence changes. Client-only. Rollback is a revert.
- Mockup: N/A. The only new UI is a single-line toast that uses the existing
  `primitives/Toast`.
- Spike harness and raw results: `spike/` in this change.

## Discipline Skills

- `performance-optimization`: The copy-time full-span mount has a latency
  budget. Ceilings must be justified by measured per-row cost on real transcripts,
  desktop and 6× CPU.
- `review-code`: A non-trivial change to a selection and virtualization hot
  path, reviewed before commit.
- `doubt-driven-review`: Reverses a shipped design decision (D3 "actively
  clear"). Stress-test the endpoint-only invariant before it stands.

Apply-loop subagent checkpoint: `react-expert`. A hook is reworked
(`useActiveChatSelection` contract, `useSwipeBack`) and there is a render-perf
path (extractor, copy-time mount).
