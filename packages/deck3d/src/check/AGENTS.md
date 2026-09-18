# DOX — packages/deck3d/src/check

Browser fit/legibility/overlap/occlusion/contrast check over `__deck3d.measure()` (design D8). See change: add-deck3d-presentation-package.

| File | Purpose |
|------|---------|
| `AGENTS.md` | This file. |
| `rules.ts` | Pure rules over `Measurement[]`. `fitFindings` (union vs 4 % safe margin), `legibilityFindings` (cap height ≥ 14 px at 1080, scaled by height), `overlapFindings` (label IoU > 0.1, epsilon-guarded), `occlusionFindings` (raycast hit ≠ own id), `contrastFindings` (ratio ≥ 3:1, warn-only). Every `Finding` carries severity, slide id/index, measured vs threshold strings, and a `suggest` key spelled in the `overrides` grammar. `formatFinding` renders the one-line CLI form. |
| `index.ts` | `runCheck(html, opts)`: launches chromium, per viewport (default `1920x1080,1280x720`) at dpr 1, per slide at `t=0` + each `peaks()` value; samples label-background luminance via `drawImage` + `getImageData` (renderer uses `preserveDrawingBuffer`). `DECK3D_CHECK_TIMEOUT_MS` (default 120 s) per viewport; `CheckUnavailableError` when chromium is absent. `parseViewports("WxH,WxH")`. |
