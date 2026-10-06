import { defineConfig } from "@playwright/test";

// Team app E2E (openspec: add-team-plugin). One private dashboard process with the
// identity plane armed (fake OIDC issuer, real interactive auth-code + PKCE flow, REAL
// pi sessions) — the identity-matrix lifecycle, but a single scenario and no docker.
// Needs the `pi` CLI on PATH and a built team app (`npm run build:app -w
// @blackbelt-technology/pi-dashboard-team-plugin`).
//
//   npm run test:e2e:team
export default defineConfig({
  testDir: "tests/e2e/team",
  testMatch: ["**/*.spec.ts"],
  timeout: 120_000,
  globalTimeout: 15 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
  projects: [
    {
      name: "team",
      use: {
        browserName: "chromium",
        launchOptions: process.env.PW_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PW_CHROMIUM_EXECUTABLE } : {},
      },
    },
  ],
});
