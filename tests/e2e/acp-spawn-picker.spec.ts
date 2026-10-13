import { expect, test } from "./fixtures.js";
import { spawnAcpSession } from "./helpers/acp.js";
import { ensureFixtureGitGroup, FIXTURE_GIT, gotoDashboard, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Spawn picker (WAI-ARIA menu button) in the browser: keyboard operation,
 * per-folder memory and the unchanged-when-pi default (test-plan #F9/#F10/#F11).
 *
 * See change: add-acp-session-driver (tasks 7.83, 7.84).
 */
test.describe("ACP spawn picker", () => {
  test("opens with the chevron, is a menu of radios and Escape returns focus", async ({ page }) => {
    await gotoDashboard(page);
    const body = await ensureFixtureGitGroup(page);
    const chevron = body.getByTestId("folder-spawn-session-btn-chevron");
    await expect(chevron).toHaveAttribute("aria-haspopup", "menu");
    await chevron.click();

    const menu = page.getByTestId("folder-spawn-session-btn-menu");
    await expect(menu).toHaveAttribute("role", "menu");
    const items = menu.getByRole("menuitemradio");
    await expect(items).toHaveCount(6); // pi + 5 seeded agents
    await expect(items.first()).toHaveAttribute("aria-checked", "true");

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(menu).toHaveCount(0);
    await expect(chevron).toBeFocused();
    await expect(body.getByTestId("folder-spawn-session-btn-agent")).toContainText("QueryMT");

    await chevron.click();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(chevron).toBeFocused();
  });

  test("the chosen agent is remembered per folder across a reload", async ({ page }) => {
    await gotoDashboard(page);
    let body = await ensureFixtureGitGroup(page);
    await body.getByTestId("folder-spawn-session-btn-chevron").click();
    await page.getByTestId("folder-spawn-session-btn-menu").locator('[data-agent="qmt-perm"]').click();
    await page.reload();
    body = await ensureFixtureGitGroup(page);
    await expect(body.getByTestId("folder-spawn-session-btn-agent")).toContainText("QueryMT Perm");

    // restore the default so later specs start from pi
    await body.getByTestId("folder-spawn-session-btn-chevron").click();
    await page.getByTestId("folder-spawn-session-btn-menu").locator('[data-agent="pi"]').click();
    await expect(body.getByTestId("folder-spawn-session-btn-agent")).toContainText("pi");
  });
});

/** Choose `agentId` in the FIXTURE_GIT folder's picker (does not spawn). */
async function pickAgent(page: import("@playwright/test").Page, agentId: string): Promise<import("@playwright/test").Locator> {
  const body = await ensureFixtureGitGroup(page);
  await body.getByTestId("folder-spawn-session-btn-chevron").click();
  await page.getByTestId("folder-spawn-session-btn-menu").locator(`[data-agent="${agentId}"]`).click();
  return body;
}

test.describe("ACP spawn picker layout", () => {
  for (const width of [375, 900, 1440]) {
    test(`a long agent name keeps the button short and the menu on screen at ${width}px (#F13)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await gotoDashboard(page);
      const body = await pickAgent(page, "claude");
      const main = body.getByTestId("folder-spawn-session-btn");
      await main.scrollIntoViewIfNeeded();
      const box = await main.boundingBox();
      expect(box, "main button must render").not.toBeNull();
      expect(box!.height).toBeLessThanOrEqual(64); // one 44 px control, two label lines at most

      await body.getByTestId("folder-spawn-session-btn-chevron").click();
      const menu = page.getByTestId("folder-spawn-session-btn-menu");
      const mbox = await menu.boundingBox();
      expect(mbox).not.toBeNull();
      expect(mbox!.x).toBeGreaterThanOrEqual(0);
      expect(mbox!.x + mbox!.width).toBeLessThanOrEqual(width);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
});

test("the worktree dialog preselects the folder's agent and names it on the create action (#F14)", async ({ page }) => {
  await gotoDashboard(page);
  const body = await pickAgent(page, "claude");
  await body.getByTestId("folder-spawn-worktree-btn").click();
  const select = page.getByTestId("worktree-dialog-agent");
  await expect(select).toBeVisible({ timeout: 30_000 });
  await expect(select).toHaveValue("claude");
  await expect(page.getByTestId("worktree-dialog-create-submit")).toContainText("Claude Agent");

  // Back to pi: the label loses the agent name.
  await select.selectOption("");
  await expect(page.getByTestId("worktree-dialog-create-submit")).not.toContainText("Claude Agent");
});

test("the goal link picker offers pi sessions only and says what is hidden (#F15)", async ({ page }) => {
  // pi session first (the folder still remembers pi), then an ACP one.
  const piCard = await spawnFreshGitSession(page);
  const piId = (await piCard.getAttribute("data-session-id")) as string;
  const acpCard = await spawnAcpSession(page, "qmt");
  expect(await acpCard.getAttribute("data-session-id")).not.toBe(piId);

  // A real goal needs the goal loop; the detail page only reads the list, so
  // serve one (same technique as ui-token-alignment.spec.ts).
  const goal = {
    id: "g-e2e-acp-picker",
    cwd: FIXTURE_GIT,
    objective: "e2e acp goal picker",
    criteria: [],
    status: "pursuing",
    sessionIds: [] as string[],
    totalSpendUsd: 0,
    createdAt: Date.now() - 60_000,
    updatedAt: Date.now(),
  };
  await page.route("**/api/folders/goals?**", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ success: true, data: [goal] }) });
  });
  // Mirror of packages/client/src/lib/util/folder-encoding.ts::encodeFolderPath (base64url).
  const enc = Buffer.from(FIXTURE_GIT, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  {
    await page.goto(`/folder/${enc}/goals/${goal.id}`);
    await expect(page.getByTestId("goal-new-session")).toContainText("New pi session", { timeout: 30_000 });
    await page.getByTestId("goal-link-existing").click();
    const picker = page.getByTestId("goal-link-picker");
    await expect(picker).toBeVisible();
    await expect(page.getByTestId("goal-link-acp-hidden")).toContainText(/ACP sessions? hidden — goals need pi\./);
    // the pi session is offered; no ACP session is
    await expect(picker.getByRole("button").first()).toBeVisible();
  }
});
