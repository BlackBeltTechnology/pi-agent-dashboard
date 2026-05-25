## 1. Shared: file-kind classifier

- [ ] 1.1 Create `packages/shared/src/file-kind.ts` exporting `fileKind(absPath: string, sniff?: Buffer | string): FileKindResult` with the discrimination strategy from design §2. Return `{ kind: "text" | "image" | "pdf" | "markdown" | "binary" | "unknown", mimeType, viewer, editable }`. v1 always returns `editable: false`.
- [ ] 1.2 Export the `ViewerKind` literal union, `FileKindResult` type, and constants `TEXT_EXTENSIONS`, `IMAGE_EXTENSIONS` from the shared package barrel.
- [ ] 1.3 Add unit tests in `packages/shared/src/__tests__/file-kind.test.ts`: each allowlist extension picks the right viewer; `.md` overrides `monaco` to `markdown`; NUL-byte sniff triggers `binary-warn`; unknown extensions without sniff default to `monaco`; absolute path is required (relative path throws).

## 2. Server: extended `/api/file` response

- [ ] 2.1 In `packages/server/src/routes/file-routes.ts`, extend the `GET /api/file` handler to invoke `fileKind(resolved, sniff)` after `fs.stat` succeeds. Sniff the first 1024 bytes (`fs.read` into a fixed buffer) — do NOT read full content for binary classification.
- [ ] 2.2 When the resolved entry is a file: read the full content if `kind` is text/markdown; return `{ type: "file", kind, mimeType, size, content? }`. For images, return `{ type: "file", kind, mimeType, size }` (no `content` — client fetches the raw bytes separately). For PDFs and binaries, same as images.
- [ ] 2.3 Add a separate `GET /api/file/raw?cwd=...&path=...` endpoint that streams raw bytes with the correct `Content-Type` header, gated by the same cwd + path-traversal checks as `/api/file`. Used by image / PDF tabs.
- [ ] 2.4 Update `packages/shared/src/rest-api.ts` with the new response shape on `/api/file` and the new `/api/file/raw` route signature.
- [ ] 2.5 Add tests in `packages/server/src/__tests__/file-routes.test.ts` covering: text file returns content + kind; image returns metadata only; binary returns binary-warn; path-traversal rejected for `/api/file/raw`; unknown cwd 403 for both endpoints.

## 3. Client: pane state hook + persistence

- [ ] 3.1 Create `packages/client/src/lib/editor-pane-state.ts` exporting `useEditorPaneState(sessionId): [state, dispatch]` backed by `localStorage` under key `pi-dashboard:editor-pane:<sessionId>`. State shape per design §3.
- [ ] 3.2 Implement reducer actions: `openFile(path, viewer)`, `closeTab(index)`, `setActive(index)`, `toggleTreeRoot(relPath)`, `reorderTabs(from, to)`. `openFile` is idempotent — opening an already-open path activates its tab instead of opening a duplicate.
- [ ] 3.3 Guard against quota errors and corrupt JSON: catch `localStorage.setItem` failures (log + warn, in-memory continues); catch JSON parse errors on read (treat as empty state).
- [ ] 3.4 Add tests in `packages/client/src/lib/__tests__/editor-pane-state.test.ts` covering each reducer action, idempotency of `openFile`, persistence round-trip, and corrupt-JSON recovery.

## 4. Client: viewer registry + per-kind components

- [ ] 4.1 Create directory `packages/client/src/components/editor-pane/`. Add a uniform `ViewerProps = { cwd: string; path: string; kind: FileKindResult["kind"]; mimeType: string; size: number }` type.
- [ ] 4.2 Create `packages/client/src/components/editor-pane/MonacoBuffer.tsx` as a `React.lazy` boundary wrapping `@monaco-editor/react`. Configure read-only mode. Use the language list from design §4. Add `?worker` Vite imports for the editor workers.
- [ ] 4.3 Create `packages/client/src/components/editor-pane/ImageViewer.tsx` — fetch from `/api/file/raw`, render in an `<img>` with `object-contain` sizing. Reuse `useZoomPan` from `packages/client/src/hooks/useZoomPan.ts` for pan/zoom.
- [ ] 4.4 Create `packages/client/src/components/editor-pane/MarkdownViewer.tsx` — fetch text content from `/api/file`, pass through existing `MarkdownContent.tsx` wrapped in `SessionAssetsProvider` for `pi-asset:` resolution.
- [ ] 4.5 Create `packages/client/src/components/editor-pane/PdfViewer.tsx` — render `<object data="/api/file/raw?..." type="application/pdf">` with a fallback `<a>` link to download the file if the browser cannot render PDF.
- [ ] 4.6 Create `packages/client/src/components/editor-pane/BinaryWarn.tsx` — display a "this file is binary; open externally" message with a button that triggers the existing native-editor handoff if a native editor is detected.
- [ ] 4.7 Create `packages/client/src/components/editor-pane/viewer-registry.ts` exporting `viewerRegistry: Record<ViewerKind, React.ComponentType<ViewerProps>>`.
- [ ] 4.8 Add Vite build config: ensure `MonacoBuffer.tsx` produces its own chunk (verify via `npm run build` output). Add a CI size-guard test in `packages/client/src/__tests__/monaco-chunk-size.test.ts` warning at >2 MB gzipped, failing at >3 MB.

## 5. Client: pane shell — tabs + tree + viewer host

- [ ] 5.1 Create `packages/client/src/components/editor-pane/EditorTabs.tsx` — horizontal scrollable tab list with close (×), middle-click close, drag-to-reorder, active highlight, Ctrl/Cmd-W keyboard close. Tab labels use the file basename; tooltip shows the rel path.
- [ ] 5.2 Create `packages/client/src/components/editor-pane/EditorFileTree.tsx` — lazy directory tree rooted at session `cwd`. One-level-at-a-time expansion via `/api/browse`. Clicking a file calls `openFile(path, viewer)`. Tree state (expanded directories) persisted via `treeOpenRoots`.
- [ ] 5.3 Create `packages/client/src/components/editor-pane/EditorPane.tsx` — composes `EditorTabs` + (`EditorFileTree` | collapse button) + active viewer. Header: back-to-chat button, tree-toggle, file rel-path label. Status footer: line count, language, kind.
- [ ] 5.4 Add the route in `packages/client/src/App.tsx`: parallel to `FileDiffView` / `MarkdownPreviewView`, render `EditorPane` when the URL matches `/session/:id/editor`. Parse `?file=<rel>&line=<n>` query and `openFile` on mount.
- [ ] 5.5 Add a `buildEditorUrl(sessionId, filePath, line?)` route-builder helper in `packages/client/src/lib/route-builders.ts`.

## 6. Client: OpenFileButton split-button refactor

- [ ] 6.1 Refactor `packages/client/src/components/tool-renderers/OpenFileButton.tsx` from a single `<button>` to a split control (main click + caret dropdown). Default action navigates to `buildEditorUrl(sessionId, filePath, line)`. Dropdown lists detected native editors (preserving today's `openEditor(...)` flow). When no native editors are detected, render the plain button (no dropdown caret).
- [ ] 6.2 Pass `sessionId` through `ToolContext` so the button can build the route. Confirm `ToolContext` already exposes the active session id; thread it through if not.
- [ ] 6.3 Update tests in `packages/client/src/components/tool-renderers/__tests__/OpenFileButton.test.tsx` (or create) covering: click → internal route; dropdown → native editor; no native editor → plain button; dropdown hidden when only internal option exists.
- [ ] 6.4 Confirm the button now renders for ALL Edit/Read/Write/MultiEdit tool cards even when no native editor is detected. Today's gate (`if (editors.length === 0) return null`) becomes `if (!filePath) return null`.

## 7. Documentation

- [ ] 7.1 Add a `docs/architecture.md` subsection "Internal Monaco editor pane (v1 read-only)" describing the route, the viewer registry, the file-kind classifier, and explicit pointers to v2-v4 follow-on phases.
- [ ] 7.2 Add the new files to `docs/file-index-client.md` (`EditorPane.tsx`, `EditorTabs.tsx`, `EditorFileTree.tsx`, `MonacoBuffer.tsx`, `ImageViewer.tsx`, `MarkdownViewer.tsx`, `PdfViewer.tsx`, `BinaryWarn.tsx`, `viewer-registry.ts`, `editor-pane-state.ts`) and `docs/file-index-shared.md` (`file-kind.ts`) and `docs/file-index-server.md` (extended `file-routes.ts`, new `/api/file/raw` route). Use the caveman style per the project's Documentation Update Protocol; delegate writes to a subagent.
- [ ] 7.3 Update AGENTS.md "Key Files" backbone with at most 2 rows: `EditorPane.tsx` (the pane shell) and `file-kind.ts` (the shared classifier). All other new files go to the file-index splits only.

## 8. Verification

- [ ] 8.1 Run `npm test` and confirm all new tests pass.
- [ ] 8.2 Run `npm run build` and verify the Monaco chunk is split into its own asset (filename pattern `*Monaco*` or similar) and is ≤ 2 MB gzipped.
- [ ] 8.3 Manual smoke test on a session whose agent has just run Edit/Write/Read tool calls: click `OpenFileButton` → pane opens with the file in a tab; open a second file → second tab appears, active tab switches; close a tab → next tab activates; reload page → tabs restored; restart dashboard server → tabs still restored.
- [ ] 8.4 Manual smoke test for each viewer kind: open a `.ts` (Monaco), an `.md` (MarkdownViewer), a `.png` (ImageViewer with pan/zoom), a `.pdf` (PdfViewer), a binary `.bin` (BinaryWarn). Confirm no viewer crashes; binary triggers warn without attempting to render content.
- [ ] 8.5 Manual smoke test for `OpenFileButton` dropdown: with Zed running, dropdown lists Zed; click body → internal pane; click "Open in Zed" → native handoff still works. Stop Zed, refresh → button becomes plain "Open" with no caret, click → internal pane.
- [ ] 8.6 Run `openspec validate add-internal-monaco-editor-pane --strict` and resolve any reported issues.
