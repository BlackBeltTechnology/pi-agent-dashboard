# CanvasDriver.tsx — index

Auto-canvas driver. Consumes a session's `CanvasState`; viewport-gated open via `useSplitWorkspace` `openInSplit`/`openLiveTarget` (desktop/tablet) or a tap-to-open `canvas-file-chip` (mobile). Renders `CanvasServerChip`. Coexists with URL-driven preview. See change: auto-canvas (Section 6).

See change: surface-denial-remedy-in-previews — `openTarget` passes `autoOpened: background` (effect → `true`, chip tap → `false`); `restrictCsp` unchanged.
