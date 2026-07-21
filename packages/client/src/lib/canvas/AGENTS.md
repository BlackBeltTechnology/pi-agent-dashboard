# DOX — packages/client/src/lib/canvas

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `canvas-doc-csp.ts` | Injects subresource-blocking CSP meta into auto-opened file docs. See change: auto-canvas. |
| `canvas-gate.ts` | Pure canvas viewport-gate + two-phase state reducers. See change: auto-canvas. |
| `canvas-types-api.ts` | Client helper + pure selector for the canvas-type registry REST API. `GET/PATCH /api/canvas-types` → `{global,project,effective}`. `CanvasTypesScope`, `CanvasTypesResponse`. See change: auto-canvas. |
