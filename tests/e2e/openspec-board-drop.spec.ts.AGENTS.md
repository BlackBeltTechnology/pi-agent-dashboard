# openspec-board-drop.spec.ts — index

L3 spec (change: fix-openspec-board-drop-targeting). Drop resolution + commit: F1/F2/F3/F5/F6/F10/F11/F12/F13/F14/F15/F17/F18 and cancellation X1/X2/X3/X4/X5/X6. Pins the last-position drop in an overflowing column, the rail appending without replacing the order, header/body/padding all accepting a drop, column reorder surviving the `pointerWithin` switch, and that a null `over` (gutter/page margin) commits nothing. `visibilitychange` is dispatched on the WINDOW — dnd-kit binds it there (`core.cjs:1449`).
