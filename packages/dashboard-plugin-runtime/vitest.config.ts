import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    pool: "forks",
    maxWorkers: "50%",
    globalSetup: ["@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts"],
  },
  resolve: {
    // Worktree-local shared source wins over the hoisted-workspace symlink so
    // tests see the same code the build does (mirrors packages/client). Needed
    // for shared modules added in a worktree (e.g. dashboard-plugin/route-descriptor).
    alias: {
      "@blackbelt-technology/pi-dashboard-shared": path.resolve(__dirname, "../shared/src"),
    },
  },
});
