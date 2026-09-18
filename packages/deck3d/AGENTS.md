# DOX — packages/deck3d

Deterministic Markdown → self-contained 3D presentation engine (`deck3d` CLI + pi skill).

| File | Purpose |
|------|---------|
| `AGENTS.md` | This file — per-file map for the package root. |
| `package.json` | Manifest. Name `@blackbelt-technology/pi-dashboard-deck3d`. `pi.skills` → `.pi/skills/deck3d`, bin `deck3d` → `bin/deck3d`. deps three (pinned 0.160.0), mermaid (exact 11.17.2, harvest), opentype.js, ajv, esbuild, playwright. `build` = bundle harvest + runtime + regenerate IR field reference. |
| `bin/deck3d` | CLI launcher. Runs built `dist/cli.js` when present, else `node --import tsx src/cli.ts` (dev checkout). |
| `tsconfig.json` | Extends `../../tsconfig.base.json`; `rootDir` src → `outDir` dist. |
| `vitest.config.ts` | Vitest config. Node env, forks pool, **maxWorkers 1** (browser-driving suites share one chromium), `testTimeout` 60 s, `passWithNoTests`. |
| `.gitignore` | Ignores `dist/`, `.deck3d/` (prop cache), local `*.deck3d.html`. |
| `.pi/skills/deck3d/reference/ir-fields.md` | GENERATED IR field reference (from `src/ir/schema.json` via `scripts/gen-ir-fields.ts`). The LLM's knob lookup; never hand-edit. |
| `assets/Poppins-Bold.ttf` | Vendored Poppins Bold TTF (SIL OFL 1.1). Subset at render time; the only font that renders Hungarian double-acute glyphs (`ő ű Ő Ű`) without earcut corruption. |
| `assets/LICENSE-Poppins.txt` | Poppins OFL 1.1 licence text + vendoring rationale. |
| `assets/props/AGENTS.md` | Subfolder — vendored CC0 prop corpus (`manifest.json`, `LICENSES.txt`, `<id>.glb`). |
| `scripts/gen-ir-fields.ts` | Regenerates `reference/ir-fields.md` from the schema descriptions (`--check` = fail if stale); wired into package `build`. |
| `scripts/build-harvest.ts` | Bundles `src/parse/harvest/harness.ts` (mermaid + harvest) → `dist/harvest/harness.js`; wired into package `build`. |
| `scripts/build-runtime.mjs` | Bundles `src/runtime/index.ts` (three.js engine, IIFE, no hashes) → `dist/runtime.js`; wired into package `build`. |
| `fixtures/AGENTS.md` | Subfolder — fixture decks for the harvest/parse/render suites. |
