# DOX — packages/deck3d/src/compare

`deck3d compare`: score each slide against its reference render. Spec deck3d-variant-loop.

| File | Purpose |
|------|---------|
| `AGENTS.md` | This file. |
| `ssim.ts` | `ssim` (luminance, 8×8 windows, C1/C2 standard), `rgbDiff`, `frameRect` (slide aspect contain-fitted), `scoreFrame` (crop to the frame, both to 480 px wide). See change: deck3d-pptx-import. |
| `index.ts` | `compareDeck`: snapshot at rest per slide, score vs `<ref>/<slideId>.png`, `font-fallback` list, `--transition` frames at 25/50/75 %. Default threshold 0.85. See change: deck3d-pptx-import. |
