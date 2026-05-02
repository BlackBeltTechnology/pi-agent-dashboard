## Why

Pinned directory groups in the sidebar cannot be reordered by drag-and-drop **when they (or the intended drop target) are expanded**. Collapsing first, dragging, then expanding works — but the friction is hostile and the failure is silent (the drag visibly moves and then snaps back with no feedback). The existing `pinned-directories-ui` capability already promises drag-to-reorder; in practice it only works in the collapsed state.

Root cause is in `packages/client/src/components/SessionList.tsx`:

- One `DndContext` wraps **both** the pinned-group `SortableContext` and the per-group session `SortableContext`s.
- `collisionDetection={closestCenter}` operates over **every** `useDroppable` in the tree, ignoring `SortableContext` boundaries.
- When a group is expanded, the centers of its inner session cards are physically closer to the cursor than the wrapping pinned-group container's center. `closestCenter` resolves `over` to a session id (`type: "session"`), not a pinned-group id (`type: "pinned-group"`).
- The `handleDragEnd` cross-type guard `if (activeType !== overType) return;` then bails out silently — no reorder, no error.

The fix is one self-contained collision-detection function: filter `droppableContainers` by the active item's `data.current.type` before delegating to `closestCenter`. This restores the contract `pinned-directories-ui` already promises without touching any of the surrounding drag logic, the resume-keep-position semantics, or the nested-sortable structure.

## What Changes

- Replace the `collisionDetection={closestCenter}` prop on the sidebar `DndContext` with a small `sameTypeClosestCenter` collision-detection function that filters `droppableContainers` by `data.current.type === active.data.current.type` before delegating to `closestCenter`.
- The `if (activeType !== overType) return;` guard in `handleDragEnd` stays as defense-in-depth.
- Add a regression test under `packages/client/src/components/__tests__/` that drives the bug deterministically: render `SessionList` with two pinned groups, expand both, simulate a drag-end with `active.id = group A` and `over.id = group B`, assert `onReorderPinnedDirs` was called with the swapped order. A second scenario simulates a session-card drag inside an expanded group and asserts pinned-group order is untouched.
- No protocol changes, no server changes, no API changes. No change to session reorder behavior, drag-to-resume, or the inner `SortableContext`. Pure client-side collision-detection swap.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `pinned-directories-ui`: Strengthen the existing **Drag-to-reorder pinned directories** requirement so the contract holds regardless of whether the source or target group is expanded or collapsed. Add explicit scenarios for both states.

## Impact

- **Affected code**:
  - `packages/client/src/components/SessionList.tsx` — replace one `collisionDetection` prop and add a small pure helper (or inline arrow) above `handleDragEnd`. ~10–15 lines added/modified.
  - `packages/client/src/components/__tests__/SessionList.expanded-pinned-drag.test.tsx` (new) — regression coverage. Mirrors the existing `session-drag-reorder.test.tsx` style.
- **No server / API / protocol changes**.
- **No persistence migration** — `sessionOrderMap` and pinned-dirs persistence are untouched.
- **Docs**:
  - `AGENTS.md`: update the `SessionList.tsx` row (or the `SortablePinnedGroup.tsx` row) with a one-line cross-ref to this change name explaining type-aware collision detection.
  - `docs/architecture.md`: mention only if it currently describes sidebar drag-and-drop (likely not — confirm during implementation).
