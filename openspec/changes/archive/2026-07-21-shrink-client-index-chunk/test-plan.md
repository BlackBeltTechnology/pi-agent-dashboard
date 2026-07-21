# Test Plan — shrink-client-index-chunk

Adversarial scenarios for isolating `@mdi/js` from the eager `index` entry chunk and
removing its dynamic+static import warning. Manifest — `disposition` drives the fold
(`plan-proposal`) and defer (`ship-change`). Stage: design (HARD gate); no unfillable
slots remained after the doubt-review reframe (size cap measured, clean-build grep
sequences on the ci step `fix-vite-build-warnings` adds).

Repo levels: **L1** vitest · **L2/ci** `.github/workflows/ci.yml` · **L3** Playwright.

## Scenarios

### S1 — @mdi/js is a dedicated chunk; index chunk shrank
- **class:** edge-case · **technique:** state (chunk topology) + absolute threshold · **level:** L1 · **disposition:** automated
- **exemplar:** `packages/client/src/__tests__/eml-bundle-exclusion.test.ts` (entry-chunk exclusion) + `packages/client/src/__tests__/monaco-chunk-size.test.ts` (gzip cap)
- **Triple:** INPUT: `dist/` after `npm run build` · TRIGGER: build with `"mdi": ["@mdi/js"]` in manualChunks · OBSERVABLE: a `mdi-*.js` chunk exists **and** the main entry chunk (resolved from `index.html`) does NOT contain an `@mdi/js` marker (e.g. `mdiZodiacAquarius`) **and** the gzipped `index` chunk ≤ **900 KB** (baseline ~1388 KB). Skip-if-no-build.

### S2 — No @mdi/js dynamic-import warning (authoritative gate)
- **class:** error-handling · **technique:** output assertion · **level:** L2/ci · **disposition:** automated
- **exemplar:** `.github/workflows/ci.yml` — extend the build-log grep step added by `fix-vite-build-warnings` (test-plan #S5) to also forbid an `@mdi/js` … `dynamic import will not move module into another chunk` line
- **Triple:** INPUT: full `npm run build` stdout+stderr · TRIGGER: CI build step · OBSERVABLE: no `dynamic import will not move module into another chunk` line naming `@mdi/js`. (Catches the design risk that a manualChunk alone fails to silence it — only the static conversion does.)

### S3 — Icon-by-key resolves synchronously (arbitrary keys) after static conversion
- **class:** frontend-quirk · **technique:** equivalence partitioning (valid / unknown key) · **level:** L1 · **disposition:** automated
- **exemplar:** `packages/client-utils/src/__tests__/ActionList.test.tsx` / `StatusPill.test.tsx`
- **Triple:** INPUT: an `ActionList`/`StatusPill` rendered with (a) a valid key `mdiRefresh`, (b) an unknown key `mdiNotAReal` · TRIGGER: synchronous `import * as mdi` + `mdi[key]` lookup (post-conversion, no `useEffect`) · OBSERVABLE: (a) the icon `<path>` renders; (b) nothing renders and no error is thrown.

## Non-goals (NOT tested)
- The oversized-chunk (>700 kB) aggregate warning is an accepted notice — no scenario
  asserts its presence or absence; `chunkSizeWarningLimit` stays 700.

## New infra needed
- None new: S2 extends the ci.yml grep step introduced by `fix-vite-build-warnings`.

## Fold summary
- **automated → test task:** S1, S2, S3 (3 rows)
- **manual-only:** none
