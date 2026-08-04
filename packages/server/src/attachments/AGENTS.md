# attachments — index

Display-fit + originals handling for inline image attachments.

| File | Purpose |
|---|---|
| `display-fit.ts` | Pure fit primitive for inline image blocks. Exports `fitImageBlockForDisplay(block)`, `isAnimatedGif(bytes)`, `DISPLAY_MAX_EDGE`=768, `DISPLAY_JPEG_QUALITY`=75. Resizes to a 768 px long edge via jimp; NEVER upscales and returns byte-identical input at/under the bound (no re-encode, no quality loss). PNG-in→PNG-out, else JPEG@q75. Animated GIFs exempt (D11) — `isAnimatedGif` counts Image Descriptor `0x2C` blocks, short-circuits at 2, so animation is never flattened to a still. Never throws: undecodable input returns `{failed:true}` so the caller can store the message row and render an honest failed state. Called from a worker so the measured 174–874 ms decode/encode stays off the event loop (D4). See change: fit-attachments-for-display. |
