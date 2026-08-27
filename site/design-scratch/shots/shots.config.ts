/**
 * Playwright config for the screenshot prototype.
 *
 * Attaches to an ALREADY-RUNNING docker harness (no globalSetup/globalTeardown)
 * so a capture pass never boots or tears down the container the e2e suite may
 * be using. Bring the harness up yourself first:
 *
 *   PI_E2E_SEED=1 docker/test-up.sh -d --build
 *   PW_E2E_USE_RUNNING=1 \
 *   PW_E2E_PORT=$(jq -r .dashboardPort .pi-test-harness.json) \
 *   PW_GATEWAY_PORT=$(jq -r .gatewayPort .pi-test-harness.json) \
 *   npx playwright test --config design-scratch/shots/shots.config.ts
 */

import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.PW_E2E_PORT ?? "18000";

export default defineConfig({
  testDir: ".",
  testMatch: new RegExp(`${process.env.PW_SHOTS_MATCH ?? "capture"}\\.spec\\.ts`),
  timeout: 25 * 60_000,
  globalTimeout: 40 * 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
