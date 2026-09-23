import { mdiCheckDecagram } from "@mdi/js";
import { FOOTER_ICON_KEY, FOOTER_ICON_TAIL, FOOTER_ICON_TEXT } from "../../qa/fixtures/faux-scenarios.js";
import { expect, test } from "./fixtures.js";
import { byTestId, gotoDashboard, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * L3 gate for the lazy full MDI icon set (change:
 * harden-ios-safari-memory-and-ws-diagnostics; issue #712).
 *
 * P1 — a cold landing with no key-resolved icon on screen fetches no chunk
 * carrying the full `@mdi/js` set, and its eager JS graph (entry script +
 * every `modulepreload`) is strictly smaller than the pre-change baseline
 * recorded in the change's notes.md (6,740,503 B decoded).
 *
 * F2 — a key-resolved icon (a footer-segment decorator whose `icon` is an MDI
 * key, published by the `e2e-custom` fixture's `e2e_footer_segment` tool)
 * renders in a real browser, and the lazy set is requested exactly once. F2
 * also proves the P1 matcher names the real chunk, so P1 cannot pass vacuously.
 *
 * See change: harden-ios-safari-memory-and-ws-diagnostics (test-plan #P1, #F2).
 */

/** Rollup names the lazy chunk after its module, `@mdi/js/commonjs/mdi.js`. */
const FULL_SET_CHUNK = /\/assets\/mdi-[^/]*\.js$/;
const BASELINE_LANDING_JS_BYTES = 6_740_503;

function recordFullSetRequests(page: import("@playwright/test").Page): string[] {
  const hits: string[] = [];
  page.on("request", (req) => {
    try {
      if (FULL_SET_CHUNK.test(new URL(req.url()).pathname)) hits.push(req.url());
    } catch {
      /* non-URL request */
    }
  });
  return hits;
}

test.describe("lazy MDI icon set", () => {
  test("P1: the cold landing fetches no full-icon-set chunk and less JS than the baseline", async ({ page }) => {
    test.setTimeout(120_000);
    const fullSet = recordFullSetRequests(page);

    await gotoDashboard(page);
    await expect(byTestId(page, "headerAppBar")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1_500);

    expect(fullSet, `full-icon-set chunk fetched on a cold landing:\n${fullSet.join("\n")}`).toEqual([]);

    const measured = await page.evaluate(() => {
      const eager = [
        ...Array.from(document.querySelectorAll('link[rel="modulepreload"]')).map((l) => (l as HTMLLinkElement).href),
        ...Array.from(document.querySelectorAll('script[type="module"][src]')).map((s) => (s as HTMLScriptElement).src),
      ];
      const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      const selected = entries.filter((e) => eager.includes(e.name));
      return {
        total: selected.reduce((sum, e) => sum + (e.decodedBodySize || 0), 0),
        detail: selected.map((e) => `${e.name.split("/").pop()}=${e.decodedBodySize}`).join(" "),
      };
    });
    test.info().annotations.push({
      type: "perf",
      description: `landing JS ${measured.total} B decoded (baseline ${BASELINE_LANDING_JS_BYTES} B); ${measured.detail}`,
    });
    expect(measured.total, measured.detail).toBeGreaterThan(0);
    expect(measured.total, measured.detail).toBeLessThan(BASELINE_LANDING_JS_BYTES);
  });

  test("F2: a key-resolved footer icon renders and loads the set exactly once", async ({ page }) => {
    test.setTimeout(180_000);
    const fullSet = recordFullSetRequests(page);

    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:footer-icon]] go");
    await expect(page.getByText(FOOTER_ICON_TAIL).first()).toBeVisible({ timeout: 60_000 });

    const segment = page.getByTestId("footer-segment:e2e:lazy-icon");
    await expect(segment).toContainText(FOOTER_ICON_TEXT, { timeout: 30_000 });
    // FOOTER_ICON_KEY is mdiCheckDecagram: the rendered path must be its data.
    await expect(segment.locator("svg path")).toHaveAttribute("d", mdiCheckDecagram, { timeout: 30_000 });

    await page.waitForTimeout(1_000);
    expect(fullSet, `expected exactly one full-icon-set request for ${FOOTER_ICON_KEY}`).toHaveLength(1);
  });
});
