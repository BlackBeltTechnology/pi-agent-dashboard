# DOX — tests

Files in this directory. One row per file. Non-source area. Subdirectories own their own rows (`e2e/AGENTS.md`, `e2e-electron/AGENTS.md`).

| File | Purpose |
|------|---------|
| `tsconfig.json` | TS config for the E2E suites. Typechecked by `npm run lint:e2e` (`tsc -p tests/tsconfig.json --noEmit`); the root tsconfig only includes `packages/*/src`, so nothing under `tests/` is seen without it. |
| `vitest.config.ts` | Vitest project for repo-root `/tests`, registered as `"tests"` in the root `vitest.config.ts`. Include glob is deliberately narrow — `e2e/helpers/__tests__/**/*.test.ts` ONLY; Playwright specs (`e2e/*.spec.ts`) need a docker harness + browser and must never be collected here (`npm run test:e2e` drives those). Added so pure helper logic used exclusively by opt-in specs is still exercised by normal CI. See issue #549. |
