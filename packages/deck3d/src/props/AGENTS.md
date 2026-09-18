# DOX — packages/deck3d/src/props

Prop pipeline: LLM selects from a candidate table; code searches, fetches, hash-pins (design D7). See change: add-deck3d-presentation-package.

| File | Purpose |
|------|---------|
| `AGENTS.md` | This file. |
| `search.ts` | Vendored corpus search (`vendoredCandidates`/`vendoredPath` over `assets/props/manifest.json`, offline, id-sorted) + Poly Pizza (`searchPolyPizza`, `POLY_PIZZA_KEY`, `POLY_PIZZA_ENDPOINT`, `DECK3D_HTTP_TIMEOUT_MS`; unset/unreachable/timeout → vendored-only + one-line notice). `parsePolyResponse` is the defensive parser. `searchProps` = vendored first, writes no files. |
| `fetch.ts` | `fetchProp(candidate, { destDir, sizeCap, sha256 })`: download/copy → glTF/GLB magic check → self-containment (reject external `buffers[].uri` AND `images[].uri`) → inclusive size cap (default 8 MiB) → sha256 write-if-absent / fail-if-differs in `.deck3d/props/<source>-<id>.glb` (slug-only). `PropFetchError` carries the CLI reason. |
| `key.ts` | `propSlug`/`propKey` (`<source>-<id>`) — the cache filename shared by fetch, embed, generate, runtime. |
| `embed.ts` | `loadProps(ir, jsonFile)`: resolve each *placeable* `overrides.props[]` from `.deck3d/props/<key>.glb`, verify the pinned sha256, return `{ key: base64 }`. Missing/tampered → `PropEmbedError` naming prop + fetch remedy (no HTML). `activeProps` (dangling `node:` role stays inert), `requiresAttribution`, `creditsSlide` (render-only `credits` slide). |
| `generate.ts` | `generateProp({fromImage,name,destDir})`: shell to `python3 -c` `gradio_client` (`tencent/Hunyuan3D-2` `/shape_generation`, extract `r[0]['value']`), download → cache as `generated` + `restyle:palette`; missing client → install hint. Injectable spawn. |
