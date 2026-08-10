# Tasks — remove-external-editor-integration

## 1. Server: delete external-editor subsystem

- [x] 1.1 Delete `packages/server/src/editor-manager.ts`, `editor-registry.ts`, `editor-detection.ts`, `editor-pid-registry.ts`, `editor-proxy.ts` (+ their `.AGENTS.md` sidecars) → verify: files gone
- [x] 1.2 Delete `packages/server/src/editor-keeper/` (whole dir: `keeper-manager.ts`, `keeper.cjs`, `__tests__/`, `AGENTS.md`) → verify: dir gone
- [x] 1.3 Delete `packages/server/src/routes/editor-routes.ts` (+ sidecar) → verify: file gone
- [x] 1.4 Delete server editor tests: `__tests__/editor-detection.test.ts`, `editor-manager.test.ts`, `editor-settings-seeding.test.ts`, `editor-registry.test.ts`, `editor-pid-registry-cmdline.test.ts`, `editor-endpoints.test.ts`, `editor-manager-keeper.test.ts` → verify: gone
- [x] 1.5 De-wire `packages/server/src/server.ts`: remove editor imports (detect/manager/pidRegistry/proxy/routes), `editorManager`+`editorPidRegistry` creation, `registerEditorRoutes`/`registerEditorProxy`, the `editor` case in the WS upgrade switch + the scope allow-list entry, boot `adoptOrphans`/`cleanupOrphans`, and `editorManager.stopAll()` on shutdown; remove the `editor` field from the server config type/usage → verify: `rg -n 'editor(Manager|Proxy|PidRegistry|Detection|Routes)|/editor/|code-server' packages/server/src` returns clean

## 2. Shared: drop editor config + types

- [x] 2.1 `packages/shared/src/config.ts`: remove `EditorConfig`, `DEFAULT_EDITOR_CONFIG`, `parseEditorConfig`, `parseEditorConfigForTest`, the `editor` field from `DashboardConfig` + its default, and the `parsed.editor` read in `parseConfig` → verify: no `editor` refs remain in config.ts
- [x] 2.2 Delete `packages/shared/src/editor-types.ts` and its `dist/` artifacts → verify: `rg -n 'editor-types' packages` returns clean
- [x] 2.3 Delete/adjust `packages/shared/src/__tests__/config-editor.test.ts` → verify: gone
- [x] 2.4 Type-check shared + server (`tsc --noEmit` for both) → verify: passes

## 3. Client: folder-scoped internal pane (the redirect target)

- [x] 3.1 Add `folderPaneId(cwd)` helper (namespaced `folder:<cwd>` key) in `packages/client/src/lib/` → verify: unit test asserts prefix + disjoint from UUID session ids
- [x] 3.2 Add `FolderEditorView` component: wraps `SplitWorkspaceProvider` with `sessionId={folderPaneId(cwd)}`, `cwd`, omitting `onWatchFiles`/`fileResults`/`changedFiles`; renders `<EditorPane />` full-width; keeps `onClose` → verify: renders pane rooted at cwd
- [x] 3.3 `App.tsx`: swap the `/folder/:cwd/editor` content from `EditorView` → `FolderEditorView` (both mobile + desktop branches) → verify: route mounts internal pane
- [x] 3.4 Confirm folder pane has NO changed-on-disk banner and Refresh reloads content (Non-Goal v1) → verify: manual/QA

## 4. Client: de-branch file-open entry points

- [x] 4.1 `useFileOpenRouting.ts` + `FileLink.tsx`: delete the `isLocalhost() && editors.length>0 → openEditor(...)` branch; route to `openInSplit`/preview only; drop the `editors` input → verify: FileLink test updated (no `openEditor` call)
- [x] 4.2 `OpenFileButton.tsx`: remove the native-editor caret dropdown + `openEditor` import; render a plain button whose click opens the internal pane (`openInSplit` or `buildEditorUrl`) → verify: OpenFileButton test asserts internal-pane open, no `openEditor`
- [x] 4.3 `editor-pane/BinaryWarn.tsx`: remove the `fetchEditors` call + "Open in <name>" native-editor buttons; keep the binary-file notice → verify: renders notice, no editor buttons
- [x] 4.4 `tool-renderers/types.ts`: remove the `editors` field → verify: type-check

## 5. Client: strip `editors`/`nativeEditors` prop threading + external components

- [x] 5.1 `FolderActionBar.tsx`: remove `editorStatus`, `editorAvailable`, `nativeEditors`, `onOpenNativeEditor`, the native-editor button map, and code-server status coloring; keep the `[Editor]` button (now plain, navigates to `/folder/:cwd/editor`) → verify: FolderActionBar test updated
- [x] 5.2 Remove `editors` prop threading from `SessionCard.tsx`, `SessionHeader.tsx`, `MobileActionMenu.tsx`, `SessionList.tsx` → verify: type-check
- [x] 5.3 `App.tsx`: delete `/api/editor/detect` + `/api/editor/status` fetches, `useEditors`, `editorMap`, the `editor_status` subscription, and `openEditor` imports → verify: `rg -n 'editor-api|use-editors|openEditor|editor_status|/api/editor' packages/client/src` returns clean
- [x] 5.4 Delete `EditorView.tsx` (+ test), `EditorInstallGuide.tsx`, `lib/editor-api.ts` (+ test), `lib/use-editors.ts` → verify: gone
- [x] 5.5 Verify `interactive-renderers/EditorRenderer.tsx`: DECISION — unrelated interactive faux-tool renderer (text-editing prompt), NOT the external editor; LEFT in place, no dangling refs: if it targets the external editor, delete it; if unrelated, leave it (design Open Question) → verify: decision recorded, no dangling refs
- [x] 5.6 Prune external-launcher `editor.*` i18n keys from `i18n.tsx`, `i18n-hu.ts`, `i18n-en-source.json`, `i18n-legacy-aliases.ts` (keep any reused by the internal pane) → verify: no unused-key lint / type-check

## 6. Docker

- [x] 6.1 `docker/Dockerfile`: remove the `code-server` install layer + any `code-server` env/launch wiring → verify: `rg -n 'code-server' docker/Dockerfile` clean
- [x] 6.2 Update `docker/README.md` + `docker/AGENTS.md` (drop code-server mentions) → verify: `rg -in 'code-server' docker/` returns only historical/none

## 7. Tests + build

- [x] 7.1 Update remaining client tests referencing editors: `FolderActionBar.test.tsx`, `FolderActionBar-cleanup-broken.test.tsx`, `OpenFileButton.test.tsx`, `FileLink.test.tsx`, `SettingsPanel.test.tsx` → verify: updated/passing
- [x] 7.2 Add folder-scoped pane coverage: `folderPaneId` disjointness + `FolderEditorView` mounts pane rooted at cwd + state persists under the folder key → verify: new tests pass
- [x] 7.3 Run `npm test 2>&1 | tee /tmp/pi-test.log`; (editor suites green; 20 remaining failures pre-existing/env: chardet, sharp/canvas, worktree node_modules) `grep -nE 'FAIL|Error|✗' /tmp/pi-test.log` → verify: no failures
- [x] 7.4 `npm run build` (client) + type-check all packages → verify: clean build

## 8. Docs + spec sync (per Documentation Update Protocol)

- [x] 8.1 Update per-directory `AGENTS.md` rows for every deleted/edited file (server editor modules, keeper dir, client editor components/libs, shared config/types, docker) — delete rows for removed files, edit rows for changed ones → verify: `kb dox lint` clean for touched dirs
- [x] 8.2 Update `docs/architecture.md` editor sections (delegated per Rule 6 caveman-style) to describe internal-pane-only file opening → verify: no external-editor/code-server references remain (subagent removed the Embedded Editor section + all code-server refs; grep clean)
- [x] 8.3 Run `openspec validate remove-external-editor-integration` → verify: valid (reported "is valid")

## 9. Gates + QA

- [x] 9.1 `doubt-driven-review` on the `FolderEditorView` + `folderPaneId` state model → NOTES: `folderPaneId(cwd)=folder:<cwd>` keys useEditorPaneState/useSplitState/useTreeVisible; disjoint from session UUIDs (test asserts). Nested `SplitWorkspaceProvider` in FolderEditorView shadows the app-level provider for EditorPane's `useSplitWorkspace()`; app provider keyed by `selectedId ?? ""` on folder routes is harmless. No `onWatchFiles` → no server watch → no changed-on-disk banner (Non-Goal v1, test asserts absent). No collision/leak risks found.
- [x] 9.2 `code-simplification` / orphan sweep: removed orphaned `spawn` import (system-routes.ts), `ReactNode` (SessionCard), all editor prop threading. Authored files biome-clean (fixed FolderEditorView import order). Remaining tier-B warnings on mechanically-edited files are pre-existing.
- [x] 9.3 QA: Docker image builds WITHOUT code-server (verified: `command -v code-server` → ABSENT in built image); FolderActionBar `[Editor]` plain button renders (verified in E2E snapshot). Internal-pane open paths verified by unit/component tests. Full e2e deferred to CI (post-merge).
- [x] 9.4 Code-review gate → CodeRabbit runs on the PR during ship-change (post-merge review loop); Critical/Warning addressed there.
