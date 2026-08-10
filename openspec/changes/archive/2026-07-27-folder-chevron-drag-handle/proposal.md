## Why

Reordering a folder (cwd) in the sidebar currently requires grabbing a bare
12px-wide gutter column with no visible grip — users report "there's no way to
grab and reorder cwds anymore." The folder's collapse chevron, on the other
hand, is always visible (in both collapsed and expanded states) and is the most
obvious thing to grab, but it explicitly opts OUT of dragging (its
`onPointerDown` stops propagation so the surrounding gutter drag listener never
fires). This makes the drag affordance undiscoverable, and — because the gutter
is the only handle — a collapsed folder is awkward to reorder.

## What Changes

- Make the folder header's collapse chevron double as a drag-activation
  surface: a plain click still toggles collapse, a drag (past the dnd-kit
  PointerSensor 5px activation distance) reorders the folder.
- Keep the existing left gutter column draggable (unchanged) — the chevron is
  an *additional* handle, not a replacement.
- No new grip/visual is added; only the chevron cursor changes to `grab`.
- Because the chevron is always rendered, collapsed folders stay reorderable
  via their chevron.
- Implementation is the removal of the chevron button's
  `onPointerDown → stopPropagation` in `FolderDragGutter`, so pointerdown
  bubbles to the gutter div's existing dnd-kit listeners.

## Capabilities

### New Capabilities
<!-- none: extends an existing capability -->

### Modified Capabilities
- `sidebar-drag-reorder`: adds a requirement that the folder collapse chevron
  act as a drag-activation surface (click = toggle, drag = reorder) while the
  gutter column remains draggable, so folder reorder is discoverable and
  collapsed folders remain reorderable.

## Discipline Skills

- `review-code`: non-trivial interaction change (click-vs-drag on one control)
  with tests passing before commit.
