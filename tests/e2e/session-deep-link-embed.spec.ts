/**
 * L3 — embed mode and prefix deep links for `/session/:id` URLs.
 *
 * Covers test-plan #F10, #F11, #F12, #F13, #F17, #F20 of change
 * `add-session-ui-deep-links-for-agents` (specs url-routing, app-decomposition).
 *
 * Why L3: "the sidebar is gone" and "the URL converges without a history
 * entry" are statements about the rendered shell and the real History API;
 * jsdom cannot lay out the two shells (`useMobile()` is viewport-driven).
 *
 * Exemplar: `mobile-viewport-bound.spec.ts` (viewport-driven shell checks).
 * Port comes from the running harness; one live session is reused/spawned.
 */
import { expect, type Page, test } from "./fixtures.js";
import { byTestId, ensureGitSession, gotoDashboard } from "./helpers/index.js";

const DESKTOP = { width: 1024, height: 768 } as const;
const NARROW = { width: 400, height: 800 } as const;

async function liveSessionId(page: Page): Promise<string> {
  const card = await ensureGitSession(page);
  const id = await card.getAttribute("data-session-id");
  expect(id).toBeTruthy();
  return id as string;
}

/** No session-list chrome at all: list, resize handle, hamburger, cards. */
async function expectNoSidebar(page: Page): Promise<void> {
  await expect(page.getByTestId("session-list-scroll")).toHaveCount(0);
  await expect(page.getByTestId("drag-handle")).toHaveCount(0);
  await expect(page.getByTestId("hamburger-button")).toHaveCount(0);
  await expect(page.getByTestId("session-card-desktop")).toHaveCount(0);
}

test.describe("session deep link: embed mode (L3)", () => {
  test("F10: ?embed=1 shows the chat with no sidebar; overlay routes still work", async ({ page }) => {
    const id = await liveSessionId(page);
    await page.setViewportSize(DESKTOP);
    await page.goto(`/session/${id}?embed=1`);
    await expect(page.getByPlaceholder(/message/i).first()).toBeVisible({ timeout: 30_000 });
    await expectNoSidebar(page);

    await page.goto("/settings");
    await expect(page.getByTestId("settings-panel").first()).toBeVisible({ timeout: 30_000 });
    await expectNoSidebar(page);
  });

  test("F11: embed persists across in-app navigation to a query-less URL", async ({ page }) => {
    const id = await liveSessionId(page);
    await page.setViewportSize(DESKTOP);
    await page.goto(`/session/${id}?embed=1`);
    await expect(page.getByPlaceholder(/message/i).first()).toBeVisible({ timeout: 30_000 });

    // In-app (History API) navigation, exactly what wouter's navigate() does.
    await page.evaluate((sid) => window.history.pushState({}, "", `/session/${sid}/diff`), id);
    await expect(page).toHaveURL(new RegExp(`/session/${id}/diff$`));
    await expectNoSidebar(page);
    expect(await page.evaluate(() => window.sessionStorage.getItem("pi-dash-embed"))).toBe("1");
  });

  test("F12: a narrow embed shows the session, and back lands on the embed home (no list)", async ({ page }) => {
    const id = await liveSessionId(page);
    await page.setViewportSize(NARROW);
    await page.goto(`/session/${id}?embed=1`);
    await expect(page.getByTestId("session-header")).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("back-button").click();
    await expect(page).toHaveURL(/\/(\?.*)?$/);
    await expect(page.getByTestId("embed-home")).toBeVisible();
    await expect(page.getByTestId("session-card-desktop")).toHaveCount(0);
    await expect(page.getByTestId("session-card-mobile")).toHaveCount(0);
  });

  test("F13: a unique 8-char prefix converges to the canonical URL without a history entry", async ({ page }) => {
    const id = await liveSessionId(page);
    await page.setViewportSize(DESKTOP);
    await gotoDashboard(page);
    await page.goto(`/session/${id.slice(0, 8)}/diff?embed=1`);
    await expect.poll(() => page.url(), { timeout: 30_000 }).toMatch(new RegExp(`/session/${id}/diff\\?embed=1$`));

    await page.goBack();
    // Back leaves the short URL's predecessor, never the 8-char form.
    expect(page.url()).not.toContain(`/session/${id.slice(0, 8)}/`);
  });

  test("F17: embed-exit replaces to ?embed=0, shows the sidebar, adds no history entry", async ({ page }) => {
    const id = await liveSessionId(page);
    await page.setViewportSize(DESKTOP);
    await page.goto(`/session/${id}?embed=1`);
    await expect(page.getByTestId("embed-exit")).toBeVisible({ timeout: 30_000 });
    const before = await page.evaluate(() => window.history.length);

    await page.getByTestId("embed-exit").click();
    await expect(page).toHaveURL(/embed=0$/);
    await expect(byTestId(page, "headerAppBar")).toBeVisible();
    await expect(page.getByTestId("session-list-scroll")).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => window.history.length)).toBe(before);
  });

  test("F20: an independent tab never inherits embed mode", async ({ page, browser }) => {
    const id = await liveSessionId(page);
    await page.setViewportSize(DESKTOP);
    await page.goto(`/session/${id}?embed=1`);
    await expect(page.getByPlaceholder(/message/i).first()).toBeVisible({ timeout: 30_000 });

    const ctxB = await browser.newContext({ viewport: DESKTOP });
    const b = await ctxB.newPage();
    try {
      await gotoDashboard(b);
      await b.goto(`/session/${id}`);
      await expect(b.getByTestId("session-list-scroll")).toBeVisible({ timeout: 30_000 });
      await expectNoSidebar(page);
    } finally {
      await ctxB.close();
    }
  });
});
