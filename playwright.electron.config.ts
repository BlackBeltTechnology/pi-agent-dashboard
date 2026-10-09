import { defineConfig } from "@playwright/test";

// Electron-E2E suite — launches the REAL packaged Electron app via Playwright's
// `_electron` and drives native-surface flows (zombie-adoption modal, Doctor
// version-skew row) that unit tests cannot reach.
//
// SEPARATE from the web-client E2E config (playwright.config.ts, Docker :18000):
// this suite has NO Docker globalSetup — it launches the packaged app directly.
// Package the app first: `npm run -w packages/electron package` (the
// pretest:e2e:electron script does this). CI runs it under xvfb on Linux.
//
// See change: electron-attach-ownership-fixes (Electron-E2E harness).
export default defineConfig({
  testDir: "tests/e2e-electron",
  testMatch: /.*\.electron\.spec\.ts/,
  // App launch + packaged-binary boot is slow; keep generous.
  timeout: 90_000,
  // Env override: the runtime-overlay job stages two npm runtimes (change:
  // electron-runtime-release-pipeline).
  globalTimeout: Number(process.env.PW_ELECTRON_GLOBAL_TIMEOUT_MS) || 15 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Electron app + fixed :8000 fake server → serialize.
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report-electron", open: "never" }]],
});
