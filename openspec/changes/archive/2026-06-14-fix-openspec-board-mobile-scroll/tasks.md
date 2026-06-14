# Tasks

## 1. Fix the responsive scroll container

- [x] 1.1 In `packages/client/src/index.css`, change the `@media (max-width: 900px)`
      `.board-columns` rule from `overflow-x: visible` to
      `overflow-x: hidden; overflow-y: auto` (keep `flex-wrap: wrap`).
- [x] 1.2 Confirm `.board-column { max-height: none }` and
      `.board-column-body { overflow-y: visible }` remain unchanged so columns
      grow and the parent region scrolls.

## 2. Verify

- [x] 2.1 Load `/folder/:cwd/openspec` at ≤540px (phone): columns stack
      full-width and the whole column area scrolls vertically to the last card.
- [x] 2.2 Load at 540–900px (tablet): columns wrap to rows; the region scrolls
      vertically with no horizontal scroll.
- [x] 2.3 Load at >900px (desktop): unchanged — horizontal kanban scroll, each
      column body scrolls internally.
- [x] 2.4 Header (top bar + filter bar) stays fixed while the column area
      scrolls underneath.
