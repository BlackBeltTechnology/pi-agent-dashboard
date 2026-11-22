/**
 * Single source of truth for the vitest worker target.
 *
 * Every parallel vitest project imports this value instead of restating
 * `"50%"` inline, so the suite's concurrency policy has one grep point and a
 * future tuning change is one edit instead of ~27. Deliberately serial
 * projects (`maxWorkers: 1`) do NOT import this module — it carries the
 * parallel default only, it is not a mandate.
 *
 * Imported by RELATIVE path from each `vitest.config.ts` on purpose: hosting
 * it in a workspace package would force a new dependency edge onto every
 * importing package (including leaf publishable ones) purely to read a
 * number. A path import adds no edge and cannot create a cycle.
 *
 * See change: make-test-suite-deterministic (design D3).
 */
export const PARALLEL_MAX_WORKERS = "50%" as const;

/**
 * Budget-lane switch (change: stabilize-blocking-test-lanes, design.md D1).
 *
 * `*.budget.test.*` files are timing/size-budget tests that run ONLY in the
 * nightly budget lane (`pnpm run test:budget` sets `RUN_BUDGET_TESTS=1`). Every
 * vitest config whose project collects such a file spreads this list into
 * `test.exclude` (with `configDefaults.exclude`), so a blocking run
 * (`npm test`, PR shards) never collects one — not even its module top level.
 * Only the exact value `"1"` lifts the exclusion. Lane membership is judged by
 * `scripts/check-budget-lane.mjs`, which never sets the variable.
 */
export const BUDGET_TEST_EXCLUDE: string[] = process.env.RUN_BUDGET_TESTS === "1" ? [] : ["**/*.budget.test.*"];
