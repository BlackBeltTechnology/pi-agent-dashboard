# CanvasDriver.tsx — index

Auto-canvas driver. Consumes a session's `CanvasState`; viewport-gated open via `useSplitWorkspace` `openInSplit`/`openLiveTarget` (desktop/tablet) or a tap-to-open `canvas-file-chip` (mobile). Renders `CanvasServerChip`. Coexists with URL-driven preview. See change: auto-canvas (Section 6).
- Auto-open key consumed only when `gateAllowsAutoOpen(tier)`: target withheld on `mobile` opens once viewport grows (tier dep), no re-push needed.

See change: surface-denial-remedy-in-previews — `openTarget` passes `autoOpened: background` (effect → `true`, chip tap → `false`); `restrictCsp` unchanged.

History (superseded by fix-chat-transcript-layout, below): fix-canvas-chip-tray-overlay made the tray a floating `fixed` overlay positioned by `useAnchorBottom` (ResizeObserver + MutationObserver over a 0-px sentinel); that machinery is deleted. Only the fallback overlay (`LayerPortal`, `fixed z-overlay pointer-events-none`, chips `pointer-events-auto`) survives.

Routing extracted to `useOpenCanvasTarget`; auto-open passes `{opener:"agent",background:true,bump}` (bump = same target identity, higher version); loopback url never auto-opens; publishes chip port via `setActiveCanvasPort`. See change: improve-canvas-html-and-url-ux.

See change: fix-chat-transcript-layout (D5) — tray now portals INTO `anchor` (App content-height chip slot `composer-stack-anchor`, `shrink-0 mx-5` above the dock) via `createPortal` while `anchor != null && split.mode !== "full"`: in flow, wrapper `flex flex-col items-end gap-2 pb-3 max-md:pb-6` (clears dock Hide handle). Else fallback: `LayerPortal` `fixed z-overlay pointer-events-none`, `bottom: calc(1rem + env(safe-area-inset-bottom))`. `useAnchorBottom`, `TRAY_GAP_PX`, hidden-until-measured state DELETED — no ResizeObserver/MutationObserver/viewport listeners. Reads `split.mode` from `useSplitWorkspace()`.
