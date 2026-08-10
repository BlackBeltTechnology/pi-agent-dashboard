# openspec-board-order.ts — index

Pure per-change ordering helpers. `defaultChangeSort` orders in-progress → others → complete, then name. `orderChangesForGroup(changes, order?)` applies persisted `changeName[]` first, appends unordered by default sort, ignores stale entries, never throws. `computeReorder(names, moved, idx)` clamps insert index. See change: redesign-openspec-board.
