# CanvasDriver.tsx — index

Auto-canvas driver. Consumes a session's `CanvasState`; viewport-gated open via `useSplitWorkspace` `openInSplit`/`openLiveTarget` (desktop/tablet) or a tap-to-open `canvas-file-chip` (mobile). Renders `CanvasServerChip`. Coexists with URL-driven preview. See change: auto-canvas (Section 6).
- Auto-open key consumed only when `gateAllowsAutoOpen(tier)`: target withheld on `mobile` opens once viewport grows (tier dep), no re-push needed.

See change: surface-denial-remedy-in-previews — `openTarget` passes `autoOpened: background` (effect → `true`, chip tap → `false`); `restrictCsp` unchanged.
