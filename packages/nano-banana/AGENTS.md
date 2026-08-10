# DOX — packages/nano-banana

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. TS port of standalone `nano-banana-imagegen` pi skill, no Python. Generate/edit images via Gemini through `@the-focus-ai/nano-banana` CLI, wrapped with key resolution + batch. Exposed as pi skill (`.pi/skills/nano-banana-imagegen`) + CLI bin `pi-nano-banana`. Programmatic `generateImage`/`batchGenerate` reused by video-production storyboard step. |
| `package.json` | Package manifest. Name `@blackbelt-technology/pi-dashboard-nano-banana`. `pi.skills` → `.pi/skills/nano-banana-imagegen`. bin `pi-nano-banana` → `src/bin/nano-banana.ts`. `exports` map `./*.js`→`./src/*.ts` for cross-package TS import. dep `@blackbelt-technology/pi-dashboard-shared`. |
| `tsconfig.json` | Extends `../../tsconfig.base.json`; `rootDir` src, `outDir` dist. |
| `vitest.config.ts` | Vitest config. `include` `src/**/__tests__/**/*.test.ts`, node env, forks pool, maxWorkers 1, testTimeout 30000. |
