import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { PARALLEL_MAX_WORKERS } from "../../vitest.workers";

// craft-web-plugin: server tests (node) + shim/client tests. Default environment is `node`;
// DOM tests opt in per file with a `// @vitest-environment jsdom` docblock.
// See change: edit-office-in-pane-with-craft-web.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    environment: "node",
    pool: "forks",
    maxWorkers: PARALLEL_MAX_WORKERS,
    testTimeout: 30000,
    globalSetup: ["@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts"],
  },
  resolve: {
    // Worktree-local sources win over the hoisted-workspace symlinks (which escape to the main checkout).
    alias: [
      {
        find: "@blackbelt-technology/dashboard-plugin-runtime/context",
        replacement: path.resolve(__dirname, "../dashboard-plugin-runtime/src/plugin-context.tsx"),
      },
      {
        find: /^@blackbelt-technology\/dashboard-plugin-runtime\/server$/,
        replacement: path.resolve(__dirname, "../dashboard-plugin-runtime/src/server/index.ts"),
      },
      {
        find: /^@blackbelt-technology\/dashboard-plugin-runtime$/,
        replacement: path.resolve(__dirname, "../dashboard-plugin-runtime/src/index.ts"),
      },
      {
        find: "@blackbelt-technology/pi-dashboard-shared",
        replacement: path.resolve(__dirname, "../shared/src"),
      },
      {
        find: "@blackbelt-technology/pi-dashboard-craft-apps",
        replacement: path.resolve(__dirname, "../craft-apps/src"),
      },
    ],
  },
});
