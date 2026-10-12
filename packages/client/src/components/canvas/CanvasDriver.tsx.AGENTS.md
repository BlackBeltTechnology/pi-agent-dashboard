# CanvasDriver.tsx — index

Auto-canvas driver. Consumes a session's `CanvasState`; viewport-gated open via `useSplitWorkspace` `openInSplit`/`openLiveTarget` (desktop/tablet) or a tap-to-open `canvas-file-chip` (mobile). Renders `CanvasServerChip`. Coexists with URL-driven preview. See change: auto-canvas (Section 6).
- Auto-open key consumed only when `gateAllowsAutoOpen(tier)`: target withheld on `mobile` opens once viewport grows (tier dep), no re-push needed.
- `canvas-chip-tray` portals via `LayerPortal` to `document.body`: `fixed bottom-4 left-4 z-toast`, `pointer-events-none` (chips `pointer-events-auto`). Never in-flow: App mounts the driver above the shell root, so an in-flow tray pushed the layout down (#681).

See change: surface-denial-remedy-in-previews — `openTarget` passes `autoOpened: background` (effect → `true`, chip tap → `false`); `restrictCsp` unchanged.
