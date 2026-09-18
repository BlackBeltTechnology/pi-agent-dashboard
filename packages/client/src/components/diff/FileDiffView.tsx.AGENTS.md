# FileDiffView.tsx — index

Split-pane session-diff view replacing `ChatView`. Left `DiffFileTree`, right `DiffPanel`; auto-selects first file. Desktop side-by-side via `ResizableTreePanel` (mouse-drag resize, 150–500px), mobile stacked with tree toggle. Backed by `useSessionDiff`. Passes `totalAdditions`/`totalDeletions` to `DiffFileTree`. Exports `FileDiffView` + `ResizableTreePanel` (exported so the drag lifecycle is directly testable, test-plan #E8). Body drag styles delegate to `useBodyDragStyle()`. See change: add-change-summary-table. See change: fix-long-session-ux-degradation.
