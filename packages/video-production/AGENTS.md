# DOX — packages/video-production

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `.pi/skills/veo-generator/SKILL.md` | Skill: render scripted shot package → mp4 via Google Veo 3.1 API. Parses shots/*.md (Full Veo prompt, negative, seed/aspect/refs), never re-invents prompt. CLI pi-veo: parse/plan/render/storyboard, TS via jiti no build. Key: --api-key → VEO_API_KEY/GEMINI_API_KEY/GOOGLE_API_KEY → <Project>/.env → package .env. Models veo-3.1-generate-preview (standard) / veo-3.1-fast-generate-preview (fast). Flags: --shots, --chain (A→B last frame), --parallel N, --force, --with-reference. Clips ≤8s. Developer API rejects seed → --no-seed; unset GOOGLE_GENAI_USE_VERTEXAI. Logs renders/render_log.jsonl. |
| `.pi/skills/veo-showreel-production-kit/SKILL.md` | Skill: turn video timeline + voiceover into reproducible sliceable Veo 3.1 prompt package with consistency anchor + AI storyboard sketches. STYLE BIBLE = global anchor: byte-identical STYLE LOCK/AUDIO LOCK per prompt, global NEGATIVE, fixed repro (16:9, 4K/24fps, constant seed, enhance_prompt=false). Split ≤8s units, A/B sub-shots; hard-cut (parallel) vs SEAMLESS chain. Per-shot shots/*.md: 7-layer prompt + Full Veo prompt (~110-170 words) + VIDEO_MASTER.md. nano-banana sketches (world anchor + per cut, max_workers=3). Audio: ambient SFX only, VO + music in post. |
| `.env.example` | Template for the Veo/Gemini key `.env`. Accepts `VEO_API_KEY`/`GEMINI_API_KEY`/`GOOGLE_API_KEY`; per-project (nearest wins) or package-global fallback. Never commit real keys. |
| `README.md` | Package overview. TS port of standalone `veo-generator` + `veo-showreel-production-kit` pi skills, no Python. Parse `shots/*.md`, render one mp4/cut via Veo 3.1, storyboard first-frames via nano-banana. Exposed as pi skills + CLI bin `pi-veo` (parse/plan/render/storyboard). deps `@google/genai`, nano-banana, shared. |
| `package.json` | Manifest. Name `@blackbelt-technology/pi-dashboard-video-production`. `pi.skills` → veo-showreel-production-kit + veo-generator. bin `pi-veo` → `src/bin/veo.ts`. `exports` map `./*.js`→`./src/*.ts`. deps `@blackbelt-technology/pi-dashboard-nano-banana`, `-shared`, `@google/genai`. |
| `tsconfig.json` | Extends `../../tsconfig.base.json`; `rootDir` src, `outDir` dist. |
| `vitest.config.ts` | Vitest config. `include` `src/**/__tests__/**/*.test.ts`, node env, forks pool, maxWorkers 1, testTimeout 30000. |
