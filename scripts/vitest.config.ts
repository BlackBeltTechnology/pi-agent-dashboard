import { defineConfig } from "vitest/config";

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
    maxWorkers: "50%",
  },
});
