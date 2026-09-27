# DOX — packages/system-one

Files in this directory. One row per file. See change: add-system-one-registry.

| File | Purpose |
|------|---------|
| `package.json` | `@blackbelt-technology/pi-system-one`, public (`publishConfig.access: public`; plugin ships + resolves it from npm). ESM, Node built-ins only, `engines.node >=22.19`. Exports `.` → `src/index.ts`, `./capabilities` → `src/capabilities.ts` (browser-safe; client imports it). Listed in `.github/workflows/publish.yml` PACKAGES before the plugin. See change: add-system-one-registry. |
| `README.md` | npm page: what the library is, a `predict` usage example (policy on `ok:false`; act only on `mode: "enforce"` + `thresholds`), config/keys pointer to `docs/system-one.md`. See change: add-system-one-registry. |
| `tsconfig.json` | Extends `../../tsconfig.base.json`. NodeNext, `noEmit`, `types: [node]`. |
| `vitest.config.ts` | node env, `pool: forks`, `PARALLEL_MAX_WORKERS`, globalSetup `setup-home.ts` + per-file HOME `setup-home-perfile.ts` (library writes under `$HOME/.pi/agent/system-one/`). Root project `packages/system-one`. |
