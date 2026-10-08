## Why

Rule and AI repair (`add-mermaid-auto-repair`, `add-mermaid-ai-repair`) fix a diagram for display only — the file on disk stays broken, so GitHub, VS Code, the kb indexer and the next reader still see the error. When the diagram comes from a file the dashboard is previewing, the user should be able to persist the fix with one confirmed click instead of copying the source into an editor by hand.

## What Changes

- **"Apply fix to file" action** on a repaired (rule- or AI-fixed) diagram, shown only when the diagram came from an on-disk file inside a live session's cwd (the scope `md-read`/`write` accept): markdown file previews (`FilePreviewOverlay`, editor-pane `MarkdownViewer`, `MarkdownPreview`), the AsciiDoc preview, and the `.mmd`/`.mermaid` viewer. Chat and other file-less surfaces keep display-only + copy.
- **Fetch-verify, then confirm with a diff.** Activating the action re-reads the file (`GET /api/file/md-read` → `{content, mtime}`, same `isWritableMdTarget` guard as the write), locates the target block by its ordinal using the **same parser/detection the preview used**, and verifies the located block's source is **exactly** the source the preview rendered. Only then a confirmation shows a line diff of the on-disk block content versus the content that will be written; nothing is written without confirming.
- **Splice-write.** On confirm the fixed source is spliced in, preserving fence/delimiter lines, container indentation and line endings, and written via the existing `POST /api/file/write` with the `md-read` mtime token. Not-found, mismatch, or a 409 writes nothing and shows "file changed — reload". Blocks the splicer cannot rewrite safely (mermaid fence inside a blockquote, unclosed fence, mermaid code that came from raw HTML) do not offer the action.
- **Preview refreshes** after a successful write so the diagram renders from the now-valid source (badge disappears).
- **`.mmd` / `.mermaid` become writable** text targets in **directory scope only**: the write allowlist gains these two extensions under the same realpath/cwd containment rules; global scope (`~/.pi/agent`) keeps rejecting them. Whole-file replace (the file IS the block). The Instructions file picker is unchanged (still `.md`/`.mdx`, a subset of the guard).
- Exposes a generic "replace block N of kind K in file F" helper reused by `add-md-adoc-markup-repair`.

## Capabilities

### New Capabilities
- `preview-fix-write-back`: the apply-fix action availability rules, diff confirmation, block location by ordinal + content verification, splice rules per format, conflict semantics, post-write refresh.

### Modified Capabilities
- `scoped-markdown-editing`: "Write target authorization SHALL be allowlist-bounded" — writable extensions gain `.mmd` and `.mermaid`.

## Impact

- `packages/server/src/lib/writable-md-target.ts`: directory-scope-only `.mmd`/`.mermaid` + tests. `md-candidates.ts` unchanged.
- `packages/client/src/lib/preview/`: new `mermaid-block-locator.ts` (md: re-parse with the shared remark plugin list and collect `code` nodes with `lang === "mermaid"`; AsciiDoc `[source,mermaid]` block scanner with count-parity guard; whole-file for `.mmd`) + splice; new `remark-mermaid-ordinal` plugin; shared `MARKDOWN_REMARK_PLUGINS` constant. Client declares `unified` + `remark-parse` explicitly (already installed transitively via `react-markdown`).
- `packages/client/src/components/preview/MermaidBlock.tsx`: optional block-source context consumption, apply action, diff confirm dialog (uses existing `diff` dependency).
- `MarkdownContent.tsx`, `AsciiDocPreview.tsx`, `editor-pane/MermaidViewer.tsx`, `FilePreviewOverlay.tsx`, `MarkdownViewer.tsx`, `MarkdownPreview.tsx`: provide a stable-identity file source (`{cwd, path, kind, reload}`) + per-block ordinal to `MermaidBlock`.
- No new endpoint; reuses `/api/file/md-read` + `/api/file/write` (mtime optimistic lock, serialized writes).
- **Hard prerequisite:** `add-mermaid-auto-repair` (active, unimplemented) must land first — this change consumes its `{kind:"repaired", code}` outcome. Works with AI-fixed source once `add-mermaid-ai-repair` lands.
- Rollback: revert client; reverting the allowlist extension is independent and safe (no data migration).

## Discipline Skills

- `security-hardening`: widens the server write allowlist (`.mmd`/`.mermaid`) — must keep realpath-on-target extension check, cwd containment and symlink-escape rejection; the written content is model- or rule-derived and must only replace the verified block.
- `doubt-driven-review`: irreversible user-file mutation — review the locate/verify/splice logic and conflict handling before it stands.
- `review-code`: before commit.
