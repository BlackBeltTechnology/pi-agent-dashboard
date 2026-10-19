# DOX — packages/path-containment-guard

Files in this directory. One row per file. See change: add-path-containment-guard-extension.

| File | Purpose |
|------|---------|
| `README.md` | Package docs: `-e`/`scope.extensions` loading only (no `pi.extensions`), env contract + fail-closed table, reason codes, trust boundary, `deniedTools` guidance, `withPathContainmentGuard`, assumptions. |
| `package.json` | `@blackbelt-technology/pi-path-containment-guard`. NO `pi.extensions` (a discovered guard with no config would block every path tool). `exports`: `.` → `src/scope.ts`, `./extension` → `src/extension.ts`. Dep `pi-dashboard-shared`; optional pi peer. Listed in `publish.yml` allowlist, root vitest projects, `knip.json`; server devDependency for the spawn-chain test. |
| `tsconfig.json` | Extends `../../tsconfig.base.json`; `rootDir: src`. |
| `vitest.config.ts` | Package vitest config (registered in root `vitest.config.ts`). node env, forks, `maxWorkers: PARALLEL_MAX_WORKERS`, 30 s timeout. |
