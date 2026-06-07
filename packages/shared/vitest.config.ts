import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    maxWorkers: "50%",
    globalSetup: ["@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts"],
    // Per-file HOME isolation for HOME-writing tests under parallelism.
    // See change: parallelize-test-suite.
    setupFiles: [path.resolve(__dirname, "src/test-support/setup-home-perfile.ts")],
  },
});
