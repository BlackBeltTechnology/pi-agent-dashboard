import { expect, test } from "@playwright/test";
import { byTestId, gotoDashboard } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

// Baseline CSP (§7). The container runs report-only by default, so the header
// must be present AND the shell must render with no CSP violations that would
// break core load (the report-only signal that gates flipping to enforce).
test.describe("baseline CSP", () => {
  test("emits a CSP header on the dashboard document", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/`);
    const enforce = res.headers()["content-security-policy"];
    const report = res.headers()["content-security-policy-report-only"];
    const csp = enforce ?? report;
    expect(csp, "a CSP header must be present").toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
  });

  test("shell renders with no CSP violations", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (msg) => {
      const t = msg.text();
      if (/Content Security Policy|Refused to (load|execute|connect|frame)/i.test(t)) {
        violations.push(t);
      }
    });
    await gotoDashboard(page);
    await expect(byTestId(page, "headerAppBar")).toBeVisible();
    // Give async chunks (Monaco/mermaid workers, WS) a beat to load.
    await page.waitForTimeout(3_000);
    expect(violations, `CSP violations:\n${violations.join("\n")}`).toHaveLength(0);
  });
});
