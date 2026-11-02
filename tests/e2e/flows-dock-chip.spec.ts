import { execFileSync } from "node:child_process";
import { expect, test } from "./fixtures.js";
import { resolveContainer } from "./helpers/container-proc.js";
import {
  chipEdit,
  chipOpen,
  chipRun,
  closeChipPopover,
  flowsChip,
  openChipPopover,
  pickFlow,
  waitForFlowsChip,
} from "./helpers/flows-chip.js";
import { byTestId, FIXTURE_GIT, gotoDashboard, spawnFreshGitSession } from "./helpers/index.js";
import { closeSessionMenu, openSessionMenu, sessionMenuPanel } from "./helpers/session-actions-menu.js";
import { restartDashboard } from "./helpers/windowed-session.js";

// Change: flows-dock-chip-and-panel-actions — L3 against the REAL pi-flows engine
// + faux agents (exemplar: flow-attach-before-run.spec.ts). The harness bakes
// `e2e:synthetic` (2 agents, succeeds) and `e2e:failing` (1 agent, faux model
// error) under /fixtures/sample-git/.pi/flows/flows/e2e/.
//
// The flows plugin bridge publishes the session's flow catalog as a replayed
// `flow_catalog` event; the FLOWS chip in the composer dock carries Run / Open /
// Edit. The flow panel starts collapsed and never opens on its own.

const sh = (script: string): string =>
  execFileSync("docker", ["exec", resolveContainer(), "bash", "-c", script], { encoding: "utf8" }).trim();

/** Record catalog asks the page sends (`plugin_action flow.request-catalog`). */
function watchCatalogAsks(page: import("@playwright/test").Page): { count: () => number } {
  let n = 0;
  page.on("websocket", (ws) =>
    ws.on("framesent", (f) => {
      const s = typeof f.payload === "string" ? f.payload : "";
      if (s.includes('"flow.request-catalog"')) n++;
    }),
  );
  return { count: () => n };
}

/** Labels currently listed by the open flow picker. */
async function pickerOptions(page: import("@playwright/test").Page): Promise<string[]> {
  const search = page.getByPlaceholder("Search flows...");
  await search.waitFor({ state: "visible", timeout: 15_000 });
  const texts = await page.getByRole("option").allTextContents();
  return texts.map((t) => t.trim()).sort();
}

test.describe("FLOWS dock chip (L3: real pi-flows engine + faux agents)", () => {
  test("F1/F2: the chip shows from the replayed catalog on late subscribe and after reload", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await waitForFlowsChip(page);

    // F1 — a fresh page subscribes after the catalog event: the chip comes from
    // replay, without the page having to ask the session to publish again.
    const asks = watchCatalogAsks(page);
    await gotoDashboard(page);
    await card.click();
    await waitForFlowsChip(page, 15_000);
    await expect(chipRun(page)).toBeVisible();
    await expect(chipOpen(page)).toBeVisible();
    await expect(chipEdit(page)).toBeVisible();
    expect(asks.count(), "catalog known from replay: no ask needed").toBe(0);

    await chipOpen(page).click();
    const before = await pickerOptions(page);
    await page.keyboard.press("Escape");
    expect(before.join("\n")).toContain("e2e:synthetic");

    // F2 — reload: same flows after replay.
    await page.reload();
    await card.click();
    await waitForFlowsChip(page, 30_000);
    await chipOpen(page).click();
    expect(await pickerOptions(page)).toEqual(before);
    await page.keyboard.press("Escape");
  });

  test("F4: a session with flows has no flows item in the menu; the chip is present", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await waitForFlowsChip(page);
    const panel = await openSessionMenu(page, card);
    for (const name of [/run flow/i, /open flow/i, /new flow/i, /edit mode for this project/i]) {
      await expect(panel.getByRole("menuitem", { name })).toHaveCount(0);
    }
    await closeSessionMenu(page);
  });

  test("F3: a flowless project has no chip; the menu holds only New flow… (edit mode on)", async ({ page }) => {
    // Stage a flowless project by parking the fixture's flows dir for the
    // session's lifetime (no extra folder is pinned into the shared container).
    const GLOBAL = '"$HOME/.pi/agent/settings.json"';
    const flowsDir = `${FIXTURE_GIT}/.pi/flows/flows`;
    const parked = "/tmp/e2e-flows-parked";
    const saved = sh(`if [ -f ${GLOBAL} ]; then base64 -w0 ${GLOBAL}; else echo ABSENT; fi`);
    sh(
      `node -e 'const fs=require("fs"),p=require("path"),f=process.argv[1];let o={};try{o=JSON.parse(fs.readFileSync(f,"utf8"))}catch{};o.flows={...(o.flows||{}),editFlow:true};fs.mkdirSync(p.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2))' ${GLOBAL}`,
    );
    sh(`rm -rf ${parked} && mv ${flowsDir} ${parked}`);
    try {
      const card = await spawnFreshGitSession(page);
      await card.click();
      const panel = await openSessionMenu(page, card);
      await expect(panel.getByRole("menuitem", { name: /new flow/i })).toBeVisible({ timeout: 60_000 });
      await expect(panel.getByRole("menuitem", { name: /run flow|open flow|edit mode for this project/i })).toHaveCount(0);
      await closeSessionMenu(page);
      await expect(flowsChip(page)).toHaveCount(0);
    } finally {
      sh(`if [ -d ${parked} ]; then rm -rf ${flowsDir} && mv ${parked} ${flowsDir}; fi`);
      sh(saved === "ABSENT" ? `rm -f ${GLOBAL}` : `printf '%s' '${saved}' | base64 -d > ${GLOBAL}`);
    }
  });

  test("F5: Open from the chip shows the flow not started, expanded", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await waitForFlowsChip(page);
    await chipOpen(page).click();
    await pickFlow(page, "synthetic");
    const panel = page.getByTestId("flow-dashboard");
    await expect(panel).toHaveAttribute("data-flow-mode", "idle", { timeout: 30_000 });
    await expect(panel.getByText("not started")).toBeVisible();
    await expect(panel.locator("[data-step]").first()).toBeVisible();
    await expect(page.getByTestId("flows-chip-status")).toHaveText("not started");
  });

  test("F6: a failed flow run from the chip stays collapsed; the chip says failed", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await waitForFlowsChip(page);
    await chipRun(page).click();
    await pickFlow(page, "failing");
    await byTestId(page, "flowLaunchRun").click();
    const toggle = page.getByTestId("flow-summary-panel-toggle");
    await expect(toggle).toBeVisible({ timeout: 120_000 });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("flow-summary-scrollbox")).toHaveCount(0);
    await expect(page.getByTestId("flows-chip-status")).toHaveText(/failed/);
  });

  test("F7: a collapsed panel stays collapsed on reselect and navigation", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await waitForFlowsChip(page);
    await chipRun(page).click();
    await pickFlow(page, "synthetic");
    await byTestId(page, "flowLaunchRun").click();
    const toggle = page.getByTestId("flow-summary-panel-toggle");
    await expect(toggle).toBeVisible({ timeout: 120_000 });
    // Expand, then collapse — an explicit user choice.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await card.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await gotoDashboard(page);
    await card.click();
    await expect(page.getByTestId("flow-summary-panel-toggle")).toHaveAttribute("aria-expanded", "false", { timeout: 30_000 });
  });

  test("F8: keyboard — the pencil popover takes focus, arrows move, Escape returns to the pencil", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await waitForFlowsChip(page);
    await chipEdit(page).focus();
    await page.keyboard.press("Enter");
    const pop = await openChipPopover(page);
    const items = pop.getByRole("menuitem");
    await expect(items.first()).toBeFocused({ timeout: 10_000 });
    if ((await items.count()) > 1) {
      await page.keyboard.press("ArrowDown");
      await expect(items.nth(1)).toBeFocused();
    }
    await page.keyboard.press("Escape");
    await expect(pop).toHaveCount(0);
    await expect(chipEdit(page)).toBeFocused();
  });

  test("F9: opening the Run picker refreshes the catalog (a flow removed on disk leaves it)", async ({ page }) => {
    const dir = `${FIXTURE_GIT}/.pi/flows/flows/e2e/failing`;
    const parked = "/tmp/e2e-failing-flow-parked";
    const card = await spawnFreshGitSession(page);
    await card.click();
    await waitForFlowsChip(page);
    try {
      sh(`rm -rf ${parked} && mv ${dir} ${parked}`);
      // Stay clear of the server's per-session catalog ask limit (2 s).
      await page.waitForTimeout(2_500);
      await chipRun(page).click();
      await expect.poll(async () => (await pickerOptions(page)).join("\n"), { timeout: 30_000 }).not.toContain("e2e:failing");
      expect((await pickerOptions(page)).join("\n")).toContain("e2e:synthetic");
      await page.keyboard.press("Escape");
    } finally {
      sh(`if [ -d ${parked} ]; then rm -rf ${dir} && mv ${parked} ${dir}; fi`);
    }
  });

  test("F11: the chip is reachable and operable in the compact dock (400 px)", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await waitForFlowsChip(page);
    await page.setViewportSize({ width: 400, height: 800 });
    const dock = page.getByTestId("composer-dock");
    await expect(dock).toHaveAttribute("data-layout", "compact", { timeout: 15_000 });
    // Compact: the Context lane is a chip that opens a sheet holding the group.
    await dock.getByTestId("composer-dock-chip-context").click();
    const sheet = dock.getByTestId("composer-dock-sheet");
    await expect(sheet.getByTestId("flows-context-group")).toBeVisible({ timeout: 15_000 });
    await sheet.getByTestId("flows-chip-open").click();
    await expect(page.getByPlaceholder("Search flows...")).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect(page.getByPlaceholder("Search flows...")).toHaveCount(0);
    if (!(await sheet.isVisible().catch(() => false))) await dock.getByTestId("composer-dock-chip-context").click();
    await sheet.getByTestId("flows-chip-edit-button").click();
    await expect(page.getByTestId("flows-chip-edit-popover")).toBeVisible();
    await closeChipPopover(page);
  });

  test("X1: after a dashboard restart the chip comes back within 15 s", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    const sid = (await card.getAttribute("data-session-id")) as string;
    await card.click();
    await waitForFlowsChip(page);
    await restartDashboard();
    await gotoDashboard(page);
    const again = page.locator(`[data-testid="session-card-desktop"][data-session-id="${sid}"]`);
    await expect(again).toBeVisible({ timeout: 60_000 });
    await again.click();
    await expect(flowsChip(page)).toBeVisible({ timeout: 15_000 });
    await expect(sessionMenuPanel(page)).toHaveCount(0);
  });
});
