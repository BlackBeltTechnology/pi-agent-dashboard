# __tests__/test-collection-completeness.test.ts — index

Repo-lint (D7, E28): every `packages/*` holding vitest test files (scan skips `node_modules/`, `dist/`, `out/`) is collected by a root `vitest.config.ts` project or listed in `EXCLUDED` with a reason (`electron`, `pi-forms-bpmn`); removing `quota-plugin` from projects names it. No per-file quarantine. See change: speed-up-ci-affected-tests.
