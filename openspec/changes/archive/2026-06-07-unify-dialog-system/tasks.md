> Revised 2026-06-06. Primitives target `packages/client-utils`; plugins
> consume via the UI-primitive registry (no relative imports). See proposal.md
> chrome audit + design.md D1.

## 1. Build the Dialog primitive (in client-utils)

- [x] 1.1 Add `useFocusTrap(ref, open)` hook in `packages/client-utils/src/useFocusTrap.ts`: stores previous `document.activeElement`, focuses first focusable child on open, traps `Tab`/`Shift+Tab`, restores focus on close.
- [x] 1.2 Write unit tests for `useFocusTrap` (initial focus, Tab wrap, Shift+Tab wrap, focus restore).
- [x] 1.3 Add `Dialog.tsx` in `packages/client-utils/src/Dialog.tsx` with props `{ open, onClose, title?, icon?, size?, testId?, children, ariaLabel? }` and subcomponents `Dialog.Footer`, `Dialog.Cancel`, `Dialog.Action` (intent: primary | danger | neutral).
- [x] 1.4 Implement chrome inside `Dialog`: `DialogPortal` wrapper (import from `./DialogPortal.js`); sibling overlay `<div onClick=onClose data-testid="<id>-overlay" class="fixed inset-0 bg-black/60">`; container with `role="dialog" aria-modal="true" aria-labelledby?` at `z-[60]`, `bg-[var(--bg-primary)]`, `border-[var(--border-primary)]`, size→max-w map (sm/md/lg), `max-h-[80vh] overflow-y-auto`.
- [x] 1.5 Implement header (only rendered when `title` or `icon` set): icon in accent-tinted square + title `<h3 id={titleId}>`; wire `aria-labelledby` only when title is present.
- [x] 1.6 Implement Esc key listener (window keydown, removed on unmount/close).
- [x] 1.7 Implement intent → button class map for `Dialog.Action`: primary=`bg-[var(--accent-primary)]`, danger=`bg-red-600 hover:bg-red-500`, neutral=bordered transparent (matches Cancel).
- [x] 1.8 Write unit tests for `Dialog` in `packages/client-utils/src/__tests__/`: open/close, Esc, overlay click, container click does not dismiss, ARIA attrs, size classes, header renders/omits, intent classes, testId propagation incl. derived `-overlay`/`-cancel`/`-action`.
- [x] 1.9 Export `Dialog` (+ subcomponents) and `useFocusTrap` from `packages/client-utils` package entrypoints / per-file subpath exports, matching the existing `ConfirmDialog`/`DialogPortal` export style.

## 2. Build the Confirm preset + wire the registry

- [x] 2.1 Add `Confirm.tsx` in `packages/client-utils/src/Confirm.tsx` with props `{ open, onClose, title, message, body?, intent?, confirmLabel?, cancelLabel?, onConfirm, testId? }`.
- [x] 2.2 Implement `Confirm` as a composition over `Dialog` (size="sm"); render message paragraph, optional `body` node, footer with `Dialog.Cancel` + `Dialog.Action`.
- [x] 2.3 Wire callbacks: action → `onConfirm` only (no auto-close); cancel/Esc/overlay → `onClose`.
- [x] 2.4 Defaults: `intent="primary"`, `confirmLabel="Confirm"`, `cancelLabel="Cancel"`.
- [x] 2.5 Write unit tests for `Confirm`: title/message render, body slot, intent maps to action button class, button wiring per spec, default labels, testId derived ids.
- [x] 2.6 **Re-skin the registered `ui:confirm-dialog` primitive** without contract change. In `packages/client/src/main.tsx`, register an adapter for `UI_PRIMITIVE_KEYS.confirmDialog` that satisfies `UiConfirmDialogProps` (`{ message, confirmLabel?, onConfirm, onCancel }`), mapping `onCancel → onClose` and rendering `Confirm`/`Dialog` (no title). Verify type-check against `UiConfirmDialogProps`.
- [x] 2.7 **Add additive `ui:dialog` registry key.** In `packages/shared/src/dashboard-plugin/ui-primitives.ts` add `dialog: "ui:dialog"` to `UI_PRIMITIVE_KEYS` and a `UiDialogProps` contract mirroring `Dialog`'s public props. Register the `Dialog` implementation in `main.tsx`. Add a contract/registration test alongside the existing ui-primitive tests.
- [x] 2.8 Confirm plugins consuming `ui:confirm-dialog` (`flows-plugin/SessionFlowActions.tsx`, `flows-plugin/FlowsCommandRoutes.tsx`) render correctly with the re-skinned adapter — **no source edits expected**; update their tests only if assertions reference old chrome.

## 3. Migrate Era-1 confirm dialogs (host call sites)

- [x] 3.1 Replace `ConfirmDialog` usage in `packages/client/src/App.tsx` with `Confirm` (verify whether the import is live or dead; remove if dead).
- [x] 3.2 Replace `ConfirmDialog` usage in `packages/client/src/components/SessionOpenSpecActions.tsx` (3 sites).
- [x] 3.3 Replace `ConfirmDialog` usage in `packages/client/src/components/ComposerSessionActions.tsx`.
- [x] 3.4 Replace `ConfirmDialog` usage in `packages/client/src/components/FolderActionBar.tsx` (imports from `client-utils/ConfirmDialog`).
- [x] 3.5 Replace `ConfirmDialog` usage in `packages/client/src/components/OpenSpecGroupManager.tsx`.
- [x] 3.6 Replace `ConfirmDialog` usage in `packages/client/src/components/WorktreeInitButton.tsx` (imports from `client-utils/ConfirmDialog`).
- [x] 3.7 Replace `ConfirmDialog` usage in `packages/client/src/components/extension-ui/GenericExtensionDialog.tsx`.
- [x] 3.8 Migrate `packages/jj-plugin/src/client/JjActionBar.tsx`: replace `JjForgetConfirmDialog` with the `ui:dialog`/`ui:confirm-dialog` primitive (use `body={<ul>…unfolded…</ul>}` + `intent="danger"` via `ui:dialog` if rich body needed). Delete `JjForgetConfirmDialog.tsx`; update `packages/jj-plugin/src/client/index.tsx` exports.
- [x] 3.9 Migrate `JjFoldBackDialog` caller in `JjActionBar.tsx` to the primitive. Delete `JjFoldBackDialog.tsx`, its `__tests__`, and `index.tsx` export.
- [x] 3.10 Migrate the confirm step inside `packages/flows-plugin/src/client/FlowLaunchDialog.tsx` (currently hand-wires `ui:dialog-portal`) to the `ui:dialog` primitive.
- [x] 3.11 Update tests: `packages/client/src/components/__tests__/Dialogs.test.tsx`, `packages/client/src/__tests__/extension-ui-modal.test.tsx`, and `packages/jj-plugin/src/__tests__/JjFoldBackDialog.test.tsx` to drive `Confirm`/primitive.
- [x] 3.12 Delete the `packages/client/src/components/ConfirmDialog.tsx` shim and fold `packages/client-utils/src/ConfirmDialog.tsx` source into `Confirm` (keep the registered primitive working via the 2.6 adapter). Verify `rg "from .*['\"](\\.\\.?/)*ConfirmDialog"` returns no hits, and `rg "JjForgetConfirmDialog|JjFoldBackDialog"` returns no source hits outside changelog/specs.
- [x] 3.13 Run `npm test` and `npm run reload:check`; fix fallout.

## 4. Migrate Era-3 dialogs to the Dialog shell

- [x] 4.1 `PackageInstallConfirmDialog` → re-implement on top of `Dialog` (size sm) with header icon, body table, scope picker, and `Dialog.Footer`. Preserve `data-testid="package-install-confirm-dialog"` on the container. (Used by `SettingsPanel`, `PiResourcesView`.)
- [x] 4.2 `PackageReadmeDialog` → use `Dialog` (size lg) with title from package name; body keeps current README markdown rendering.
- [x] 4.3 `QrCodeDialog` → use `Dialog` (size sm), QR + URL in body.
- [x] 4.4 `WhatsNewDialog` → use `Dialog` (size md/lg), changelog body. Preserve existing dismissal/seen behaviour.
- [x] 4.5 Update `__tests__/UnifiedPackagesSection.test.tsx`, `PackageInstallConfirmDialog.test.tsx`, `QrCodeDialog.test.tsx`, `WhatsNewDialog.test.tsx`, `Dialogs.test.tsx`, `MobileActionMenu.test.tsx` to assert the new chrome (overlay `bg-black/60`, role, aria-modal, `z-[60]`) where they currently assert it.

## 5. Migrate Era-2 dialogs

- [x] 5.1 `BranchSwitchDialog` → wrap each step's content + footer inside one `Dialog` (size sm). Step state machine unchanged. Confirm buttons adopt accent (primary) intent; switch off `bg-black/50`/`z-50`.
- [x] 5.2 `GroupedAttachDialog` → `Dialog` shell (switch off `bg-black/50`/`z-50`).
- [x] 5.3 `NewChangeDialog` → `Dialog` shell, primary action.
- [x] 5.4 `PinDirectoryDialog` → `Dialog` shell.
- [x] 5.5 `ExploreDialog` → `Dialog` shell.
- [x] 5.6 `NewWorkspaceDialog` → `Dialog` shell.
- [x] 5.7 `WorktreeSpawnDialog` → `Dialog` shell.
- [x] 5.8 `CloseWorktreeDialog` → `Dialog` shell.
- [x] 5.9 `MergeConfirmDialog` → `Confirm` (or `Dialog` if richer body). Update `WorktreeActionsMenu` caller.
- [x] 5.10 `SearchableSelectDialog` (client-utils) → `Dialog` shell, preserve search input + list rendering. This is also the `ui:searchable-select-dialog` primitive — keep its contract intact; plugins consume it unchanged.
- [x] 5.11 Update each dialog's existing tests in `packages/client/src/components/__tests__/` and `packages/client-utils/src/__tests__/` (`BranchSwitchDialog.test.tsx`, `PinDirectoryDialog.test.tsx`, `NewChangeDialog.test.tsx`, `CloseWorktreeDialog.test.tsx`, `MergeConfirmDialog.test.tsx`, `WorktreeSpawnDialog.test.tsx`, etc.) to keep passing; assert new ARIA + Esc.

## 6. Cleanup, validation, docs

- [x] 6.1 Search for any remaining `bg-[var(--bg-overlay)]`, `bg-black/50`, `bg-black/60`, ad-hoc `z-[60]` / `z-50` dialog roots in `packages/client/src/components`, `packages/client-utils/src`, and `packages/*/src/client` — verify only the new `Dialog` is responsible for these classes.
- [x] 6.2 Manual visual sweep: open every migrated dialog in dev mode (light + dark theme, mobile viewport + desktop). Note any layout regressions.
- [x] 6.3 Run full test suite: `npm test 2>&1 | tee /tmp/pi-test.log` and grep for failures.
- [x] 6.4 Run `npm run reload:check` to type-check and reload bridges.
- [x] 6.5 Update `docs/architecture.md` and the `docs/file-index-client.md` / `docs/file-index-plugins.md` splits to list `Dialog.tsx`, `Confirm.tsx`, `useFocusTrap.ts` (in client-utils) and the new `ui:dialog` registry key; mark `ConfirmDialog.tsx` shim removed. (Delegate `docs/` writes per AGENTS.md.)
- [x] 6.6 Update `README.md` if it mentions `ConfirmDialog` (unlikely but check).
- [x] 6.7 Run `openspec validate unify-dialog-system --strict` and confirm clean.
