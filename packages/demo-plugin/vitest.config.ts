import { defineConfig } from "vitest/config";
import { PARALLEL_MAX_WORKERS } from "../../vitest.workers";

// demo-plugin fixture: bridge fixture-gate contract. See change:
// expose-plugin-credential-and-oauth-seams (D8).
export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    environment: "node",
    pool: "forks",
    maxWorkers: PARALLEL_MAX_WORKERS,
    globalSetup: ["@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts"],
  },
});
