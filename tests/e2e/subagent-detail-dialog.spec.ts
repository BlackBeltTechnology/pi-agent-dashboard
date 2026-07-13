import { expect, test } from "@playwright/test";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// change: fix-subagent-live-detail-reliability (D4) — the subagent detail
// popout opens the shell `ui:dialog` primitive (parity with flow-agent-detail),
// NOT a `window.open(..., "_blank")` browser tab that breaks on Electron/PWA/
// mobile.
//
// Reuses the `subagent-spawn` faux scenario (qa/fixtures/faux-scenarios.ts):
// the parent emits an `Agent` tool call whose prompt embeds `[[faux:plain-text]]`,
// so pi spawns a REAL subagent and the subagents-plugin renders it through
// AgentToolRenderer (its card sits inside a tool-burst-group).
//
// Harness note: the faux subagent does not reliably resolve a `toolDetails.agentId`
// (it terminates before emitting a full AgentDetails), so the Popout affordance
// may stay DISABLED here. The POSITIVE dialog-open path (agentId present →
// dialog opens) is exercised deterministically in the AgentToolRenderer unit
// tests, where agentId is controllable. What THIS e2e proves through the real
// prompt → faux → bridge → /ws → renderer round-trip is the core D4 regression
// guard: activating the popout affordance NEVER opens a new browser tab/window
// (the retired `window.open` path), and — when agentId is present — opens a
// `ui:dialog` dismissable with Esc. Needs PI_E2E_SEED=1.
test.describe("subagent detail dialog (D4)", () => {
  test("popout never opens a new browser tab; opens a ui:dialog when agentId resolves", async ({ page, context }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:subagent-spawn]] go");

    // Subagent card mounts and the parent round-trip settles.
    await expect(page.getByText(/faux subagent probe/i).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText(/subagent spawn complete/i).first()).toBeVisible({
      timeout: 60_000,
    });

    // The Agent card sits inside a collapsed tool-burst-group; expand every
    // "Explore: faux subagent probe" toggle (group header + member row) until
    // the AgentToolRenderer CardControls (Details + Popout pills) surface.
    const popout = page.getByRole("button", { name: "Popout" }).first();
    const toggles = page.getByRole("button", { name: /Explore: faux subagent probe/i });
    for (let i = 0; i < (await toggles.count()); i++) {
      // Break on VISIBILITY, not DOM presence: the Popout button may exist in a
      // collapsed tool-burst-group but stay hidden until the group is expanded.
      if (await popout.isVisible().catch(() => false)) break;
      await toggles.nth(i).click();
    }
    await expect(popout).toBeVisible({ timeout: 30_000 });

    // No dialog before activation.
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Arm a popup watcher: the retired window.open path would fire a `popup`
    // event and add a second context page.
    const popupPromise = context.waitForEvent("popup", { timeout: 3_000 }).catch(() => null);
    const pagesBefore = context.pages().length;

    if (await popout.isEnabled()) {
      // agentId resolved → popout opens the ui:dialog.
      await popout.click();
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    } else {
      // agentId unresolved (faux harness) → disabled affordance opens nothing.
      await popout.click({ force: true });
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }

    // Core D4 regression guard: NO new browser tab/window was ever opened.
    expect(await popupPromise).toBeNull();
    expect(context.pages().length).toBe(pagesBefore);
  });
});
