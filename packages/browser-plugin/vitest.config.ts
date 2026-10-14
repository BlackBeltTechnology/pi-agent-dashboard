import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
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
    // build does. Mirrors packages/kb-plugin.
    // The relay store bumps the slot-claims version and the gate/feed read it:
    // both must resolve ONE `dashboard-plugin-runtime` module instance
    // (specific subpaths precede the bare key). See change: fix-empty-status-subcard.
    alias: [
      {
        find: "@blackbelt-technology/dashboard-plugin-runtime/context",
        replacement: path.resolve(__dirname, "../dashboard-plugin-runtime/src/plugin-context.tsx"),
      },
      {
        find: /^@blackbelt-technology\/dashboard-plugin-runtime$/,
        replacement: path.resolve(__dirname, "../dashboard-plugin-runtime/src/index.ts"),
      },
      {
        find: "@blackbelt-technology/pi-dashboard-shared",
        replacement: path.resolve(__dirname, "../shared/src"),
      },
    ],
  },
});
