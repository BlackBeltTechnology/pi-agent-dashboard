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
    // Per-file HOME isolation: role-manager / model-resolve tests write
    // ~/.pi/agent/providers.json and clobber each other across parallel forks
    // without it. Config-relative path so worktree-local source wins.
    // See change: parallelize-test-suite.
    setupFiles: [path.resolve(__dirname, "../shared/src/test-support/setup-home-perfile.ts")],
  },
  resolve: {
    // Worktree-local shared source wins over the hoisted-workspace symlink
    // (which escapes to the main checkout), so tests see the same code the
    // build does. Mirrors packages/server + packages/client vitest configs.
    // See change: honor-native-models-json-metadata.
    alias: {
      "@blackbelt-technology/pi-dashboard-shared": path.resolve(__dirname, "../shared/src"),
    },
  },
});
