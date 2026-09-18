# DOX — packages/deck3d

Deterministic Markdown → self-contained 3D presentation engine (`deck3d` CLI + pi skill).

| File | Purpose |
|------|---------|
| `AGENTS.md` | This file — per-file map for the package root. |
| `README.md` | Install, markdown grammar, CLI commands, IR/overrides, tune loop, effects, props, tests, build. |
| `package.json` | Manifest. Name `@blackbelt-technology/pi-dashboard-deck3d`. `pi.skills` → `.pi/skills/deck3d`, bin `deck3d` → `bin/deck3d`. deps three (pinned 0.160.0), mermaid (exact 11.17.2, harvest), opentype.js, ajv, esbuild, playwright. `build` = bundle CLI + harvest + runtime + regenerate IR field reference; `files` ships `src/`+`assets/`+`dist/` and excludes every `__tests__`. |
| `bin/deck3d` | CLI launcher. Dev (tsx resolvable + `src/cli.ts` present) → `node --import tsx src/cli.ts`; else built `dist/cli.js` via a `node` subprocess (the CLI entry guard needs `argv[1]`); else exit 1 naming `npm run build`. |
| `tsconfig.json` | Extends `../../tsconfig.base.json`; `rootDir` src → `outDir` dist. |
| `vitest.config.ts` | Vitest config. Node env, forks pool, **maxWorkers 1** (browser-driving suites share one chromium), `testTimeout` 60 s, `passWithNoTests`. |
| `.gitignore` | Ignores `dist/`, `.deck3d/` (prop cache), local `*.deck3d.html`. |
| `.pi/skills/deck3d/reference/ir-fields.md` | GENERATED IR field reference (from `src/ir/schema.json` via `scripts/gen-ir-fields.ts`). The LLM's knob lookup; never hand-edit. |
| `assets/Poppins-Bold.ttf` | Vendored Poppins Bold TTF (SIL OFL 1.1). Subset at render time; the only font that renders Hungarian double-acute glyphs (`ő ű Ő Ű`) without earcut corruption. |
| `assets/LICENSE-Poppins.txt` | Poppins OFL 1.1 licence text + vendoring rationale. |
| `assets/props/AGENTS.md` | Subfolder — vendored CC0 prop corpus (`manifest.json`, `LICENSES.txt`, `<id>.glb`). |
| `scripts/build-cli.mjs` | Bundles `src/cli.ts` → `dist/cli.js` (esbuild, node ESM, `packages:external`, shebang) so the published `bin/deck3d` runs a built CLI. Wired into package `build`.
| `scripts/gen-ir-fields.ts` | Regenerates `reference/ir-fields.md` from the schema descriptions (`--check` = fail if stale); wired into package `build`. |
| `scripts/build-cli.mjs` | Bundles `src/cli.ts` (esbuild, node ESM, `packages:external`, shebang) → `dist/cli.js`; wired into package `build`. Requires `src/util/paths.ts` `pkgRoot` so the bundle resolves `src/`+`assets/`+`dist/runtime.js`.
| `scripts/build-harvest.ts` | Bundles `src/parse/harvest/harness.ts` (mermaid + harvest) → `dist/harvest/harness.js`; wired into package `build`. |
| `scripts/build-runtime.mjs` | Bundles `src/runtime/index.ts` (three.js engine, IIFE, no hashes) → `dist/runtime.js`; wired into package `build`. |
| `fixtures/AGENTS.md` | Subfolder — fixture decks for the harvest/parse/render suites. |

## Learnings carried over from the strategy-lab mockup

- **Hungarian double-acutes.** Every three.js `typeface.json` (helvetiker, droid, gentilis) ships corrupt `ő ű Ő Ű` outlines → earcut streaks and vanishing letters. Only a real TTF through opentype.js renders them. `assets/Poppins-Bold.ttf` is embedded; there is no typeface fallback.
- **Mermaid id scheme.** v11 renders node groups as `<renderId>-flowchart-<nodeId>-<n>` and edge paths as `<renderId>-L_<from>_<to>_<k>`. Harvest matches on those; the mermaid version is pinned exactly and the harvest fixtures fail if the scheme moves.
- **Hidden-tab loop.** Headless/background tabs stall `requestAnimationFrame`; the runtime falls back to `setTimeout` so build-time snapshots capture a finished frame.
- **Label treatment.** Extruded small text blooms and becomes unreadable; diagram labels are flat canvas planes filled `P.text` with an 18 % `P.bg` outline, `toneMapped:false`, offset in front of the node surface (`h/2` for round shapes).
- **Z-fighting / veil.** ONE global `Reflector` floor (not per-slide coplanar floors) with a radial-alpha veil, camera near 0.5, shadow bias/normalBias — all ported from the lab.
- **Bloom vs mode.** Bloom threshold/strength are mode-aware; glass transmission is lowered in light mode for text contrast.

## Test environment hooks

- `DECK3D_HARVEST_TIMEOUT_MS` — mermaid harvest timeout per block (default 60000).
- `DECK3D_CHECK_TIMEOUT_MS` — `check` timeout per viewport (default 120000).
- `DECK3D_HTTP_TIMEOUT_MS` — prop search/fetch request timeout (default 10000).
- `POLY_PIZZA_ENDPOINT` — override the Poly Pizza search endpoint (tests point it at a local mock).
- `DECK3D_HARVEST_STALL` — set to `1` to make the harvest page never resolve (timeout-path tests).
- Browser-driving suites self-skip without chromium (`describe.skipIf(!chromiumAvailable())`); CI installs chromium via `npx playwright install chromium --with-deps`.
