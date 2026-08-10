# playwright.config.ts — index

(repo root) Playwright config. testDir `tests/e2e`, `use.baseURL` imports `BASE_URL` from lifecycle.ts, single chromium project. globalSetup/globalTeardown = `tests/e2e/global-*.ts`. expect timeout 10s, globalTimeout 15min, retries CI?1:0. Opt-in browser E2E; not in `npm test`. `@playwright/test` pinned exact 1.61.1. chromium `channel` env-driven via `PW_CHANNEL`. See change: add-playwright-e2e. See change: parallelize-test-harness. See change: self-heal-host-playwright-browser.
