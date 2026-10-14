import { expect, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";

/**
 * L3 browser behaviour for the lazy islands (change:
 * shrink-client-entry-lazy-islands): katex, the hu/zh-CN catalogs and the
 * Settings panel are separate chunks fetched only on first use.
 *
 * Asserts on the REAL network — the unit/build guards prove the chunks exist
 * and are off the landing graph; only a browser proves the cold page does not
 * request them and the first use does. KaTeX is covered by the build guard and
 * jsdom (a math message needs a live session, not worth a harness spawn here).
 * The dashboard port comes from the Playwright baseURL (.pi-test-harness.json).
 */

const CHUNK = {
  katex: /\/assets\/katex-[^/]+\.(js|css)(\?|$)/,
  hu: /\/assets\/i18n-hu-[^/]+\.js(\?|$)/,
  zh: /\/assets\/i18n-zh-CN-[^/]+\.js(\?|$)/,
  settings: /\/assets\/SettingsPanel-[^/]+\.js(\?|$)/,
};

test.describe("lazy islands", () => {
  test("English cold load fetches no island; opening Settings fetches the panel chunk only", async ({ page }) => {
    // Start from English regardless of what earlier specs left in storage.
    await page.addInitScript(() => localStorage.setItem("pi-dashboard-language", "en"));
    const urls: string[] = [];
    page.on("request", (r) => urls.push(r.url()));

    await gotoDashboard(page);
    await page.waitForLoadState("networkidle");
    for (const [name, re] of Object.entries(CHUNK)) {
      expect(urls.filter((u) => re.test(u)), `cold landing requested the ${name} island`).toEqual([]);
    }

    await page.getByRole("button", { name: "Settings", exact: true }).first().click();
    await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });
    expect(urls.filter((u) => CHUNK.settings.test(u)).length).toBeGreaterThan(0);
    // English + Settings still pulls neither a catalog nor KaTeX.
    for (const name of ["katex", "hu", "zh"] as const) {
      expect(urls.filter((u) => CHUNK[name].test(u)), `${name} requested without need`).toEqual([]);
    }
  });

  test("switching to Magyar loads the hu catalog once, translates, and back to English", async ({ page }) => {
    await page.addInitScript(() => {
      // Only seed on the first document; the switch below persists its own value.
      if (!sessionStorage.getItem("seeded-lang")) {
        localStorage.setItem("pi-dashboard-language", "en");
        sessionStorage.setItem("seeded-lang", "1");
      }
    });
    const urls: string[] = [];
    page.on("request", (r) => urls.push(r.url()));

    await gotoDashboard(page);
    await page.getByRole("button", { name: "Settings", exact: true }).first().click();
    await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("settings-nav-rail").getByRole("button", { name: "General", exact: true }).click();

    const language = page.getByLabel("Language", { exact: true });
    await language.selectOption("hu");
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe("hu");
    // Translated on the first hu frame: the rail label is Hungarian, not English.
    await expect(page.getByTestId("settings-nav-rail").getByRole("button", { name: "Általános", exact: true })).toBeVisible();
    expect(urls.filter((u) => CHUNK.hu.test(u)).length).toBe(1);
    expect(urls.filter((u) => CHUNK.zh.test(u))).toEqual([]);

    // Back to English; the hu chunk is not refetched.
    await page.getByLabel("Nyelv").selectOption("en");
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe("en");
    await expect(page.getByTestId("settings-nav-rail").getByRole("button", { name: "General", exact: true })).toBeVisible();
    expect(urls.filter((u) => CHUNK.hu.test(u)).length).toBe(1);
  });

  test("a Hungarian cold start renders nothing until its catalog arrives (no English flash)", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("pi-dashboard-language", "hu"));
    const urls: string[] = [];
    page.on("request", (r) => urls.push(r.url()));
    // Hold the hu catalog so the pre-render window is observable.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await page.route(CHUNK.hu, async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto("/", { waitUntil: "commit" });
    await expect.poll(() => urls.filter((u) => CHUNK.hu.test(u)).length).toBeGreaterThan(0);
    // Catalog request is in flight: React has not mounted a single frame yet.
    await page.waitForTimeout(300);
    expect(await page.locator("#root").evaluate((el) => el.childElementCount)).toBe(0);
    release();
    await expect(page.getByTestId("header-app-bar")).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("hu");
  });
});
