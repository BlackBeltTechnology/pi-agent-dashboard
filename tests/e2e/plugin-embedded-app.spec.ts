import { expect, type Page, test } from "./fixtures.js";
import { FIXTURE_GIT, gotoDashboard, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Browser E2E — embedded plugin apps (change: add-plugin-app-host, test-plan
 * F1–F5), driven through the demo-plugin fixture's `presentation: "content"`
 * claim `/folder/:encodedCwd/demo-app/*?` (the harness builds with
 * PI_DASHBOARD_FIXTURE_PLUGINS=1, see docker/compose.test.yml).
 *
 * Only a real browser can prove placement: nothing unit-tests `App`, so the
 * "content area beside the sidebar, no dialog/scrim" wiring and the mobile
 * depth have no jsdom coverage. The host contract underneath is unit-tested in
 * dashboard-plugin-runtime `embedded-app.test.tsx`.
 */

const ENC = Buffer.from(FIXTURE_GIT).toString("base64url");
const APP = `/folder/${ENC}/demo-app`;
const DESKTOP = { width: 1440, height: 900 } as const;
const MOBILE = { width: 390, height: 844 } as const;

async function openApp(page: Page, path = APP) {
  await page.goto(path);
  await expect(page.getByTestId("demo-app")).toBeVisible({ timeout: 20_000 });
}

test.describe("embedded plugin app (desktop)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
  });

  test("F1: renders in the content area beside an interactive sidebar, no dialog", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    const sid = await card.getAttribute("data-session-id");
    await openApp(page);

    await expect(page).toHaveURL(new RegExp(`${APP}$`));
    await expect(page.getByTestId("embedded-app-topbar")).toBeVisible();
    const crumb = page.getByTestId("embedded-app-breadcrumb");
    await expect(crumb).toContainText("sample-git");
    await expect(crumb).toContainText("Demo");
    // Content presentation: no dialog, no scrim, no underlay.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator('[data-testid$="-underlay"]')).toHaveCount(0);
    // The sidebar stays visible AND interactive: clicking a card leaves the app.
    const sideCard = page.locator(`[data-testid="session-card-desktop"][data-session-id="${sid}"]`);
    await expect(sideCard).toBeVisible();
    await sideCard.click();
    await expect(page).toHaveURL(new RegExp(`/session/${sid}`), { timeout: 15_000 });
  });

  test("F2: a cold deep link to a sub-route renders that view", async ({ page }) => {
    await gotoDashboard(page);
    await openApp(page, `${APP}/sub`);
    await expect(page.getByTestId("demo-app-view-sub")).toBeVisible();
    await expect(page.getByTestId("embedded-app-topbar")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("F3: Escape is ignored; top-bar Back returns to the folder", async ({ page }) => {
    await gotoDashboard(page);
    await openApp(page);
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(new RegExp(`${APP}$`));
    await expect(page.getByTestId("demo-app")).toBeVisible();
    await page.getByTestId("embedded-app-back").click();
    await expect(page).toHaveURL(new RegExp(`/folder/${ENC}$`), { timeout: 15_000 });
  });

  test("F4: return pill round trip, cleared elsewhere", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    const sid = (await card.getAttribute("data-session-id")) ?? "";
    expect(sid).not.toBe("");

    await openApp(page, `${APP}/sub`);
    await page.getByTestId("demo-app-session-id").fill(sid);
    await page.getByTestId("demo-app-open-session").click();
    await expect(page).toHaveURL(new RegExp(`/session/${sid}$`), { timeout: 15_000 });
    const pill = page.getByTestId("embedded-app-return-pill");
    await expect(pill).toHaveText("← Demo · Demo ctx");
    await pill.click();
    await expect(page).toHaveURL(new RegExp(`${APP}/sub$`), { timeout: 15_000 });
    await expect(page.getByTestId("demo-app-view-sub")).toBeVisible();
    await expect(pill).toHaveCount(0);

    // Again, then leave for /settings: no pill there.
    await page.getByTestId("demo-app-session-id").fill(sid);
    await page.getByTestId("demo-app-open-session").click();
    await expect(pill).toBeVisible({ timeout: 15_000 });
    await page.goto("/settings");
    await expect(page.getByTestId("embedded-app-return-pill")).toHaveCount(0);
  });
});

test.describe("embedded plugin app (mobile)", () => {
  test("F5: detail panel at depth 2; Back → folder; 44 px Back target", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoDashboard(page);
    await openApp(page);

    const shell = page.getByTestId("mobile-shell");
    await expect(shell).toHaveAttribute("data-depth", "2");
    await expect(shell.getByTestId("demo-app")).toBeVisible();

    const back = page.getByTestId("embedded-app-back");
    const box = await back.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    await back.click();
    await expect(page).toHaveURL(new RegExp(`/folder/${ENC}$`), { timeout: 15_000 });
  });
});
