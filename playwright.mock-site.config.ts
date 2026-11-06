import { defineConfig } from "@playwright/test";

// MOCK-SITE E2E project (openspec: add-live-component-mock-site). SEPARATE from
// playwright.config.ts because its server is NOT the docker harness: global-setup
// starts the live-component mock site (repo Vite + a temp fixture project) on a
// free port. Run: npm run test:e2e:mock-site
export default defineConfig({
  testDir: "tests/e2e/mock-site",
  testMatch: ["**/*.spec.ts"],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/mock-site/global-setup.ts",
  globalTeardown: "./tests/e2e/mock-site/global-teardown.ts",
  use: { trace: "off", ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) },
  projects: [{ name: "mock-site", use: { browserName: "chromium" } }],
});
