# Tasks — fix-settings-overlay-header-peek (#591)

## 1. Root cause

- [x] 1.1 Reproduce on the desktop instance (`localhost:8000`, production bundle):
  open a session, open Settings, capture the doubled/ghosted session header in the
  strip above the dialog card.
- [x] 1.2 Rule out the z-index hypothesis with pixels: paint the dialog scrim solid
  red and measure the margin strips outside the card. Result: 100% covered — the
  scrim already covered the underlay, so nothing painted "above" it.
  Triple: `settings-btn` → Settings · eval `backdrop.style.background='#ff0000'` ·
  `magick compare -metric AE -fuzz 18%` per margin strip → `0 (0)` for top/left/
  right/bottom.
- [x] 1.3 Locate the real cause: measure the underlay's box against its parent's.
  Result: underlay `(x=0, w=1568)` (full viewport) inside a `static` content column
  of `(x=500, w=1068)`; the frozen header lays out from x=0 over the live sidebar.
  Triple: `und.getBoundingClientRect()` · walk parents for the content column ·
  compare with the column's box.

## 2. Fix

- [x] 2.1 `packages/client/src/App.tsx` — add `relative` to the desktop content
  column (`flex-1 flex flex-col min-w-0 min-h-0`) so it is the overlay underlay's
  containing block, with a comment naming #591 and the failure mode.
- [x] 2.2 Leave `RouteBackedOverlay`, `Dialog`, the z-scale and the scrim unchanged
  (rejected alternatives are recorded in design.md).

## 3. Tests

- [x] 3.1 Add a geometry regression test to
  `tests/e2e/route-backed-overlay.spec.ts`: with Settings open, the
  `settings-overlay-underlay` box must have `x > 0` (not the viewport's left edge —
  that is the sidebar), `width < viewport width - 1` (not viewport-wide), and
  `x + width >= viewport width - 1` (still reaches the right edge, so this is
  containment, not shrinkage).
  Triple: `gotoDashboard` · click `settings-btn` · `boundingBox()`.
- [x] 3.2 Confirm no unit-suite regression: `packages/client` + `packages/client-utils`
  vitest projects, plus `tsc --noEmit`.
- [x] 3.3 Manual pre-merge check in the running dashboard: Settings stays a centered
  dialog card over a dimmed dashboard, the frozen header sits inside the content
  region, and the sidebar is no longer overlapped.
