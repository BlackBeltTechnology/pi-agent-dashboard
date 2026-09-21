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

// CI runs the suite SHARDED (see .github/workflows/ci-e2e-browser.yml): each
// shard emits a Playwright `blob` report which a final `merge-report` job joins
// into one HTML artifact. Locally `list` + `html` are the point, so blob stays
// out of a local run. Reporters are read at config load, like every env here.
const IS_CI = !!process.env.CI;
const REPORTERS = [
  ["list"],
  ...(IS_CI ? [["blob"]] : []),
  ["html", { outputFolder: "playwright-report", open: "never" }],
];

export default defineConfig({
  testDir: "tests/e2e",
  // tests/e2e/helpers/__tests__/ is a VITEST project (vitest.config.ts |e2e|).
  // Playwright's default `**/*.test.ts` match would execute those files and
  // die with "Vitest failed to find the runner" — scope them out. See change:
  // surface-pi-runtime-on-general (gate restored after #553 landed the dir).
  testIgnore: ["**/helpers/__tests__/**"],
  // Container boot is slow; first run may build the image. Keep generous.
  timeout: 60_000,
  // NO `globalTimeout`. A committed wall-clock budget cannot cover 168 specs and
  // made a full run report a timeout instead of a verdict (#450). Termination of
  // a pathological run is already guaranteed by the per-test `timeout` above,
  // `expect.timeout`, and the harness-down short-circuit (3 consecutive probe
  // failures → remaining specs skipped). A whole-run budget is a CI concern and
  // lives in the shard job's `timeout-minutes`; locally pass `--global-timeout`.
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: IS_CI,
  retries: IS_CI ? 1 : 0,
  workers: 1,
  reporter: REPORTERS,
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
