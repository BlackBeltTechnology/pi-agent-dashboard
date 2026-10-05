import path from "node:path";
import { defineConfig } from "vitest/config";
import { PARALLEL_MAX_WORKERS } from "../../vitest.workers";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    maxWorkers: PARALLEL_MAX_WORKERS,
    testTimeout: 30_000,
    globalSetup: ["@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts"],
  },
  resolve: {
    alias: {
      "@blackbelt-technology/dashboard-plugin-runtime/server": path.resolve(
        __dirname,
        "../dashboard-plugin-runtime/src/server/index.ts",
      ),
      "@blackbelt-technology/dashboard-plugin-runtime": path.resolve(
        __dirname,
        "../dashboard-plugin-runtime/src/index.ts",
      ),
      "@blackbelt-technology/pi-dashboard-shared": path.resolve(__dirname, "../shared/src"),
    },
  },
});
