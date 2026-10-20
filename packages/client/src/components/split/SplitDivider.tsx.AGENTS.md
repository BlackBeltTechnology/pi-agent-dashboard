# SplitDivider.tsx — index

Draggable divider (outer chat/editor + inner rail). Reports pointer coord; orientation-aware cursor. Optional `‹`/`›` collapse chevrons (`onCollapseChat`→full, `onCollapseEditor`→closed; `stopPropagation` drag-vs-click guard, testids `split-fold-chat`/`split-fold-editor`). Body drag styles delegate to `useBodyDragStyle()` (orientation-aware cursor kept). See change: split-editor-workspace. See change: editor-layout-modes. See change: fix-long-session-ux-degradation.

See change: fix-split-divider-drag — drag lifecycle moved to `useResizeDrag`. Spreads `onPointerDown`/`onMouseDown` + inline `touchAction:"none"`. `onResize(clientPos)` = per-frame preview. `onResizeEnd(clientPos|null)` = single commit (`null` = nothing). `onResizeStart` → hook `onStart`. No document mouse listeners.
