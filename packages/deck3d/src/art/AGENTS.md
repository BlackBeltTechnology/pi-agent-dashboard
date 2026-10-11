# DOX — packages/deck3d/src/art

`deck3d art trace|icon|cutout`. Pixels in/out through a pure-TS PNG codec; images decode in a sandboxed chromium page. Spec deck3d-art-tooling.

| File | Purpose |
|------|---------|
| `AGENTS.md` | This file. |
| `png.ts` | Pure-TS PNG encode (8-bit RGBA, deterministic) / decode (8-bit non-interlaced), `cropRgba`, `resizeRgba`. See change: deck3d-pptx-import. |
| `decode.ts` | `openSandbox`: chromium page with JS off, every request but the input aborted, 20 MB cap; SVG rasterised as `<img>`. `DecodeUnavailableError` carries the install hint. See change: deck3d-pptx-import. |
| `trace.ts` | `traceImage`: classify (palette) → 4-connected components → crack-following boundary loops → RDP; outer CCW (area > 0), holes CW; byte-identical for identical pixels. See change: deck3d-pptx-import. |
| `icon.ts` | `svgToPolylines`: SVG parsed as data (caps: 2 MB, 50 000 elements, 500 000 points, no DOCTYPE); paths `MLHVCSQTAZ`, shapes, transforms; arcs sampled on the true ellipse. See change: deck3d-pptx-import. |
| `cutout.ts` | `cutout`: colour-to-alpha, 8-connected `--split` regions with source-pixel boxes, `--max` downscale. See change: deck3d-pptx-import. |
