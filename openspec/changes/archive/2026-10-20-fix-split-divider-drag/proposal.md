# Fix split-divider drag: lost pointer, stuck drag, and per-frame lag

## Why

Dragging the chat│editor divider or the files│preview rail divider lags, and
the divider often "loses" the mouse and then keeps following the pointer after
the button is released. Two separate causes, both confirmed in source:

1. **Stuck drag over embedded frames.** All three drag-to-resize affordances
   (`SplitDivider`, `ResizableSidebar`, `FileDiffView`'s `ResizableTreePanel`)
   track the drag with `document` `mousemove`/`mouseup` listeners only. The
   editor pane hosts iframes (`HtmlPreview`, `LiveServerViewer`, `EmlPreview`,
   `YouTubePreview` in `packages/client`; `CraftFrame` in
   `packages/craft-web-plugin`). When the pointer enters an iframe
   the parent document stops receiving `mousemove` (divider freezes), and a
   `mouseup` released over the iframe never reaches the parent: `dragging` stays
   `true` and the divider tracks the bare pointer until the next click. There is
   no `buttons === 0` check, no pointer capture, no `blur`/`pointercancel`
   handling. `fix-long-session-ux-degradation` explicitly deferred this "lost
   `mouseup`" case as a non-goal; this change closes it.
2. **Per-frame React + storage work on the split dividers.** Every `mousemove`
   on the outer divider calls `updateSplit({ ratio })` → new
   `SplitWorkspaceContext` value → every context consumer re-renders, plus a
   fresh `<EditorPane/>` element re-renders the whole pane, plus a
   `localStorage` write via `useSplitState`'s effect. The rail divider does the
   same through `setRailWidth` → `EditorPane` re-render + `saveRailWidth`. No
   `requestAnimationFrame` coalescing — high-rate mice fire >120 events/s. The
   inline `onRatioChange` arrow also re-subscribes the divider's document
   listeners every render. (`ResizableSidebar` and `ResizableTreePanel` already
   mutate the DOM directly during the drag and commit on release — the pattern
   the split dividers lack.)

## What Changes

- New shared drag hook (`useResizeDrag`) owning the full drag lifecycle for
  every drag-to-resize affordance: pointer-event based, `setPointerCapture`
  where available, a transparent full-viewport **drag shield** so embedded
  iframes cannot swallow move/release events, end-of-drag on `pointerup`,
  `pointercancel`, `lostpointercapture`, or any move reporting
  no pressed button (committing the last *previewed* size, never the stale
  coordinate of the ending event), one drag at a time, `touchAction: "none"`
  on handles, divider press keeps editor/composer focus, and rAF-coalesced preview callbacks. Composes the existing
  `useBodyDragStyle` (body cursor + `user-select` contract unchanged).
  Callback refs keep listener identity stable across renders.
- `SplitDivider` adopts the hook; its props contract becomes *preview* (per
  frame) + *end* (commit, `clientPos | null`). Internal component API only —
  all callers are in-repo and updated; the orphaned `useSplitRatio` hook
  export is removed (its pure helpers stay).
- Outer divider (`SplitWorkspace`) and rail divider (`EditorPane`) preview the
  resize by mutating pane styles directly during the drag and commit
  `onRatioChange` / `setRailWidth` **once on release** — no React re-render
  and no `localStorage` write per frame.
- `ResizableSidebar` and `ResizableTreePanel` migrate onto the same hook
  (they gain the shield + reliable release; their existing direct-DOM preview
  and commit-on-release behaviour is kept).
- Persisted values (split ratio, rail width, sidebar width) are unchanged in
  key, shape and clamp; only *when* they are written changes.

## Capabilities

### New Capabilities
- `resize-drag-lifecycle`: how every drag-to-resize affordance starts, tracks,
  previews, and reliably ends a drag (embedded-frame shielding, lost-release
  recovery, frame coalescing, commit-on-release persistence).

### Modified Capabilities
- (none) — `drag-body-style` (body cursor/selection overrides) and
  `split-editor-workspace` / `resizable-sidebar` (clamps, persistence keys,
  grip visuals) keep their requirements verbatim; the new hook composes
  `useBodyDragStyle`, so the drag-body-style "single shared mechanism"
  requirement stays satisfied.

## Impact

- **Code (client only):** new `packages/client/src/hooks/useResizeDrag.ts`;
  `components/split/SplitDivider.tsx`, `components/split/SplitWorkspace.tsx`,
  `components/editor-pane/EditorPane.tsx` (rail divider),
  `components/shell/ResizableSidebar.tsx`,
  `components/diff/FileDiffView.tsx` (`ResizableTreePanel`). Possibly
  `lib/layout/useSplitRatio.ts` (ratio math reused for the live preview).
- **Tests:** existing unit tests drive these handles with `fireEvent.mouse*`
  (`SplitWorkspace.test.tsx`, `EditorPane.test.tsx`,
  `ResizableSidebar.test.tsx`, `body-drag-delegation.test.tsx`) — they migrate
  to pointer events. E2E `tests/e2e/drag-body-style.spec.ts` and
  `editor-pane.spec.ts` use Playwright's mouse (emits pointer events) — expected
  to pass unchanged; re-run to confirm.
- **No server, protocol, or persistence-format change.** No migration; rollback
  is a plain revert. `useTreeColumnWidth` (Instructions folder-tree column) is
  out of scope — same class of bug, follow-up candidate once the hook lands.
- **Out of scope:** keyboard resizing of dividers; Escape-to-cancel; freezing
  chat-row reflow during a drag (only if profiling after this change still
  shows jank).

## Discipline Skills

- `performance-optimization` — drag latency is a frame budget; measure a drag
  in a long session (DevTools Performance) before and after the commit-on-release
  change.
- `systematic-debugging` — confirm the iframe-swallowed-`mouseup` mechanism with
  a reproducer test before the fix.
- `review-code` — inline review before commit (non-trivial lifecycle code
  shared by four affordances).
