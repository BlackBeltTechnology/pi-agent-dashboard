# vitest.config.ts — index

(repo root) Root Vitest config. `defineConfig`. Vitest 4 dropped `vitest.workspace.ts`; projects live under `test.projects`. `test.projects` array registers each per-package `vitest.config.ts`; each carries own environment (jsdom client / node server+shared+extension), include globs, pool settings. `packages/shell` registered in `test.projects`. See change: add-server-keypair-pairing.
