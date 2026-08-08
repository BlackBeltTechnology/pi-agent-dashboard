## Why

A selected user-tag chip in the sidebar "Your tags" filter group renders its selection
indicator as a heavy, near-black box that clashes with the chip's own palette color. The
ring is drawn on an uncolored wrapper element, so `outline-current` resolves against the
inherited sidebar text color instead of the tag color — the selected state reads as a
rendering defect rather than an intentional affordance.

## What Changes

- Fix the selected-state ring on `filter` chips so its color derives from the tag's own
  palette color (`tagColor(label)`) instead of inheriting the ambient text color.
- Reduce the selection ring weight so it reads as a selection affordance on an 11px pill
  rather than a boxed outline.
- Keep the ring on the wrapper element for the `filter` + `tone="user"` + `onRemove`
  configuration, so the toggle and the destructive ✕ stay enclosed as one unit (the
  existing overflow/no-wrap behavior is preserved).
- No change to selection *behavior*, `aria-pressed`, keyboard operability, the
  global-delete ✕, or tag persistence.

## Capabilities

### New Capabilities
<!-- none: this is a visual-affordance correction to an existing capability -->

### Modified Capabilities
- `session-tags`: adds a requirement that a selected filter chip's selection indicator be
  visually distinguishable AND derived from that chip's own tag color, so the indicator is
  correct in every theme and for both the plain and remove-enabled chip layouts.

## Discipline Skills

- `review-code`: non-trivial shared-primitive change — review the diff once tests pass and
  before committing.

## Impact

- `packages/client/src/components/tags/TagChip.tsx` — the `selRing` construction and the
  `filter` + `tone="user"` + `onRemove` wrapper branch.
- `packages/client/src/components/tags/__tests__/tags-components.test.tsx` — add coverage
  asserting the selected ring color tracks `tagColor(label)` in the remove-enabled layout.
- No server, protocol, or persistence surface is touched. `tagColor` / `TAG_PALETTE` in
  `packages/shared/src/tags.ts` are consumed unchanged (no palette reorder — that would
  re-hue every existing tag).
- Affected surface is the sidebar filter group (`TagFilterGroup` with `tone="user"` +
  `onRemove`); the read-only phase group and the card/detail strips are unchanged.
