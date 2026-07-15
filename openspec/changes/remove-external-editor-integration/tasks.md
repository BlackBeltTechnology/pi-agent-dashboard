# Tasks — remove-external-editor-integration

## 1. Server: delete external-editor subsystem

- [ ] 1.1 Delete `packages/server/src/editor-manager.ts`, `editor-registry.ts`, `editor-detection.ts`, `editor-pid-registry.ts`, `editor-proxy.ts` (+ their `.AGENTS.md` sidecars) → verify: files gone
- [ ] 1.2 Delete `packages/server/src/editor-keeper/` (whole dir: `keeper-manager.ts`, `keeper.cjs`, `__tests__/`, `AGENTS.md`) → verify: dir gone
- [ ] 1.3 Delete `packages/server/src/routes/editor-routes.ts` (+ sidecar) → verify: file gone
- [ ] 1.4 Delete server editor tests: `__tests__/editor-detection.test.ts`, `editor-manager.test.ts`, `editor-settings-seeding.test.ts`, `editor-registry.test.ts`, `editor-pid-registry-cmdline.test.ts`, `editor-endpoints.test.ts`, `editor-manager-keeper.test.ts` → verify: gone
- [ ] 1.5 De-wire `packages/server/src/server.ts`: remove editor imports (detect/manager/pidRegistry/proxy/routes), `editorManager`+`editorPidRegistry` creation, `registerEditorRoutes`/`registerEditorProxy`, the `editor` case in the WS upgrade switch + the scope allow-list entry, boot `adoptOrphans`/`cleanupOrphans`, and `editorManager.stopAll()` on shutdown; remove the `editor` field from the server config type/usage → verify: `rg -n 'editor(Manager|Proxy|PidRegistry|Detection|Routes)|/editor/|code-server' packages/server/src` returns clean

## 2. Shared: drop editor config + types

- [ ] 2.1 `packages/shared/src/config.ts`: remove `EditorConfig`, `DEFAULT_EDITOR_CONFIG`, `parseEditorConfig`, `parseEditorConfigForTest`, the `editor` field from `DashboardConfig` + its default, and the `parsed.editor` read in `parseConfig` → verify: no `editor` refs remain in config.ts
- [ ] 2.2 Delete `packages/shared/src/editor-types.ts` and its `dist/` artifacts → verify: `rg -n 'editor-types' packages` returns clean
- [ ] 2.3 Delete/adjust `packages/shared/src/__tests__/config-editor.test.ts` → verify: gone
- [ ] 2.4 Type-check shared + server (`tsc --noEmit` for both) → verify: passes

## 3. Client: folder-scoped internal pane (the redirect target)

- [ ] 3.1 Add `folderPaneId(cwd)` helper (namespaced `folder:<cwd>` key) in `packages/client/src/lib/` → verify: unit test asserts prefix + disjoint from UUID session ids
- [ ] 3.2 Add `FolderEditorView` component: wraps `SplitWorkspaceProvider` with `sessionId={folderPaneId(cwd)}`, `cwd`, omitting `onWatchFiles`/`fileResults`/`changedFiles`; renders `<EditorPane />` full-width; keeps `onClose` → verify: renders pane rooted at cwd
- [ ] 3.3 `App.tsx`: swap the `/folder/:cwd/editor` content from `EditorView` → `FolderEditorView` (both mobile + desktop branches) → verify: route mounts internal pane
- [ ] 3.4 Confirm folder pane has NO changed-on-disk banner and Refresh reloads content (Non-Goal v1) → verify: manual/QA

## 4. Client: de-branch file-open entry points

- [ ] 4.1 `useFileOpenRouting.ts` + `FileLink.tsx`: delete the `isLocalhost() && editors.length>0 → openEditor(...)` branch; route to `openInSplit`/preview only; drop the `editors` input → verify: FileLink test updated (no `openEditor` call)
- [ ] 4.2 `OpenFileButton.tsx`: remove the native-editor caret dropdown + `openEditor` import; render a plain button whose click opens the internal pane (`openInSplit` or `buildEditorUrl`) → verify: OpenFileButton test asserts internal-pane open, no `openEditor`
- [ ] 4.3 `editor-pane/BinaryWarn.tsx`: remove the `fetchEditors` call + "Open in <name>" native-editor buttons; keep the binary-file notice → verify: renders notice, no editor buttons
- [ ] 4.4 `tool-renderers/types.ts`: remove the `editors` field → verify: type-check

## 5. Client: strip `editors`/`nativeEditors` prop threading + external components

- [ ] 5.1 `FolderActionBar.tsx`: remove `editorStatus`, `editorAvailable`, `nativeEditors`, `onOpenNativeEditor`, the native-editor button map, and code-server status coloring; keep the `[Editor]` button (now plain, navigates to `/folder/:cwd/editor`) → verify: FolderActionBar test updated
- [ ] 5.2 Remove `editors` prop threading from `SessionCard.tsx`, `SessionHeader.tsx`, `MobileActionMenu.tsx`, `SessionList.tsx` → verify: type-check
- [ ] 5.3 `App.tsx`: delete `/api/editor/detect` + `/api/editor/status` fetches, `useEditors`, `editorMap`, the `editor_status` subscription, and `openEditor` imports → verify: `rg -n 'editor-api|use-editors|openEditor|editor_status|/api/editor' packages/client/src` returns clean
- [ ] 5.4 Delete `EditorView.tsx` (+ test), `EditorInstallGuide.tsx`, `lib/editor-api.ts` (+ test), `lib/use-editors.ts` → verify: gone
- [ ] 5.5 Verify `interactive-renderers/EditorRenderer.tsx`: if it targets the external editor, delete it; if unrelated, leave it (design Open Question) → verify: decision recorded, no dangling refs
- [ ] 5.6 Prune external-launcher `editor.*` i18n keys from `i18n.tsx`, `i18n-hu.ts`, `i18n-en-source.json`, `i18n-legacy-aliases.ts` (keep any reused by the internal pane) → verify: no unused-key lint / type-check

## 6. Docker

- [ ] 6.1 `docker/Dockerfile`: remove the `code-server` install layer + any `code-server` env/launch wiring → verify: `rg -n 'code-server' docker/Dockerfile` clean
- [ ] 6.2 Update `docker/README.md` + `docker/AGENTS.md` (drop code-server mentions) → verify: `rg -in 'code-server' docker/` returns only historical/none

## 7. Tests + build

- [ ] 7.1 Update remaining client tests referencing editors: `FolderActionBar.test.tsx`, `FolderActionBar-cleanup-broken.test.tsx`, `OpenFileButton.test.tsx`, `FileLink.test.tsx`, `SettingsPanel.test.tsx` → verify: updated/passing
- [ ] 7.2 Add folder-scoped pane coverage: `folderPaneId` disjointness + `FolderEditorView` mounts pane rooted at cwd + state persists under the folder key → verify: new tests pass
- [ ] 7.3 Run `npm test 2>&1 | tee /tmp/pi-test.log`; `grep -nE 'FAIL|Error|✗' /tmp/pi-test.log` → verify: no failures
- [ ] 7.4 `npm run build` (client) + type-check all packages → verify: clean build

## 8. Docs + spec sync (per Documentation Update Protocol)

- [ ] 8.1 Update per-directory `AGENTS.md` rows for every deleted/edited file (server editor modules, keeper dir, client editor components/libs, shared config/types, docker) — delete rows for removed files, edit rows for changed ones → verify: `kb dox lint` clean for touched dirs
- [ ] 8.2 Update `docs/architecture.md` editor sections (delegated per Rule 6 caveman-style) to describe internal-pane-only file opening → verify: no external-editor/code-server references remain
- [ ] 8.3 Run `openspec validate remove-external-editor-integration` → verify: valid

## 9. Gates + QA

- [ ] 9.1 `doubt-driven-review` on the `FolderEditorView` + `folderPaneId` state model before it stands → verify: review notes recorded
- [ ] 9.2 `code-simplification` pass: no orphaned imports/props/state after de-wiring → verify: `npm run quality:changed` clean
- [ ] 9.3 QA: folder `[Editor]` opens the internal pane; OpenFileButton/FileLink open internal; no `/editor/` proxy responds; Docker image builds without code-server → verify: manual/e2e
- [ ] 9.4 Code-review gate on the diff (`review-changes.ts`) → verify: no Critical/Warning outstanding
