# PreviewCard.tsx — index

Inline chat-message card for `/view` rows. Header: icon (per renderer kind) + target label + `⤢ expand` button → navigates to overlay route. Body: dispatches via `dispatchPreview`. Inline size caps per design D2 (markdown/asciidoc/html `max-h-[60vh]`, pdf `h-[60vh]`, video/youtube 16:9, image `max-h-[40vh] max-w-full`). Lazy-loads `PdfPreview` via `React.lazy`. Exports `PreviewBody` reused by overlay shell. See change: render-file-previews. `pptx` kind: `mdiFilePresentationBox` icon, `h-[60vh]` body cap, dispatches to `PptxPreview`. See change: render-pptx-preview.

Expand is a `SafeLink` to the overlay route; a plain click on an OPERATOR-provenance card mints a navigation intent (`mintNavIntent`) and navigates with `ni=`; agent cards, modifier / middle clicks and mint failure navigate without `ni`. See change: harden-client-sinks.
