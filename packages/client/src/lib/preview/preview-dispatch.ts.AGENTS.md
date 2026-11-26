# preview-dispatch.ts — index

Pure `dispatchPreview(target: ViewTarget): RendererKind`. File targets dispatch by extension via `RENDERER_BY_EXT` map. URL targets: host first (`youtube.com`, `www.youtube.com`, `m.youtube.com`, `youtu.be` → `youtube`), then URL extension, then `fallback`. Single source of truth. RendererKind = `"markdown" \| "asciidoc" \| "docx" \| "spreadsheet" \| "html" \| "pdf" \| "video" \| "audio" \| "image" \| "youtube" \| "fallback"`. Audio exts `.mp3/.wav/.ogg/.m4a/.flac`→audio. `.docx`→docx; `.xlsx`/`.csv`→spreadsheet (dispatch stays shape-based). See change: render-file-previews. See change: improve-content-editor. See change: render-office-previews.

Exports `YOUTUBE_HOSTS` (`youtube.com`, `www.youtube.com`, `m.youtube.com`, `youtu.be`); `extractYouTubeId` accepts exactly that set. See change: fix-codeql-small-findings.

URL targets (rich-chat-links D11): non-http(s) → `fallback`; YouTube host → `youtube`; extension kind only when it is `video`/`audio`/`image`/`pdf` (the renderers that take a URL target); everything else (no extension, `.html`, `.md`, `.docx`, `.pptx`, `.eml`…) → `webpage`. `RendererKind` gains `webpage`; framing decisions belong to `WebPagePreview`, never to dispatch. See change: rich-chat-links.
