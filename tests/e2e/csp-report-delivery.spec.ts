import { expect, test } from "./fixtures.js";
import { countOf, cspHeaders, readCspReports } from "./helpers/csp-strict.js";

/**
 * L3 — CSP violation reports reach the counters on the UNMODIFIED document (change: fix-csp-report-delivery;
 * test-plan #F1; spec baseline-content-security-policy "Report destinations are deliverable on plain http").
 * No `page.route` rewrite: `report-to` + `Reporting-Endpoints` were never delivered by Chromium/Firefox on plain
 * http, so the response must carry `report-uri` only. Exemplar: tests/e2e/csp-strict-report.spec.ts.
 */
test.describe("CSP report delivery, report mode", () => {
  test("F1: / carries report-uri only, and an inline script moves the strict counter", async ({ page, request }) => {
    test.setTimeout(60_000);
    const doc = await cspHeaders(await request.get("/"));
    const all = [...doc.enforcing, ...doc.reportOnly];
    test.skip(!doc.reportOnly.some((v) => v.includes("/__pi/csp-report/strict")), "harness does not emit the strict Report-Only policy");
    if (readCspReports() === undefined) test.skip(true, "health carries no cspReports block (disclosure refused or sink not wired)");

    for (const v of all) expect(v, "no report-to token").not.toMatch(/report-to/);
    expect(doc.reportingEndpoints, "no Reporting-Endpoints header").toBeUndefined();

    await page.goto("/");
    await page.waitForTimeout(3_000);
    const before = countOf(readCspReports(), "strict", "script-src-elem");
    await page.evaluate(() => {
      const s = document.createElement("script");
      s.appendChild(document.createTextNode("window.__a=1"));
      document.head.appendChild(s);
    });
    await expect.poll(() => countOf(readCspReports(), "strict", "script-src-elem") - before, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  });
});
