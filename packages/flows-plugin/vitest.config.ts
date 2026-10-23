import path from "node:path";
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
  resolve: {
    // Worktree-local shared source wins over the hoisted-workspace symlink (which escapes to the
    // main checkout), so `plugin-route-cwd.js` resolves before it lands there. Mirrors
    // packages/automation-plugin/vitest.config.ts. See change: harden-git-terminal-plugin-boundaries.
    alias: {
      "@blackbelt-technology/pi-dashboard-shared": path.resolve(__dirname, "../shared/src"),
    },
  },
});
