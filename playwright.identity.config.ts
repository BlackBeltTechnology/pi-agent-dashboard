import { defineConfig } from "@playwright/test";
import { BASE_URL } from "./tests/e2e/lifecycle.js";

// Dedicated IDENTITY-ACTIVE E2E project (openspec: add-multi-user-identity-plane
// §11.2). SEPARATE from playwright.config.ts because an active resolver refuses
// ordinary browser sockets (§9.2) — these specs drive raw HTTP + `ws` with
// minted bearers, no page, against a harness booted with
// TEST_EXTRA_COMPOSE=compose.test.identity.yml.
//
//   npm run test:e2e:identity
export default defineConfig({
  testDir: "tests/e2e/identity",
  testMatch: ["**/*.spec.ts"],
  timeout: 60_000,
  globalTimeout: 15 * 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/identity/global-setup.ts",
  globalTeardown: "./tests/e2e/identity/global-teardown.ts",
  use: {
    baseURL: BASE_URL,
    trace: "off",
  },
  // No browser project: API-only. Playwright still needs one project entry.
  projects: [{ name: "identity-api" }],
});
