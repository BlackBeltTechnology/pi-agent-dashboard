/**
 * E2E: credential vault Settings page (change: add-credential-vault, test-plan F1, F5).
 *
 * F1  The page lists account labels, and NO `/api/vault*` response body or DOM
 *     text ever carries a stored value.
 * F5  A plugin's declared binding is approved/revoked from Settings: the toggle
 *     persists across a reload, and the plugin's read endpoint reports a value
 *     only while approved (demo-plugin fixture, `POLY_PIZZA_KEY`).
 */

import { expect, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";
import { OperatorSession } from "./helpers/operator-session.js";
import { VaultSeed } from "./helpers/vault-seed.js";

const op = new OperatorSession();
let seed: VaultSeed;

test.describe("credential vault — Settings", () => {
  test.beforeEach(async ({ request, context }) => {
    await op.arm(request, context);
    seed = new VaultSeed(request, () => op.headers());
    await seed.reset();
  });
  // Restore per TEST, not per file: a timed-out test must not leave the harness's
  // trust seed narrowed for every spec that runs after it.
  test.afterEach(async ({ request }) => {
    await seed.reset();
    await op.restore(request);
  });

  test("F1 — lists labels and never lets a value reach the browser", async ({ page }) => {
    const V1 = "f1-secret-value-AAAA";
    const V2 = "f1-secret-value-BBBB";
    await seed.addAccount("gemini", "personal", V1);
    await seed.addAccount("gemini", "work", V2);

    const bodies: string[] = [];
    page.on("response", async (res) => {
      if (res.url().includes("/api/vault")) bodies.push(await res.text().catch(() => ""));
    });

    await gotoDashboard(page);
    await page.goto("/settings/vault");
    await expect(page.getByTestId("vault-section")).toBeVisible({ timeout: 20_000 });
    const labels = page.getByTestId("vault-account-label");
    await expect(labels).toHaveCount(2);
    await expect(labels.filter({ hasText: "personal" })).toHaveCount(1);
    await expect(labels.filter({ hasText: "work" })).toHaveCount(1);

    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).not.toContain(V1);
      expect(body).not.toContain(V2);
    }
    const dom = (await page.locator("body").textContent()) ?? "";
    expect(dom).not.toContain(V1);
    expect(dom).not.toContain(V2);
  });

  test("F5 — a plugin approval persists across reload and gates the read endpoint", async ({ page, request }) => {
    const id = await seed.addAccount("polypizza", "poly", "poly-key-value-1");
    await seed.addBinding("POLY_PIZZA_KEY", id);
    const read = async () =>
      (await (await request.get("/api/plugins/demo/vault-read", { headers: op.headers() })).json()) as { present: boolean; length: number | null };

    await gotoDashboard(page);
    await page.goto("/settings/vault");
    const row = page.getByTestId("vault-plugin-demo-POLY_PIZZA_KEY");
    await expect(row).toBeVisible({ timeout: 20_000 });
    const box = row.getByTestId("vault-plugin-approve");
    await expect(box).not.toBeChecked();
    expect((await read()).present).toBe(false);

    // A controlled checkbox: it flips after the server round-trip, so click, then assert.
    await box.click();
    await expect(box).toBeChecked();
    await page.reload();
    await expect(page.getByTestId("vault-plugin-demo-POLY_PIZZA_KEY").getByTestId("vault-plugin-approve")).toBeChecked({ timeout: 20_000 });
    expect(await read()).toEqual({ binding: "POLY_PIZZA_KEY", present: true, length: 16 });

    await page.getByTestId("vault-plugin-demo-POLY_PIZZA_KEY").getByTestId("vault-plugin-approve").click();
    await expect.poll(async () => (await read()).present, { timeout: 10_000 }).toBe(false);
  });
});
