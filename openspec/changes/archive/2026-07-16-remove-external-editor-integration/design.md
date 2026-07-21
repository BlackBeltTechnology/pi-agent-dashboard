## Context

Two independent "editor" systems coexist today:

1. **External editor launcher** (being removed). Server-side `code-server` lifecycle: `editor-detection` (find the binary) → `editor-manager` (3-way resolve: in-memory / keeper reattach / fresh spawn) → `editor-keeper/` sidecar (`keeper.cjs` supervises the child so it survives dashboard restart) → `editor-pid-registry` (boot orphan sweep + adoption) → `editor-proxy` (`/editor/<id>/` HTTP + WS proxy). Client: `EditorView` (iframe onto the proxy), `EditorInstallGuide`, `editor-api` (`fetchEditors`/`openEditor` for native Zed/VS Code launch), `use-editors` (per-cwd detection map), plus `editors`/`nativeEditors` props threaded through `FolderActionBar`, `SessionCard`, `SessionHeader`, `MobileActionMenu`, `SessionList`, and the tool-renderer file-open path. Docker bakes `code-server` into the image.

2. **Internal Monaco pane** (being kept + extended). `editor-pane/` (`EditorPane`, `MonacoBuffer`, `EditorFileTree`, `EditorTabs`, `viewer-registry`, …) renders/edits files in-browser. State lives in `editor-pane-state.ts` — a pure reducer + `useEditorPaneState(id)` that persists open tabs / active tab / expanded tree under `pi-dashboard:editor-pane:<id>`. It is currently **session-scoped**: `SplitWorkspaceProvider` lifts the state, keyed by `sessionId`, and co-mounts the pane beside chat (`SessionSplitView`).

Key observation that makes the redirect cheap: **`useEditorPaneState`, `useSplitState`, and `useTreeVisible` all key on an opaque string id, and `OpenFile.path` is relative to `cwd`.** Nothing in the pane's state model is intrinsically session-bound. The only truly session-bound wire is `onWatchFiles(sessionId, cwd, paths)` (the changed-on-disk banner), which is optional in `SplitWorkspaceProvider`.

## Goals / Non-Goals

**Goals:**
- Delete the entire external-editor launcher (server modules, keeper sidecar, proxy, routes, client components/libs, shared config, Docker `code-server`, i18n keys, tests).
- Every former external-editor entry point opens the **internal Monaco pane** instead.
- Give the sidebar folder `[Editor]` button + `/folder/:cwd/editor` route a **folder-scoped internal pane** rooted at the folder cwd.
- Leave the session-scoped internal pane (`SessionSplitView` / split workspace) behavior unchanged.

**Non-Goals:**
- No changes to Monaco viewers, file previews, diff tabs, or the search panel beyond de-branching external-editor calls.
- No server-side file-watch (changed-on-disk banner) for the folder-scoped pane in v1 — there is no session WS to attach it to. The banner simply does not appear in folder scope; a manual Refresh reloads a tab's content.
- No write-collaboration or multi-user concerns (unchanged).

## Decisions

### D1 — Folder-scoped pane = reuse `SplitWorkspaceProvider` + `EditorPane` with a synthetic id
Mount a thin `FolderEditorView` (replacing `EditorView`) that wraps `SplitWorkspaceProvider` with `sessionId = folderPaneId(cwd)` and `cwd = <folder cwd>`, omits `onWatchFiles`/`fileResults`/`changedFiles`, and renders `<EditorPane />` full-width in the content area.
- `folderPaneId(cwd)` = a namespaced key, e.g. `folder:${cwd}` (or a short hash of cwd). Namespacing prevents any collision with real session ids in `localStorage`.
- **Why over alternatives:**
  - *Refactor `EditorPane` to take props instead of context* — larger blast radius, touches the session path we want untouched.
  - *New parallel folder-pane component* — duplicates tabs/tree/viewer logic (violates DRY); the provider indirection already gives us the seam.
  - Reusing the provider means the folder pane inherits every viewer, tab, tree, and search behavior for free.

### D2 — `/folder/:cwd/editor` route repurposed, not removed
`App.tsx` keeps the route match and the `[Editor]` button's `navigate('/folder/:cwd/editor')`, but the rendered content swaps `EditorView` → `FolderEditorView`. Preserves deep-links/bookmarks to the folder editor; only the implementation behind the URL changes.

### D3 — File-level entry points de-branch to internal-only
- `useFileOpenRouting` / `FileLink`: delete the `isLocalhost() && editors.length>0 → openEditor(...)` branch. Route is now: split context present → `openInSplit`; else → preview overlay / internal pane. (The `editors` input disappears.)
- `OpenFileButton`: becomes a plain button (no split caret); body-click → `openInSplit` (or deep-link `buildEditorUrl`), same as today's body-click. The native-editor caret dropdown is deleted.
- `BinaryWarn`: keep the "binary file" notice; delete the "Open in <native editor>" buttons and the `fetchEditors` call.

### D4 — `editors` / `nativeEditors` prop removal is mechanical
Drop the prop from `FolderActionBar` (native-editor buttons + code-server status coloring + `editorAvailable`/`editorStatus`), `SessionCard`, `SessionHeader`, `MobileActionMenu`, `SessionList`, and `tool-renderers/types.ts`. `App.tsx` deletes the `/api/editor/detect` + `/api/editor/status` fetches, `useEditors`, and the `openEditor` import.

### D5 — Shared config: drop `editor` field, tolerate legacy blocks
Remove `EditorConfig`, `DEFAULT_EDITOR_CONFIG`, `parseEditorConfig`, and the `editor` field from `DashboardConfig`. `parseConfig` simply stops reading `parsed.editor`; a stale `"editor": {…}` block in an existing `settings.json` is ignored (not an error), so no user migration is required.

### D6 — Server de-wiring is delete-then-unref
Delete the 5 editor modules + `editor-keeper/` + `routes/editor-routes.ts` + their tests, then remove every reference in `server.ts` (imports; `editorManager`/`editorPidRegistry` creation; `registerEditorRoutes`/`registerEditorProxy`; the `editor` case in the WS upgrade switch + the scope allow-list; boot `adoptOrphans`/`cleanupOrphans`; `editorManager.stopAll()` on shutdown). Verify with a type-check + `rg` for `editor-manager|editor-proxy|editorManager|/editor/`.

## Risks / Trade-offs

- **[Folder pane has no changed-on-disk banner]** → Documented Non-Goal for v1; a Refresh reloads tab content. A folder-level watch can be added later without changing the state model.
- **[Synthetic `folder:` id collides with a real session id]** → The `folder:` prefix is not a valid session UUID, so `localStorage` keys are disjoint by construction; guard with a helper (`folderPaneId`) rather than inline string concat.
- **[Missed `server.ts` reference leaves a dangling import → build break]** → Post-removal `tsc --noEmit` + `rg 'editor(Manager|Proxy|PidRegistry|Detection|Routes)|/editor/|code-server'` over `packages/server/src` must return clean.
- **[Docker image cache still ships `code-server`]** → Remove the install layer AND rebuild the image in QA; grep `docker/` for `code-server` returns clean.
- **[Deleting shared `editor-types.ts` breaks an unexpected importer]** → `rg "editor-types"` before deletion; the only importers should be the files this change already removes/edits.

## Migration Plan

1. Server: delete modules + tests, de-wire `server.ts`, delete shared `editor-types.ts` + config fields. Type-check server + shared.
2. Client: add `FolderEditorView` + `folderPaneId`; repurpose the route; de-branch file-open paths; strip `editors` props; delete external components/libs; prune i18n keys. Type-check + client tests.
3. Docker: drop `code-server` layer; update `docker/README.md` + `docker/AGENTS.md`.
4. Specs/docs: write delta specs (removed/modified capabilities); update per-directory `AGENTS.md` rows.
5. Full rebuild + restart + QA (folder `[Editor]` opens the internal pane; file links/OpenFileButton open internal; no `/editor/` proxy; Docker image builds without code-server).

**Rollback:** revert the change commit; no persisted-state migration ran, so nothing to undo server-side. Stale `localStorage` `folder:` keys are harmless.

## Open Questions

- `folderPaneId(cwd)`: raw `folder:${cwd}` (readable, long) vs short hash (opaque, fixed length). Leaning raw prefix for debuggability; either works. → resolve in implementation.
- `interactive-renderers/EditorRenderer.tsx`: confirm during implementation whether it targets the external editor (delete) or is an unrelated interactive renderer (leave). Inventory flags it for verification, not blind deletion.
