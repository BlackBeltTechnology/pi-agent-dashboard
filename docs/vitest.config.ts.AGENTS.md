# vitest.config.ts — index

(repo root) Root Vitest config. `defineConfig`. Vitest 4 dropped `vitest.workspace.ts`. Projects live under `test.projects`. New `tests` project. Points at `tests/vitest.config.ts`. Collects `tests/e2e/helpers/__tests__/` only. Playwright specs excluded. Need docker harness + browser. Run via `npm run test:e2e`. Added for pure helper. Used only by opt-in specs (`PI_SYNTH_AGENT_TICKS=1`). No CI job executed it. See issue #549. → see `vitest.config.ts.AGENTS.md`
