## Context

Folder reorder lives in `FolderDragGutter` (`packages/client/src/components/session/SessionList.tsx`).
The gutter `<div>` spreads dnd-kit drag props (`{...dragHandleProps}` from
`useFolderDragHandle()`), so the whole left column is a drag handle. Inside it, a
`<button data-testid="folder-toggle-btn">` renders the collapse chevron.

That button carried `onPointerDown={(e) => e.stopPropagation()}`, deliberately
preventing pointerdown from reaching the gutter's dnd-kit listener — so the
chevron was click-only and never started a drag.

## Decision

Remove the chevron button's `onPointerDown → stopPropagation`. pointerdown then
bubbles to the gutter div's dnd-kit `onPointerDown`, registering a potential
drag. The `PointerSensor` `activationConstraint: { distance: 5 }` (already
configured in `SessionList`) distinguishes the two gestures:

- movement < 5px then release → no drag activates → the button's `onClick`
  fires → collapse toggles;
- movement ≥ 5px → drag activates → dnd-kit suppresses the trailing click →
  folder reorders.

The chevron's cursor becomes `grab`/`grabbing` to match the gutter. The gutter
column keeps its own listeners unchanged, so both surfaces drag. No new markup,
context, or handler is introduced.

## Alternatives considered

- **Folder-tab "ear" as the handle** — makes the decorative nub interactive.
  Rejected: adds markup/visual (grip dots) the user explicitly declined, and the
  ear is not rendered distinctly in the collapsed state the way the chevron is.
- **Keep a separate visible grip** — rejected per the same "no grip" constraint.

## Risks / Trade-offs

- **Keyboard Space collision**: a `<button>` fires click on Space, while
  dnd-kit's `KeyboardSensor` also uses Space to lift. This change does not add a
  KeyboardSensor, so pointer/touch behavior is clean; keyboard-drag is out of
  scope and unchanged (the gutter's existing attributes still carry it). Flagged
  for a future keyboard pass if needed.
- **Accidental drag on click**: mitigated by the 5px activation distance, the
  same guard the gutter already relies on.
