# DOX — packages/context-budget

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Per-turn context budget meter. Captures the REAL provider payload via `before_provider_request` (fires after payload build, before send — unlike `ctx.getSystemPrompt()`, which reports pi's prompt string, not the serialized payload). Attributes bytes to system-prompt blocks, skill-catalogue entries and per-tool schemas. Documents the silent-no-op trap: a `"skills": ["-…"]` exclusion in top-level settings does NOT reach package-provided skills — those need the package-entry form. |
| `package.json` | Package manifest. `pi.extensions` → `src/meter.ts`; `bin.context-budget` → `bin/context-budget.mjs`; exports `./src/index.ts`. pi SDK is an OPTIONAL peer — the analysis half must import without pi installed. |
| `tsconfig.json` | Extends `../../tsconfig.base.json`. NodeNext, `outDir: dist`, `rootDir: src`, declarations on, `src/__tests__` excluded. |
| `vitest.config.ts` | Package vitest config. include `src/**/__tests__/**/*.test.ts`, node env, `pool: forks`, `maxWorkers: "50%"`. The explicit `maxWorkers` is REQUIRED, not cosmetic: vitest 4 refuses to group two projects that disagree on `maxWorkers` under the same `sequence.groupOrder`, and without it the whole root run aborts before a single test executes (`Projects "…client-utils" and "…context-budget" have different 'maxWorkers'`). Match the default-order peers, or take a distinct `sequence.groupOrder` the way `packages/kb-extension` does. |
