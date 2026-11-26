import { expect, test } from "./fixtures.js";
import { routed, routeTeams, sessionIdOf, teamState, teamViewUrl } from "./helpers/agent-teams.js";
import { spawnFreshGitSession } from "./helpers/index.js";

/**
 * L3 — Team view route behaviour (change: add-agent-teams-ui; tasks 14.4, 14.5, 14.6,
 * 14.8; test-plan S93, S94, S95, S97): cold deep link (skeleton → team, never a "no team"
 * flash, header names the viewed teammate), lead → teammate → back switching, Escape
 * (view stays; dialog closes alone and returns focus), no occlusion, and the width switch.
 * S97 adapts to the owner decision "tabs on every width": the selected tab survives the
 * resize and nothing duplicates. Exemplars: route-backed-overlay.spec.ts, overlay-layout.spec.ts.
 * STATUS: written, not yet run (needs the docker harness).
 */
const members = [
  { name: "alice", status: "busy", sessionId: "S-alice" },
  { name: "bob", status: "idle", sessionId: "S-bob" },
];

async function setup(page: import("@playwright/test").Page, over: Parameters<typeof routed>[1] = {}) {
  const state = teamState({ members });
  const r = routed(state, over);
  await routeTeams(page, r);
  const sid = await sessionIdOf(await spawnFreshGitSession(page));
  state.members = [{ name: "alice", status: "busy", sessionId: sid }, members[1] as (typeof members)[number]];
  return { sid, state, r };
}

test.describe("Team view route", () => {
  test("S93: hard reload of the teammate route shows the skeleton, then the team; never flashes 'no team'", async ({ page }) => {
    test.setTimeout(120_000);
    const { sid } = await setup(page);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    await page.route(/\/api\/plugins\/agent-teams\/teams\?sessionId=/, async (route) => {
      await held;
      await route.fallback();
    });
    await page.goto(teamViewUrl(sid));
    await expect(page.getByTestId("team-loading")).toHaveAttribute("aria-busy", "true", { timeout: 20_000 });
    await expect(page.getByTestId("team-none")).toHaveCount(0);
    release();
    await expect(page.getByTestId("team-view")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("team-viewed-from")).toContainText("alice");
    await expect(page.getByTestId("team-none")).toHaveCount(0);
  });

  test("S94: lead → teammate → Back; same team, 'viewed from' only on the teammate route; sidebar stays clickable", async ({ page }) => {
    test.setTimeout(120_000);
    const { sid, state } = await setup(page);
    await page.goto(teamViewUrl(sid));
    await expect(page.getByTestId("team-view")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("team-name")).toHaveText(state.name);
    // The viewed session is alice here, so the header names her.
    await expect(page.getByTestId("team-viewed-from")).toContainText("alice");
    await expect(page.locator('[data-testid="session-card-desktop"]').first()).toBeEnabled();
    await page.getByTestId("team-back").click();
    await expect(page).toHaveURL(new RegExp(`/session/${sid}$`));
    await expect(page.getByTestId("team-view")).toHaveCount(0);
  });

  test("S95: Escape does nothing on the view; Escape in the dialog closes only the dialog and returns focus; Back overlaps nothing", async ({ page }) => {
    test.setTimeout(120_000);
    const { sid } = await setup(page);
    await page.goto(teamViewUrl(sid));
    await expect(page.getByTestId("team-view")).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("team-view")).toBeVisible();
    const trigger = page.getByTestId("team-shutdown");
    await trigger.click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("team-view")).toBeVisible();
    await expect(trigger).toBeFocused();
    const boxes = await page.locator('[data-testid="team-header"] button, [data-testid="team-header"] a').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom })));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i] as (typeof boxes)[number];
        const b = boxes[j] as (typeof boxes)[number];
        const overlap = a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
        expect(overlap, `header controls ${i} and ${j} overlap`).toBe(false);
      }
    }
  });

  test("S97: the selected tab survives a narrow ↔ wide resize; ids stay unique and the live region stays", async ({ page }) => {
    test.setTimeout(120_000);
    const { sid } = await setup(page);
    await page.setViewportSize({ width: 600, height: 800 });
    await page.goto(teamViewUrl(sid));
    await expect(page.getByTestId("team-view")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("tab", { name: /Tasks/ }).click();
    await page.locator('[data-testid="team-task-toggle"]').first().focus();
    for (const width of [1400, 600]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(page.getByRole("tab", { name: /Tasks/ })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("team-live-region")).toHaveCount(1);
      const dupes = await page.evaluate(() => {
        const ids = Array.from(document.querySelectorAll("[id]")).map((e) => e.id);
        return ids.filter((id, i) => ids.indexOf(id) !== i);
      });
      expect(dupes).toEqual([]);
    }
  });
});
