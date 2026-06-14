# Tasks

## 1. Grab cursor on cards

- [x] 1.1 In `OpenSpecBoardView.tsx` `ProposalCard` root `<div>`, add
      `cursor-grab active:cursor-grabbing` to the className (alongside the
      existing `board-card` + `opacity-40` drag classes).
- [x] 1.2 Verify column headers retain their existing `cursor: grab` (no
      regression).

## 2. Drag overlay (pointer-following preview)

- [x] 2.1 Import `DragOverlay` from `@dnd-kit/core`.
- [x] 2.2 Render `<DragOverlay>` inside `<DndContext>`, driven by `activeDrag`.
- [x] 2.3 Add a lightweight `DragChip` component: shows the change/group name +
      state pill (for cards) or group name + dot (for columns). Do NOT re-render
      the full `ProposalCard` (no stepper/session subtree) in the overlay.
- [x] 2.4 Confirm the source element keeps its `opacity-40`/`opacity-50` dim so
      the origin slot stays legible while the chip moves.

## 3. Drop-zone highlight

- [x] 3.1 In `BoardColumn`, destructure `isOver` from `useDroppable(...)`
      (currently discarded).
- [x] 3.2 Apply a highlight class to the column body when `isOver` is true —
      use existing accent/border tokens (e.g. ring or border-accent + subtle
      bg tint). Add a CSS class in `index.css` only if Tailwind utilities are
      insufficient.

## 4. Verify

- [x] 4.1 Hover a card → grab (open-hand) cursor; press → grabbing cursor.
- [x] 4.2 Drag a card → a chip follows the pointer; origin slot dims.
- [x] 4.3 Drag a card over another column → that column highlights; drop →
      reassigns + persists (existing behavior intact).
- [x] 4.4 Drag a column header → header shows grabbing cursor, preview follows,
      drop target highlights; reorder persists.
- [x] 4.5 Existing tests in `OpenSpecBoardView.test.tsx` still pass; added a
      test asserting the card grab-cursor affordance. Full DragOverlay/isOver
      drag-over simulation not feasible with the jsdom pointer harness; chip
      and highlight covered by code review + manual QA.
- [x] 4.6 `npm test` green; no console errors during drag.
