# DOX — packages/client/src/components/preview

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `AsciiDocPreview.tsx` | Fetches `/api/file/render`, renders sanitized HTML via `dangerouslySetInnerHTML`. Wraps in `.asciidoc-body` for scoped CSS. Server enforces `safe:"secure"` mode. See change: render-file-previews. |
| `FallbackPreview.tsx` | File targets: "We can't preview this file. [Download]" → `/api/file/raw`. URL targets: "[Open in new tab]" with `rel="noopener noreferrer"`. See change: render-file-previews. |
| `HtmlPreview.tsx` | Local .html files only. Fetches `/api/file/raw` as text, renders in `<iframe sandbox="allow-same-origin" srcDoc={html}>`. No `allow-scripts`/`allow-forms`/`allow-top-navigation`/`allow-popups`. Browser-native isolation; no DOMPurify. See change: render-file-previews. |
| `AudioPreview.tsx` | `<audio src={rawUrl} controls preload=metadata>`. Server Range support drives scrubber. Shared by editor-pane audio tab. See change: improve-content-editor. |
| `ImagePreview.tsx` | Two variants via `variant` prop. `inline` (default): `<img>` capped `max-h-[40vh]` for cards. `full`: full-tab pan/zoom + zoom controls (`useZoomPan`, ex editor-pane `ImageViewer`) — editor image tab uses this. See change: render-file-previews. See change: improve-content-editor. |
| `MarkdownPreview.tsx` | Fetches `/api/file` (text content) + renders via `<MarkdownContent>`. Loading/error states. See change: render-file-previews. |
| `PdfPreview.tsx` | Dynamic `import("pdfjs-dist")` keeps pdfjs out of main bundle. Worker resolved via Vite `?url` import (`pdfjs-dist/build/pdf.worker.min.mjs?url`) — no manual copy to `public/`. Page nav (`Prev` / `Next` / `Page X of Y`). Renders to `<canvas>` at scale 1.5. Destroys doc on unmount. See change: render-file-previews. |
| `raw-url.ts` | Helpers `rawUrl(target)` → `/api/file/raw?cwd=&path=`, `renderUrl(target)` → `/api/file/render?...`, `readTextUrl(target)` → `/api/file?...`. All consume `getApiBase()`. See change: render-file-previews. |
| `VideoPreview.tsx` | `<video src={rawUrl} controls preload="metadata">` 16:9 aspect. Server's Range support drives seek bar. See change: render-file-previews. |
| `YouTubePreview.tsx` | Exports `extractYouTubeId(url): string\|null` handling `youtu.be/<id>`, `youtube.com/watch?v=`, `/embed/`, `/v/`, `/shorts/`. Renders `<iframe src="https://www.youtube.com/embed/<id>">` 16:9 + `allowFullScreen`. See change: render-file-previews. |
