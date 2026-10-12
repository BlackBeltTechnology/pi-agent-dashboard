# DOX — packages/skill-atlas-plugin/src/server

See change: add-skill-atlas-screen.

| File | Purpose |
|------|---------|
| `atlas-service.ts` | `createAtlasService({getPiResources, broadcast, fs?})`. GET: stat-fingerprint (id/origin/pkg/description/path/mtime/ctime/size + scope + degraded) → memo hit without body reads, else read first 256 KiB + rebuild. ENOENT excludes + warns; other errors keep skill with empty body + warn. Memo LRU 32, key `global` / `project:<normalized abs cwd>`. Push: `onInvalidated(cwd)` → segment-related project keys + `global` → 500 ms debounce → fresh rescan → broadcast `skill_atlas_changed` only when graph hash ≠ last broadcast. Exports `normalizeCwd`, `pathsRelated`, `AtlasRequestError`, `whenIdle`. |
| `index.ts` | Server entry `registerPlugin`: wires host seams `getPiResources` / `onPiResourcesInvalidated`, mounts routes, disposes on shutdown; 501 route when the host lacks the seam. |
| `inputs.ts` | `skillEntries(result, scope)`: project = local ∪ global ∪ packages; global = global ∪ global-scope packages; disabled excluded; `packageSource` → package origin. |
| `routes.ts` | `GET /api/plugins/skill-atlas/graph` in an encapsulated scope with `@fastify/rate-limit` (loopback allow-listed). 400 bad params, 501 no seam. Tier row in `route-tiers.ts` (observe); MCP-denylisted. |
| `__tests__/atlas-service.test.ts` | Membership, route, body limit, fingerprint, memo key, affected keys, push races, file errors (test-plan E2, E16–E22, F5, X2–X6, X9). |
| `__tests__/atlas-perf.test.ts` | P1 memo-hit p95 < 100 ms at 100 skills; P2 rebuild < 500 ms at 300 × 256 KiB. |
