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
    // Worktree-local shared source wins over the hoisted-workspace symlink
    // (which escapes to the main checkout), so tests see the same code the
    // build does. Mirrors packages/server + packages/client + packages/extension.
    // See change: add-git-checkout-root-resolver.
    alias: {
      "@blackbelt-technology/pi-dashboard-shared": path.resolve(__dirname, "../shared/src"),
    },
  },
});
