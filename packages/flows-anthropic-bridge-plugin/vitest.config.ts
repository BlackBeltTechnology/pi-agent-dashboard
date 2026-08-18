import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// `bridge/index.ts` dynamic-imports both anthropic-messages peer specifiers
// (literal specifiers, so Vite resolves them at transform time); neither
// optional peer is installed in the workspace, so the module cannot be
// transformed without a stand-in. Test-only — the `pi-packages` branch imports
// an absolute entryPath the alias does not cover, so the E10 contract test
// still exercises a genuine import failure.
// See change: warn-missing-anthropic-messages-peer.
const peerStub = fileURLToPath(new URL("./src/__tests__/fixtures/anthropic-messages-stub.ts", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@pi/anthropic-messages": peerStub,
      "@blackbelt-technology/pi-anthropic-messages": peerStub,
    },
  },
  test: {
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    pool: "forks",
    maxWorkers: "50%",
    globalSetup: ["@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts"],
  },
});
