/**
 * L3 — issue #1082: an unpaired browser on a `pair`-mode server with NO sign-in method sees the
 * "Network not allowed" surface with Request access, never a bare "Offline".
 *
 * Variant harness only: boot with `PI_E2E_SEED=1 PI_E2E_OAUTH=0 PI_E2E_TRUST_MODE=pair`
 * (`network.trustMode: "pair"`, `pairing.acceptLanRequests: true`). The skip keys off the harness
 * env, never off the health field — a regression would otherwise become a green skip.
 *
 * F7  fresh context → `network-denied-request-access` visible, no Offline/Disconnected text,
 *     no app header, and `/api/health` carries `networkAccess.error === "network_not_allowed"`.
 * F8  clicking it navigates the SAME context to `/pair?request`.
 *
 * See change: surface-network-denial-on-health (test-plan #F7, #F8).
 */
import { expect, test } from "./fixtures.js";

test.skip(() => process.env.PI_E2E_TRUST_MODE !== "pair", "needs the pair-mode variant harness (PI_E2E_TRUST_MODE=pair)");

test.describe.configure({ mode: "serial" });

test.describe("pair mode, no sign-in: Request access instead of Offline", () => {
  test("F7: unpaired browser sees Request access, not Offline", async ({ page }) => {
    await page.goto("/");
    const requestAccess = page.getByTestId("network-denied-request-access");
    await expect(requestAccess).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Server offline|Disconnected from/)).toHaveCount(0);
    await expect(page.getByTestId("header-app-bar")).toHaveCount(0);

    const verdict = await page.evaluate(async () => {
      const res = await fetch("/api/health");
      return ((await res.json()) as { networkAccess?: { error?: string } }).networkAccess?.error;
    });
    expect(verdict).toBe("network_not_allowed");
  });

  test("F8: Request access navigates the same context to /pair?request", async ({ page, context }) => {
    await page.goto("/");
    const requestAccess = page.getByTestId("network-denied-request-access");
    await expect(requestAccess).toBeVisible({ timeout: 30_000 });
    const pagesBefore = context.pages().length;
    await requestAccess.click();
    await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toBe("/pair?request");
    expect(context.pages().length).toBe(pagesBefore);
    await expect(page.getByTestId("pair-landing-request-host")).toBeVisible();
  });
});
