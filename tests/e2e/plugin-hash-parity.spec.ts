import { expect, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";

/**
 * L3 browser behaviour for served-client build coherence — folds test-plan
 * scenario F3.
 *
 * The regression this change fixes is a convergence property: on a host whose
 * served client was built from the same checkout, the plugin-staleness banner
 * must NEVER appear (before the change it appeared permanently, because the
 * runtime hash counted a client-less plugin the build did not). A component
 * test can assert the render given a mocked hash; only the harness can show the
 * real build → served artifact → `/api/health.clientBuild` chain agrees.
 *
 * The harness port comes from the fixtures' baseURL (`.pi-test-harness.json#
 * dashboardPort` via `docker/test-up.sh`) — never hardcoded.
 *
 * See change: add-served-build-coherence-and-hash-parity (design D4).
 */

interface HealthBody {
  bundleHash?: string;
  clientBuild?: { pluginRegistryHash: string | null; status: string };
}

test.describe("plugin registry hash parity (L3)", () => {
  test("F3: served client matches the runtime plugin set and the banner never appears", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);

    const res = await request.get("/api/health");
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as HealthBody;

    // The served artifact is built from this checkout, so it declares the same
    // plugin set the server computes at runtime.
    expect(body.clientBuild?.status).toBe("matched");
    expect(body.clientBuild?.pluginRegistryHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.bundleHash).toMatch(/^[0-9a-f]{64}$/);

    await gotoDashboard(page);
    // Let the banner's own health probe resolve (it fetches on mount); a stale
    // banner would persist, not flash.
    await page.waitForTimeout(2_500);
    await expect(page.getByTestId("plugin-staleness-banner")).toHaveCount(0);
  });
});
