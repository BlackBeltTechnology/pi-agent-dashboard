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
    // Worktree-local shared source wins over the hoisted-workspace symlink so
    // tests see the same code the build does (mirrors packages/client). Needed
    // for shared modules added in a worktree (e.g. dashboard-plugin/route-descriptor).
    alias: {
      "@blackbelt-technology/pi-dashboard-shared": path.resolve(__dirname, "../shared/src"),
      // app-kit ships dist-only exports; `<EmbeddedApp>` (runtime
      // `./embedded-app`) imports its React half, so resolve it to source
      // (no prebuilt dist needed). `/react` MUST precede the bare key (alias
      // matches by prefix). See change: add-plugin-app-host.
      "@blackbelt-technology/pi-dashboard-app-kit/react": path.resolve(__dirname, "../app-kit/src/react/index.ts"),
      "@blackbelt-technology/pi-dashboard-app-kit": path.resolve(__dirname, "../app-kit/src/index.ts"),
    },
  },
});
