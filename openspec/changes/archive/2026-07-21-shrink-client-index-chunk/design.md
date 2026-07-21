## Context

The production `index` entry chunk is ~4.8 MB raw / **1388 KB gz**; ~2.6 MB raw of that
is the full `@mdi/js` icon set. It is eager because `App.tsx` (eager root) plus ~200
files import `@mdi/js`, including a **static** `import * as mdi from "@mdi/js"` in
`mdi-icon-lookup.ts` (reachable from the eager root) that alone forces the full set in.
`ActionList.tsx`/`StatusPill.tsx` additionally do dynamic `import("@mdi/js")` to resolve
**arbitrary extension-supplied** icon keys — and that dynamic-vs-static split is what
triggers the `@mdi/js` "dynamic import will not move module into another chunk" warning.
Sequences after `fix-vite-build-warnings`.

## Goals / Non-Goals

**Goals:**
- Remove the `@mdi/js` dynamic+static import warning (reliably).
- Move `@mdi/js` out of the eager `index` entry chunk into its own cacheable chunk.
- Guard the shrink with a gzip size-test (build-failing), per repo convention.

**Non-Goals:**
- Reducing initial-download bytes (the `mdi` chunk stays eager — App imports it).
- Tree-shaking `@mdi/js` to used-only icons (icon keys are open-ended per extension).
- Silencing the oversized-chunk (>700 kB) aggregate warning — `monaco` (3.9 MB, lazy)
  is the floor; `chunkSizeWarningLimit` stays at the deliberate **700**.
- Splitting `monaco` or restructuring app code.

## Decisions

**#1 Warning fix — align the two dynamic sites to static (NOT via manualChunks).**
The `@mdi/js` warning fires because the module is both dynamically imported
(`ActionList.tsx`, `StatusPill.tsx`) and statically imported (many files, incl. the
static namespace import in `mdi-icon-lookup.ts`). A `manualChunks` entry relocates the
module but does **not** give the dynamic `import()` a lazy target (the chunk is eager
via `App.tsx`), so it does **not** reliably silence the warning. The reliable fix is the
canonical one: make all imports the same strategy — convert the two dynamic
`import("@mdi/js").then(mdi => mdi[key])` sites to a static `import * as mdi from
"@mdi/js"` + synchronous `mdi[key]` lookup. Size-neutral, because the static namespace
import in `mdi-icon-lookup.ts` already pins the full set eager. Verify by a clean build:
the `@mdi/js` warning line is absent.

**#2 Placement — `"mdi": ["@mdi/js"]` in `manualChunks`.** Separate concern from the
warning. Forces the icon set into its own `mdi` chunk, pulling ~2.6 MB raw out of
`index` (1388 KB gz → ~700 KB gz expected). Net: `index` smaller and app-code churn no
longer re-downloads the icons (they cache independently). Initial-download bytes are
~unchanged (the `mdi` chunk is eager).

**#3 Guard — gzip size-test, not a config comment.** Follow `monaco-chunk-size.test.ts`:
a build-failing vitest that gzips the `index` chunk and asserts it dropped below a cap
(gz ≤ **900 KB**; baseline 1388 KB, expected ~700 KB), and that a `mdi` chunk exists
(so a future refactor that re-inlines the icons fails loudly). `chunkSizeWarningLimit`
is left at **700** — untouched; the oversized aggregate warning stays a known notice.

## Risks / Trade-offs

- **#1 sync lookup** — converting dynamic→static makes `IconByKey` resolve synchronously
  (no `useEffect`/loading state). Verify the two components still render icons correctly
  (the value is identical; only the load timing changes, and the module is already
  eager). No visual/behavior change expected.
- **#2 no initial-load win** — stated as a non-goal so the change is not mis-sold; the
  win is caching + entry-chunk hygiene + warning removal.
- **Size-test cap** — 900 KB gz cap has headroom below the expected ~700 KB; if the real
  post-split value is higher, adjust the cap to a measured value rather than loosening
  blindly.
- **Ordering** — measured against the post-`fix-vite-build-warnings` inventory; re-measure
  if this lands first.
