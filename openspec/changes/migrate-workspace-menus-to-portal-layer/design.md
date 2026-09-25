# Design — migrate-workspace-menus-to-portal-layer

## Context

Nine menu/popover components render their panel as a `position:absolute` child
carrying raw `z-50`:

| File | Panel |
|---|---|
| `workspace/AddToWorkspaceMenu.tsx` | folder "+ New workspace…" flyout |
| `workspace/WorkspaceHeader.tsx` | workspace overflow menu |
| `connectivity/ServerSelector.tsx` | server picker dropdown |
| `openspec/OpenSpecGroupPicker.tsx` | group picker dropdown |
| `openspec/OpenSpecBoardView.tsx` | per-session OS menu |
| `session/SessionHeader.tsx` | mobile attach menu |
| `shell/MobileActionMenu.tsx` | mobile action menu |
| `settings/SettingsPanel.tsx` | a provider/model sub-menu |
| `worktree/WorktreeActionsMenu.tsx` | worktree actions menu |

A raw z-index only orders siblings within the nearest ancestor stacking context.
When an ancestor establishes a context (`transform`, `isolate`, `opacity<1`,
`will-change`), the whole subtree competes as one box at the ancestor's rank, so
these panels can underlap a sibling overlay that portals to the layer root — even
one at a numerically LOWER token (`z-popover = 40 < 50`). `AddToWorkspaceMenu`
underlapping the portaled `FolderActionsMenu` is the reported instance.

The fix pattern is already sanctioned and shipped: `ModelSelector.tsx` is the
exemplar, and `overlay-layering` REQUIRES box-escaping overlays to portal +
reference a token. These 9 are enumerated on `scripts/z-layer-baseline.json` as
the pending migration backlog.

## Decision

Migrate each of the 9 to the exemplar pattern:

- Render the panel through `LayerPortal` — escapes every ancestor stacking
  context and any `overflow` clip; portals to the nearest `LayerHost`, else
  `document.body`.
- Add a `triggerRef` on the toggle button; position the panel `fixed` from the
  `usePopoverFlip(triggerRef, { open, … })` `triggerRect` (keep each panel's
  existing anchor — `right-0` / `left-0` — via the rect's `right`/`left`).
- Stack at the `z-popover` token, never raw `z-50`.
- Outside-click: check `panelRef` FIRST (a portaled panel is no longer a DOM
  descendant of the trigger container), then the trigger ref — mirrors
  ModelSelector.
- `visibility: hidden` until `triggerRect` is measured, so the panel never paints
  a frame at (0,0).

Then shrink `scripts/z-layer-baseline.json` by the 9 migrated `z-50` entries. The
guard fails if an entry is removed while a raw-z still remains in that file, which
pins each migration to its baseline deletion.

### Per-file caveats surfaced by cross-model review (NOT a uniform migration)

The 9 are **not** mechanically identical. The pattern above is the baseline; each
of these deviates and must be handled explicitly:

- **`AddToWorkspaceMenu` (nested-overlay, the reported bug)** — the flyout is
  rendered *inside* a `role="menuitem"` button that lives inside
  FolderActionsMenu's already-portaled panel (state in `SessionList.tsx`:
  `addToWsMenuFor`; terminal actions also `setFolderMenuFor(null)`). A
  `document.body` portal breaks FolderActionsMenu's `panelRef.contains()`
  outside-click → host menu closes mid-select. Fix path: FolderActionsMenu wraps
  its panel in a `LayerHostProvider`; the flyout uses `LayerPortal` to portal
  INTO that host (escapes the panel's `overflow-x-hidden` clip while staying in
  the host's stacking context + outside-click scope). The `triggerRef`/`open`
  live in `SessionList.tsx` — a file the migration MUST touch (not in the naive
  file list).
- **`SettingsPanel` dropdown** — left-anchored (`left-0`): must pass
  `preferredAnchor: "left"` to `usePopoverFlip` or it silently flips to
  right-anchor. It also sits under `useOverlayDismissGuard` / `DialogPortal`;
  verify the portaled dropdown's dismiss interplay with the dialog backdrop.
- **"Already import a portal primitive" is misleading** — `OpenSpecBoardView`,
  `MobileActionMenu`, `SettingsPanel` import `DialogPortal` (modal, body
  scroll-lock), NOT `LayerPortal`. There is only ONE real exemplar:
  `ModelSelector.tsx`. `DialogPortal` supplies no `LayerHost`.
- **Container-ref split** — `ServerSelector`, `WorkspaceHeader`, `SessionHeader`,
  `MobileActionMenu`, `SettingsPanel` today wrap trigger+panel in ONE ref for
  outside-click. Each must be split into `triggerRef` + `panelRef` (panelRef
  checked first) — none has a `triggerRef` today.
- **usePopoverFlip per-consumer params** — default `gap: 8` vs the inline menus'
  `mt-1` (4px) → pass `GAP=4`; default `minPopoverHeight: 120` renders dead space
  for 2–3 item menus (`AddToWorkspaceMenu`, `WorkspaceHeader`) → pass a `0`/short
  floor.
- **`WorktreeActionsMenu`** — the `z-50` sheet is mobile-only (desktop branch
  renders no menu); migrate the mobile form, leave the desktop branch.

### Baseline shrink is per-KEY, not per-file

`scripts/z-layer-baseline.json` is keyed `path|z-token`. `OpenSpecBoardView.tsx`
has BOTH `|z-10` (sticky header, in-flow, out of scope) and `|z-50` (the menu).
Remove only the 9 `|z-50` keys; leave every `|z-10`/`|z-20`/`|z-[N]` key. The
guard fails if a `|z-50` key is deleted while a raw `z-50` still remains in that
file, which pins each deletion to its migration.

### Test-migration budget

Existing vitest/e2e assertions that a menu is a DOM descendant of its
trigger/card/row will BREAK once panels move out via portal. Budget test
*updates*, not only net-new tests — audit each migrated component's existing
tests for containment assertions.

## Alternatives considered

- **Raise `z-50` → `z-popover` in place (no portal)**: fails — an ancestor
  stacking context still traps the panel, and the spec prohibits raw-z /
  inline box-escaping overlays. Rejected.
- **Only fix `AddToWorkspaceMenu` (the reported bug)**: leaves 8 identical latent
  defects on the baseline; the class recurs. Rejected in favor of clearing the
  whole raw-`z-50` menu class in one pass.
- **Introduce a new lint rule / gate**: unnecessary — the ratchet guard
  (`scripts/z-layer-lint.mjs`) and spec already exist; this change is the backlog
  execution, not new tooling.

## Risks

- Outside-click / focus for a portaled panel — mitigated by panelRef-first
  handling (proven in ModelSelector) and a per-menu interaction test.
- Anchor drift: panels that were `left-0` / `right-0` must reproduce that edge
  from `triggerRect`; covered by each menu's open+select test and manual QA.
- `SettingsPanel.tsx` is large; the migrated sub-menu must not disturb the
  surrounding provider/model UI — scoped edit + targeted test.
- Mobile sheets (`MobileActionMenu`, `SessionHeader` attach) — verify the portaled
  panel still anchors correctly at narrow width (manual QA row).
