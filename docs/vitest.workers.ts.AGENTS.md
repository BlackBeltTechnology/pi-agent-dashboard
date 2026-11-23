# vitest.workers.ts — index

(repo root) Single source of truth for the vitest worker target: exports `PARALLEL_MAX_WORKERS = "50%"`. Parallel `vitest.config.ts` files import it by RELATIVE path (27 at adoption) — no `package.json` dependency edge. Deliberately serial projects (7, `maxWorkers: 1`) do not import it. Guard: `scripts/__tests__/vitest-workers.test.mjs`. See change: make-test-suite-deterministic.

Budget switch: exports `BUDGET_TEST_EXCLUDE`. `["**/*.budget.test.*"]` unless `RUN_BUDGET_TESTS === "1"`, then `[]`. Spread into `test.exclude` of 6 vitest configs (`scripts/`, `packages/server` ×2, `packages/skill-atlas-plugin`, `packages/blender`, `packages/kb-plugin`). Guards: `scripts/__tests__/vitest-workers.test.mjs`, `scripts/check-budget-lane.mjs` (CI). See change: stabilize-blocking-test-lanes (design D1).
