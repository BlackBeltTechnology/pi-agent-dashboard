import { expect, test } from "./fixtures.js";
import { cspHeaders, installCspProbe, readCspProbe } from "./helpers/csp-strict.js";
import { byTestId } from "./helpers/index.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

/**
 * L3 — the cross-origin switcher topology is refused under the DEFAULT (enforcing) policy (change:
 * enforce-strict-csp-default, test-plan #F5; spec cross-origin-client). The page is served from
 * `http://localhost:<port>`; the "other dashboard" is the same server under `127.0.0.1:<port>`, a different
 * origin. `connect-src 'self' ws: wss:` refuses the fetch and `img-src 'self' data: blob:` the image, which is
 * why a host driving another dashboard needs `PI_DASHBOARD_CSP=report`.
 *
 *   PI_E2E_SEED=1 npx playwright test tests/e2e/csp-cross-origin-refused.spec.ts
 */

const OTHER_ORIGIN = `http://127.0.0.1:${DASHBOARD_PORT}`;

test("F5: an enforcing host refuses a cross-origin fetch and image (connect-src, img-src)", async ({ page, request }) => {
  const head = await cspHeaders(await request.get("/"));
  test.skip(head.enforcing.length === 0, "harness does not enforce CSP; boot it with PI_DASHBOARD_CSP unset or enforce");
  await installCspProbe(page);
  await page.goto(`http://localhost:${DASHBOARD_PORT}/`);
  await expect(byTestId(page, "headerAppBar")).toBeVisible({ timeout: 30_000 });

  const fetchError = await page.evaluate(async (url) => {
    try {
      await fetch(`${url}/api/health`);
      return "resolved";
    } catch (e) {
      return (e as Error).name;
    }
  }, OTHER_ORIGIN);
  expect(fetchError, "cross-origin fetch rejects").toBe("TypeError");

  await page.evaluate((url) => {
    const img = document.createElement("img");
    img.src = `${url}/favicon.ico?csp-f5=${Date.now()}`;
    document.body.appendChild(img);
  }, OTHER_ORIGIN);

  await expect
    .poll(async () => {
      const dirs = new Set((await readCspProbe(page)).filter((e) => e.blocked.startsWith(OTHER_ORIGIN)).map((e) => e.directive));
      return ["connect-src", "img-src"].filter((d) => dirs.has(d));
    })
    .toEqual(["connect-src", "img-src"]);
});
