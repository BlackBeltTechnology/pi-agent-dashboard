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
    // Per-file HOME: routes + supervisor write under $HOME/.pi/agent/system-one/.
    setupFiles: [path.resolve(__dirname, "../shared/src/test-support/setup-home-perfile.ts")],
  },
  resolve: {
    // Worktree-local sources win over the hoisted-workspace symlink (mirrors
    // packages/blackhole-plugin/vitest.config.ts). Subpaths before bare keys.
    alias: {
      "@blackbelt-technology/dashboard-plugin-runtime/server": path.resolve(__dirname, "../dashboard-plugin-runtime/src/server/index.ts"),
      "@blackbelt-technology/dashboard-plugin-runtime/context": path.resolve(__dirname, "../dashboard-plugin-runtime/src/plugin-context.tsx"),
      "@blackbelt-technology/dashboard-plugin-runtime/test-support": path.resolve(__dirname, "../dashboard-plugin-runtime/src/test-support/index.ts"),
      "@blackbelt-technology/dashboard-plugin-runtime": path.resolve(__dirname, "../dashboard-plugin-runtime/src/index.ts"),
      "@blackbelt-technology/pi-dashboard-shared": path.resolve(__dirname, "../shared/src"),
      "@blackbelt-technology/pi-system-one/capabilities": path.resolve(__dirname, "../system-one/src/capabilities.ts"),
      "@blackbelt-technology/pi-system-one": path.resolve(__dirname, "../system-one/src/index.ts"),
    },
  },
});
