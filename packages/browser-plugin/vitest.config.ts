import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { PARALLEL_MAX_WORKERS } from "../../vitest.workers";

const VENDOR_SHIMS = path.resolve(__dirname, "src/server/relay/vendor/shims");

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
    alias: [
      {
        find: "@blackbelt-technology/pi-dashboard-shared",
        replacement: path.resolve(__dirname, "../shared/src"),
      },
      // Bare specifiers used by the VENDORED playwright-core relay files
      // (relay/vendor/playwright-core/src/tools/mcp/*). TS resolves them via
      // the `paths` entries in tsconfig.base.json; Vite needs its own alias
      // (a tsconfig `paths` entry alone does not affect vitest). Regex keys
      // are exact-match: plain-string aliases can match by prefix, and
      // `@isomorphic/time` is a PREFIX of `@isomorphic/timeoutRunner`.
      // See change: add-browser-relay (task 2.2).
      { find: /^@isomorphic\/manualPromise$/, replacement: path.join(VENDOR_SHIMS, "manualPromise.ts") },
      { find: /^@isomorphic\/time$/, replacement: path.join(VENDOR_SHIMS, "time.ts") },
      { find: /^@isomorphic\/timeoutRunner$/, replacement: path.join(VENDOR_SHIMS, "timeoutRunner.ts") },
      { find: /^@utils\/wsServer$/, replacement: path.join(VENDOR_SHIMS, "wsServer.ts") },
    ],
  },
});
