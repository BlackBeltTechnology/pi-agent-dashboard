import { defineConfig } from "@playwright/test";
import type { LivePreviewOptions } from "./tests/e2e/live-preview/fixture.js";

// LIVE-PREVIEW L3 project (openspec: serve-live-previews-on-capability-origin, tasks 14.2/14.4).
// SEPARATE from playwright.config.ts: global-setup starts a HOST-RUN isolated dashboard
// (HOME=<tmp>, free non-8000 port, previewOrigins tiers 1/2/3/5) — NOT the docker harness — so a
// browser on the host is a real loopback peer and tier 1 applies. See tests/e2e/live-preview/README.md.
// Run: npm run test:e2e:live-preview
const RESOLVER_RULES = "MAP *.preview.test 127.0.0.1, MAP dash.test 127.0.0.1, MAP dash5.test 127.0.0.1";

export default defineConfig<LivePreviewOptions>({
  testDir: "tests/e2e/live-preview",
  testMatch: ["**/*.spec.ts"],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1, // one shared isolated server + sessions; specs are serial
  reporter: [["list"]],
  globalSetup: "./tests/e2e/live-preview/global-setup.ts",
  globalTeardown: "./tests/e2e/live-preview/global-teardown.ts",
  use: { trace: "off", screenshot: "only-on-failure", ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) },
  projects: [
    // Loopback: dashboard reached as http://localhost:<port> (tier 1, `<label>.localhost`).
    { name: "chromium", testIgnore: /\.resolver\.spec\.ts$/, use: { browserName: "chromium" } },
    // Firefox on the same loopback dashboard (`*.localhost` resolves natively in Firefox).
    { name: "firefox", testIgnore: /\.resolver\.spec\.ts$/, use: { browserName: "firefox" } },
    // Chromium with host-resolver rules: dash.test (tier 2, forHosts hit) / dash5.test (tier 5) /
    // `<label>.preview.test` all map to 127.0.0.1. Only `*.resolver.spec.ts` files run here, and
    // they pick the host with `dashHost` (default dash.test). Chromium-only (Firefox has no such flag).
    {
      name: "chromium-resolver",
      testMatch: /\.resolver\.spec\.ts$/,
      use: { browserName: "chromium", dashHost: "dash.test", launchOptions: { args: [`--host-resolver-rules=${RESOLVER_RULES}`] } },
    },
  ],
});
