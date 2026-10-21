# CanvasServerChip.tsx — index

Declared-server confirm chip (`data-testid=canvas-server-chip`, carries only port). Tap routes through LiveServerViewer loopback probe (`onTap(127.0.0.1:port)`); NO pre-tap fetch. See change: auto-canvas (Section 7).

See change: fix-canvas-chip-tray-overlay — chip chain is shrinkable inside the floating tray (`min-w-0 max-w-full` on the wrapper + button, `truncate` on the label, `shrink-0` on icon + `:port`); the button is `pointer-events-auto` because the tray itself is `pointer-events-none`.

Probe moved to `useOpenCanvasTarget().openServer`; chip shows `:port/path`; no `onTap` prop; tap opens restricted preset at declared path. See change: improve-canvas-html-and-url-ux.
