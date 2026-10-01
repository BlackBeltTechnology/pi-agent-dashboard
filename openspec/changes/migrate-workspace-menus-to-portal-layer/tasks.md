## 1. Flagship — nested-overlay fix (validate the approach FIRST)

- [ ] 1.1 `FolderActionsMenu` wraps its portaled panel in a `LayerHostProvider`
  (host = the panel element via `useState` ref, like `Dialog`). See exemplar:
  `packages/client-utils/src/Dialog.tsx` (panelEl → LayerHostProvider).
- [ ] 1.2 `AddToWorkspaceMenu` renders its panel through `LayerPortal` (portals
  INTO the FolderActionsMenu host, not `document.body`), `fixed` from a
  `triggerRef` `usePopoverFlip` rect at `z-popover`, `GAP=4`, short/`0` height
  floor, panelRef-first outside-click, `visibility:hidden` pre-measure. Trigger
  lives in `SessionList.tsx` (`renderAddToWorkspaceButton`).
- [ ] 1.3 Remove `workspace/AddToWorkspaceMenu.tsx|z-50` from
  `scripts/z-layer-baseline.json`.

## 2. The other 8 menus (mirror ModelSelector; per-file caveats in design.md)

- [ ] 2.1 `workspace/WorkspaceHeader` → portal + `z-popover`, container-ref split,
  short height floor. Remove its `|z-50` baseline key.
- [ ] 2.2 `connectivity/ServerSelector` → portal + token, container-ref split.
  Remove `|z-50` key.
- [ ] 2.3 `openspec/OpenSpecGroupPicker` → portal + token. Remove `|z-50` key.
- [ ] 2.4 `openspec/OpenSpecBoardView` → portal + token (remove ONLY the `|z-50`
  key; leave `|z-10`).
- [ ] 2.5 `session/SessionHeader` (mobile attach menu) → portal + token,
  container-ref split. Remove `|z-50` key.
- [ ] 2.6 `shell/MobileActionMenu` → portal + token, container-ref split. Remove
  `|z-50` key.
- [ ] 2.7 `settings/SettingsPanel` dropdown → portal + token, `preferredAnchor:
  "left"`, verify `useOverlayDismissGuard`/`DialogPortal` dismiss interplay.
  Remove `|z-50` key.
- [ ] 2.8 `worktree/WorktreeActionsMenu` (mobile sheet only) → portal + token.
  Remove `|z-50` key.

## 3. Tests (L1 vitest — one interaction test per menu)

- [ ] 3.1 `AddToWorkspaceMenu` nested case: open from a folder row inside
  FolderActionsMenu; assert the flyout is portaled AND a click on a flyout item
  fires `onPick` WITHOUT the host FolderActionsMenu closing first. Triple:
  render folder menu · open flyout · click item · handler fired + host stable.
  (test-plan: automated) — home `session/__tests__/` or `folder/__tests__/`;
  exemplar `ModelSelector.test.tsx` + existing FolderActionsMenu test.
- [ ] 3.2 One interaction test each for WorkspaceHeader, ServerSelector,
  OpenSpecGroupPicker, OpenSpecBoardView menu, SessionHeader attach,
  MobileActionMenu, SettingsPanel dropdown, WorktreeActionsMenu sheet: portaled
  render + outside-click closes + item-select fires handler. (test-plan:
  automated) — sibling `__tests__` per component; exemplar `ModelSelector.test.tsx`.
- [ ] 3.3 Audit + update existing tests asserting DOM containment of a migrated
  menu (they break once portaled). (test-plan: automated)
- [ ] 3.4 z-layer baseline guard passes with the 9 `|z-50` keys removed and no
  new raw-z. Triple: run `node scripts/z-layer-lint.mjs` · after migration ·
  green, baseline shrunk by 9. (test-plan: automated) — reuse existing guard.
- [ ] 3.5 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` — TDD: new
  assertions fail pre-impl, pass post; no unrelated regressions.

## 4. Manual verification in a separate docker harness (post-build, before merge)

- [ ] 4.1 (test-plan: manual-only) Build client + bring up the docker all-in-one
  harness (isolated from the dev instance). Open each of the 9 menus and confirm
  it floats ABOVE its siblings, anchors to its trigger, dismisses on outside
  click / Escape, and its action fires. Flagship first: the WORKSPACE flyout no
  longer renders behind FolderActionsMenu.
