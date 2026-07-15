import { expect, test } from "@playwright/test";
import { byTestId, gotoDashboard, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
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

// auto-canvas Section 8 — document CSP on auto-opened file-kind documents.
//
// The pure CSP transform (`withRestrictiveCsp`, AUTO_OPEN_DOC_CSP) + the
// HtmlPreview `restrictCsp` prop are implemented + unit-tested
// (packages/client/src/lib/__tests__/canvas-doc-csp.test.ts). The auto-open
// PATH now threads `restrictCsp=true` through CanvasDriver → openInSplit →
// editor-pane openFile → EditorPane → HtmlViewer, so a canvas-opened html tab
// renders under AUTO_OPEN_DOC_CSP. `canvas()` url/youtube declares render in the
// `url` split viewer with NO document CSP (S35).
test.describe("auto-canvas — document CSP", () => {
  test("an auto-opened .html cannot beacon an external subresource (S34)", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    // Fail if the beacon subresource is ever requested.
    let beaconHit = false;
    await page.route("**/attacker.example/**", (route) => {
      beaconHit = true;
      route.abort();
    });
    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:canvas-write-html-beacon]] go");
    // The auto-opened document renders under AUTO_OPEN_DOC_CSP → img-src blocks
    // the http://attacker.example/beacon.gif subresource.
    await expect(page.getByTestId("split-editor-pane")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2_000);
    expect(beaconHit, "auto-opened doc must not beacon").toBe(false);
  });

  test("a canvas() url declare renders normally with no document CSP (S35)", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:canvas-declare-url]] go");
    // A url/youtube declare renders in the `url` split viewer (dispatchPreview →
    // PreviewBody → YouTubePreview iframe) — no restrictive document CSP.
    await expect(page.getByTestId("split-editor-pane")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("canvas-url-viewer")).toBeVisible({ timeout: 15_000 });
  });
});
