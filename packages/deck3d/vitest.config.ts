import { defineConfig } from "vitest/config";

/**
 * deck3d runs browser-driving suites (mermaid harvest, render/check) through a
 * shared Playwright chromium. They must be serialised — concurrent chromium
 * launches are both slow and flaky — so this project declares a single worker
 * rather than the repo's parallel default. See design D2/D8.
 */
export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    maxWorkers: 1,
    testTimeout: 60000,
    passWithNoTests: true,
  },
});
