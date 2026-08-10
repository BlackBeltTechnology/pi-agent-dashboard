# DOX — packages/video-production

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `.env.example` | Template for the Veo/Gemini key `.env`. Accepts `VEO_API_KEY`/`GEMINI_API_KEY`/`GOOGLE_API_KEY`; per-project (nearest wins) or package-global fallback. Never commit real keys. |
| `README.md` | Package overview. TS port of standalone `veo-generator` + `veo-showreel-production-kit` pi skills, no Python. Parse `shots/*.md`, render one mp4/cut via Veo 3.1, storyboard first-frames via nano-banana. Exposed as pi skills + CLI bin `pi-veo` (parse/plan/render/storyboard). deps `@google/genai`, nano-banana, shared. |
| `package.json` | Manifest. Name `@blackbelt-technology/pi-dashboard-video-production`. `pi.skills` → veo-showreel-production-kit + veo-generator. bin `pi-veo` → `src/bin/veo.ts`. `exports` map `./*.js`→`./src/*.ts`. deps `@blackbelt-technology/pi-dashboard-nano-banana`, `-shared`, `@google/genai`. |
| `tsconfig.json` | Extends `../../tsconfig.base.json`; `rootDir` src, `outDir` dist. |
| `vitest.config.ts` | Vitest config. `include` `src/**/__tests__/**/*.test.ts`, node env, forks pool, maxWorkers 1, testTimeout 30000. |
