import { defineConfig } from "@playwright/test";

// DIST-ONLY E2E project (openspec: decouple-plugins-from-core, task 8.5; test-plan #F18).
// SEPARATE from playwright.config.ts because its server is NOT the docker harness: a clean-prefix
// npm-global install (no monorepo root, no toolchain) booted like `qa/tests/35-plugin-install-load.sh`,
// with the prebuilt canary under `~/.pi/dashboard/plugins`. The host Playwright reaches it over
// loopback, so it is genuinely local and may grant trust over HTTP.
//
//   QA_DASHBOARD_TARBALL=<packed root tgz> QA_EXTRA_TARBALLS="<workspace tgz...>" npm run test:e2e:dist-only
//   (or QA_DASHBOARD_VERSION=<registry version>; or attach: PW_DIST_ONLY_URL=http://localhost:<port>)
export default defineConfig({
  testDir: "tests/e2e/dist-only",
  testMatch: ["**/*.spec.ts"],
  timeout: 90_000,
  globalTimeout: 20 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/dist-only/global-setup.ts",
  globalTeardown: "./tests/e2e/dist-only/global-teardown.ts",
  use: { trace: "off", ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) },
  projects: [{ name: "dist-only", use: { browserName: "chromium" } }],
});
