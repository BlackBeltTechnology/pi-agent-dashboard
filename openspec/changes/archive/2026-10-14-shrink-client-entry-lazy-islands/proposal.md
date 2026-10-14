## Why

The client entry chunk (`index-*.js`) is **944,327 B gzipped in CI** (940,548 B locally, 3.17 MB raw) against a 920–924 KB cap in `mdi-chunk-size.test.ts`, which has already been raised twice (900 → 910 → 920) with the note "a size win is still owed before any further raise". Every PR is ~1.8 KB from a red CI.

A source-map attribution of the entry chunk (`vite build --sourcemap`, per-source byte spans) shows three always-loaded subsystems that most sessions never use:

| Subsystem | Raw in entry | ~gz | Why eager today |
|---|---|---|---|
| `katex` (+ `rehype-katex`, KaTeX CSS — 393 `.katex` rules in the entry stylesheet) | 254 KB | ~70 KB | static `rehype-katex` import in `MarkdownContent.tsx`; `katex.min.css` imported in `main.tsx`; not in any `manualChunks` group, so Rollup leaves it in `index` |
| Non-English catalogs: `i18n-hu.ts` (125 KB) + inline `zhCN` in `i18n.tsx` (~80 KB) | ~205 KB | ~55 KB | static `huCatalog` import + inline dictionary; English users download both |
| `components/settings/*` — `SettingsPanel.tsx` alone 91 KB | 296 KB | ~65 KB | static import at `App.tsx:47`; only `App.tsx` imports the module |

The largest remaining item — eager plugin client code via the generated plugin registry (~560 KB raw) — changes the plugin manifest contract and is handled separately in `lazy-plugin-claim-modules`.

## What Changes

- **KaTeX on demand (A+A+)**: `katex`, `rehype-katex` and the KaTeX stylesheet move to one lazily-imported "math engine" module. `MarkdownContent` keeps `remark-math` (6 KB) static to *detect* math nodes; when a rendered content has math it triggers a single shared load and re-renders with `rehypeKatex`. Until then math renders as literal source (no throw). `AsciiDocPreview`'s existing `import("katex")` reuses the same chunk. `vite.config.ts` gets a `katex` manual-chunk group so the engine is one cacheable chunk and is never pulled back into `markdown`/`index`.
- **Lazy non-English catalogs (B)**: `zhCN` moves out of `i18n.tsx` into `i18n-zh-CN.ts`; both `zh-CN` and `hu` load via `import()`. `main.tsx` awaits the initial language's catalog before `createRoot().render` (non-English users only — no English flash). `setLanguage` loads, then applies. Plugin catalogs registered earlier are buffered and merged on load. `translationsOf` stops reading runtime dictionaries (see design D4).
- **Lazy Settings panel (C)**: `App.tsx` renders `SettingsPanel` via `React.lazy` + `Suspense` at both call sites, with an in-panel loading state and an error boundary with retry.
- **Guard + cap**: extend `mdi-chunk-size.test.ts` with landing-graph absence checks for the three subsystems (marker strings), and **lower `INDEX_GZ_CAP_BYTES`** to the measured post-change size rounded up to the next 10 KB (spec ceiling 800 KB). The test comment records the measurement.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `client-build-config`: entry cap lowered (≤ 800 KB); new requirement that katex, non-English catalogs and the Settings panel stay off the cold-landing graph.
- `markdown-rendering`: math engine loads on demand; literal-source rendering before load / on failure.
- `ui-i18n-coverage`: non-English catalogs load on demand with no startup flash; plugin-catalog merge on late load.
- `settings-panel`: panel module loads on first open, with loading and error states.

## Impact

- `packages/client/src/components/preview/MarkdownContent.tsx`, `AsciiDocPreview.tsx`, new `lib/preview/math-engine.ts`; `main.tsx` (drop global KaTeX CSS import, await initial catalog).
- `packages/client/src/lib/i18n/i18n.tsx`, new `i18n-zh-CN.ts`, `i18n-hu.ts` (unchanged content), `lib/settings-promotions.ts` (`translationsOf` consumer).
- `scripts/i18n-parity.mjs` — reads `zh-CN` from `i18n-zh-CN.ts` instead of `i18n.tsx`.
- `packages/client/src/App.tsx` (lazy Settings), `packages/client/vite.config.ts` (`katex` group).
- `packages/client/src/__tests__/mdi-chunk-size.test.ts` (new guards, lower cap); `openspec/specs/client-build-config` cap value updated (spec said ≤ 900 KB while the test sat at 920 KB — drift fixed here).
- UX: first math message / first Settings open / first language switch incurs one extra request (~70 / ~65 / ~30 KB gz). Non-English cold start waits for its catalog before first paint.
- No server, protocol, or dependency change. Rollback: revert; no persisted state.
- Expected entry size: ~755 KB gz (−185 KB), confirmed by measurement in tasks.

## Discipline Skills

- `performance-optimization` — measured budget (entry gz) with before/after numbers; no optimisation without the source-map attribution.
- `doubt-driven-review` — D4 (`translationsOf` source) and the pre-render catalog await change startup ordering; stress-test before they stand.
- `review-code` — before commit.
- No security / observability triggers: client bundling only, no new endpoint or untrusted input.
