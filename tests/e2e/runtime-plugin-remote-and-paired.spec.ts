import { expect, test } from "./fixtures.js";
import { CANARY_ID, ensureCanaryState, runtimeListing } from "./helpers/runtime-canary.js";
import { BASE_URL, DASHBOARD_PORT } from "./lifecycle.js";

/**
 * L3 — runtime plugin code loading across client/server topologies (change: decouple-plugins-from-core;
 * test-plan #F13, #F14). Harness: default `trusted` canary (docker/test-up.sh, task 7.5).
 *
 * F13  a bearer-only paired device (no cookie) loads plugin code through `<script type="module">`/`import()`, which
 *      never carries an `Authorization` header — so `/plugin-assets/**` MUST be served under the same rule as
 *      `/assets/**` (task 6.9): it succeeds iff `/assets/*` loads, and no request for either carries a bearer.
 * F14  a client switched to ANOTHER dashboard (different origin ⇒ non-empty API base) loads no runtime plugin code:
 *      0 `/plugin-assets` requests, the Plugins tab says why, build-time claims still render. The "second dashboard"
 *      is the harness itself reached through its other loopback name (`127.0.0.1` vs `localhost`): a distinct origin
 *      that exercises exactly the remote-API-base rule the loader keys on.
 */

const BEARER_KEY = "pi-dashboard:device-bearer";
const LAST_SERVER_KEY = "pi-dashboard-last-server";

test.describe("runtime plugin loading — topologies", () => {
  test("F13: a bearer-only paired context loads the plugin entry with no Authorization header", async ({ browser, request }) => {
    await ensureCanaryState(request, "trusted");
    const context = await browser.newContext({ baseURL: BASE_URL }); // fresh: no cookie
    try {
      await context.addInitScript(([key]) => localStorage.setItem(key, "e2e-bearer-without-cookie"), [BEARER_KEY]);
      const page = await context.newPage();
      const modules: Array<{ url: string; status: number; auth: string | undefined }> = [];
      page.on("response", async (r) => {
        const url = r.url();
        if (url.includes("/plugin-assets/") || /\/assets\/[^/]+\.js$/.test(url)) {
          modules.push({ url, status: r.status(), auth: (await r.request().allHeaders()).authorization });
        }
      });
      await page.goto("/");
      await expect.poll(() => modules.some((m) => m.url.includes(`/plugin-assets/${CANARY_ID}/`) && m.url.endsWith("/index.js")), { timeout: 30_000 }).toBe(true);
      const assets = modules.filter((m) => !m.url.includes("/plugin-assets/"));
      const plugin = modules.filter((m) => m.url.includes("/plugin-assets/"));
      expect(assets.length, "the shell's own /assets/* loaded").toBeGreaterThan(0);
      // Same rule: the plugin module succeeds exactly when the host's own assets do.
      expect(plugin.every((m) => m.status === 200)).toBe(assets.every((m) => m.status === 200));
      expect(plugin.every((m) => m.status === 200), "plugin asset requests succeed").toBe(true);
      // A module request never carries the device bearer.
      expect(plugin.map((m) => m.auth)).toEqual(plugin.map(() => undefined));
      expect(assets.map((m) => m.auth)).toEqual(assets.map(() => undefined));
    } finally {
      await context.close();
    }
  });

  test("F14: a client targeting another dashboard loads no runtime plugin code and says why", async ({ browser, request }) => {
    // The remote-server topology needs cross-origin `fetch`; an ENFORCED `connect-src 'self' ws: wss:` refuses it,
    // so this runs on the report-only boot (the default), not the `PI_DASHBOARD_CSP=enforce` one.
    const csp = (await request.get("/")).headers()["content-security-policy"];
    test.skip(!!csp, "enforced CSP blocks the cross-origin API base this topology needs; run on the report-only harness");
    await ensureCanaryState(request, "trusted");
    expect((await runtimeListing(request)).map((p) => p.id), "the target dashboard admits the canary").toContain(CANARY_ID);
    const context = await browser.newContext({ baseURL: `http://localhost:${DASHBOARD_PORT}` });
    try {
      // The saved "last server" makes the client connect (WS + API base) to the OTHER origin.
      await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [LAST_SERVER_KEY, `127.0.0.1:${DASHBOARD_PORT}`]);
      const page = await context.newPage();
      const assetRequests: string[] = [];
      page.on("request", (r) => {
        if (r.url().includes("/plugin-assets")) assetRequests.push(r.url());
      });
      await page.goto("/settings/plugins");
      await expect(page.getByTestId("plugins-runtime-notice-remote-server")).toBeVisible({ timeout: 30_000 });
      // Build-time claims stay: the shell and its settings rail render normally.
      await expect(page.getByTestId("settings-nav-rail")).toBeVisible();
      await expect(page.getByTestId("canary-settings")).toHaveCount(0);
      expect(assetRequests).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
