# DOX — packages/context-budget

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Per-turn context budget meter. Captures the REAL provider payload via `before_provider_request` (fires after payload build, before send — unlike `ctx.getSystemPrompt()`, which reports pi's prompt string, not the serialized payload). Attributes bytes to system-prompt blocks, skill-catalogue entries and per-tool schemas. Documents the silent-no-op trap: a `"skills": ["-…"]` exclusion in top-level settings does NOT reach package-provided skills — those need the package-entry form. |
| `package.json` | Package manifest. `pi.extensions` → `src/meter.ts`; `bin.context-budget` → `bin/context-budget.mjs`; exports `./src/index.ts`. pi SDK is an OPTIONAL peer — the analysis half must import without pi installed. |
| `tsconfig.json` | Extends `../../tsconfig.base.json`. NodeNext, `outDir: dist`, `rootDir: src`, declarations on, `src/__tests__` excluded. |
| `vitest.config.ts` | Package vitest config. include `src/**/__tests__/**/*.test.ts`, node env, `pool: forks`. No `maxWorkers` override, so it groups with the default-order projects in the root `vitest.config.ts` list. |
