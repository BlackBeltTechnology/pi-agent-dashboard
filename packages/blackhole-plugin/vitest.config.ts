import react from "@vitejs/plugin-react";
import path from "node:path";
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
    // Worktree-local runtime/shared source wins over the hoisted-workspace
    // symlink (which escapes to the main checkout) so tests see the code under
    // test — the client gate calls `bumpSlotClaimsVersion`, an export that
    // exists only in this worktree until it lands. Mirrors packages/server/
    // vitest.config.ts. Specific subpath keys MUST precede the bare key (alias
    // matches by prefix). See change: add-blackhole-session-pipeline.
    alias: {
      "@blackbelt-technology/dashboard-plugin-runtime/server": path.resolve(
        __dirname,
        "../dashboard-plugin-runtime/src/server/index.ts",
      ),
      "@blackbelt-technology/dashboard-plugin-runtime/context": path.resolve(
        __dirname,
        "../dashboard-plugin-runtime/src/plugin-context.tsx",
      ),
      "@blackbelt-technology/dashboard-plugin-runtime/test-support": path.resolve(
        __dirname,
        "../dashboard-plugin-runtime/src/test-support/index.ts",
      ),
      "@blackbelt-technology/dashboard-plugin-runtime": path.resolve(
        __dirname,
        "../dashboard-plugin-runtime/src/index.ts",
      ),
      "@blackbelt-technology/pi-dashboard-shared": path.resolve(__dirname, "../shared/src"),
    },
  },
});
