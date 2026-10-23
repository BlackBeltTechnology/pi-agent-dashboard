import { expect, test } from "./fixtures.js";
import {
  CSP_REPORT_PREFIX,
  countOf,
  cspHeaders,
  installCspProbe,
  pluginIds,
  readCspProbe,
  readCspReports,
  reportLabelOf,
  scriptSrcOnly,
  TT_DIRECTIVE,
} from "./helpers/csp-strict.js";
import { byTestId } from "./helpers/index.js";

/**
 * L3 — strict CSP in the DEFAULT (`report`) harness (change: harden-cors-and-csp-reporting; test-plan #WF1, #WF4;
 * spec baseline-content-security-policy). The default mode emits the baseline AND the strict policy as two
 * Report-Only headers, each naming its own sink under `/__pi/csp-report/<label>`. Exemplar:
 * tests/e2e/trusted-types-budget.spec.ts.
 */

const CORE_ROUTES = ["/", "/settings/general", "/settings/security", "/settings/access", "/settings/appearance", "/atlas"];

test.describe("strict CSP, report mode", () => {
  test.describe("WF1: core routes", () => {
    test.use({ serviceWorkers: "block" });

    test("WF1: strict Report-Only yields zero script-src* violations and no strict report on core routes", async ({ page, request }) => {
      const head = await cspHeaders(await request.get("/"));
      test.skip(!head.reportOnly.some((v) => v.includes(`${CSP_REPORT_PREFIX}strict`)), "harness does not emit the strict Report-Only policy (PI_DASHBOARD_CSP=enforce/off?)");
      const routes = [...CORE_ROUTES, ...pluginIds().map((id) => `/settings/plugins/${id}`)];
      test.setTimeout(60_000 + routes.length * 15_000);

      await installCspProbe(page);
      let strictReports = 0;
      page.on("request", (r) => {
        if (r.url().includes(`${CSP_REPORT_PREFIX}strict`)) strictReports++;
      });
      for (const route of routes) {
        strictReports = 0;
        await page.goto(route);
        await expect(byTestId(page, "headerAppBar"), route).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(3_000);
        // `script-src*` of the strict policy only; the baseline listener is deliberately not asserted.
        expect(scriptSrcOnly(await readCspProbe(page)), `${route}: strict script-src violations`).toEqual([]);
        expect(strictReports, `${route}: requests to the strict sink`).toBe(0);
      }
    });
  });

  test("WF4: browser-emitted reports reach the sink; a TT violation files under its header's label, not strict", async ({ page, request }) => {
    test.setTimeout(90_000);
    const doc = await cspHeaders(await request.get("/apps/team/"));
    const all = [...doc.enforcing, ...doc.reportOnly];
    // Where the TT directive rides decides its label: a TT-only header → `trusted-types`, else the header it is appended to.
    const ttLabel = reportLabelOf(all, TT_DIRECTIVE);
    test.skip(!ttLabel, "no header on /apps/team/ carries the Trusted Types directive with a report destination");
    test.skip(!doc.reportOnly.some((v) => v.includes(`${CSP_REPORT_PREFIX}strict`)), "harness does not emit the strict Report-Only policy");
    if (readCspReports() === undefined) test.skip(true, "health carries no cspReports block (disclosure refused or sink not wired)");

    // Chromium may not surface report-uri deliveries to page.on("request"); when it does, every one must be a 204.
    const sinkStatuses: number[] = [];
    page.on("response", (r) => {
      if (r.url().includes(CSP_REPORT_PREFIX)) sinkStatuses.push(r.status());
    });

    await page.goto("/apps/team/");
    await page.waitForTimeout(3_000);

    // 1. One raw sink on a page with no `default` policy → one TT violation, filed under `ttLabel` only.
    const ttBefore = countOf(readCspReports(), ttLabel as string, "require-trusted-types-for");
    const strictTtBefore = countOf(readCspReports(), "strict", "require-trusted-types-for");
    await page.evaluate(() => {
      const d = document.createElement("div");
      d.innerHTML = "<b>raw sink</b>";
    });
    await expect
      .poll(() => countOf(readCspReports(), ttLabel as string, "require-trusted-types-for") - ttBefore, { timeout: 15_000 })
      .toBe(1);
    expect(countOf(readCspReports(), "strict", "require-trusted-types-for") - strictTtBefore, "TT violations never file under strict (unless strict carries them)").toBe(
      ttLabel === "strict" ? 1 : 0,
    );

    // 2. A no-nonce inline script: report-only does not block it, and the strict policy reports it. (Creating the
    //    script is itself a TT sink, so the TT bucket may move again; only the strict script-src bucket is asserted.)
    const strictBefore = countOf(readCspReports(), "strict", "script-src-elem");
    await page.evaluate(() => {
      const s = document.createElement("script");
      s.appendChild(document.createTextNode("window.__a=1"));
      document.head.appendChild(s);
    });
    expect(await page.evaluate(() => (window as unknown as { __a?: number }).__a)).toBe(1);
    await expect.poll(() => countOf(readCspReports(), "strict", "script-src-elem") - strictBefore, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);

    for (const status of sinkStatuses) expect(status, "the sink answers every browser report 204").toBe(204);
  });
});
