## Why

The production client `index` entry chunk is **4.8 MB** — of which **~2.6 MB is the
entire `@mdi/js` icon set** (all ~7000 SVG paths), pulled in eagerly because
`ActionList.tsx` / `StatusPill.tsx` resolve extension-supplied icon keys via a
full-namespace lookup (`import("@mdi/js").then(mdi => mdi[iconKey])`) that defeats
tree-shaking, while 202 other files also import `@mdi/js`. That same namespace access
is the root cause of the `@mdi/js` "dynamic import will not move module into another
chunk" build warning. This change splits the bloat out of the eager entry chunk and
then sets a deliberate, documented `chunkSizeWarningLimit`.

This is the structural follow-up deliberately deferred from `fix-vite-build-warnings`,
which handled only the mechanical, zero-behavior warnings.

## What Changes

- **Kill the `@mdi/js` dynamic+static warning at its real root** — convert the two
  dynamic `import("@mdi/js")` sites (`ActionList.tsx`, `StatusPill.tsx`) to static
  namespace imports. The warning fires because `@mdi/js` is dynamically imported yet
  ALSO statically imported (incl. a static `import * as mdi` in `mdi-icon-lookup.ts`
  reachable from the eager root), so the dynamic import has no lazy target. Aligning the
  two stragglers to static removes the conflict. Size-neutral: the static namespace
  import already forces the full icon set eager. A `manualChunks` entry alone does NOT
  reliably silence this warning — the reliable fix is import-strategy alignment.
- **Split `@mdi/js` into its own manual chunk** (separate concern: placement, not the
  warning) — add `"mdi": ["@mdi/js"]` to `manualChunks` so the ~2.6 MB of icon paths
  leaves the eager `index` chunk (index ~1388 KB gz → ~700 KB gz expected) into a
  separately-cacheable `mdi` chunk. **Honest scope:** `App.tsx` statically imports
  `@mdi/js`, so the `mdi` chunk still loads eagerly — this **relocates** bytes (better
  caching: icons change far less often than app code); it does **not** reduce
  initial-download bytes. Icon keys are open-ended (any extension may request any icon),
  so the namespace lookup is retained — no tree-shaking.
- **Guard the shrink with a gzip size-test** (repo convention — see
  `monaco-chunk-size.test.ts`), NOT a config comment: assert the gzipped `index` chunk
  dropped below a cap and a `mdi` chunk exists.

**Explicitly NOT in scope:** silencing the oversized-chunk (>700 kB) aggregate warning.
`monaco` (3.9 MB, intentional + lazy) is the floor; zeroing that warning needs a blunt
limit ≥ 4 MB. `chunkSizeWarningLimit` stays at its deliberate **700**; the aggregate
warning remains a known, documented notice.

## Capabilities

### New Capabilities
<!-- none: internal build-tooling / bundle-structure change -->

### Modified Capabilities
- `client-build-config`: add a requirement covering the `@mdi/js` chunk placement
  (icons out of the eager entry chunk) and the deliberate `chunkSizeWarningLimit`.

## Impact

- `packages/client/vite.config.ts` — `manualChunks` (`mdi` entry), `chunkSizeWarningLimit`.
- Depends on / sequences after `fix-vite-build-warnings` (shares `client-build-config`
  and the `markdown` chunk sizing).
- No dependencies added or removed; no runtime behavior change. Verified by before/after
  `dist/assets` chunk sizes and a clean build.

## Sequencing

Sequences **after** `fix-vite-build-warnings` lands (shares `client-build-config` and
depends on the enlarged `markdown` chunk when choosing the limit). The
`chunkSizeWarningLimit` value is set against the post-`fix` chunk inventory.
