import { defineConfig, devices } from "@playwright/test";
import { BASE_URL } from "./tests/e2e/lifecycle.js";

// Browser-E2E suite. Targets the disposable Docker test harness. The port is
// dynamic (probed in managed mode, PW_E2E_PORT when attaching) and resolved
// once in tests/e2e/lifecycle.ts so baseURL matches the container.
// Lifecycle (boot/teardown of the container) lives in tests/e2e/global-*.ts.
// See openspec change add-playwright-e2e, parallelize-test-harness + tests/e2e/README.md.
export default defineConfig({
  testDir: "tests/e2e",
  // Container boot is slow; first run may build the image. Keep generous.
  timeout: 60_000,
  globalTimeout: 15 * 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
