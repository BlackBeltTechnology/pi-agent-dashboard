# 09-image-fit-extension.ps1 — index

Windows port of pi-image-fit install + dep-tree sanity. Verifies `@blackbelt-technology/pi-image-fit` installs, `src/extension.ts` present, jimp 1.x in tree, no `sharp` / `@napi-rs/image` / `@napi-rs/canvas`. Falls back to local workspace `packages/image-fit-extension` on registry miss.
