## Why

AsciiDoc files in the editor pane / canvas could not be edited, did not scroll, and their PlantUML
diagrams never rendered. Investigating that exposed three latent bugs that also broke existing
features:

- `POST /api/file/write` only accepted `.md`/`.mdx`, so the shipped `.csv` Edit/Save always got `403`.
- `GET /api/file` returned `mtime` rounded to whole ms while the write check compares the exact
  `mtimeMs`, so every editor-pane save (markdown, csv) got a false `409` on APFS/ext4 sub-ms mtimes.
- Under the server's `node --import jiti-register` loader, `await import("isomorphic-dompurify")`
  routes jsdom's CommonJS through jiti and breaks its `interfaces.js` ↔ `create-element.js` cycle
  (`interfaces.getInterfaceWrapper is not a function`), so every server-side sanitize failed:
  PlantUML (Kroki) SVGs, EML bodies and docx HTML.

## What Changes

- `.adoc`/`.asciidoc` become `editable`: the editor-pane AsciiDoc tab gets a Preview/Edit toggle
  (Preview = rendered AsciiDoc, Edit = Monaco over raw source, Save via `/api/file/write`).
- The csv Preview/Edit tab is generalized into a shared `EditablePreviewTab` (csv + adoc); its body
  is the scroll container, fixing the non-scrolling AsciiDoc preview.
- The write allowlist (`isWritableMdTarget`) extends to all `editable` text kinds: `.md`, `.mdx`,
  `.adoc`, `.asciidoc`, `.csv`. Containment rules are unchanged.
- `GET /api/file` returns the full-precision `mtime` token.
- Server-side DOMPurify loads through a shared `loadPurify()` (`createRequire`, lazy, never caches a
  half-initialized instance) used by diagram render, EML and office previews.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `internal-monaco-editor-pane`: AsciiDoc joins the editable kinds; `/api/file` returns content for
  it and a full-precision `mtime`; the Preview/Edit tab body scrolls.
- `scoped-markdown-editing`: write allowlist covers every `editable` text kind; the mtime token is
  full precision.
- `file-and-url-preview`: the server sanitizer is loaded lazily via native `require`, for all
  server-side sanitizers.

## Impact

- Client: `editor-pane/EditablePreviewTab.tsx` (new, generic), `EditableSpreadsheetTab.tsx`
  (wrapper), `viewer-registry.tsx`.
- Server: `lib/purify.ts` (new), `lib/diagram-render.ts`, `lib/eml.ts`, `lib/office-preview.ts`,
  `lib/writable-md-target.ts`, `routes/file-routes.ts`, `vitest.real-process-files.ts`.
- Shared: `file-kind.ts`.
- Security: the write allowlist widens by extension only (`.adoc`, `.asciidoc`, `.csv`); realpath
  containment, `..`/symlink escape rejection and the global `~/.pi/agent` scope are unchanged.
- Compatibility: no migration. Old clients only gain working saves. Rollback = revert.

## Discipline Skills

- `security-hardening` — widening the `isWritableMdTarget` write boundary (extension-only; tests
  cover in-scope allow + `..` escape reject for `.adoc`).
- `systematic-debugging` — the jsdom-under-jiti failure was root-caused by reproducing under the
  real `jiti-register` loader (plain node and `createJiti` both pass).
