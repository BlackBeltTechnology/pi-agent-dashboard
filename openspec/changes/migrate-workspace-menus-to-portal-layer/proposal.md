## Why

Opening the folder-actions "+ New workspace…" flyout (`AddToWorkspaceMenu`) over
a session card renders the menu BEHIND a portaled sibling: the menu is a
`position:absolute` child carrying raw `z-50`, so it is trapped in its ancestor
stacking context and underlaps overlays that portal to the layer root at
`z-popover`. This is exactly the failure the `overlay-layering` spec describes,
and `AddToWorkspaceMenu.tsx|z-50` (with 8 sibling menus) is already an enumerated
entry on the shrink-only baseline in `scripts/z-layer-baseline.json` — the
migration backlog the spec's ratchet exists to burn down. The gate is already in
place; this change executes the pending work for the whole raw-`z-50` menu class.

## What Changes

- Migrate all 9 raw-`z-50` box-escaping menus to the sanctioned exemplar
  (`ModelSelector.tsx`): render through `LayerPortal`, position `fixed` from a
  `triggerRef` `usePopoverFlip` rect, stack at the `z-popover` token, use
  panelRef-first outside-click, and guard with `visibility: hidden` until the
  trigger rect is measured. Files:
  `workspace/AddToWorkspaceMenu`, `workspace/WorkspaceHeader`,
  `connectivity/ServerSelector`, `openspec/OpenSpecGroupPicker`,
  `openspec/OpenSpecBoardView`, `session/SessionHeader`,
  `shell/MobileActionMenu`, `settings/SettingsPanel`,
  `worktree/WorktreeActionsMenu`.
- Shrink `scripts/z-layer-baseline.json` by the 9 migrated `z-50` entries (the
  baseline may only shrink; removing an entry while a raw-z remains fails the
  guard, which pins each migration).

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
(none — executes the existing `overlay-layering` portal requirement and its
shrink-only baseline backlog; no spec-level behavior changes. `skip_specs: true`.)

## Impact

- `packages/client/src/components/**` — 9 menu components migrated to portal +
  token.
- `scripts/z-layer-baseline.json` — shrink by 9 migrated entries.
- Tests: one L1 vitest interaction test per migrated menu (portaled render +
  outside-click close + item-select handler), plus the existing z-layer baseline
  guard.

## Discipline Skills

- `review-code` — run the inline review before commit once tests pass.

No auth / untrusted-input / secrets / PII / latency-budget surface is touched, so
`security-hardening`, `performance-optimization`, and
`observability-instrumentation` do not apply.
