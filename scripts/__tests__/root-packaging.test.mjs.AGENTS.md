# __tests__/root-packaging.test.mjs — index

ci-level (`RUN_CI_SCENARIOS=1`): packs real root via `packWorkspace`. Asserts 0 packed `packages/` paths under `__tests__/`/`__fixtures__/`/`__mocks__/` or matching `.test.`/`.spec.`/`AGENTS.md`/`.AGENTS.md` (E14). Root `AGENTS.md` + `tsconfig.base.json` + `packages/server/src/` still ship (E15). Exemplar: `kb-packaging.test.mjs`. See change: check-root-package-imports.
