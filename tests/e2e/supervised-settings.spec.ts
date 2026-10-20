/**
 * L3 — Settings ▸ Security ▸ "Tool approval (Supervised mode)", change: add-supervised-tool-approval
 * (design D10). test-plan: #F22.
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * The L1 component test pins the parser and the pure undercut formula. Only the real settings
 * shell proves the field error blocks the unified Save bar, a legal value actually persists
 * through `PUT /api/config`, and the undercut warning reads the panel's own
 * `askUserPromptTimeoutSeconds` (set through the API here: that field lives on another page).
 *
 * Exemplars: `blackhole-settings.spec.ts` (settings shell), `agent-path-gate.spec.ts` (`PUT /api/config`).
 */
import { expect, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";
import { getConfig, putConfig } from "./helpers/supervised.js";

interface SupervisedConfig {
  default: string;
  timeoutSeconds: number;
  tools: string[];
}
interface Cfg {
  askUserPromptTimeoutSeconds?: number;
  supervisedMode?: SupervisedConfig;
}

let original: Cfg = {};

test.beforeEach(async ({ page }) => {
  await gotoDashboard(page);
  const cfg = await getConfig<Cfg>(page);
  original = { askUserPromptTimeoutSeconds: cfg.askUserPromptTimeoutSeconds, supervisedMode: cfg.supervisedMode };
});

test.afterEach(async ({ page }) => {
  await putConfig(page, {
    askUserPromptTimeoutSeconds: original.askUserPromptTimeoutSeconds ?? 300,
    ...(original.supervisedMode ? { supervisedMode: original.supervisedMode } : {}),
  }).catch(() => undefined);
});

test("#F22 timeout bounds block Save; a legal value persists; an undercutting ask_user timeout warns", async ({ page }) => {
  // Precondition (another page's field): ask_user prompt timeout 30 s, supervised currently 120 s.
  await putConfig(page, {
    askUserPromptTimeoutSeconds: 30,
    supervisedMode: { default: "full", timeoutSeconds: 120, tools: original.supervisedMode?.tools ?? ["bash", "powershell", "write", "edit", "Agent"] },
  });
  await page.goto("/settings/security");
  const section = page.getByTestId("supervised-mode-section");
  await expect(section).toBeVisible({ timeout: 30_000 });
  const field = page.getByTestId("supervised-timeout");
  const error = page.getByTestId("supervised-timeout-error");
  const save = page.getByTestId("save-btn");

  // 120 vs ask_user 30 → effective min(120, 30 − 1) = 29 s, stated in the warning.
  await expect(page.getByTestId("supervised-timeout-undercut")).toContainText("29");
  await expect(error).toHaveCount(0);

  for (const bad of ["9", "3601"]) {
    await field.fill(bad);
    await expect(error).toBeVisible();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(save).toBeDisabled();
  }

  // 10 is the floor: accepted, Save enabled, and it persists.
  await field.fill("10");
  await expect(error).toHaveCount(0);
  await expect(save).toBeEnabled();
  await save.click();
  await expect
    .poll(async () => (await getConfig<Cfg>(page)).supervisedMode?.timeoutSeconds, { timeout: 15_000 })
    .toBe(10);
  // 10 s is shorter than the 29 s ask_user window: nothing undercuts any more.
  await expect(page.getByTestId("supervised-timeout-undercut")).toHaveCount(0);

  // Back above the ask_user window → the warning returns with the effective value.
  await field.fill("120");
  await expect(page.getByTestId("supervised-timeout-undercut")).toContainText("29");
});
