/**
 * E2E: Settings ▸ Security ▸ Sudo password prompt persists in a real browser
 * (change: add-sudo-credential-prompt, test-plan #S65, task 1.9).
 *
 * Toggle off, Save, reload: the switch is still off and `GET /api/config` reports
 * `sudoCredentialPrompt.enabled:false`; toggling back on restores the default values
 * (timeout / cache minutes) untouched.
 */

import { expect, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";
import { OperatorSession } from "./helpers/operator-session.js";

const op = new OperatorSession();

interface SudoSlice {
  enabled: boolean;
  timeoutMs: number;
  cacheMinutes: number;
}

const DEFAULTS: SudoSlice = { enabled: true, timeoutMs: 120_000, cacheMinutes: 5 };

async function readSlice(request: import("@playwright/test").APIRequestContext): Promise<SudoSlice | undefined> {
  const res = await request.get("/api/config", { headers: op.headers() });
  expect(res.ok(), "/api/config must be readable").toBe(true);
  return ((await res.json()) as { data?: { sudoCredentialPrompt?: SudoSlice } }).data?.sudoCredentialPrompt;
}

test.describe("sudo credential prompt — Settings", () => {
  test.beforeEach(async ({ request, context }) => {
    // Config writes are operator-guarded; the harness browser is never loopback-sourced.
    await op.arm(request, context);
    const reset = await request.put("/api/config", { headers: op.headers(), data: { sudoCredentialPrompt: DEFAULTS } });
    expect(reset.ok(), "reset to defaults").toBe(true);
  });
  test.afterEach(async ({ request }) => {
    await request.put("/api/config", { headers: op.headers(), data: { sudoCredentialPrompt: DEFAULTS } });
  });

  test("S65: the toggle survives a reload and the config API; toggling on restores the default limits untouched", async ({ page, request }) => {
    await gotoDashboard(page);
    await page.goto("/settings/security");
    const toggle = page.getByTestId("sudo-credential-enabled");
    await expect(toggle).toBeVisible({ timeout: 20_000 });
    await expect(toggle, "default install: on").toBeChecked();

    await toggle.uncheck();
    await expect(page.getByTestId("settings-save-bar")).toBeVisible();
    await page.getByTestId("save-btn").click();
    await expect(page.getByTestId("settings-save-bar")).toHaveCount(0, { timeout: 30_000 });

    await page.reload();
    await expect(page.getByTestId("sudo-credential-enabled")).not.toBeChecked({ timeout: 20_000 });
    expect(await readSlice(request)).toMatchObject({ enabled: false });

    await page.getByTestId("sudo-credential-enabled").check();
    await page.getByTestId("save-btn").click();
    await expect(page.getByTestId("settings-save-bar")).toHaveCount(0, { timeout: 30_000 });

    await page.reload();
    await expect(page.getByTestId("sudo-credential-enabled")).toBeChecked({ timeout: 20_000 });
    await expect(page.getByTestId("sudo-credential-timeout")).toHaveValue(String(DEFAULTS.timeoutMs / 1000));
    await expect(page.getByTestId("sudo-credential-cache-minutes")).toHaveValue(String(DEFAULTS.cacheMinutes));
    expect(await readSlice(request)).toEqual(DEFAULTS);
  });
});
