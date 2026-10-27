/**
 * E2E: a LOCKED credential vault in the real UI (change: encrypt-credentials-at-rest, test-plan F4).
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * The L1 suites pin the codec classification and the store/route refusal. Only a
 * real server + real browser proves the whole chain on a file the server did not
 * write itself: an unreadable `pi-dashboard-encrypted:v2` envelope on disk →
 * `GET /api/vault` `status.state:"locked"` → the settings page converges to the
 * locked callout naming the reason with every write control disabled, an API
 * write answers 409 `vault_locked`, and restoring the original bytes converges
 * the same page back to `ok` with the seeded account listed and writable.
 *
 * The swap is done out-of-band with `docker exec` on `/home/pi/.pi/dashboard/vault.json`
 * (the harness container's home). `restoreVault` is idempotent and always runs in
 * `afterEach`, so a failed assertion can never leave the harness vault locked for
 * later specs.
 *
 * test-plan: #F4.
 */
import { execFileSync } from "node:child_process";
import { expect, test } from "./fixtures.js";
import { resolveContainer } from "./helpers/container-proc.js";
import { gotoDashboard } from "./helpers/index.js";
import { OperatorSession } from "./helpers/operator-session.js";
import { VaultSeed } from "./helpers/vault-seed.js";

const VAULT = "/home/pi/.pi/dashboard/vault.json";
const BACKUP = `${VAULT}.e2e-locked.bak`;
/** An envelope version this build cannot decode → locked `unsupported_format`. */
const UNSUPPORTED_ENVELOPE_PRINTF = "pi-dashboard-encrypted:v2\\n{}"; // printf expands the \n in the container shell

function inContainer(script: string): string {
  return execFileSync("docker", ["exec", resolveContainer(), "sh", "-c", script], { encoding: "utf8", timeout: 30_000 }).trim();
}

/** Keep the original bytes (mode preserved), then overwrite IN PLACE so owner/mode stay 0600. */
function lockVault(): void {
  inContainer(`set -e; cp -p ${VAULT} ${BACKUP}; printf '${UNSUPPORTED_ENVELOPE_PRINTF}' > ${VAULT}`);
}

/** Put the original bytes back; a no-op when there is no backup (idempotent). */
function restoreVault(): void {
  inContainer(`if [ -f ${BACKUP} ]; then cat ${BACKUP} > ${VAULT} && rm -f ${BACKUP}; fi`);
}

const op = new OperatorSession();
let seed: VaultSeed;

test.describe("credential vault — locked state (L3)", () => {
  test.beforeEach(async ({ request, context }) => {
    await op.arm(request, context);
    seed = new VaultSeed(request, () => op.headers());
    restoreVault();
    await seed.reset();
  });
  // Restore FIRST: `seed.reset()` cannot delete accounts from a locked vault.
  test.afterEach(async () => {
    restoreVault();
    await seed.reset();
  });

  test("F4: a vault with an unreadable envelope shows the locked banner, refuses writes, and recovers on restore", async ({ page, request }) => {
    await seed.addAccount("gemini", "f4-account", "f4-secret-value-AAAA");

    const state = async () => {
      const body = (await (await request.get("/api/vault", { headers: op.headers() })).json()) as {
        data?: { status?: { state?: string; reason?: string } };
      };
      return `${body.data?.status?.state}:${body.data?.status?.reason ?? ""}`;
    };
    await expect.poll(state, { timeout: 10_000 }).toBe("ok:");

    // Baseline: the seeded account is listed and the add control is enabled.
    await gotoDashboard(page);
    await page.goto("/settings/vault");
    await expect(page.getByTestId("vault-section")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("vault-locked")).toHaveCount(0);
    await expect(page.getByTestId("vault-account-label").filter({ hasText: "f4-account" })).toHaveCount(1);

    // Swap the on-disk vault for an envelope this build cannot decode.
    lockVault();
    await expect.poll(state, { timeout: 15_000 }).toBe("locked:unsupported_format");

    // Reload: the page converges to the locked callout naming the reason, all write controls disabled.
    await page.reload();
    await expect(page.getByTestId("vault-locked")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("vault-lock-reason")).toHaveText("unsupported_format");
    await expect(page.getByTestId("vault-lock-remedy")).not.toBeEmpty();
    await page.getByTestId("vault-tab-variables").click();
    await expect(page.getByTestId("vault-variable-new")).toBeDisabled();
    await page.getByTestId("vault-tab-accounts").click();
    await expect(page.getByTestId("vault-account-new")).toBeDisabled();
    await page.getByTestId("vault-tab-import").click();
    await expect(page.getByTestId("vault-import-file")).toBeDisabled();
    // Any account/import-review row that does render must be disabled too.
    for (const id of ["vault-account-rotate", "vault-account-revoke", "vault-import-review"]) {
      for (const btn of await page.getByTestId(id).all()) await expect(btn).toBeDisabled();
    }

    // An API write is refused 409 vault_locked with the non-secret reason.
    const add = await request.post("/api/vault/accounts", {
      headers: op.headers(),
      data: { provider: "gemini", label: "f4-refused", value: "f4-secret-value-BBBB" },
    });
    expect(add.status()).toBe(409);
    const refused = (await add.json()) as { success: boolean; error?: string; reason?: string };
    expect(refused.success).toBe(false);
    expect(refused.error).toBe("vault_locked");
    expect(refused.reason).toBe("unsupported_format");

    // Restore the original bytes: the page converges back to ok, account listed, controls enabled.
    restoreVault();
    await expect.poll(state, { timeout: 15_000 }).toBe("ok:");
    await page.reload();
    await expect(page.getByTestId("vault-section")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("vault-locked")).toHaveCount(0);
    await page.getByTestId("vault-tab-accounts").click();
    await expect(page.getByTestId("vault-account-label").filter({ hasText: "f4-account" })).toHaveCount(1);
    await expect(page.getByTestId("vault-account-new")).toBeEnabled();
    await page.getByTestId("vault-tab-variables").click();
    await expect(page.getByTestId("vault-variable-new")).toBeEnabled();
  });
});
