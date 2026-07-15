# DOX — packages/video-production/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `env.ts` | Veo key resolution. `KEY_NAMES` (`VEO_API_KEY`,`GEMINI_API_KEY`,`GOOGLE_API_KEY`). `resolveVeoKey({cliKey,baseDir,env,packageDir})` precedence flag→env→project `.env`→package `.env`, returns `{key,source}`. Reuses `parseEnvFile`/`envSearchDirs` from the nano-banana package. |
| `inspect.ts` | Dry-run inspector (port of `parse_shots.py`). `inspectPackage({target,shots})` → `InspectReport` (per-shot seed/aspect/res/refs, key state, `problems`=shots missing prompt). `formatReport` renders the human table. No SDK/key needed. |
| `package.ts` | Layout resolver (port of `resolve_package`/`load_shots`). `resolvePackage(target)` accepts project / video_production / shots dir → `{shotsDir,baseDir}`. `loadShots(target,names?)` parses + filters by short/full id. `expandHome`. |
| `render.ts` | Veo renderer (port of `veo_render.py`). `renderShots(opts)` idempotent (skip existing mp4 unless force), sequential+`--chain` (ffmpeg last-frame handoff) or `--parallel N`, retry-without-refs, jsonl log. `buildRequest` (config+first-frame image), `planRender`, `loadImage`, `extractLastFrame`. Injectable `VeoClient` (`createGenAIClient` wraps `@google/genai`) for testability. |
| `shots.ts` | Shot parsing (port of shot parser). `Shot` type, `MODEL_ALIASES` (standard/fast→veo-3.1 ids), `parseShotFile` (fenced Full Veo/Negative blocks, seed/aspect/resolution/enhance regex, reference + first-frame image resolution, SEAMLESS-to→`seamlessNext`), `resolveImage`, `shotShort`. |
| `storyboard.ts` | Storyboard generator (port of `gen_storyboard.py`). `generateStoryboard({target,only,force,workers})` reads `storyboard/sketch_prompts.json`, generates one PNG/key via nano-banana `batchGenerate`. |
