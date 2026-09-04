import { defineConfig } from "vitest/config";
import { PARALLEL_MAX_WORKERS } from "../vitest.workers";

/**
 * Vitest project for repo-root /scripts.
 * Picks up `*.test.mjs` under scripts/__tests__/.
 *
 * See change: fix-dashboard-spawn-correlation-by-token.
 */
export default defineConfig({
  test: {
    include: ["__tests__/**/*.test.mjs"],
    environment: "node",
    pool: "forks",
    maxWorkers: PARALLEL_MAX_WORKERS,
  },
});
