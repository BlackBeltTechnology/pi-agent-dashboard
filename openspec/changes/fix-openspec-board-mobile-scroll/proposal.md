# Fix OpenSpec board not scrollable on mobile

## Why

On phone/tablet widths the full-page OpenSpec board (`/folder/:cwd/openspec`)
clips its stacked columns and offers no way to scroll to content below the
first viewport height. The board is effectively unusable past the first column.

Root cause is a CSS regression in the responsive re-layout. The board column
area is `<div className="… overflow-x-auto flex-1 min-h-0 board-columns">`.

```
MobileShell root      relative h-[100dvh] overflow-hidden   ← clips, fixed height
  └ detail panel      absolute inset-0 flex flex-col
      └ board root     flex flex-col h-full min-h-0
          ├ top bar    sticky, flex-wrap        (grows tall on narrow screens)
          ├ filter bar flex-wrap                (grows tall on narrow screens)
          ├ BOARD      flex-1 min-h-0 .board-columns   ← the scroll region
          └ footer hint
```

On desktop, `.board-columns` carries Tailwind `overflow-x-auto`. Because one
axis is `auto`, the browser computes the cross axis (`overflow-y`) as `auto`
too, so the region scrolls. Columns are `max-h-full` with internally-scrolling
bodies. Everything is reachable.

On mobile, `index.css` (`@media max-width: 900px`) rewrites the region:

```css
.board-columns     { flex-wrap: wrap; overflow-x: visible; }   /* kills the scroll */
.board-column      { max-height: none; }
.board-column-body { overflow-y: visible; }                    /* columns grow tall */
```

Setting `overflow-x: visible` leaves `overflow-y` at its default `visible`, so
`.board-columns` is **no longer a scroll container**. The stacked, full-height
columns now overflow past the viewport, and no ancestor provides
`overflow-y: auto` — the board root is plain `flex flex-col` and the
`MobileShell` root is `overflow-hidden`. The overflow is therefore **clipped,
not scrollable**.

```
        DESKTOP                         MOBILE (current)
   ┌──────────────────┐           ┌──────────────────┐
   │ overflow-x:auto  │           │ overflow-x:visible│ ← both axes visible
   │ → implies y:auto │           │ overflow-y:visible│   = NO scroll container
   │ [col][col][col]→ │           │ [col stacked]     │
   └──────────────────┘           │ [col stacked]  ───┼──▶ overflows, clipped
                                   └──────────────────┘
```

## What changes

Make `.board-columns` a bounded **vertical** scroll container at tablet/phone
widths instead of going `overflow: visible`. It already sits inside the
fixed-height `MobileShell` as `flex-1 min-h-0`, so switching it to
`overflow-y: auto` (and `overflow-x: hidden`, since columns now stack/wrap and
no longer need horizontal scroll) yields a scrollable region while the
header/filter bars stay put.

```css
@media (max-width: 900px) {
  .board-columns { flex-wrap: wrap; overflow-x: hidden; overflow-y: auto; }
  /* .board-column / .board-column-body rules unchanged */
}
```

No JSX/component changes required — the height chain
(`h-[100dvh]` → `flex-1 min-h-0`) is already correct; only the cross-axis
overflow on `.board-columns` was wrong.

## Impact

- Affected spec: `openspec-board` — "Responsive column layout" requirement
  (tablet + phone scenarios gain a scrollability guarantee).
- Affected code: `packages/client/src/index.css` (`@media max-width: 900px`
  `.board-columns` rule).
- No behavior change on desktop (>900px).
