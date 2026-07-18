import { expect, type Page, test } from "@playwright/test";
import { gotoDashboard } from "./helpers/index.js";

/**
 * Browser E2E for change `support-zrok-v2` (F1/F2/F3).
 *
 * The container has no live enrolled v2 zrok account, so tunnel state is
 * injected via `page.route` (the established stubbing pattern in this suite).
 * The stubs are faithful to the real REST contracts the client consumes:
 *   - `/api/tunnel-status` → `{ status, url, serverOs }`
 *   - `/api/tunnel-disconnect` → `{ ok: true }` (F3 asserts the request body)
 */

const V2_URL = "https://pi-dash-abcd1234.shares.zrok.io";

async function stubTunnelStatus(page: Page, body: Record<string, unknown>): Promise<void> {
  await page.route("**/api/tunnel-status", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }),
  );
}

test.describe("support-zrok-v2 tunnel UI", () => {
  // F1 — install guide renders v2 Install/Enroll/Verify for a linux server.
  test("F1: /tunnel-setup shows the v2 guide with docs link + package-repo commands", async ({ page }) => {
    await stubTunnelStatus(page, { status: "unavailable", serverOs: "linux" });
    await gotoDashboard(page);
    await page.goto("/tunnel-setup");

    await expect(page.getByTestId("tunnel-guide-back")).toBeVisible({ timeout: 15_000 });
    // Install / Enroll / Verify steps.
    await expect(page.getByRole("heading", { name: /1\. Install zrok/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Create Account & Enroll/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Verify/i })).toBeVisible();
    await expect(page.getByText(/zrok enable/).first()).toBeVisible();
    await expect(page.getByText(/zrok version/).first()).toBeVisible();
    // Linux package-repo command + official docs link.
    await expect(page.getByText(/get\.openziti\.io\/install\.bash/).first()).toBeVisible();
    await expect(page.getByText("Official zrok documentation")).toBeVisible();
  });

  // F2 — an active v2 tunnel drives the sidebar Gateway button to connected.
  test("F2: active *.shares.zrok.io tunnel → connected indicator + v2 URL", async ({ page }) => {
    await stubTunnelStatus(page, { status: "active", url: V2_URL, serverOs: "linux" });
    await gotoDashboard(page);

    const btn = page.getByTestId("tunnel-btn");
    await expect(btn).toBeVisible({ timeout: 15_000 });
    // Connected: green + the copyable v2 URL surfaces in the title.
    await expect(btn).toHaveClass(/text-green-400/, { timeout: 15_000 });
    await expect(btn).toHaveAttribute("title", new RegExp(V2_URL.replace(/[.]/g, "\\.")));
  });

  // F3 — the "Forget reserved URL" control fires disconnect {forget:true}.
  test("F3: Forget reserved URL fires POST /api/tunnel-disconnect {forget:true}", async ({ page }) => {
    await stubTunnelStatus(page, { status: "active", url: V2_URL, serverOs: "linux" });
    let forgetBody: any = null;
    await page.route("**/api/tunnel-disconnect", async (route) => {
      forgetBody = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    await gotoDashboard(page);
    const btn = page.getByTestId("tunnel-btn");
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await btn.click(); // active → opens the Gateway dialog

    const forget = page.getByTestId("gateway-forget-reserved");
    await expect(forget).toBeVisible({ timeout: 10_000 });
    await forget.click();

    await expect.poll(() => forgetBody?.forget).toBe(true);
    // No error surfaced.
    await expect(page.getByTestId("gateway-dialog-error")).toHaveCount(0);
  });
});
