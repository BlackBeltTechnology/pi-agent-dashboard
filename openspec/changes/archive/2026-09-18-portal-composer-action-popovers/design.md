# Design — portal-composer-action-popovers

## Context

`CommandInput.tsx` renders three popover groups inline:

- command/file autocomplete lists — `absolute left-3 right-3 … z-10`, flip via
  `usePopoverFlip(composerRef)`.
- `＋` attach menu — `absolute bottom-full … z-20`.
- mobile `⋯` overflow menu — `absolute right-0 bottom-full … z-20`.

All are `position:absolute` inside the composer, which sits in a `flex-col
overflow-hidden` chat column. A raw z-index only orders siblings within the
nearest stacking context, so these panels underlap the sticky quota usage bar and
are clipped by the column — exactly the failure `overlay-layering` describes.

#635 already fixed the model + thinking-level selectors with the sanctioned
pattern; `ModelSelector.tsx` is the exemplar.

## Decision

Migrate all three groups to the exemplar pattern:

- Render each panel through `LayerPortal` (escapes ancestor stacking contexts +
  the overflow clip; portals to the nearest layer host, else `document.body`).
- Position `fixed` from the trigger's `usePopoverFlip` `triggerRect` (each menu
  gets a `triggerRef` on its button; the autocomplete already flips against
  `composerRef` and keeps its `left/right` inset semantics via the rect).
- Stack at `z-popover` (token), not raw `z-10`/`z-20`.
- Outside-click: check `panelRef` FIRST (a portaled panel is no longer a DOM
  descendant of the trigger container), then the trigger ref — same as
  ModelSelector.
- `visibility: hidden` until `triggerRect` is measured, so no (0,0) flash.

Then shrink `scripts/z-layer-baseline.json` by the four migrated
`CommandInput.tsx` entries (`z-10`×2, `z-20`×2). The guard fails if a migrated
entry is removed from the baseline but a raw-z still remains, which pins the
migration.

## Alternatives considered

- **Raise z to `z-popover` in place (no portal)**: fails — the `overflow-hidden`
  chat column still clips the panel, and the spec prohibits raw-z / inline
  box-escaping overlays. Rejected.
- **Portal only the `⋯`/`＋` menus, leave autocomplete inline**: leaves two
  baseline entries and the same clip class for the autocomplete lists. Do all
  four so the baseline shrinks cleanly.

## Risks

- Outside-click / focus for a portaled panel: mitigated by panelRef-first
  handling (proven in ModelSelector).
- The autocomplete lists span `left-3 right-3` (full composer width); the
  portaled version must reproduce that width from `triggerRect`/`maxWidth` rather
  than the inline insets. Covered by an interaction test that the list still opens
  and selects.
