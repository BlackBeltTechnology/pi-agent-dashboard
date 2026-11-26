import fs from "node:fs";
import path from "node:path";
import { expect, test } from "./fixtures.js";
import { routed, routeTeams, sessionIdOf, teamState, teamViewUrl } from "./helpers/agent-teams.js";
import { contrastFailures, measureText, setThemeMode } from "./helpers/computed-contrast.js";
import { spawnFreshGitSession } from "./helpers/index.js";
import { REPO_ROOT } from "./lifecycle.js";

/**
 * L3 — Team view accessibility and theming (change: add-agent-teams-ui; tasks 14.10 and
 * 14.11; test-plan S99 WCAG 2.2 AA scan, S100 reduced motion).
 *
 * axe-core is injected from node_modules (no @axe-core/playwright dep); `color-contrast`
 * is disabled in axe and covered by the repo's 3:1 floor (`contrastFailures`), exactly as
 * in mcp-client-settings-a11y.spec.ts — absolute 4.5:1 is advisory (counted, logged, not
 * gated) per the owner decision. The scan covers the Team view in dark, light and one
 * non-default palette. Reduced motion: under `prefers-reduced-motion: reduce` the skeleton
 * pulse, the busy glyph pulse and the "New messages" button compute `animation-name: none`
 * / ≈ 0 durations.
 * STATUS: written, not yet run (needs the docker harness).
 */
const axePath = path.join(REPO_ROOT, "node_modules", "axe-core", "axe.min.js");

async function open(page: import("@playwright/test").Page) {
  const state = teamState({ members: [{ name: "alice", status: "busy", sessionId: "S-a" }, { name: "bob", status: "failed" }], mail: [{ id: 1, from: "alice", to: "lead", text: "hello", priority: "urgent" }] });
  await routeTeams(page, routed(state));
  const sid = await sessionIdOf(await spawnFreshGitSession(page));
  await page.goto(teamViewUrl(sid));
  await expect(page.getByTestId("team-view")).toBeVisible({ timeout: 20_000 });
  return sid;
}

test.describe("Team view a11y and theming", () => {
  for (const [mode, theme] of [["dark", "base"], ["light", "base"], ["dark", "nord"]] as const) {
    test(`S99: axe (no serious/critical) and the 3:1 contrast floor — ${theme} ${mode}`, async ({ page }) => {
      test.setTimeout(180_000);
      await open(page);
      await setThemeMode(page, mode, theme);
      await expect(page.getByTestId("team-view")).toBeVisible({ timeout: 20_000 });
      for (const tab of [/Members/, /Tasks/, /Messages/]) {
        await page.getByRole("tab", { name: tab }).click();
        await page.addScriptTag({ path: axePath });
        const violations = await page.evaluate(async () => {
          const axe = (window as unknown as { axe: { run: (ctx: string, opts: unknown) => Promise<{ violations: Array<{ id: string; impact: string | null; nodes: Array<{ target: string[] }> }> }> } }).axe;
          const r = await axe.run('[data-testid="team-view"]', { rules: { "color-contrast": { enabled: false } } });
          return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
        });
        expect(violations, `axe in ${tab}`).toEqual([]);
        const measures = await measureText(page.getByTestId("team-view"));
        expect(contrastFailures(measures, 3), `3:1 floor in ${tab}`).toEqual([]);
        const advisory = contrastFailures(measures, 4.5).length;
        console.info(`[agent-teams a11y] ${theme} ${mode} ${tab}: ${advisory} node(s) between 3:1 and 4.5:1 (advisory)`);
      }
      // Status never colour alone: every status pill carries visible text next to its glyph.
      for (const pill of await page.getByTestId("team-member-status").all()) expect((await pill.textContent())?.trim().length).toBeGreaterThan(2);
    });
  }

  test("S100: prefers-reduced-motion removes the skeleton and status animations", async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    const busy = page.getByTestId("team-member-status").first().locator('[aria-hidden="true"]').first();
    expect(await busy.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    // The skeleton: hold the lookup so it stays on screen.
    await page.route(/\/api\/plugins\/agent-teams\/teams\?sessionId=/, () => undefined);
    await page.reload();
    const bar = page.getByTestId("team-loading").locator("div").nth(0);
    await expect(page.getByTestId("team-loading")).toBeVisible({ timeout: 20_000 });
    expect(await bar.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    for (const prop of ["animationDuration", "transitionDuration"] as const) {
      const d = await bar.evaluate((el, p) => parseFloat(getComputedStyle(el)[p as "animationDuration"]), prop);
      expect(d).toBeLessThanOrEqual(0.01);
    }
    expect(fs.existsSync(axePath)).toBe(true);
  });
});
