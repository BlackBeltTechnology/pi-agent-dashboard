import { expect, type Page, test } from "./fixtures.js";
import { ensureGitSession, FIXTURE_GIT } from "./helpers/index.js";
import { fileViewUrl, removeFile, seedFile } from "./helpers/trusted-types.js";
import { TT_EGRESS_HTML } from "./helpers/tt-fixtures.js";

// Signed navigation intents × preview egress (change: harden-client-sinks, D10).
//   F4 (test-plan #F4): a route-backed overlay opened WITHOUT `ni` (a pasted /
//       crafted link) keeps agent provenance → restricted egress: the CDN script
//       is blocked and listed in the egress banner.
//   F5 (test-plan #F5): the same overlay WITH a verified intent (minted by this
//       operator for this exact target) has operator provenance → open egress,
//       and survives a reload; stripping `ni` and reloading restores the block.
// The in-app operator action that mints (Expand on an operator-provenance card)
// is unit-tested (PreviewCard.test.tsx); here the intent is minted through the
// same endpoint from the operator's own page, so principal + origin are real.
// Exemplar: tests/e2e/canvas-egress-banner.spec.ts.

const PAGE = "tt-egress.html";
const CDN = "https://unpkg.com";

test.beforeAll(() => seedFile(PAGE, TT_EGRESS_HTML));
test.afterAll(() => removeFile(PAGE));

const cdnRow = (page: Page) => page.getByTestId("egress-banner").getByTestId("egress-row").filter({ hasText: CDN });

async function mint(page: Page): Promise<string> {
  return page.evaluate(
    async ([cwd, path]) => {
      const res = await fetch("/api/nav-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "file-view", target: { cwd, path } }),
      });
      return ((await res.json()) as { ni: string }).ni;
    },
    [FIXTURE_GIT, PAGE] as const,
  );
}

test.describe("navigation intent → preview egress", () => {
  test("F4: an overlay link without ni stays restricted — the CDN is blocked and listed", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await ensureGitSession(page);
    await page.goto(fileViewUrl(PAGE));
    await expect(page.getByTestId("preview-overlay")).toBeVisible({ timeout: 30_000 });
    await expect(cdnRow(page)).toBeVisible({ timeout: 40_000 });
  });

  test("F5: a verified intent opens with operator egress, survives reload; stripping ni restores the block", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await ensureGitSession(page);
    const ni = await mint(page);
    expect(ni).toMatch(/^[\w-]+\.[\w-]+$/);
    const withNi = `${fileViewUrl(PAGE)}&ni=${encodeURIComponent(ni)}`;
    // The live frame mounted (positive signal), and after the egress scan had
    // time to report, nothing is listed as blocked: open (operator) policy.
    const expectOpen = async () => {
      await expect(page.getByTestId("preview-overlay")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("live-open").first()).toBeVisible({ timeout: 40_000 });
      await page.waitForTimeout(8_000);
      await expect(cdnRow(page)).toHaveCount(0);
    };
    await page.goto(withNi);
    await expectOpen();
    await page.reload();
    await expectOpen();

    await page.goto(fileViewUrl(PAGE));
    await page.reload();
    await expect(cdnRow(page)).toBeVisible({ timeout: 40_000 });
  });
});
