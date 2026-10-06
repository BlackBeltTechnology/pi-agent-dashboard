import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { PARALLEL_MAX_WORKERS } from "../../vitest.workers";
import { aliases } from "./vite.aliases";

export default defineConfig({
  plugins: [react({ include: [/\.[tj]sx?$/] })],
  resolve: { alias: aliases, dedupe: ["react", "react-dom", "wouter"] },
  test: {
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    pool: "forks",
    maxWorkers: PARALLEL_MAX_WORKERS,
    testTimeout: 30_000,
    setupFiles: [path.resolve(__dirname, "src/__tests__/setup.ts")],
    globalSetup: ["@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts"],
  },
});
