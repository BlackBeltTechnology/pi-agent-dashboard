import { defineConfig } from "vitest/config";

/**
 * Vitest project for the ship-batch skill (pure scheduler / outcome / lock /
 * args modules + the runner driven through injected adapters).
 *
 * Registered in the root `vitest.config.ts` next to `.pi/skills/ship-it`.
 * See change: add-ship-batch-orchestrator.
 */
export default defineConfig({
  test: {
    include: ["scripts/__tests__/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    maxWorkers: "50%",
    // Runner tests drive real git in mkdtemp repos.
    testTimeout: 30_000,
  },
});
