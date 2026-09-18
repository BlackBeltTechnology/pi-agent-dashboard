# DOX — packages/deck3d/src/props

Prop pipeline: LLM selects from a candidate table; code searches, fetches, hash-pins (design D7). See change: add-deck3d-presentation-package.

| File | Purpose |
|------|---------|
| `AGENTS.md` | This file. |
| `search.ts` | Vendored corpus search (`vendoredCandidates`/`vendoredPath` over `assets/props/manifest.json`, offline, id-sorted) + Poly Pizza (`searchPolyPizza`, `POLY_PIZZA_KEY`, `DECK3D_HTTP_TIMEOUT_MS`; unset/unreachable/timeout → vendored-only + one-line notice). `parsePolyResponse` is the defensive parser. `searchProps` = vendored first, writes no files. |
| `fetch.ts` | `fetchProp(candidate, { destDir, sizeCap, sha256 })`: download/copy → glTF/GLB magic check → self-containment (reject external buffer URIs) → inclusive size cap (default 8 MiB) → sha256 write-if-absent / fail-if-differs in `.deck3d/props/<source>-<id>.glb` (slug-only). `PropFetchError` carries the CLI reason. |
