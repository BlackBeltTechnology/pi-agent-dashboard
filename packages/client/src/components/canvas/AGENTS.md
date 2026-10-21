# DOX — packages/client/src/components/canvas

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `CanvasDriver.tsx` | Auto-canvas driver. Consumes a session's `CanvasState`; viewport-gated open via `useSplitWorkspace`… → see `CanvasDriver.tsx.AGENTS.md` |
| `CanvasServerChip.tsx` | Declared-server confirm chip (`data-testid=canvas-server-chip`, carries only port). → see `CanvasServerChip.tsx.AGENTS.md` |
| `useOpenCanvasTarget.ts` | Shared canvas-target opener: `open(target,{opener,background,bump})` (file→`openInSplit`, `.html`→`openStaticTarget`, non-loopback url→`openUrlTarget`; loopback url never opened) + `openServer(port,path)` (probe→restricted preset opener `agent`) + `serverStatus`. Used by `CanvasDriver`, `CanvasServerChip`, `CanvasToolRenderer`. See change: improve-canvas-html-and-url-ux. |
