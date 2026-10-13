/**
 * E2E: per-session vault binding view (change: add-credential-vault, test-plan F2, F4).
 *
 * F2  A repository grant in a never-confirmed checkout shows `pending-confirmation`;
 *     clicking Confirm converges to `delivered` WITHOUT a page reload.
 * F4  A session shows `delivered`, `local-override` and `revoked` rows; the revoked
 *     row carries the running-process note; no value is in the DOM.
 *
 * `local-override` is produced deterministically by granting `DEBIAN_FRONTEND`,
 * which the harness image sets in every process environment (Dockerfile `ENV`), so
 * the bridge finds it pre-set and keeps it.
 */

import { expect, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { OperatorSession } from "./helpers/operator-session.js";
import { SAMPLE_GIT_SUBJECT, VaultSeed } from "./helpers/vault-seed.js";

const op = new OperatorSession();
let seed: VaultSeed;
const ORIGIN_REPO = "github.com/acme/vault-e2e";

async function runScenario(page: import("@playwright/test").Page, scenario: string, done: string): Promise<void> {
  const card = await spawnFreshGitSession(page);
  await card.click();
  await sendPrompt(page, `[[faux:${scenario}]] go`);
  await expect(page.getByText(done, { exact: true }).first()).toBeVisible({ timeout: 60_000 });
}

test.describe("credential vault — session bindings", () => {
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

  test("F2 — pending confirmation converges to delivered without a reload", async ({ page }) => {
    const id = await seed.addAccount("gemini", "g", "gemini-key-0001");
    await seed.addBinding("VAULT_E2E_API_KEY", id);
    await seed.grant(`repo:${ORIGIN_REPO}`, "VAULT_E2E_API_KEY");

    // The bridge reads `origin` at session start, so point the sample repo at the
    // granted repository in a throwaway session first.
    await runScenario(page, "vault-set-origin", "origin set");
    try {
      const card = await spawnFreshGitSession(page);
      await card.click();
      const chip = page.getByTestId("vault-chip");
      await expect(chip).toBeVisible({ timeout: 60_000 });
      await expect(chip).toHaveAttribute("data-pending", "true", { timeout: 30_000 });
      await chip.click();
      const row = page.getByTestId("vault-binding-row").first();
      await expect(row).toHaveAttribute("data-state", "pending-confirmation");
      await expect(page.getByTestId("vault-pending-copy")).toContainText(ORIGIN_REPO);

      await page.getByTestId("vault-confirm").click();
      await expect(row).toHaveAttribute("data-state", "delivered", { timeout: 20_000 });
      await expect(page.getByTestId("vault-confirm")).toHaveCount(0);
    } finally {
      await runScenario(page, "vault-unset-origin", "origin unset");
    }
  });

  test("F4 — delivered, local-override and revoked rows; the revoked row warns; no values in the DOM", async ({ page }) => {
    const a = await seed.addAccount("svc", "a", "a-key-value-001");
    const b = await seed.addAccount("svc", "b", "b-key-value-002");
    const c = await seed.addAccount("svc", "c", "c-key-value-003");
    await seed.addBinding("A_KEY", a);
    await seed.addBinding("DEBIAN_FRONTEND", b);
    await seed.addBinding("C_KEY", c);
    for (const name of ["A_KEY", "DEBIAN_FRONTEND", "C_KEY"]) await seed.grant(SAMPLE_GIT_SUBJECT, name);

    const card = await spawnFreshGitSession(page);
    await card.click();
    const chip = page.getByTestId("vault-chip");
    await expect(chip).toBeVisible({ timeout: 60_000 });
    await chip.click();
    const states = () => page.getByTestId("vault-binding-row").evaluateAll((els) => Object.fromEntries(els.map((e) => [e.querySelector(".font-mono")?.textContent, e.getAttribute("data-state")])));
    await expect.poll(states, { timeout: 30_000 }).toMatchObject({ A_KEY: "delivered", DEBIAN_FRONTEND: "local-override", C_KEY: "delivered" });

    await seed.ungrant(SAMPLE_GIT_SUBJECT, "C_KEY");
    await expect.poll(states, { timeout: 30_000 }).toMatchObject({ C_KEY: "revoked" });
    await expect(page.getByTestId("vault-revoked-note")).toHaveCount(1);

    const dom = (await page.locator("body").textContent()) ?? "";
    for (const v of ["a-key-value-001", "b-key-value-002", "c-key-value-003"]) expect(dom).not.toContain(v);
  });
});
