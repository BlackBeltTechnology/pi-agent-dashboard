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
    globalSetup: ["@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts"],
  },
});
