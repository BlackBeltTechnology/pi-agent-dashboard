import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { PARALLEL_MAX_WORKERS } from "../../vitest.workers";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    pool: "forks",
    maxWorkers: PARALLEL_MAX_WORKERS,
    // Real plugin + engine boot + async run-store writes; the 5s default blew
    // under fork contention. Contention headroom, not a hang budget.
    // See change: contention-harden-real-process-tests.
    testTimeout: 30_000,
    globalSetup: ["@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts"],
  },
});
