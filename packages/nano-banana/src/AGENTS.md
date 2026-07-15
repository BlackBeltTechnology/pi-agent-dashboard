# DOX — packages/nano-banana/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `env.ts` | GEMINI key resolution. `KEY_NAMES` (`GEMINI_API_KEY`,`GOOGLE_API_KEY`). `parseEnvFile` (KEY=VALUE, strips quotes/`export`/comments). `envSearchDirs` (base + 2 parents). `resolveGeminiKey({cliKey,baseDir,env,packageDir})` precedence flag→env→project `.env`→package `.env`. Returns `{key,source}`. |
| `nano-banana.ts` | CLI wrapper. `generateImage(opts)` resolves key, spawns `npx -y @the-focus-ai/nano-banana` via shared `buildSafeArgv`+`execFileAsync` (no-direct-child-process invariant), mkdir output dir, returns `{ok,output,error}`. `batchGenerate({jobs,concurrency,force})` bounded-concurrency, skips existing outputs. `buildArgs`, injectable `NanoBananaRunner`/`npxRunner` for tests. |
