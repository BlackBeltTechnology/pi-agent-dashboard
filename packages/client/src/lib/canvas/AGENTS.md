# DOX — packages/client/src/lib/canvas

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `active-canvas-target.ts` | Tiny store: `setActiveCanvasPort(sessionId,port|null)` / `useActiveCanvasPort` so the picker lists the active canvas target first. See change: improve-canvas-html-and-url-ux. |
| `canvas-doc-csp.ts` | Injects subresource-blocking CSP meta into auto-opened file docs. See change: auto-canvas. |
| `canvas-gate.ts` | Pure canvas viewport-gate + two-phase state reducers. See change: auto-canvas. `CanvasState.sourceCallId` (last writer); `reduceCanvasChip` keeps chip `path`/`declarationId`; `canvasToolScalars` for `ToolContext.canvas`. See change: improve-canvas-html-and-url-ux. |
| `canvas-types-api.ts` | Client helper + pure selector for the canvas-type registry REST API. `GET/PATCH /api/canvas-types` → `{global,project,effective}`. `CanvasTypesScope`, `CanvasTypesResponse`. See change: auto-canvas. |
| `probe-loopback.ts` | `probeLoopbackServer(port,sessionId)`: preset `startLiveServer` → restricted mint → 3000 ms probe fetch of the capability root (tokenless browser `/live/` is 404). See change: improve-canvas-html-and-url-ux. |
| `use-canvas-tool-scalars.ts` | `useCanvasToolScalars(state)`: identity-stable `{key,sourceCallId,chipDeclarationId}` for the tool-context memo. See change: improve-canvas-html-and-url-ux. |
