import type { Locator, Page, Request } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { CANARY_ID, ensureCanaryState } from "./helpers/runtime-canary.js";

/**
 * OPT-IN performance budgets for runtime plugin client loading (skipped unless PW_PERF=1).
 * change: decouple-plugins-from-core (tasks 8.145 / 8.146, test-plan #P2 / #P3). Same opt-in stance as
 * `chat-render-perf.spec.ts`: absolute timings inside a shared Docker container are load-dependent, so
 * these are advisory probes, not default-run gates.
 *
 * P2 (zero plugins): what runtime loading ADDS to a cold load of the stock app is the listing fetch plus
 * any `/host/*` shim or `/plugin-assets/*` bytes. With nothing admitted it must stay ≤ 2 extra requests
 * and ≤ 10 kB of gzip host JS. The pre-change build is not runnable beside the harness, so the added
 * work is measured directly (the requests that exist only because of runtime loading), not as a diff.
 *
 * P3 (one plugin): claim-visible p95 of a trusted canary settings section ≤ the p95 of a first-party
 * plugin's settings body + 300 ms, over 5 cold loads each.
 *
 * RUN: PW_PERF=1 PW_CHANNEL=chrome PW_E2E_USE_RUNNING=1 PW_E2E_PORT=$(jq -r .dashboardPort .pi-test-harness.json) \
 *      npx playwright test runtime-plugin-perf
 */
const RUNS = 5;
const MAX_EXTRA_REQUESTS = 2;
const MAX_EXTRA_GZIP_BYTES = 10 * 1024;
const P3_SLACK_MS = 300;
const RUNTIME_ADDED = /\/api\/plugins\/runtime-clients(\?|$)|\/host\/|\/plugin-assets\//;

const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(0.95 * xs.length) - 1)];

/** A cold load: a fresh context (no HTTP cache, no service worker) per run. */
async function coldPage(browser: import("@playwright/test").Browser, baseURL: string | undefined): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL });
  return { page: await context.newPage(), close: () => context.close() };
}

test.describe("runtime plugin client loading — regression budgets (advisory, PW_PERF only)", () => {
  test.skip(!process.env.PW_PERF, "perf probe is opt-in: set PW_PERF=1");

  test("P2: zero plugins add ≤ 2 requests and ≤ 10 kB gzip host JS to a cold load", async ({ browser, baseURL, request }) => {
    test.setTimeout(180_000);
    await ensureCanaryState(request, "untrusted"); // nothing admitted → zero runtime plugins
    const requestCounts: number[] = [];
    const gzipBytes: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const { page, close } = await coldPage(browser, baseURL);
      const added: Request[] = [];
      page.on("requestfinished", (r) => RUNTIME_ADDED.test(r.url()) && added.push(r));
      await page.goto("/");
      await expect(page.getByText("Connected").first()).toBeVisible({ timeout: 30_000 });
      await page.waitForLoadState("networkidle");
      let bytes = 0;
      for (const r of added.filter((a) => /\/host\/|\/plugin-assets\//.test(a.url()))) bytes += (await r.sizes()).responseBodySize;
      requestCounts.push(added.length);
      gzipBytes.push(bytes);
      await close();
    }
    test.info().annotations.push({ type: "p2", description: `requests=${requestCounts} gzipBytes=${gzipBytes}` });
    expect(Math.max(...requestCounts), `extra requests per run ${requestCounts}`).toBeLessThanOrEqual(MAX_EXTRA_REQUESTS);
    expect(Math.max(...gzipBytes), `extra gzip bytes per run ${gzipBytes}`).toBeLessThanOrEqual(MAX_EXTRA_GZIP_BYTES);
  });

  test("P3: one trusted plugin's claim-visible p95 ≤ a first-party settings body p95 + 300 ms", async ({ browser, baseURL, request }) => {
    test.setTimeout(240_000);
    await ensureCanaryState(request, "trusted");
    const measure = async (path: string, ready: (p: Page) => Locator) => {
      const samples: number[] = [];
      for (let i = 0; i < RUNS; i++) {
        const { page, close } = await coldPage(browser, baseURL);
        const t0 = Date.now();
        await page.goto(path);
        await ready(page).waitFor({ state: "visible", timeout: 30_000 });
        samples.push(Date.now() - t0);
        await close();
      }
      return samples;
    };
    const baseline = await measure("/settings/plugins/hermes-memory", (p) => p.getByTestId("hermes-file-path"));
    const canary = await measure(`/settings/plugins/${CANARY_ID}`, (p) => p.getByTestId("canary-settings"));
    test.info().annotations.push({ type: "p3", description: `canary=${canary} baseline=${baseline}` });
    expect(p95(canary), `canary ${canary} vs first-party ${baseline}`).toBeLessThanOrEqual(p95(baseline) + P3_SLACK_MS);
  });
});
