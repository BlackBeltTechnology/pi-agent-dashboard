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
    // build does. Mirrors packages/server + packages/client + packages/extension.
    // See change: add-git-checkout-root-resolver.
    alias: {
      "@blackbelt-technology/pi-dashboard-shared": path.resolve(__dirname, "../shared/src"),
      // Worktree-local runtime so `copyText` resolves (the hoisted link escapes to the main checkout).
      // See change: audit-plugin-bundles-non-secure-context.
      "@blackbelt-technology/dashboard-plugin-runtime/server": path.resolve(__dirname, "../dashboard-plugin-runtime/src/server/index.ts"),
      "@blackbelt-technology/dashboard-plugin-runtime/bridge": path.resolve(__dirname, "../dashboard-plugin-runtime/src/bridge/index.ts"),
      "@blackbelt-technology/dashboard-plugin-runtime/context": path.resolve(__dirname, "../dashboard-plugin-runtime/src/plugin-context.tsx"),
      "@blackbelt-technology/dashboard-plugin-runtime/test-support": path.resolve(__dirname, "../dashboard-plugin-runtime/src/test-support/index.ts"),
      "@blackbelt-technology/dashboard-plugin-runtime/host": path.resolve(
        __dirname,
        "../dashboard-plugin-runtime/src/host.ts",
      ),
      "@blackbelt-technology/dashboard-plugin-runtime/sdk": path.resolve(
        __dirname,
        "../dashboard-plugin-runtime/src/sdk.ts",
      ),
      "@blackbelt-technology/dashboard-plugin-runtime": path.resolve(__dirname, "../dashboard-plugin-runtime/src/index.ts"),
    },
  },
});
