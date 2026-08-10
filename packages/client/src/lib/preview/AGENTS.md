# DOX — packages/client/src/lib/preview

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `extract-urls.ts` | Pure `extractRecentUrls(messages: ChatMessage[]): string[]`. → see `extract-urls.ts.AGENTS.md` |
| `file-icon.ts` | `fileIcon(pathOrName)` → `{ iconPath, colorClass }`. Extension-keyed `@mdi/js` glyph + accent color for… → see `file-icon.ts.AGENTS.md` |
| `mdi-icon-lookup.ts` | Extension UI System icon resolver. Exports `resolveMdiIcon(key)` — maps `"mdiCheckCircle"`-style key to… → see `mdi-icon-lookup.ts.AGENTS.md` |
| `preview-dispatch.ts` | Pure `dispatchPreview(target: ViewTarget): RendererKind`. → see `preview-dispatch.ts.AGENTS.md` |
| `wrap-ascii-tables.ts` | Pre-processes markdown to wrap raw ASCII/box-drawing table blocks in fenced code blocks so they render… → see `wrap-ascii-tables.ts.AGENTS.md` |
