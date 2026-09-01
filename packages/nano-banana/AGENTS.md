# DOX — packages/nano-banana

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `.pi/skills/nano-banana-imagegen/SKILL.md` | Image gen/edit skill via Gemini image models. Ships `pi-nano-banana` CLI (TS wrapper, resolves `GEMINI_API_KEY`, delegates to `@the-focus-ai/nano-banana`). Text-to-image, edit (`--file`), style transfer. Flags: `--output`, `--model`, `--flash` (gemini-2.0-flash), `--prompt-file`, `--list-models`. Workflow: clarify → craft prompt (prompting-guide.md) → generate → iterate. |
| `.pi/skills/nano-banana-imagegen/references/headers-and-heroes.md` | Prompt templates: blog/article headers (16:9, e.g. petrol teal #0e3b46 + warm white #faf9f6, NO dark bg/neon/robots), landing heroes (SaaS isometric, app-store feature), social headers (LinkedIn 1584x396, Twitter 1500x500). |
| `.pi/skills/nano-banana-imagegen/references/icons-and-logos.md` | Prompt templates: app icons (meditation lotus, fitness, notes, weather; readable at 64x64), logos (tech startup single-color, creative agency, environmental nonprofit), favicon (32x32, high contrast, light+dark backgrounds). |
| `.pi/skills/nano-banana-imagegen/references/illustrations.md` | Prompt templates: editorial (concept, explainer), character (mascot, avatar), decorative (pattern, spot), technical (network diagram, process flow), artistic styles (watercolor, line art, retro/vintage). |
| `.pi/skills/nano-banana-imagegen/references/photography-and-editing.md` | Photorealistic prompts (product, food, portrait, landscape, architecture) + `--file` edit recipes: background swap, style transfer, object add/remove/modify, lighting + color-grade enhancement, compositing (snow, watermark). Scene gen: interior design, outdoor. |
| `.pi/skills/nano-banana-imagegen/references/prompting-guide.md` | Comprehensive prompt guide: layered structure [Subject]+[Action]+[Setting]+[Style]+[Technical]+[Negative], length tiers (10-20/30-60/80+ words), lighting/aspect-ratio/quality vocab, brand-guide/scene/product/character patterns, negative-guidance lists, iterative refinement, external Gemini refs. |
| `README.md` | Package overview. TS port of standalone `nano-banana-imagegen` pi skill, no Python. Generate/edit images via Gemini through `@the-focus-ai/nano-banana` CLI, wrapped with key resolution + batch. Exposed as pi skill (`.pi/skills/nano-banana-imagegen`) + CLI bin `pi-nano-banana`. Programmatic `generateImage`/`batchGenerate` reused by video-production storyboard step. |
| `package.json` | Package manifest. Name `@blackbelt-technology/pi-dashboard-nano-banana`. `pi.skills` → `.pi/skills/nano-banana-imagegen`. bin `pi-nano-banana` → `src/bin/nano-banana.ts`. `exports` map `./*.js`→`./src/*.ts` for cross-package TS import. dep `@blackbelt-technology/pi-dashboard-shared`. |
| `tsconfig.json` | Extends `../../tsconfig.base.json`; `rootDir` src, `outDir` dist. |
| `vitest.config.ts` | Vitest config. `include` `src/**/__tests__/**/*.test.ts`, node env, forks pool, maxWorkers 1, testTimeout 30000. |
