# Stop the frozen underlay colliding with the live sidebar in route-backed overlays (#591)

## Why

Opening **Settings** (and the other route-backed page overlays: folder settings,
file/URL previews, the deep-linked OpenSpec artifact) garbles the session header.
The session title, the view tabs and the tag chips render **doubled/ghosted,
offset from themselves**, in the strip above the dialog card. Users read this as
"some text is brought over the dialog by accident" (GitHub #591).

Root cause is a **containing block**, not a z-index collision and not the scrim:

- `RouteBackedOverlay` renders the frozen launching surface as an inert
  `absolute inset-0` underlay.
- Its parent — the desktop content column in `App.tsx`
  (`flex-1 flex flex-col min-w-0 min-h-0`) — is `position: static`, so it is NOT a
  containing block. The underlay resolves `inset-0` against the initial containing
  block, i.e. the **whole viewport**: measured `(x=0, w=1568)` instead of the
  content region `(x=500, w=1068)` on a 1568px viewport with a 500px sidebar.
- The frozen subtree is a content-column subtree, so it lays out **from x=0 — on
  top of the live sidebar**, which is still rendered. Two surfaces paint the same
  pixels: the frozen header (`merge`, `Chat/Split/Editor`, `Seek`, `#merge` /
  `#resume` chips) collides with the sidebar's own header row, producing the
  doubled, unreadable text.

Evidence (desktop instance, 1568×992):

| Signal | Before | After |
|---|---|---|
| Underlay box | `x=0, w=1568` (full viewport) | `x=500, w=1068` (content region) |
| Frozen session title x | `52` (over the sidebar) | `552` (where it sat live) |
| Margin strips with scrim painted solid red | 100% covered | 100% covered |

The red-scrim measurement is what rules out the z-index hypothesis: the scrim
already covered the whole underlay. The underlay was **mispositioned**, so its
content occupied pixels that belong to another surface.

This is a layout/containment bug with no requirement change — `skip_specs: true`.

## What Changes

- `packages/client/src/App.tsx` — make the desktop content column a containing
  block (`relative`), so a route-backed overlay's underlay covers exactly the
  content region the launching surface occupied. One class; `RouteBackedOverlay`
  and `Dialog` are untouched, as are the z-scale and the scrim.
- Regression test in `tests/e2e/route-backed-overlay.spec.ts` — geometry: the
  underlay must not start at the viewport's left edge, must not span the full
  viewport width, and must still reach the viewport's right edge. jsdom has no
  layout engine, so this can only be pinned in a real browser.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
(none — pure layout conformance fix; `skip_specs: true`.)

## Impact

- `packages/client/src/App.tsx` — `relative` on the desktop content column.
- `tests/e2e/route-backed-overlay.spec.ts` — new geometry test.
- Desktop-only surface: the mobile shell renders Settings as a `detailPanel` and
  never goes through `RouteBackedOverlay`.
- Rejected alternatives (implemented and measured, not assumed): a full-bleed page
  panel, and an opaque/app-background scrim. See design.md.

## Discipline Skills

- `review-code` — run the inline review before commit once tests pass.

No auth / untrusted-input / secrets / PII / latency-budget surface is touched, so
`security-hardening`, `performance-optimization`, and
`observability-instrumentation` do not apply.
