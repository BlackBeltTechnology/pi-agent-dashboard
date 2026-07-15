## Why

The `⚙ View` popover (`ChatViewMenu`) renders **off the left edge** when the
ChatView panel is slim. The popover is `absolute right-0 w-64` (256px wide,
right-anchored to the trigger) and the trigger sits near the left of the
composer status bar. In a narrow panel the fixed 256px width extends left of the
panel/viewport edge, clipping each row's **label** (rows are `justify-between`,
so the label is on the left and the checkbox on the right — only the checkboxes
survive). Reported bug: "when the ChatView is slim, the View popup is not
rendered correctly."

The shared `usePopoverFlip` hook (`popover-viewport-positioning` spec,
`fix-popover-viewport-flip`) already solves the **vertical** axis — it flips
up/down and clamps `maxHeight` to keep popovers on-screen. It has **no
horizontal logic**: it never measures left/right space, so a right-anchored
popover in a narrow container has nothing to keep it on-screen. The horizontal
axis is the untested completion of the primitive.

## What Changes

- **Extend `usePopoverFlip` with a horizontal axis.** The hook additionally
  measures the trigger's left/right viewport space and returns an
  `anchorRight` boolean (or equivalent) selecting the horizontal edge the
  popover anchors to, plus a clamped `maxWidth`, so a popover renders toward
  whichever side has room and never exceeds the available horizontal space.
- **Adopt the horizontal decision in `ChatViewMenu`** — swap the hard-coded
  `right-0` for the hook-driven `left-0 ⇄ right-0` and apply `maxWidth`. Fixes
  the reported slim-panel bug.
- Existing vertical behavior (flipUp / maxHeight) and all current consumers
  stay unchanged; the horizontal fields are additive and default to today's
  behavior when there is room on the anchored side.

**Out of scope:** changing display-preference semantics, the WS protocol, or
persistence; imposing a ChatView min-width; converting the popover to
`position: fixed` / a portal / Floating UI (larger rewrite, not needed for this
bug); horizontal-flip adoption in popovers other than `ChatViewMenu` (they open
in wide containers today — revisit only if a slim-panel clip is reported).

## Capabilities

### Modified Capabilities

- `popover-viewport-positioning`: The shared `usePopoverFlip` hook gains a
  horizontal axis alongside the existing vertical one — it selects the
  horizontal anchor edge (left/right) by available space and returns a clamped
  `maxWidth`, so viewport-anchored popovers stay on-screen horizontally as well
  as vertically.

## Discipline Skills

- `systematic-debugging` — reproduce the slim-panel clip and confirm the
  horizontal-flip decision boundary before/after.
