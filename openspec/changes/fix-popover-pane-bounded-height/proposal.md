## Why

Popovers opened inside a scrollable pane (Settings page, chat composer) render past the pane's
`overflow` edge: the dropdown is visually cut off ("underlaps the view") and its absolutely-positioned
box grows the pane's scroll extent, so a **second scrollbar** appears and the pane stretches. Two
defects combine to cause it:

1. `PopoverBoundaryProvider` is mounted in exactly **one** place (`SplitWorkspace.tsx:112`), so the six
   boundary-aware consumers receive `undefined` everywhere else and silently measure against the
   **viewport** instead of their clipping pane.
2. `usePopoverFlip` computes `maxHeight = Math.max(MIN_POPOVER_HEIGHT, availableSpace)` — a floor
   applied **after** clamping, which can exceed the available space and overflow the pane even when a
   boundary *is* supplied. The current spec mandates this ("with a minimum floor (≈120px)").

Reproduced and validated against a browser mock of both surfaces before proposing.

## What Changes

- **BREAKING (internal hook contract)**: `usePopoverFlip` no longer inflates `maxHeight` with the
  minimum floor. `maxHeight` becomes the true available space in the chosen direction; the floor moves
  to a new returned `minHeight`, itself capped by the available space so it can never cause overflow.
- Raise the minimum popover height floor from ~120px to ~260px so a bounded popover is never a cramped
  sliver (the current floor yields unreadably short dropdowns in tight panes).
- Popover height becomes **content-driven within the bound**: `minHeight ≤ natural content height ≤ maxHeight`,
  expressed declaratively via CSS on a flex-column popover — no JS content measurement, no forced reflow
  on scroll. Overflow scrolls **inside** the popover's list, never the host pane.
- Mount `PopoverBoundaryProvider` at every scrollable pane that hosts popover consumers: the Settings
  panel scroll pane and the chat composer hosts outside `SplitWorkspace` (`App.tsx`,
  `DirectoryHomeView.tsx`, `ComposerSessionActions.tsx`).
- Establish the invariant that an open popover **never increases its host pane's scroll extent** —
  no second scrollbar, no container stretch.

Explicitly **not** changing: the vertical direction rule (downward default, flip up when
`spaceBelow < min(needed, 200px)` and above has more room) and the entire horizontal axis
(`anchorRight` / `maxWidth`). Both were verified to already produce correct results on the two failing
surfaces; leaving them untouched keeps the change surgical.

## Capabilities

### New Capabilities
- `popover-pane-boundary-provisioning`: Every scrollable / `overflow`-clipped pane that hosts popover
  consumers SHALL provide itself as the popover clipping boundary, and an open popover SHALL never grow
  its host pane's scroll extent (no second scrollbar).

### Modified Capabilities
- `popover-viewport-positioning`: The `maxHeight` floor semantics change — the minimum floor is no
  longer folded into `maxHeight` (where it can exceed available space and overflow the boundary) but
  returned separately as `minHeight`, capped by available space; the floor value is raised; popover
  height is content-driven between the two bounds.

## Impact

- `packages/client/src/hooks/usePopoverFlip.tsx` — return shape gains `minHeight`; `maxHeight` no longer
  floor-inflated; `MIN_POPOVER_HEIGHT` raised. Existing tests in
  `packages/client/src/hooks/__tests__/usePopoverFlip.test.ts` assert the old floor behavior and will need updating.
- **8 `usePopoverFlip` call sites** consume the changed return shape: `ModelSelector`,
  `ThinkingLevelSelector`, `ThemePicker`, `ChatViewMenu`, `CommandInput` (×2), `WorktreeActionsMenu`,
  `PackageRow`. Each must apply `minHeight` alongside `maxHeight` to gain the floor it previously got
  implicitly.
- `packages/client/src/components/settings/SettingsPanel.tsx` — scroll pane gains a ref + provider wrap.
  Note it currently nests two `overflow-y-auto` panes (lines 835, 858); the correct clip boundary must be
  determined before wrapping.
- Chat composer hosts gain a provider wrap: `App.tsx`, `components/folder/DirectoryHomeView.tsx`,
  `components/session/ComposerSessionActions.tsx`.
- No server, protocol, or persistence impact. Client-only, visual/layout behavior.

## Discipline Skills

- `performance-optimization` — the hook re-measures on window scroll/resize plus boundary
  `scroll`/`ResizeObserver`; the height rule must stay reflow-free (no `scrollHeight` reads in the
  measure path) so added panes don't introduce layout thrash on scroll.
- `doubt-driven-review` — changes a shared primitive behind 8 call sites; the `maxHeight`/`minHeight`
  contract split should be stress-tested before it stands.
- `review-code` — non-trivial cross-cutting client change; review before commit.
