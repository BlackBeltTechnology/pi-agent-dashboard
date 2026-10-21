# CanvasDriver.tsx — index

Auto-canvas driver. Consumes a session's `CanvasState`; viewport-gated open via `useSplitWorkspace` `openInSplit`/`openLiveTarget` (desktop/tablet) or a tap-to-open `canvas-file-chip` (mobile). Renders `CanvasServerChip`. Coexists with URL-driven preview. See change: auto-canvas (Section 6).
- Auto-open key consumed only when `gateAllowsAutoOpen(tier)`: target withheld on `mobile` opens once viewport grows (tier dep), no re-push needed.

See change: surface-denial-remedy-in-previews — `openTarget` passes `autoOpened: background` (effect → `true`, chip tap → `false`); `restrictCsp` unchanged.

See change: fix-canvas-chip-tray-overlay — the chip tray is a FLOATING overlay, not an in-flow block: `LayerPortal` → `document.body`, `fixed z-overlay pointer-events-none` (chips `pointer-events-auto`), `right:1rem`, `max-width:calc(100vw - 2rem)`. Optional `anchor?: HTMLElement | null` prop = App's `composer-stack-anchor` sentinel; `useAnchorBottom` sets `bottom = viewportBottom − anchor.top + 8px` (`visualViewport`-aware), via one `ResizeObserver` over the sentinel + its following siblings, a `childList` `MutationObserver` on their parent, and window/`visualViewport` `resize`; all torn down on cleanup. No anchor → `calc(1rem + env(safe-area-inset-bottom))`; anchor set but unmeasured → `visibility:hidden` (no flash over the composer). Auto-open effect, mobile gate, chip tap unchanged.
Observed set = sentinel + its PARENT (chat pane) + EVERY child row of the pane (before and after the sentinel): a pane resize or an in-place resize of a row above moves the stack top with no following row resizing. See change: fix-canvas-chip-tray-overlay (review rounds 1-2, B1).

Routing extracted to `useOpenCanvasTarget`; auto-open passes `{opener:"agent",background:true,bump}` (bump = same target identity, higher version); loopback url never auto-opens; publishes chip port via `setActiveCanvasPort`. See change: improve-canvas-html-and-url-ux.
