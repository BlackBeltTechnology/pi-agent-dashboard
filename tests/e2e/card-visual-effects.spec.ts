/**
 * Browser E2E — card effects off, computed in a real engine (jsdom has no
 * CSS cascade). The status overlay / selected ring are injected with the exact
 * production classes so the assertion is independent of a live streaming turn.
 * Scenarios: test-plan #F4, #F5. See change: add-focus-mode-and-card-block-toggles.
 */
import { expect, type Page, test } from "./fixtures.js";
import { resetCardPrefs, setSectionViaBus } from "./helpers/card-sections.js";
import { spawnFreshGitSession } from "./helpers/index.js";

const KEYS = ["fx-status-animation", "fx-selected-glow"];

async function injectStatusOverlays(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelector("#fx-status-fixture")?.remove();
    const host = document.createElement("div");
    host.id = "fx-status-fixture";
    host.style.cssText = "position:fixed;top:0;left:0;width:300px;height:40px;pointer-events:none;z-index:-1";
    host.innerHTML = ["running", "unread", "input"]
      .map((k) => `<div style="position:relative;width:300px;height:12px"><div data-fx="${k}" class="card-stripes-fx card-stripes-${k}"></div></div>`)
      .join("");
    document.body.appendChild(host);
  });
}

const beforeStyle = (page: Page, sel: string) =>
  page.locator(sel).first().evaluate((el) => {
    const cs = getComputedStyle(el, "::before");
    return { animationName: cs.animationName, backgroundImage: cs.backgroundImage };
  });

test.describe("card visual effects", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);
  test.afterAll(async () => resetCardPrefs(KEYS));

  test("F4: status animation off → overlay does not animate, no repeating gradient, class unchanged", async ({ page }) => {
    await spawnFreshGitSession(page);
    await injectStatusOverlays(page);
    await expect.poll(async () => (await beforeStyle(page, '[data-fx="running"]')).animationName).not.toBe("none");

    await setSectionViaBus("fx-status-animation", false);
    await expect(page.locator("html")).toHaveAttribute("data-fx-status", "off");
    for (const k of ["running", "unread", "input"]) {
      const s = await beforeStyle(page, `[data-fx="${k}"]`);
      expect(s.animationName, `${k} still animates`).toBe("none");
      expect(s.backgroundImage, `${k} keeps the repeating band`).not.toContain("repeating-linear-gradient");
      expect(s.backgroundImage, `${k} lost its static tint`).toContain("linear-gradient");
    }
    await expect(page.locator('[data-fx="running"]')).toHaveClass(/card-stripes-fx card-stripes-running/);
  });

  test("F5: glow off hides the ring, keeps the selected border; status animation unaffected", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await setSectionViaBus("fx-status-animation", null);
    await expect(card.locator(".card-ring-fx").first()).toBeVisible();

    await setSectionViaBus("fx-selected-glow", false);
    await expect(page.locator("html")).toHaveAttribute("data-fx-glow", "off");
    await expect(card.locator(".card-ring-fx").first()).toBeHidden();
    await expect(card).toHaveClass(/card-selected-ring/);
    await injectStatusOverlays(page);
    expect((await beforeStyle(page, '[data-fx="running"]')).animationName).not.toBe("none");
  });
});
