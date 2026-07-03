# FileDiffView.tsx — index

Split-pane session-diff view replacing `ChatView`. Left `DiffFileTree`, right `DiffPanel`; auto-selects first file. Desktop side-by-side via `ResizableTreePanel` (mouse-drag resize, 150–500px), mobile stacked with tree toggle. Backed by `useSessionDiff`. Exports `FileDiffView`.
