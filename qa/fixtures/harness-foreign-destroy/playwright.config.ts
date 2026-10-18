import { defineConfig } from "@playwright/test";
import { BASE_URL } from "../../../tests/e2e/lifecycle.js";

// Probe suite for qa/tests/19-harness-foreign-destroy-report.sh (test-plan X5;
// change: add-missing-ci-legs). Managed mode (the repo's own globalSetup /
// globalTeardown boot + tear down the Docker harness), six trivial specs that
// each probe /api/health through the SHARED harness-death latch fixture
// (tests/e2e/fixtures.ts). The driver script destroys the container after spec 1.
export default defineConfig({
  testDir: ".",
  testMatch: ["probe-*.spec.ts"],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "../../../tests/e2e/global-setup.ts",
  globalTeardown: "../../../tests/e2e/global-teardown.ts",
  use: { baseURL: BASE_URL },
});
