## Context

The sidebar uses **nested sortables inside a single `DndContext`**:

```
DndContext (collisionDetection: closestCenter)
│
├── SortableContext [pinned-group ids]            ← outer
│   └── SortablePinnedGroup × N
│       └── renderGroup(...)
│           └── SortableContext [session ids]     ← inner per group
│               └── SortableSessionCard × M
│
└── (unpinned groups — sessions only, no group sort)
```

`@dnd-kit/core`'s `closestCenter` does **not** respect `SortableContext` boundaries — it iterates every `DroppableContainer` registered in the parent `DndContext` and picks the one whose rectangle center is closest to the active draggable's translated center. Two consequences:

1. When a pinned group is **collapsed**, its bounding-box center sits roughly on the header. Dragging it onto another collapsed group → the other group's header center wins → `over.type === "pinned-group"` → reorder dispatches.
2. When a pinned group is **expanded**, its bounding-box height grows by the height of all child session cards. The wrapping container's *center* drops down into the middle of the session list. The cursor (which the user puts roughly on the target *header* to indicate intent) is now physically closer to a session card's center than to either group's wrapping center → `over.type === "session"` → cross-type guard fires → silent no-op.

The cross-type guard `if (activeType !== overType) return;` exists for good reasons (prevents nonsense reorders like dropping a session-id into the pinned-group order list), so removing it is not the answer.

The clean fix is to **constrain collision detection** so it only considers droppables of the same `type` as the active draggable, before measuring distances. dnd-kit explicitly documents this pattern in its "Multiple containers" examples.

## Goals / Non-Goals

### Goals
- Pinned-group drag-to-reorder works whether the source group, the target group, or both are expanded.
- Inner session-card reorder is unchanged.
- Drag-to-resume (the cross-status side-effect that fires on session moves) is unchanged.
- The cross-type guard in `handleDragEnd` stays as defense-in-depth.
- Zero protocol / persistence / server impact.

### Non-Goals
- Cross-folder session drag (explicitly out of scope per exploration).
- Visual changes to drop indicators, drag overlays, animations.
- Refactoring to two `DndContext`s. Considered (Option B below) and rejected as over-engineering for this bug.
- Auto-collapsing groups during drag. Considered (Option D) and rejected as visually janky.

## Decisions

### Decision 1: Type-aware collision detection (Option A)

**What**: Replace `collisionDetection={closestCenter}` with a small custom function that filters `args.droppableContainers` by matching `data.current.type` to the active draggable's type, then delegates to `closestCenter`.

```ts
import { closestCenter, type CollisionDetection } from "@dnd-kit/core";

const sameTypeClosestCenter: CollisionDetection = (args) => {
  const activeType = args.active.data.current?.type;
  if (!activeType) return closestCenter(args);
  const filtered = args.droppableContainers.filter(
    (c) => c.data.current?.type === activeType,
  );
  return closestCenter({ ...args, droppableContainers: filtered });
};
```

**Why**:
- One small pure function, zero React state, zero new context plumbing.
- Composes with everything dnd-kit already does (modifiers, sensors, accessibility announcements).
- Defensive: if `activeType` is missing for any reason, we fall back to vanilla `closestCenter` — never strictly worse than today.
- Mirrors the canonical "multiple containers" pattern from dnd-kit's own docs and Storybook examples; not novel.

### Decision 2: Keep the cross-type guard in `handleDragEnd`

The guard `if (activeType !== overType) return;` becomes effectively unreachable for the cases we care about, but we keep it because:
- It's a one-line invariant guard, not a workaround.
- If a future change adds a new draggable `type` and forgets to wire collision detection, the guard prevents a nonsense reorder dispatching.
- Removing it adds risk for zero benefit.

### Decision 3: Defense-in-depth via tests, not via collapsing-on-drag

A previous brainstorm considered auto-collapsing groups on `onDragStart` to make `closestCenter` work without a custom collision function. Rejected because:
- Visual flicker when grabbing a group.
- Re-expanding on drop or cancel doubles the state surface.
- Doesn't help the *target* group if it's expanded (cursor is on its header, but its center is far below).
- The custom-collision approach has none of these issues.

## Alternatives Considered

| Option | Approach | Verdict |
|---|---|---|
| **A. Type-aware collision detection** | Filter droppables by `data.type` before `closestCenter` | **Chosen.** Small, idiomatic, zero side effects. |
| B. Two `DndContext`s | Outer for groups, inner per group for sessions | Rejected. Loses unified accessibility announcements; doubles context plumbing; cross-folder session drag (a future possibility) becomes harder. |
| C. Disable inner `SortableContext` while pinned-group drag is active | Track `activeType` via `onDragStart` | Rejected. State coupling, race-prone, harder to test than a pure collision function. |
| D. Auto-collapse on drag-start | Visual gymnastics | Rejected. UX-jarring; doesn't fix expanded-target case. |
| E. Switch to `closestCorners` or `pointerWithin` | Different built-in detector | Rejected. Doesn't solve the type-mixing problem; just shifts which session id wins. |

## Risks / Trade-offs

- **Drag indicator visuals**: Some sortable-strategy hooks read `over` to compute insertion lines. Filtering droppables changes which `over` candidates are eligible. The inner `SortableContext`'s `verticalListSortingStrategy` will still see session-card collisions for session drags (because `activeType === "session"` keeps session droppables in the candidate set). For pinned-group drags, the strategy on the inner contexts isn't relevant — we want the outer one to drive insertion. Verified mentally; will confirm visually during implementation.
- **Accessibility**: dnd-kit's screen-reader announcements use `over.id`. Our change makes `over.id` a same-type id, which is more semantically correct than today (today's announcements would mention a session id while reordering a pinned group — confusing). Net positive.
- **Future drag types**: If we ever introduce a third drag type (e.g., "terminal"), the same-type filter Just Works without modification.
- **Test seam**: Vitest + jsdom can drive `DndContext` via direct `onDragEnd` invocation (the existing `session-drag-reorder.test.tsx` already does this). The new collision-detection function is pure and unit-testable in isolation; we'll cover both layers.

## Open Questions

- None at this time. Implementation is mechanical once tests are red.

## Migration Plan

None — pure client-side behavior fix; no persisted shape changes; no server cooperation needed.
