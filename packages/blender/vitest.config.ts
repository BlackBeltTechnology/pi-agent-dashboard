import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";
import { BUDGET_TEST_EXCLUDE, PARALLEL_MAX_WORKERS } from "../../vitest.workers";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    // Budget files run only in the nightly lane (RUN_BUDGET_TESTS=1); see vitest.workers.ts, design.md D1.
    exclude: [...configDefaults.exclude, ...BUDGET_TEST_EXCLUDE],
    environment: "node",
    pool: "forks",
    maxWorkers: PARALLEL_MAX_WORKERS,
    testTimeout: 30000,
    globalSetup: ["@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts"],
    // Per-file HOME: the tripwire refuses to run against the real user $HOME.
    setupFiles: [path.resolve(__dirname, "../shared/src/test-support/setup-home-perfile.ts")],
  },
});
