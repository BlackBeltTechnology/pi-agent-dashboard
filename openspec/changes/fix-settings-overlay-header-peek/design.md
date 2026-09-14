# Design — fix-settings-overlay-header-peek

## Context

`RouteBackedOverlay` (change: add-route-backed-overlay-dialogs, #536) renders two
things:

1. an inert `absolute inset-0` FROZEN underlay — the launching surface, kept
   renderable/linkable while the URL points at the overlay; and
2. a shared `Dialog open size="full" flush` carrying the overlay content, which
   portals to `document.body` and paints a `fixed inset-0 z-dialog` container, a
   `bg-black/60` scrim, and a centered `max-w-[95vw] max-h-[92vh]` panel.

`absolute inset-0` means "the visible area" only if an ancestor is a containing
block. The underlay's parent is the desktop content column in `App.tsx`:

```jsx
<div className="flex-1 flex flex-col min-w-0 min-h-0">   // position: static
```

`static` → not a containing block → the underlay resolves against the initial
containing block: the whole viewport, INCLUDING the live sidebar beside the
column. The frozen subtree (a content-column subtree) therefore lays out from
`x=0` and collides with the sidebar's own header row.

## Decision

Make the desktop content column a containing block — add `relative`.

The underlay then covers exactly the content region, the frozen subtree lays out
at the same x/width it had when live, and the live sidebar stays visible (dimmed,
per the scrim) where it belongs. `Dialog`, `RouteBackedOverlay`, the z-scale and
the scrim are all left alone.

### Why the containing block, and not the panel or the scrim

Both presentation routes were implemented, measured, and rejected:

- **Full-bleed page panel** (panel `inset-0`, `max-w-none`, `rounded-none`, no
  border/shadow): product-rejected. Settings must stay a centered dialog card; it
  must not become a full-screen page.
- **Opaque backdrop** (`bg-[var(--bg-primary)]` as the scrim, and a solid base
  layer under `bg-black/60`): product-rejected. It hides the collision instead of
  fixing it, and the dialog and backdrop become the same colour — a flat
  full-screen sheet with an invisible card.

Both treat the symptom. The defect is positioning: two surfaces, one containing
block too high. Fixing the containing block removes the cause while keeping the
agreed presentation (centered card over a dimmed dashboard).

### Why the underlay is not "the whole shell"

The tempting alternative — freeze the sidebar too, so a viewport-sized underlay is
legitimate — cannot work: the sidebar and the right-hand editor rail render
OUTSIDE the `settingsMatch` gate and stay LIVE. Including them in the underlay
would render each twice.

### Why the underlay stays mounted

#536 relies on it to keep the launching route renderable and linkable, and to make
dismissal smooth. It stays `inert` + `aria-hidden`; only its geometry changes.

## Verification

- Measured on the running desktop instance (1568×992): underlay box `(0,1568)` →
  `(500,1068)`; frozen session title x `52` → `552`, matching its live position.
- Diagnostic: scrim painted solid red — every margin strip outside the card
  measured 100% covered, proving the scrim already covered the underlay. This is
  what ruled out the z-index hypothesis with pixels rather than reasoning.
- Regression: `tests/e2e/route-backed-overlay.spec.ts` geometry assertions.

## Risks

- `relative` on the column also becomes the containing block for any OTHER
  absolutely-positioned descendant of the column. Checked on the running instance:
  no `position: fixed` descendant exists inside the underlay, and the overlay's own
  surfaces (`Dialog`, dropdowns, toasts) are portaled to `document.body`, so they
  are unaffected.
- Desktop-only geometry. Mobile renders Settings as a `detailPanel` with no
  overlay, so the change is inert there.
