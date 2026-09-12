import { defineConfig } from "vitest/config";
import { PARALLEL_MAX_WORKERS } from "../../vitest.workers";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    maxWorkers: PARALLEL_MAX_WORKERS,
    // Codegen/typecheck tests spawn subprocesses (tsc, codegen) that blew the
    // 5s default under fork contention. Contention headroom, not a hang budget.
    // See change: contention-harden-real-process-tests.
    testTimeout: 30_000,
  },
});
