import path from "node:path";
import { defineConfig } from "vitest/config";
import { PARALLEL_MAX_WORKERS } from "../../vitest.workers";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    maxWorkers: PARALLEL_MAX_WORKERS,
    globalSetup: ["@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts"],
    // Per-file HOME: the library writes under $HOME/.pi/agent/system-one/.
    setupFiles: [path.resolve(__dirname, "../shared/src/test-support/setup-home-perfile.ts")],
  },
});
