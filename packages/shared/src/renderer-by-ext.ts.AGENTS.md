# renderer-by-ext.ts — index

Pure extension→`RendererKind` table shared by the client `dispatchPreview` and the server canvas detector. Exports `RendererKind`, `RENDERER_BY_EXT`, `NON_FALLBACK_KINDS` (the canvas-policy universe), `extOf`, `rendererKindForPath`. No I/O, no MIME sniffing. `RendererKind` includes `webpage`: URL-target-only (never produced for a file extension) and deliberately excluded from `NON_FALLBACK_KINDS` / `CanvasKind`, so it is not a canvas type and canvas settings are unchanged. See change: rich-chat-links (D11).
