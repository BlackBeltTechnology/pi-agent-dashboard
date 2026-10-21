import { expect, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";

// Plugins tab updates live (change: decouple-plugins-from-core, test-plan #F6, task 8.86).
//
// Two browser contexts. A sits on Settings → Plugins; B installs a manifest-bearing pi package
// through the REAL `POST /api/packages/install`. The completion listener refreshes plugin discovery and
// broadcasts ONE `plugins_changed`; A must show the new row from that snapshot alone: no reload and no
// further `GET /api/plugins` after its initial load. Fixture: `docker/fixtures/plugin-live-pkg`
// (materialized at `/fixtures/plugin-live-pkg`, no server entry, so no trust grant is needed).
//
// STATUS: written, not yet run against the docker harness.
// Run: PW_E2E_USE_RUNNING=1 PW_E2E_PORT=$(jq -r .dashboardPort .pi-test-harness.json) npx playwright test plugins-tab-live

const FIXTURE_SOURCE = "/fixtures/plugin-live-pkg";
const PLUGIN_ID = "e2e-live-plugin";

test.describe("Settings → Plugins — live discovery", () => {
  test("a package installed from another context appears without reload or refetch", async ({ browser, page, baseURL }) => {
    // Context A: the observer.
    const listRequests: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "GET" && /\/api\/plugins(\?|$)/.test(req.url())) listRequests.push(req.url());
    });
    await gotoDashboard(page);
    await page.goto("/settings/plugins");
    await expect(page.getByTestId("plugins-section")).toBeVisible();
    await expect(page.getByTestId(`plugin-row-${PLUGIN_ID}`)).toHaveCount(0);
    const initialListCalls = listRequests.length;
    expect(initialListCalls).toBeGreaterThan(0);

    // Context B: installs the fixture.
    const ctxB = await browser.newContext({ baseURL });
    try {
      const res = await ctxB.request.post("/api/packages/install", { data: { source: FIXTURE_SOURCE, scope: "global" } });
      expect(res.status()).toBe(202);

      // A shows the row from the `plugins_changed` snapshot (source = pi-package), no reload.
      const row = page.getByTestId(`plugin-row-${PLUGIN_ID}`);
      await expect(row).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId(`plugin-source-${PLUGIN_ID}`)).toContainText("pi-package");
      expect(listRequests.length).toBe(initialListCalls);
    } finally {
      await ctxB.request.post("/api/packages/remove", { data: { source: FIXTURE_SOURCE, scope: "global" } }).catch(() => {});
      await ctxB.close();
    }
  });
});
