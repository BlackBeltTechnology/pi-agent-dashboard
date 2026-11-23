# Proposal

## Why

Agents produce files (Markdown reports, PDFs, spreadsheets, images) that users want to take elsewhere: attach to an e-mail, or drop into another tool such as ChatGPT's live-audio mode. Today the only way out is to ask the agent to print the text into the chat, which does not work for binary files. The only download affordances today appear when a file cannot be previewed in full: `FallbackPreview` and the `TruncationBanner` used by the DOCX/spreadsheet previews. A file that previews fine has no way to be saved.

## What Changes

- **Server**: `GET /api/file/raw` accepts an optional `download=1` query parameter. When set, the response carries `Content-Disposition: attachment` with the file's basename, header-safe (ASCII `filename="…"` fallback + RFC 5987 `filename*=UTF-8''…`). Without the parameter the route behaves exactly as today (`inline`). Admission, containment, Range, CSP and nosniff are unchanged. The attachment header is built by one shared helper, extracted from the existing EML-attachment route, so the logic is not duplicated.
- **Client download helper (hybrid)**:
  - same-origin API base + a file inside the pane cwd → a direct `<a download>` link to the `download=1` URL. The browser streams to disk at any size.
  - otherwise (a cross-origin/paired API base, or a file outside the pane cwd that may need an access grant) → fetch through the app's `fetch` wrapper (bearer + grant headers, grant prompt allowed) → Blob → save under the file's basename. A failed fetch shows an error toast.
- **Document bar More menu** (`⋯`): file tabs get a **Download** item. When the tab has unsaved changes it stays enabled and shows the hint "Unsaved changes not included". `MenuItem` gains an optional second-line `hint`.
- **File-tree rows**: the per-row copy-path popup becomes a **row actions menu** built on the shared `MenuPopover` (menu keyboard model). It opens from the row glyph, from a secondary click (right-click) on the row, or from the context-menu key / Shift+F10. The glyph is always visible on hover-less (touch) devices. File rows offer the three copy actions plus **Download**. Directory rows offer the copy actions only.
- Out of scope: folder/zip download, downloading unsaved buffer contents, and changes to the existing fallback/truncation links.

## Capabilities

### New Capabilities
- None. Download extends existing capabilities.

### Modified Capabilities
- `file-and-url-preview`: the "Binary-safe file serving endpoint" requirement adds the `download=1` attachment mode.
- `editor-pane-chrome`:
  - "Document bar breadcrumb and More menu SHALL navigate and copy" adds Download, the hybrid delivery, error feedback and the unsaved hint.
  - "Document bar SHALL host the active document's controls" adds Download to the enumerated More-menu items.
  - "Pane menus SHALL follow the menu keyboard model" adds the file-tree row actions menu.
- `internal-monaco-editor-pane`: "File-tree rows SHALL offer a copy-path popup" is renamed and modified to "…a row actions menu", with right-click/keyboard opening, touch visibility and Download on file rows.

## Discipline Skills

- `security-hardening`: the attachment `filename` derives from a filesystem name, so CR/LF/quote/backslash header injection must be closed. The new query parameter must not widen admission or bypass the scriptable-type CSP. The Blob path must keep grant/bearer semantics, not bypass them.
- `review-code`: a non-trivial change across a server route, two client surfaces, a shared menu primitive and i18n.

## Impact

- Server: `packages/server/src/routes/file-routes.ts`. The `/api/file/raw` handler gains the parameter, and the EML-attachment site (`:1996-2005`) moves onto the shared header helper.
- Client:
  - `packages/client/src/components/preview/raw-url.ts` (`downloadUrl`) plus a new download helper module
  - `packages/client/src/components/editor-pane/DocumentBar.tsx` (MoreMenu, `dirty` prop)
  - `EditorPane.tsx` (extract the shared dirty predicate used by `unsavedPaths`)
  - `MenuPopover.tsx` (`MenuItem.hint`)
  - `EditorFileTree.tsx` (`RowCopyAffordance` → `RowActionsMenu` on `MenuPopover`, row `onContextMenu`/keys)
  - i18n tables
- Electron: no change. Remote server windows already handle `will-download` (`packages/electron/src/lib/server-windows.ts:801-804`); the local main window uses Electron's default save dialog.
- API compatibility: an additive optional query parameter; old clients are unaffected. No migration. Rollback is a plain revert.
