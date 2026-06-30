import { defineConfig, devices } from "@playwright/test";
import { BASE_URL } from "./tests/e2e/lifecycle.js";

// Browser-E2E suite. Targets the disposable Docker test harness. The port is
// dynamic (probed in managed mode, PW_E2E_PORT when attaching) and resolved
// once in tests/e2e/lifecycle.ts so baseURL matches the container.
// Lifecycle (boot/teardown of the container) lives in tests/e2e/global-*.ts.
// See openspec change add-playwright-e2e, parallelize-test-harness + tests/e2e/README.md.
//
// Browser selection: default uses Playwright's bundled Chromium. Set
// PW_CHANNEL to a Chromium-family channel ("chrome", "msedge", "chrome-beta",
// "chrome-canary") to drive the SYSTEM-installed browser instead — no
// `playwright install chromium` needed (the pretest:e2e download self-skips).
// CI leaves PW_CHANNEL unset so the hermetic bundled Chromium is used.
const PW_CHANNEL = process.env.PW_CHANNEL;
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
  projects: [
    PW_CHANNEL
      ? { name: PW_CHANNEL, use: { ...devices["Desktop Chrome"], channel: PW_CHANNEL } }
      : { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
