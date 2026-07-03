# DOX — packages/image-fit-extension/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `cache.ts` | SHA-256 temp-file cache under `os.tmpdir()/pi-image-fit/<session>/`. Exports `ROOT_DIR`, `cacheKey({absPath,mtimeMs,maxEdge,maxBytes,quality})`, `scopeFor(sessionScope)` (sanitizes `[^A-Za-z0-9_-]` → `_`, collapses runs, trims, falls back to `default`), `ensureDir`, `hasCached`, `cleanupSession`, `cleanupOrphans` (24 h sweep, injectable clock). See change: pi-image-fit-extension. |
| `extension.ts` | Pi extension entry. Registers `pi.on("tool_call", ...)` gated on `toolName === "read"` + `isImagePath(input.path)`. Body wrapped in try/catch with fall-through (`event.input.path` reverts to original on any error; warns once via `console.warn`). `PI_IMAGE_FIT_DISABLE=1` skips registration entirely + logs one disabled-message line. Wires `session_shutdown` → `cleanupSession`. Fires `cleanupOrphans()` once on load. Emits one telemetry `console.log` per successful resize. See change: pi-image-fit-extension. |
| `policy.ts` | Exports `readConfigFromEnv(): { disabled, maxEdge, maxBytes, quality }`. Env vars `PI_IMAGE_FIT_DISABLE` / `PI_IMAGE_FIT_MAX_EDGE` / `PI_IMAGE_FIT_MAX_BYTES` / `PI_IMAGE_FIT_QUALITY`. Defaults 1568 / 4194304 / 85. Invalid values fall back to default + emit one `[pi-image-fit] WARN ` line naming the variable. See change: pi-image-fit-extension. |
| `resize.ts` | Exports `needsResize({bytes,maxBytes,dims,maxEdge})` predicate (long edge OR bytes), `outputFormatFor(srcPath)` (PNG-in → PNG-out, else JPEG), `isImagePath` regex `.png/.jpe?g/.webp/.gif`, `probeDims` (jimp lazy load), `resizeToFile` (long-edge `scaleToFit({w:maxEdge,h:maxEdge})` preserving aspect ratio, `getBuffer(JimpMime.png|jpeg, {quality})`). No `sharp` / `@napi-rs/image` / native deps. See change: pi-image-fit-extension. |
