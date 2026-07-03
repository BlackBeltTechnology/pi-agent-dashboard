# Improve Content Editor

## Why

The internal editor pane (`add-internal-monaco-editor-pane`, archived 2026-06-30;
extended by `split-editor-workspace`, archived 2026-07-03) shipped read-only v1 with
a thin viewer registry (`monaco | image | pdf | markdown | binary-warn`) and a
lazy file-tree rail. Daily use surfaced seven concrete defects, and two capability
gaps. Mockups for the redesign (all viewers, dark + light, tab↔tree sync, markdown
edit) live in `mockups/editor.html` and are part of this proposal.

**Seven defects (root causes verified in current source):**

1. **Hidden directories render as files and won't open.** `EditorFileTree.listDir`
   marks an entry a directory only if it appears in `/api/browse`, but
   `browse.ts::listDirectories` filters `!e.name.startsWith(".")`. So `.git` / `.pi`
   come back from `/api/file` (all names) but not from `/api/browse` (dirs-only,
   hidden stripped) → labelled files → clicking calls `openFile` on a directory.
2. **Generic icons.** `EditorFileTree` hardcodes one file glyph + one folder glyph.
   `file-kind.ts` already classifies every path; the tree never maps kind → icon.
3. **PDF "not supported."** `PdfViewer` uses `<object type="application/pdf">`, which
   needs the browser's native PDF plugin. The Electron `mainWindow` sets no
   `plugins: true`, so `<object>` falls through to the download link. A real
   `PdfPreview` (pdfjs canvas) already exists under `preview/` and is unused here.
4. **Markdown can't switch to edit mode.** `MarkdownViewer` is read-only; a full
   `MarkdownEditor` exists (Instructions page only) and `fileKind` already returns
   `editable:true` for `.md`/`.mdx`. No view/edit toggle wires them, no save path.
5. **Tree ↔ tabs not linked.** Opening a file never auto-expands ancestor folders or
   reveals the active row; switching tabs doesn't sync the tree.
6. **Tree toggle hard to find.** The show/hide control is a bare icon buried among
   header buttons.
7. **Editor ignores theme switch.** `MonacoBuffer` / `MarkdownEditor` import the raw
   `useTheme()` hook (isolated per-instance state) instead of `useThemeContext()`
   (the shared provider). The provider updates DOM CSS vars (so CSS-var components
   follow) but the editors' private copies never re-render → no recolor.

**Two capability gaps:**

- **Rich viewers not wired.** `render-file-previews` (archived 2026-05-31) shipped a
  `preview/*` renderer set + `file-and-url-preview` spec covering
  `markdown | asciidoc | html | pdf | video | image | youtube | fallback`, plus
  `MermaidBlock`. The editor-pane duplicates a poorer subset and never reuses these.
  Users want to open **mermaid, image, video, sound (audio)** — and **HTML files** —
  directly in a tab.
- **No way to view a running server inside the dashboard.** Users want to preview a
  **mockup / dev server** (e.g. `http://localhost:5173`) in a tab without leaving the
  dashboard. No live-server viewer exists.

## What Changes

- **MODIFIED** capability `internal-monaco-editor-pane`:
  - Tree rail SHALL classify entries by real type so **hidden directories render and
    expand as folders** (#1); the fix SHALL come from a single tree-listing source of
    truth returning `{ name, isDir }` per entry (no `/api/file`+`/api/browse` merge).
  - Tree + tabs SHALL show a **per-kind mime icon** derived from `fileKind` (#2).
  - Opening a file SHALL **auto-expand its ancestor folders and reveal + highlight the
    row**; the tree and the active tab SHALL stay in sync both directions (#5).
  - The rail toggle SHALL be a **labelled, discoverable control** at the rail boundary
    (#6).
  - Markdown tabs SHALL offer a **Preview / Edit toggle** (edit only for the writable
    `.md`/`.mdx` subset), with dirty state + save via the existing `/api/file/write`
    guard (#4).
  - All Monaco/markdown editors SHALL follow the dashboard theme live by consuming the
    **shared `useThemeContext()`** (#7).
  - The viewer registry SHALL **adopt the `preview/*` renderers** — replacing the
    `<object>` PDF path with `PdfPreview` (pdfjs) (#3) and adding **`html`, `mermaid`,
    `video`, `audio`** viewer kinds (gap 1). `fileKind` SHALL classify `.html/.htm`,
    `.mmd/.mermaid`, audio (`.mp3/.wav/.ogg/.m4a/.flac`), and video accordingly.
  - HTML files SHALL render sandboxed (scripts disabled) reusing `HtmlPreview`
    (`<iframe sandbox="allow-same-origin" srcDoc>`), NOT `<iframe src=/api/file/raw>`.

- **ADDED** capability `live-server-preview`: a viewer that embeds a **running local
  HTTP server** (dev server / mockup) in a tab via an isolated reverse-proxy origin,
  constrained to loopback + an explicit allowlist to prevent SSRF, following the
  `editor-view` (code-server) proxy idiom.

- **ADDED** hardening: the dashboard SHALL send a baseline **Content-Security-Policy**
  (none exists today), so any embedded/served HTML cannot reach the dashboard origin.

Out of scope: rendering HTML from chat content (separate threat model, explicitly
excluded by `render-file-previews`); editing non-markdown files; remote (non-loopback)
live-server targets.
