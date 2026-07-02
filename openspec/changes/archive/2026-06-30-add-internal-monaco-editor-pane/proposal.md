## Why

Today the dashboard surfaces every Edit/Write/Read tool call with an `OpenFileButton` that hands off to an external native editor (Zed, code-server via iframe). That works when the user wants the full IDE, but it forces a context switch out of the chat for the common case — "what did the agent just write into `src/foo.ts`? Let me glance at it." The existing code-server iframe (`editor-view`) is the right tool for *real* editing, but its layout is fixed: you cannot use the file browser and content editor independently as separate dashboard viewparts, and it spawns a process per folder.

A lightweight in-dashboard viewer — a Monaco-based pane with multi-file tabs, a collapsible file-tree rail, and per-file-kind renderers (Monaco for code, image for images, etc.) — gives users a quick way to read what the agent touched without leaving the session card, and lays the foundation for later in-pane editing alongside the chat.

## What Changes

This change captures a four-phase roadmap (v1 through v4). **Only v1 is in scope for this change.** v2–v4 are documented here as the follow-on plan so the v1 design does not paint future phases into a corner; each will get its own change proposal when ready to ship.

### v1 (in scope) — Read-only viewer pane, route-based

- **NEW capability** `internal-monaco-editor-pane`: a session-scoped pane that opens via URL route (`/session/:id/editor?file=<path>`), replacing `ChatView` in the content area like the existing `FileDiffView` pattern. Back button returns to chat.
- **NEW**: multi-file tabs inside the pane. Each tab is one open file. Tabs persist per session via `localStorage`.
- **NEW**: collapsible file-tree rail inside the pane, rooted at the session's `cwd`, lazy-expanded one level at a time.
- **NEW**: per-file-kind viewer registry — `monaco` (text/code), `image`, `pdf`, `markdown`. Tab component is a registry lookup keyed by `kind`.
- **NEW**: shared `file-kind.ts` classifier (extension allowlist + NUL-byte sniff) returning `{ kind, mimeType, viewer, editable }`. v1 always reports `editable: false`.
- **NEW**: `/api/file` (existing read endpoint) extended to return `{ kind, mimeType, size, content? }`. Binary files return metadata only.
- **NEW**: Monaco bundle lazy-loaded via dynamic `import()` on first text-file open; languages allowlisted (TS/JS/JSON/MD/Python/Go/Rust/YAML/HTML/CSS/SQL/Shell) to keep the chunk ≤ 2 MB gzipped.
- **NEW**: full theme inheritance — Monaco theme derived at runtime from the dashboard's active named theme (`base / dracula / nord / github / catppuccin / tokyo-night / rose-pine / solarized / gruvbox`) + light/dark mode via `monaco-theme.ts` (`buildMonacoTheme`), mapping `themes.ts` tokens onto Monaco editor colors + syntax rules. Recolors live on theme/mode switch. Mirrors the existing `DiffPanel`/`RichDiff` theme-into-editor precedent.
- **MODIFIED capability** `open-in-editor`: `OpenFileButton` becomes a split button — click invokes the new internal pane by default; dropdown lists detected native editors (Zed, etc.) as alternates. When no native editor is detected, the button is a plain "Open" with no dropdown. When the dashboard route is disabled (future opt-out), behavior falls back to today's native-editor handoff.
- **Persistence**: client-side `localStorage` only (per `sessionId` → open tabs + active index + tree state). Survives reload and dashboard restart; not cross-device. No server-side persistence in this change.
- **Out of scope for v1**: writing files, creating files, side-by-side chat+editor layout, LSP/IntelliSense, cross-file search, external file watchers.

### v2 (future change) — Pin-to-split layout

- Adds a header "📌 Pin editor" toggle that lifts the *same* pane components into a side-by-side layout next to `ChatView`, with a drag-resizable splitter persisted per session in `localStorage`.
- Mobile (`useMobile`) degrades to v1 single-view tabbing — no side-by-side on narrow screens.

### v3 (future change) — Create new file

- Adds a `POST /api/file/write` endpoint that REFUSES to overwrite existing paths (gated by `cwd` matching a known session, same security model as the existing read endpoint).
- "+ new tab" prompts for a path; submitting saves an empty (or templated) file to disk.
- Read-only semantics on existing files preserved.

### v4 (future change) — Edit existing files

- Extends `POST /api/file/write` to accept `{ mtime }` for conflict detection (`409 Conflict` on mismatch).
- Adds in-pane dirty-buffer state, save button, "external change detected — reload?" banner driven by tool events on already-open paths.

## Capabilities

### New Capabilities

- `internal-monaco-editor-pane`: in-dashboard, session-scoped file viewer with multi-file tabs, file-tree rail, and per-kind viewer dispatch. v1 is read-only; v2-v4 layered on later via separate proposals.

### Modified Capabilities

- `open-in-editor`: `OpenFileButton` becomes a split button with the in-dashboard pane as the default action and detected native editors as dropdown alternates. The button now appears even when no native editor is detected (today it hides itself).

## Impact

- **Code (server)**: `packages/server/src/routes/file-routes.ts` — extend `/api/file` response shape with `{ kind, mimeType, size, content? }`. `packages/server/src/browse.ts` may grow a small file-kind helper or it lives in shared.
- **Code (shared)**: `packages/shared/src/file-kind.ts` (NEW) — pure classifier; `packages/shared/src/rest-api.ts` — typed response for `/api/file`.
- **Code (client)**: new components under `packages/client/src/components/editor-pane/` — `EditorPane.tsx`, `EditorTabs.tsx`, `EditorFileTree.tsx`, `MonacoBuffer.tsx`, `ImageViewer.tsx`, `MarkdownViewer.tsx`, `PdfViewer.tsx`, `BinaryWarn.tsx`. New helpers `packages/client/src/lib/editor-pane-state.ts` (per-session state + `localStorage` persistence) and `packages/client/src/lib/monaco-theme.ts` (`buildMonacoTheme` — derives a Monaco theme from the active `themes.ts` token map). Existing `packages/client/src/components/tool-renderers/OpenFileButton.tsx` becomes a split button.
- **Code (App.tsx routing)**: new route `/session/:id/editor` rendering `EditorPane` in the content area, with `goBack` returning to chat (mirrors `FileDiffView`).
- **Dependencies**: `@monaco-editor/react` (or raw `monaco-editor` + `?worker`) added to `packages/client/package.json`. Bundled as a Vite-split lazy chunk.
- **Docs**: AGENTS.md Key Files row for the new pane components; `docs/architecture.md` short subsection on the v1-v4 roadmap and where the pane sits relative to `editor-view` (code-server) and `open-in-editor` (native editors).
- **No breaking changes.** `OpenFileButton`'s click behavior changes (today: opens first native editor; v1: opens internal pane), but the dropdown preserves access to native editors.

## References

- Design: `openspec/changes/add-internal-monaco-editor-pane/design.md`
- Related capability (code-server iframe): `openspec/specs/editor-view/spec.md`
- Related capability (native-editor handoff): `openspec/specs/open-in-editor/spec.md`
- Existing layout precedent: `packages/client/src/components/FileDiffView.tsx` (split tree + content as a content-area takeover)
- Existing image viewer pattern: `packages/client/src/components/ImageLightbox.tsx`
