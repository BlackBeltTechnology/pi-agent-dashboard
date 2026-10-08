import { defineConfig } from "@playwright/test";

// D21 identity SETUP MATRIX (openspec: add-multi-user-identity-plane, test-plan
// LK-*). One dashboard process per operator setup (tests/e2e/identity-matrix/
// scenarios.ts) against an in-process fake OIDC issuer running the real
// interactive auth-code + PKCE flow. Opt-in, no docker. Needs a built client.
//
//   npm run build && npm run test:e2e:identity-matrix
export default defineConfig({
  testDir: "tests/e2e/identity-matrix",
  testMatch: ["**/*.spec.ts"],
  timeout: 60_000,
  globalTimeout: 10 * 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/identity-matrix/global-setup.ts",
  use: { trace: "retain-on-failure" },
  projects: [
    {
      name: "identity-matrix",
      use: {
        browserName: "chromium",
        // Optional: point at an already-installed Chromium instead of `npx playwright install`.
        launchOptions: process.env.PW_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PW_CHROMIUM_EXECUTABLE } : {},
      },
    },
  ],
});
