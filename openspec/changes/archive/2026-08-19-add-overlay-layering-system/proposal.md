## Why

Overlays in the dashboard client **underlap** — an open popover, dropdown, or folder flyout paints
*behind* neighbouring session cards instead of above them (see the folder-actions / session-settings
underlap). The root cause is systemic, not a single component:

1. **No z-index scale.** The client uses **13 distinct ad-hoc z values** (`z-0 z-[1] z-10 z-[2] z-20
   z-30 z-40 z-50 z-[60] z-[70] z-[80] z-[100] z-[9999]`) across **28 overlay components**, each author
   picking a number by guess. There is no named layer taxonomy and no `--z-*` token, so nothing tells a
   future author which number an overlay should use, or that the number even matters.
2. **The z-index number is a lie inside a stacking context.** `z-50` only orders siblings *within the
   nearest ancestor stacking context*. `FolderActionsMenu` renders its desktop panel **inline** as
   `position:absolute z-50`, so a neighbouring card that establishes its own stacking context
   (`transform`, `will-change`, `opacity<1`, or its own `z-*`) paints over it regardless of the 50. The
   *mobile* path of the very same component portals the panel to `<body>` (`DialogPortal`) and is
   correct — proving the fix is **portal-or-perish**, not a bigger number.

There is no spec that encodes any of this, so `kb_search "z-index"` / `"underlap"` / `"overlay"` returns
nothing prescriptive and every agent re-derives (or re-breaks) the layering. This change installs the
missing source of truth and fixes the concrete defect.

## What Changes

- **New named layer scale** exposed as CSS custom properties (`--z-base`, `--z-raised`, `--z-sidebar`,
  `--z-overlay`, `--z-popover`, `--z-dialog`, `--z-toast`, `--z-lightbox`) with a matching Tailwind
  utility set, so overlays reference an ordinal token instead of a magic number.
- **Portal-or-perish rule**: any overlay that can extend past its parent's box (menu, popover, dropdown,
  folder flyout, dialog, toast, lightbox) MUST render through a portal to a top-level layer root — never
  inline `position:absolute`. This is what actually prevents underlap; the token only orders portaled
  layers relative to each other.
- **Fix the concrete defect**: `FolderActionsMenu` desktop panel portals like its mobile path and adopts
  the `popover` layer token, so it can no longer underlap session cards.
- **Migrate the already-portaled overlays (Tier A, ~15)** to the token scale, collapsing their raw
  values onto the named layers. The ~12 inline-`absolute` popovers (Tier B) that need a fixed-coordinate
  portal rewrite, plus `FilePreviewOverlay` (its `z-[70]` intentionally sits above dialog `z-[60]`), are
  DEFERRED to a follow-up change (`portal-inline-popovers`) and captured in the lint baseline.
- **Prohibit NEW raw z**: raw `z-[NNNN]` / ad-hoc numeric z on portaled surfaces becomes lint-guarded via
  a **frozen baseline ratchet** — the current occurrences are the baseline (and the migration backlog);
  the guard fails on new additions. The baseline may only shrink.
- **Underlap invariant**: an open overlay SHALL paint above sibling cards regardless of the sibling's
  stacking context — encoded as a scenario, not left to reviewer memory.

This change is **phased**: it lands the foundation + the concrete `FolderActionsMenu` underlap fix +
discoverability + Tier-A swaps. The Tier-B portal rewrite is a separate change so the spec is TRUE on
merge (the portal rule governs new/modified overlays now; pre-existing inline popovers are a bounded,
shrinking, lint-tracked allowlist — see the spec's migration boundary).

Explicitly **not** changing: in-flow, non-portaled decorations that legitimately order *within* their
own parent (e.g. a sticky header's `z-10`, a scrollbar shim's `z-[1]`); the escape-dismiss contract in
`modal-escape-dismiss`; the popover boundary/height work in `popover-pane-boundary-provisioning`.

## Capabilities

### New Capabilities
- `overlay-layering`: The dashboard client SHALL define a single named z-index layer scale, require every
  new/modified box-escaping overlay to portal to a top-level layer root (pre-existing inline popovers are
  a bounded, shrinking, lint-tracked allowlist), and guarantee an open overlay paints above sibling
  content regardless of ancestor stacking contexts (no underlap).

## Impact

- **New**: a layer-token module (CSS custom properties + Tailwind utilities) and a shared portal layer
  root, plus a lint rule rejecting raw `z-[NNNN]` / ad-hoc `z-50` on portaled overlays.
- `packages/client/src/components/folder/FolderActionsMenu.tsx` — desktop panel moves from inline
  `absolute z-50` to a portaled `popover`-layer surface (mobile path already portals; converge them).
- **~15 already-portaled overlays (Tier A)** migrate to tokens now — `ImageLightbox`
  (`z-[9999]`→`lightbox`), `ToastSlot`/`Toast`/`DiagnosticsSection`/`SpawnErrorToastHost`
  (`z-[100]`/`z-[80]`/`z-50`→`toast`), `OpenSpecBoardView` modals (`z-[60]`→`dialog`),
  `ResourceTrustDialog`/`FirstLaunchDisplayModal`/`GenericExtensionDialog`/`SettingsPanel` modal
  (`z-50`→`dialog`), `TasksPopover`/`MobileActionMenu` (`popover`), `MobileOverlay`/`WorktreeInitStack`
  (`overlay`/`sidebar`). Tier-B inline popovers + `FilePreviewOverlay` are DEFERRED (allowlisted).
- `docs/architecture.md` gains the layer-scale reference; the client-components `AGENTS.md` tree rows
  gain the layering keywords so `kb_search` routes future authors to the spec before they add an overlay.

## Discipline Skills

- `frontend-mockup-loop` (dashboard adapter) — the migration is a cross-screen visual-consistency pass;
  verify each converted overlay renders above siblings at mobile/tablet/desktop widths.
- `systematic-debugging` — the underlap is a stacking-context bug; confirm root cause (portal vs number)
  on the concrete `FolderActionsMenu` case before generalising the fix.
- `review-code` — a 28-component migration is exactly the non-trivial diff the inline review loop guards
  before commit.
