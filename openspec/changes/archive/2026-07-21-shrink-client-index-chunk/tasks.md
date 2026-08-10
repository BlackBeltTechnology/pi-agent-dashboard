## 1. Baseline

- [x] 1.1 Confirm sequencing: `fix-vite-build-warnings` is landed (shares `client-build-config` + the ci.yml build-log grep step S2 extends). Capture `npm run build 2>&1 | tee /tmp/shrink-before.log` and current `index`/`mdi` gzip sizes.

## 2. #1 Warning fix — align dynamic @mdi sites to static

- [x] 2.1 In `packages/client-utils/src/ActionList.tsx`, replace the dynamic `import("@mdi/js").then(mdi => mdi[iconKey])` (+ `useEffect`/state) with a static `import * as mdi from "@mdi/js"` and a synchronous `mdi[iconKey]` lookup (null when absent).
- [x] 2.2 Same conversion in `packages/client-utils/src/StatusPill.tsx`.

## 3. #2 Placement — @mdi/js own chunk

- [x] 3.1 Add `"mdi": ["@mdi/js"]` to the `manualChunks` map in `packages/client/vite.config.ts`. Leave `chunkSizeWarningLimit` at 700 (do NOT change it).

## 4. Tests (folded from test-plan.md — automated rows)

- [x] 4.1 S1 — L1 build-artifact test (see `packages/client/src/__tests__/eml-bundle-exclusion.test.ts` + `monaco-chunk-size.test.ts`): after build assert a `mdi-*.js` chunk exists, the main entry chunk excludes an `@mdi/js` marker (e.g. `mdiZodiacAquarius`), and the gzipped `index` chunk ≤ 900 KB; skip-if-no-build. Triple: dist · mdi manualChunk · mdi chunk + index excludes @mdi + index gz ≤ 900 KB. (test-plan #S1)
- [x] 4.2 S2 — L2/ci: extend the build-log grep step in `.github/workflows/ci.yml` (added by fix-vite-build-warnings) to also fail on an `@mdi/js` + `dynamic import will not move module into another chunk` line. Triple: build stdout+stderr · CI build step · no @mdi dynamic-import warning. (test-plan #S2)
- [x] 4.3 S3 — L1 component test (see `packages/client-utils/src/__tests__/ActionList.test.tsx` / `StatusPill.test.tsx`): render with a valid key `mdiRefresh` → icon `<path>` renders; render with an unknown key → nothing renders, no throw. Triple: valid + unknown key · sync mdi[key] lookup · path renders / null no-throw. (test-plan #S3)

## 5. Verify

- [x] 5.1 `npm run build 2>&1 | tee /tmp/shrink-after.log`; the `@mdi/js` dynamic-import warning is gone; `index` gzip dropped (≈700 KB); a `mdi-*.js` chunk is present. The oversized-chunk aggregate warning intentionally REMAINS (documented; `monaco` is the floor).
- [x] 5.2 `npm test 2>&1 | tee /tmp/shrink-test.log`; S1–S3 green, existing ActionList/StatusPill suites green.
- [x] 5.3 `npm run quality:changed` clean — no orphaned imports/state from the dynamic→static conversion.
