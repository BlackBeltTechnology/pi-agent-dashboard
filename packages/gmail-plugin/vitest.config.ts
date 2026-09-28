import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { PARALLEL_MAX_WORKERS } from "../../vitest.workers";

// gmail-plugin: server/bridge suites run under node; client suites opt into
// jsdom per file (`// @vitest-environment jsdom`). Worktree-local runtime/shared
// source wins over the hoisted symlink (mirrors blackhole-plugin). See change:
// add-gmail-plugin.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    environment: "node",
    pool: "forks",
    maxWorkers: PARALLEL_MAX_WORKERS,
    globalSetup: ["@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts"],
  },
  resolve: {
    alias: {
      "@blackbelt-technology/dashboard-plugin-runtime/server": path.resolve(__dirname, "../dashboard-plugin-runtime/src/server/index.ts"),
      "@blackbelt-technology/dashboard-plugin-runtime/bridge": path.resolve(__dirname, "../dashboard-plugin-runtime/src/bridge/index.ts"),
      "@blackbelt-technology/dashboard-plugin-runtime/context": path.resolve(__dirname, "../dashboard-plugin-runtime/src/plugin-context.tsx"),
      "@blackbelt-technology/dashboard-plugin-runtime/test-support": path.resolve(__dirname, "../dashboard-plugin-runtime/src/test-support/index.ts"),
      "@blackbelt-technology/dashboard-plugin-runtime": path.resolve(__dirname, "../dashboard-plugin-runtime/src/index.ts"),
      "@blackbelt-technology/pi-dashboard-shared": path.resolve(__dirname, "../shared/src"),
    },
  },
});
