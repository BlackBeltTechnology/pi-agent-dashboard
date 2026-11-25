import { expect, test } from "./fixtures.js";
import { routed, routeTeams, sessionIdOf, teamState, teamViewUrl } from "./helpers/agent-teams.js";
import { spawnFreshGitSession } from "./helpers/index.js";

/**
 * L3 — Stop member / Shut down team in a real browser (change: add-agent-teams-ui,
 * tasks 13.56 + 13.60, test-plan S102, S109): the REAL `ui:confirm-dialog` (accessible
 * name, "lead session stays open", Cancel and Escape send no POST, Confirm sends
 * exactly one even on a double click, focus returns to the trigger) and the inline
 * 403 message of an observe-tier credential (no toast, button re-enabled, no retry loop).
 * Exemplar: chat-gateway-team-controls.spec.ts. STATUS: written, not yet run (needs the docker harness).
 */
async function open(page: import("@playwright/test").Page, over: Parameters<typeof routed>[1] = {}) {
  const state = teamState();
  const r = routed(state, over);
  await routeTeams(page, r);
  const sid = await sessionIdOf(await spawnFreshGitSession(page));
  await page.goto(teamViewUrl(sid));
  await expect(page.getByTestId("team-view")).toBeVisible({ timeout: 20_000 });
  return { r, sid };
}

test.describe("team controls", () => {
  test("S102: dialog flow — Cancel / Escape → zero POST; Confirm → exactly one POST (double click); focus returns", async ({ page }) => {
    test.setTimeout(120_000);
    const { r } = await open(page, { post: async () => ({ status: 202, body: { closing: true } }) });
    const trigger = page.getByTestId("team-shutdown");

    await trigger.click();
    const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog"));
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("lead session stays open");
    await expect(dialog).toHaveAccessibleName(/.+/);
    await dialog.getByRole("button", { name: /cancel/i }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await trigger.click();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("team-view"), "Escape closes only the dialog").toBeVisible();
    await expect(trigger).toBeFocused();
    expect(r.posts).toEqual([]);

    await trigger.click();
    await dialog.getByRole("button", { name: /shut down team/i }).dblclick();
    await expect.poll(() => r.posts.length, { timeout: 10_000 }).toBe(1);
    await page.waitForTimeout(1_000);
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0]).toMatch(/\/teams\/t-e2e\/shutdown$/);
  });

  test("S109: a 403 from the host tier gate shows an inline permission message, no toast, no retry", async ({ page }) => {
    test.setTimeout(120_000);
    const { r } = await open(page, { post: async () => ({ status: 403, body: { error: "forbidden" } }) });
    const stop = page.getByTestId("team-member-stop");
    await stop.click();
    const err = page.getByTestId("team-member-stop-error");
    await expect(err).toContainText(/permission/i);
    await expect(stop).toBeEnabled();
    await expect(stop).toHaveAttribute("aria-describedby", (await err.getAttribute("id")) ?? "");
    await page.waitForTimeout(3_000);
    expect(r.posts).toHaveLength(1);
    await expect(page.getByRole("status").filter({ hasText: /permission/i })).toHaveCount(0); // no toast storm
  });
});
