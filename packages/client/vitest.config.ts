import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    pool: "forks",
    maxWorkers: 1,
    globalSetup: ["@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts"],
  },
  resolve: {
    // Mirror vite.config alias — worktree-local source wins over the
    // hoisted-workspace symlink so tests see the same code the build does.
    // See change: redesign-session-card-and-composer (config-driven-workflow).
    alias: {
      "@blackbelt-technology/pi-dashboard-shared": path.resolve(__dirname, "../shared/src"),
      "@blackbelt-technology/pi-dashboard-client-utils": path.resolve(__dirname, "../client-utils/src"),
    },
  },
});
