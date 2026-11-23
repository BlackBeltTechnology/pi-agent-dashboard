import { configDefaults, defineConfig } from "vitest/config";
import { BUDGET_TEST_EXCLUDE, PARALLEL_MAX_WORKERS } from "../vitest.workers";

/**
 * Vitest project for repo-root /scripts.
 * Picks up `*.test.mjs` under scripts/__tests__/.
 *
 * See change: fix-dashboard-spawn-correlation-by-token.
 */
export default defineConfig({
  test: {
    include: ["__tests__/**/*.test.mjs"],
    // Budget files run only in the nightly lane (RUN_BUDGET_TESTS=1); see vitest.workers.ts, design.md D1.
    exclude: [...configDefaults.exclude, ...BUDGET_TEST_EXCLUDE],
    environment: "node",
    pool: "forks",
    maxWorkers: PARALLEL_MAX_WORKERS,
    // Harness-scoping / spec-repair tests shell out (biome, openspec) and blew
    // the 5s default under fork contention. Contention headroom, not a hang
    // budget. See change: contention-harden-real-process-tests.
    testTimeout: 30_000,
  },
});
