# PreviewOverlayView.tsx — index

Full-viewport shell for overlay routes `/folder/:cwd/view?path=` + `/pi-view?url=`. Back button + label header. Reuses `PreviewBody` from `PreviewCard.tsx` so inline + overlay share renderer components. See change: render-file-previews.

Provenance from `ni`: `useNavIntentVerdict` — no `ni` → agent; verify ≤ 2 s (body not mounted while pending) → `PreviewProvenance autoOpened={false}` only on `{ok:true}`. See change: harden-client-sinks.

Web page URL targets (`kind === "webpage"`): header adds `EmbeddedFromLabel` ("embedded from <host>") and the `TabActions` url action ("Open in browser"). Route opens carry no opener → `WebPagePreview` shows the "Check and embed" card, no probe. See change: rich-chat-links (D11, task 8.7).
