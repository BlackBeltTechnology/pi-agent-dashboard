import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";

/**
 * Browser E2E for change `add-zrok-custom-reserved-name` — Gateway Setup step 3
 * (the reserved-name control) and the gateway-registration offer (F8).
 *
 * The defect this change exists to remove is a SILENT one: a user set a name,
 * saw a green tunnel at a URL they did not choose, and the only record of why
 * was a `console.warn` on the server. So every assertion here is about what the
 * operator is actually TOLD — the typed reason must reach the screen, not just
 * the response body.
 *
 * zrok is not enrolled in the container, so the config and the reserved-name
 * endpoint are stubbed via `page.route`, per `zrok-v2-tunnel.spec.ts`.
 */

type Outcome = {
  status: "ok" | "taken" | "invalid" | "write-failed";
  name: string;
  message?: string;
  liveUrlUnchanged?: string;
  tunnelStopped?: boolean;
};

async function stubTunnelStatus(page: Page, body: Record<string, unknown>): Promise<void> {
  const fulfil = (route: { fulfill: (r: object) => Promise<void> }) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/tunnel-status", fulfil);
  // The dialog reads the GATED twin, which alone may name a configured-but-
  // unserved reserved name.
  await page.route("**/api/tunnel-status-detail", fulfil);
}

async function stubConfig(page: Page, tunnel: Record<string, unknown>): Promise<void> {
  await page.route("**/api/config", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { tunnel } }),
    }),
  );
}

async function stubReadiness(page: Page): Promise<void> {
  await page.route("**/api/tunnel-readiness", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          providers: [{ provider: "zrok", state: "connected", endpoints: [] }],
          checkedAt: new Date().toISOString(),
        },
      }),
    }),
  );
}

/** Stub the set/clear endpoint and capture what the client sent. */
async function stubSetName(
  page: Page,
  outcome: Outcome,
): Promise<{ body: () => { name?: string | null } | null }> {
  let captured: { name?: string | null } | null = null;
  // AWAITED — an unawaited route registration races the first navigation.
  await page.route("**/api/tunnel-reserved-name", async (route) => {
    captured = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: outcome }),
    });
  });
  return { body: () => captured };
}

async function openSetupTab(page: Page): Promise<void> {
  const btn = page.getByTestId("tunnel-btn");
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.click();
  await page.getByTestId("gateway-tab-setup").click();
}

test.describe("gateway reserved-name control", () => {
  test("the control exists at all — a Forget button with no Remember was the whole defect", async ({ page }) => {
    await stubTunnelStatus(page, { status: "inactive", serverOs: "linux" });
    await stubConfig(page, { provider: "zrok", mode: "public", zrok: {} });
    await stubReadiness(page);
    await gotoDashboard(page);
    await openSetupTab(page);

    await expect(page.getByTestId("gateway-reserved-input")).toBeVisible({ timeout: 10_000 });
  });

  test("a valid name is submitted on BLUR and the reserved URL is shown", async ({ page }) => {
    await stubTunnelStatus(page, { status: "inactive", serverOs: "linux" });
    await stubConfig(page, { provider: "zrok", mode: "public", zrok: {} });
    await stubReadiness(page);
    const set = await stubSetName(page, { status: "ok", name: "robson-home-mac" });
    await gotoDashboard(page);
    await openSetupTab(page);

    const input = page.getByTestId("gateway-reserved-input");
    await input.fill("robson-home-mac");
    await input.blur();

    await expect.poll(() => set.body()?.name, { timeout: 10_000 }).toBe("robson-home-mac");
    await expect(page.getByTestId("gateway-reserved-msg")).toContainText("robson-home-mac.shares.zrok.io");
  });

  test("a locally invalid name never reaches the network, and the error states a FIX", async ({ page }) => {
    await stubTunnelStatus(page, { status: "inactive", serverOs: "linux" });
    await stubConfig(page, { provider: "zrok", mode: "public", zrok: {} });
    await stubReadiness(page);
    const set = await stubSetName(page, { status: "ok", name: "unused" });
    await gotoDashboard(page);
    await openSetupTab(page);

    const input = page.getByTestId("gateway-reserved-input");
    await input.fill("has_underscore");
    await input.blur();

    // The message tells the operator what to do, not merely that they are wrong.
    await expect(page.getByTestId("gateway-reserved-msg")).toContainText(/hyphen/i, { timeout: 5_000 });
    // A name the client can reject is a round trip (and a real reservation
    // attempt on the operator's account) not worth making.
    await page.waitForTimeout(500);
    expect(set.body()).toBeNull();
  });

  test("a `taken` outcome surfaces the SERVER's reason, not a generic failure", async ({ page }) => {
    await stubTunnelStatus(page, { status: "inactive", serverOs: "linux" });
    await stubConfig(page, { provider: "zrok", mode: "public", zrok: {} });
    await stubReadiness(page);
    await stubSetName(page, {
      status: "taken",
      name: "dashboard",
      message: "“dashboard” is reserved on another zrok account. The zrok namespace is shared across all accounts.",
    });
    await gotoDashboard(page);
    await openSetupTab(page);

    const input = page.getByTestId("gateway-reserved-input");
    await input.fill("dashboard");
    await input.blur();

    await expect(page.getByTestId("gateway-reserved-msg")).toContainText(/another zrok account/i, { timeout: 10_000 });
  });

  test("`write-failed` is distinguishable from `taken` — the name IS reserved remotely", async ({ page }) => {
    await stubTunnelStatus(page, { status: "inactive", serverOs: "linux" });
    await stubConfig(page, { provider: "zrok", mode: "public", zrok: {} });
    await stubReadiness(page);
    await stubSetName(page, {
      status: "write-failed",
      name: "robson-home-mac",
      message: "Reserved with zrok but could not write it to the dashboard config.",
    });
    await gotoDashboard(page);
    await openSetupTab(page);

    const input = page.getByTestId("gateway-reserved-input");
    await input.fill("robson-home-mac");
    await input.blur();

    await expect(page.getByTestId("gateway-reserved-msg")).toContainText(/could not write/i, { timeout: 10_000 });
  });

  test("replacing a stored name is confirm-gated and names the exact URL destroyed", async ({ page }) => {
    await stubTunnelStatus(page, { status: "inactive", serverOs: "linux" });
    await stubConfig(page, { provider: "zrok", mode: "public", zrok: { reservedName: "old-name" } });
    await stubReadiness(page);
    const set = await stubSetName(page, { status: "ok", name: "new-name" });
    await gotoDashboard(page);
    await openSetupTab(page);

    const input = page.getByTestId("gateway-reserved-input");
    await expect(input).toHaveValue("old-name", { timeout: 10_000 });
    await input.fill("new-name");
    await input.blur();

    // Nothing is sent until the operator confirms: the old name returns to
    // zrok's global pool immediately and anyone may claim it.
    const confirm = page.getByTestId("gateway-reserved-replace-confirm");
    await expect(confirm).toBeVisible({ timeout: 5_000 });
    await expect(confirm).toContainText("old-name.shares.zrok.io");
    expect(set.body()).toBeNull();

    await page.getByTestId("gateway-reserved-replace-confirm-yes").click();
    await expect.poll(() => set.body()?.name, { timeout: 10_000 }).toBe("new-name");
  });

  test("cancelling a replace sends nothing and restores the stored name", async ({ page }) => {
    await stubTunnelStatus(page, { status: "inactive", serverOs: "linux" });
    await stubConfig(page, { provider: "zrok", mode: "public", zrok: { reservedName: "old-name" } });
    await stubReadiness(page);
    const set = await stubSetName(page, { status: "ok", name: "new-name" });
    await gotoDashboard(page);
    await openSetupTab(page);

    const input = page.getByTestId("gateway-reserved-input");
    await expect(input).toHaveValue("old-name", { timeout: 10_000 });
    await input.fill("new-name");
    await input.blur();
    await page.getByTestId("gateway-reserved-replace-cancel").click();

    await expect(input).toHaveValue("old-name");
    expect(set.body()).toBeNull();
  });

  test("a replace while connected says the tunnel was STOPPED, not that it still serves the old URL", async ({
    page,
  }) => {
    await stubTunnelStatus(page, { status: "active", url: "https://old-name.shares.zrok.io", serverOs: "linux" });
    await stubConfig(page, { provider: "zrok", mode: "public", zrok: { reservedName: "old-name" } });
    await stubReadiness(page);
    await stubSetName(page, { status: "ok", name: "new-name", tunnelStopped: true });
    await gotoDashboard(page);
    await openSetupTab(page);

    const input = page.getByTestId("gateway-reserved-input");
    await expect(input).toHaveValue("old-name", { timeout: 10_000 });
    await input.fill("new-name");
    await input.blur();
    await page.getByTestId("gateway-reserved-replace-confirm-yes").click();

    // Claiming "still serving the old URL" here would be factually false: the
    // share is torn down before the release.
    await expect(page.getByTestId("gateway-reserved-tunnel-stopped")).toBeVisible({ timeout: 10_000 });
  });

  test("Release is offered only when there IS a reserved name to release", async ({ page }) => {
    await stubTunnelStatus(page, { status: "active", url: "https://ephemeral.shares.zrok.io", serverOs: "linux" });
    await stubConfig(page, { provider: "zrok", mode: "public", zrok: {} });
    await stubReadiness(page);
    await gotoDashboard(page);
    await openSetupTab(page);

    await expect(page.getByTestId("gateway-reserved-input")).toBeVisible({ timeout: 10_000 });
    // A Release button with nothing to release is the mirror of the missing
    // Remember button this change came from.
    await expect(page.getByTestId("gateway-forget-reserved")).toHaveCount(0);
    await expect(page.getByTestId("gateway-reserved-release")).toHaveCount(0);
  });
});
