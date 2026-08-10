# DOX — packages/server/src/canvas

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `canvas-accumulator.ts` | Server-side stateful canvas accumulator (pure classifier lives in shared): per-session per-turn candidate buffer + eager/settle/reset lifecycle, wired to injected broadcast + settings-read fns (unit-tests without a live server). See change: auto-canvas. |
| `canvas-settings.ts` | Fresh effective-`canvasTypes` read for the canvas accumulator — NO cache, reads global (`~/.pi/agent/settings.json#dashboard.canvasTypes`) + project (`<cwd>/.pi/settings.json`) on every call; absent/malformed → all-on default. `readEffectiveCanvasTypes(cwd)`, `readCanvasTypesScopes(cwd)`. See change: auto-canvas. |
