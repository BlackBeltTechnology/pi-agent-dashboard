# DOX — packages/image-fit-extension

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Two interception seams. Seam 1 `pi.on("tool_call")`: on built-in `read` of image (`.png`/`.jpg`/`.jpeg`/`.webp`/`.gif`) probes dims via jimp, fits both → leaves `event.input.path` untouched, else re-encodes (long-edge scaled) to `os.tmpdir()/pi-image-fit/<session>/<sha256>.<ext>` + mutates `event.input.path`. Seam 2 `pi.on("context")`: role-agnostic, fits oversize `ImageContent` of any origin (tool_result/user-pasted/historical) in the per-turn deep copy → rescues already-persisted sessions on reload; jimp buffer resize + mime-keyed bounded LRU; cheap header-probe gate; no temp file. No native deps (jimp only). See change: image-fit-tool-result-images. |
| `vitest.config.ts` | Package vitest config (registered in root `vitest.config.ts` `test.projects`). See change: pi-image-fit-extension. |
