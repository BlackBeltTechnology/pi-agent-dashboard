# Add drag visual feedback to the OpenSpec board

## Why

Drag-and-drop on the full-page OpenSpec board (`/folder/:encodedCwd/openspec`,
`packages/client/src/components/OpenSpecBoardView.tsx`) **works** — cards
reassign groups and reorder, columns reorder, everything persists — but it
gives the user almost no visual signal that a drag is happening. Three
independent gaps, each producing one reported symptom:

```
SYMPTOM                          ROOT CAUSE                          LOCATION
──────────────────────────────────────────────────────────────────────────────
1. No hand/grab cursor    →   Cards set no cursor; only COLUMN     ProposalCard
   on a draggable card        HEADERS get cursor:grab (L528)        (~L590)

2. No "I'm dragging an    →   No <DragOverlay> rendered anywhere   DndContext
   item" preview              in the client (grep: 0 hits). The     (L373)
                              dragged card just dims to opacity-40
                              in its ORIGINAL slot — nothing
                              follows the pointer.

3. No drop-zone           →   useDroppable's `isOver` is            BoardColumn
   highlight on hover         destructured away and never used      (L514)
```

`@dnd-kit` does not auto-render a drag preview; the app must render
`<DragOverlay>` itself. Because it does not, the only feedback today is the
source element fading where it already sits, so the thing under the pointer is
invisible and the cursor never changes. It feels like nothing is happening.

```
        WHAT HAPPENS NOW                     WHAT USERS EXPECT
   ┌──────────────────┐                 ┌──────────────────┐
   │ ░░░░░░░░░░░░░░░░ │ ← dims in place │     (gap opens)  │
   │  (opacity 0.4,   │   stays put     │  ┌────────────┐  │
   │   default cursor)│                 │  │ chip follows│ ← grabbing cursor
   └──────────────────┘                 │  │ the pointer │  │
                                        │  └────────────┘  │
                                        │  ▓ drop column ▓ │ ← isOver highlight
                                        └──────────────────┘
```

## What Changes

All three fixes are **additive to the rendering layer only** — the drag
*behavior* (`handleDragStart` / `handleDragEnd`, reorder, persistence) is
unchanged.

- **Grab cursor on cards.** Add `cursor-grab active:cursor-grabbing` to the
  `ProposalCard` root className so a draggable card shows the hand on hover and
  the closed-grab cursor while pressed. (Column headers already do this via
  inline `cursor: grab`; this brings cards to parity.)

- **Drag overlay (the moving preview).** Render a `<DragOverlay>` inside
  `<DndContext>`, driven by the existing `activeDrag` state. Show a
  **lightweight chip** — the change/group name plus its state pill (not a full
  `ProposalCard` re-render with stepper + session list). Rationale: the chip is
  cheap, won't re-run heavy card subtrees during a 60fps drag, and reads
  better as a "what am I holding" affordance. Cards keep their existing
  `opacity-40` source-dim so the origin slot stays legible.

- **Drop-zone highlight.** Pull `isOver` out of `useDroppable` in
  `BoardColumn` and apply a highlight class (e.g. ring / border-accent /
  subtle bg tint via existing `--border`/accent tokens) to the column body
  while a draggable hovers it, so the accept target is obvious.

- **(Decision deferred to design)** whether the same missing-feedback pattern
  in `OpenSpecGroupManager.tsx` / `SortablePinnedGroup.tsx` is folded into this
  change or tracked separately. Default: keep this change scoped to the board;
  note the sibling components as follow-up.

## Capabilities

### Modified Capabilities

- `openspec-board`: extends the two existing drag requirements (`Group column
  reorder is persisted`, `Cards drag between and within columns`) with a
  visual-feedback guarantee — grab cursor, a pointer-following drag preview,
  and a drop-target highlight.

## Impact

- **Affected code**: `packages/client/src/components/OpenSpecBoardView.tsx`
  (card className, `BoardColumn` `isOver`, new `<DragOverlay>` + chip
  component). Possibly a few lines of `index.css` if highlight needs a class.
- **Scope**: ~40–60 LOC, all in the render path. No protocol, server, or
  persistence change. No change to drag logic or drop outcomes.
- **Risk**: low. Pure additive feedback; worst case is a cosmetic chip/ring
  tweak.
- **No desktop/mobile behavior change** beyond the added visual cues.
