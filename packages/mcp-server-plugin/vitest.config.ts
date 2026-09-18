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
  },
  resolve: {
    // Worktree-local shared source wins over the hoisted-workspace symlink
    // (which escapes to the main checkout), so plugin tests see the same shared
    // code the build does. Mirrors packages/server/vitest.config.ts.
    // See change: expand-mcp-tiered-surface (shared/tiers.ts, shared/route-tiers.ts).
    alias: {
      "@blackbelt-technology/pi-dashboard-shared": path.resolve(__dirname, "../shared/src"),
    },
  },
});
