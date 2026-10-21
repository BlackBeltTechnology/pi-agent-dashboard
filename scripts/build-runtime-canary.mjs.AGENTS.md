# build-runtime-canary.mjs — index

Builds `tests/fixtures/runtime-canary-plugin/` and `variants/*` with the SDK preset (`dashboard-plugin-runtime/src/vite-plugin/client-preset.ts`, loaded via jiti).
- Exports: `CANARY_ROOT`, `CANARY_BUILDS` (base + missing-export, bundled-react, throws-in-render, bundled-app-kit), `buildRuntimeCanary({baseOnly})` → `{name: distClientDir}`.
- CLI: `node scripts/build-runtime-canary.mjs [--base-only] [--out-json]`; `npm run build:canary`.
- Output `<root>/dist/client/{index.js,s6-route.js,lazy-panel.js,client.css}` (variants: `index.js` only). Never committed.
- Variants 2 and 4 use the preset's TEST-ONLY `unsafeBundleSpecifiers` (bypasses the singleton guard); variant 4 aliases app-kit/react to source (app-kit ships dist-only exports).
- Harness (task 7.5) builds once, hashes the output, trusts the hash; never rebuilds after seeding.
- Test: `__tests__/build-runtime-canary.test.mjs` — manifest validates, layout has no `clientLayoutError`, bare imports ⊆ import map, no bundled React/markdown parser, utilities-only CSS, variant shapes.

See change: decouple-plugins-from-core (tasks 7.4, 8.1).
