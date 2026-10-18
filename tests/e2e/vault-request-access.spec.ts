/**
 * E2E: add-request-access-remedy (test-plan F3).
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * L1 pins the refusal body and the callout row in isolation. Only a real browser
 * against the real server shows the whole chain: a credential-free device that a
 * trusted-network entry admits opens Settings → Vault, the server refuses it with
 * `operate_required` carrying `request-access` (the knock's Host + on-link gates
 * pass for it), the callout renders the row, and its link opens the request
 * landing — without issuing a knock by itself.
 *
 * ACTOR: a credential-free browser context on `http://127.0.0.1:<dashboardPort>`.
 * The harness publishes on host loopback only, so the SERVER sees the docker
 * gateway address (private + on-link with its own eth0) — exactly the peer a LAN
 * device presents. The seed trusts `0.0.0.0/0`, which admits that peer through
 * the network guard; the suite changes no config.
 *
 * Exemplars: lan-knock.spec.ts (device context + gateway peer), vault-settings.spec.ts.
 */
import { expect, test } from "./fixtures.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

const LAN_BASE = `http://127.0.0.1:${DASHBOARD_PORT}`;

test("F3: the Vault callout offers Request access, which opens the request landing without knocking", async ({ browser }) => {
  const ctx = await browser.newContext();
  try {
    const device = await ctx.newPage();
    // A fresh container shows the first-launch display-preset modal once display prefs arrive; dismiss it
    // (same handler `gotoDashboard` arms, scoped to its own backdrop testid).
    const backdrop = device.getByTestId("first-launch-display-backdrop");
    await device.addLocatorHandler(backdrop, async () => {
      await backdrop.getByRole("button", { name: /^skip$/i }).click();
    });
    const knocks: string[] = [];
    device.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/api/pair/request")) knocks.push(req.url());
    });

    await device.goto(`${LAN_BASE}/settings/vault`);
    await expect(device.getByTestId("vault-operate-required")).toBeVisible({ timeout: 20_000 });
    const row = device.locator('[data-testid="vault-operate-remedy"][data-remedy="request-access"]');
    await expect(row).toBeVisible();

    await device.getByTestId("vault-operate-request-access").click();
    await expect(device).toHaveURL(/\/pair\?request/);
    await expect(device.getByTestId("pair-landing-request-host")).toBeVisible({ timeout: 20_000 });
    expect(knocks, "following the link must not send a knock by itself").toEqual([]);
  } finally {
    await ctx.close();
  }
});
