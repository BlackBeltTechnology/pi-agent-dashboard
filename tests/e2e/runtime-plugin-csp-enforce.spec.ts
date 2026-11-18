import { expect, test } from "./fixtures.js";
import { armFirstLaunchDismiss } from "./helpers/index.js";
import { CANARY_ID, ensureCanaryState } from "./helpers/runtime-canary.js";
import { BASE_URL } from "./lifecycle.js";

/**
 * L3 — runtime plugin loading under the ENFORCING baseline CSP (change: decouple-plugins-from-core; test-plan #X12,
 * spec baseline-content-security-policy). Runs on the DEFAULT lane: with `PI_DASHBOARD_CSP` unset the server enforces
 * (change: enforce-strict-csp-default, test-plan #F2):
 *
 *   PI_E2E_SEED=1 npx playwright test tests/e2e/runtime-plugin-csp-enforce.spec.ts
 *
 * On the report lane (`PI_DASHBOARD_CSP=report`) a violation is only logged, so the spec skips there instead of
 * passing vacuously. Under enforce: the import map (inline script) and the plugin's `import()` are same-origin `script-src
 * 'self'` loads and must succeed; a blob: module import must stay blocked (script-src carries no `blob:`/`data:`).
 */

test.describe("runtime plugin client under enforced CSP", () => {
  test("X12: a runtime claim renders and is styled; a blob import is blocked with one violation", async ({ page, request }) => {
    const head = await request.get(`${BASE_URL}/`);
    const enforced = head.headers()["content-security-policy"];
    test.skip(!enforced, "harness does not enforce CSP; boot it with PI_DASHBOARD_CSP unset or enforce");
    await ensureCanaryState(request, "trusted");
    // A fresh harness shows the first-launch display modal over the settings route.
    await armFirstLaunchDismiss(page);

    const scriptSrc = /script-src([^;]*)/.exec(enforced ?? "")?.[1] ?? "";
    expect(scriptSrc).not.toContain("blob:");
    expect(scriptSrc).not.toContain("data:");

    await page.addInitScript(() => {
      (window as unknown as { __csp: string[] }).__csp = [];
      document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    await page.goto(`/settings/plugins/${CANARY_ID}`);
    await expect(page.getByTestId("canary-settings")).toBeVisible({ timeout: 30_000 });
    // Styles applied (utilities-only stylesheet loaded under `style-src`): the `border-dashed` rule resolves.
    await expect(page.getByTestId("canary-settings")).toHaveCSS("border-top-style", "dashed");
    const violations = () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
    expect((await violations()).filter((v) => /plugin-assets/.test(v)), "no violation from the plugin load").toEqual([]);

    const blocked = await page.evaluate(async () => {
      try {
        await import(/* @vite-ignore */ URL.createObjectURL(new Blob(["export default 1"], { type: "text/javascript" })));
        return false;
      } catch {
        return true;
      }
    });
    expect(blocked, "blob: module import rejects").toBe(true);
    await expect.poll(async () => (await violations()).filter((v) => v.startsWith("script-src") && v.includes("blob")).length).toBe(1);
  });
});
