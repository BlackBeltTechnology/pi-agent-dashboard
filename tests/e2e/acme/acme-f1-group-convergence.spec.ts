/**
 * E2E (test-plan F1, task 6.29): adding an ACME source through the Gateway
 * editor converges the "Domain certificates" group to a valid `dash.test` row,
 * and the Cloudflare token typed into the editor is rendered NOWHERE afterwards.
 *
 * Needs the Pebble overlay (skipped without it):
 *   PI_E2E_SEED=1 TEST_EXTRA_COMPOSE=compose.test.acme.yml docker/test-up.sh -d --build
 *
 * Real chain: editor Save → PUT /api/tls/acme/:id → PUT …/credentials (vault) →
 * cf-shim → challtestsrv TXT → Pebble DNS-01 validation → cert served.
 *
 * See change: add-acme-dns01-certs (design D10, D11).
 */
import { expect, test } from "../fixtures.js";
import { AcmeApi, acmeOverlayPresent, CF_TOKEN, CHALLENGE_HOST, challtestsrv, fqdn, PEBBLE_DIRECTORY, ZONE } from "../helpers/acme.js";
import { gotoDashboard } from "../helpers/index.js";
import { OperatorSession } from "../helpers/operator-session.js";
import { openGatewayPage } from "../helpers/remote-access.js";

const SOURCE = "pebble";
const op = new OperatorSession();

test.describe("ACME — Domain certificates group (F1)", () => {
  test.skip(() => !acmeOverlayPresent(), "needs the Pebble overlay (TEST_EXTRA_COMPOSE=compose.test.acme.yml)");

  let api: AcmeApi;
  let prev: { enabled: boolean; host?: string } | undefined;

  test.beforeEach(async ({ request, context }) => {
    await op.arm(request, context);
    api = new AcmeApi(request, () => op.headers());
    await api.deleteSource(SOURCE);
    challtestsrv("/clear-txt", { host: fqdn(CHALLENGE_HOST) });
    prev = await api.enableListener();
  });

  test.afterEach(async () => {
    if (!api) return;
    await api.deleteSource(SOURCE);
    if (prev) await api.restoreListener(prev);
  });

  test("F1: editor Save with a typed token converges to a valid, not-advertised row; the token is never rendered", async ({ page }) => {
    test.setTimeout(180_000);
    await gotoDashboard(page);
    await openGatewayPage(page);
    await expect(page.getByTestId("gateway-tls")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`gateway-tls-source-${SOURCE}`)).toHaveCount(0);

    await page.getByTestId("gateway-acme-add").click();
    const editor = page.getByTestId("gateway-acme-editor");
    await expect(editor).toBeVisible();
    await editor.getByTestId("gateway-acme-id").fill(SOURCE);
    await editor.getByTestId("gateway-acme-email").fill("e2e@dash.test");
    await editor.getByTestId("gateway-acme-domain-input").fill(ZONE);
    await editor.getByTestId("gateway-acme-domain-add").click();
    await editor.getByTestId("gateway-acme-solver-cloudflare").click();
    await editor.getByTestId("gateway-acme-cloudflare-token").fill(CF_TOKEN);
    await editor.getByTestId("gateway-acme-dir-custom").click();
    await editor.getByTestId("gateway-acme-directory-url").fill(PEBBLE_DIRECTORY);
    await expect(editor.getByTestId("gateway-acme-advertise")).not.toBeChecked();
    await editor.getByTestId("gateway-acme-tos").check();
    await editor.getByTestId("gateway-acme-save").click();
    await expect(editor).toHaveCount(0, { timeout: 20_000 });

    const group = page.getByTestId(`gateway-tls-source-${SOURCE}`);
    await expect(group).toBeVisible({ timeout: 20_000 });
    const row = group.getByTestId("gateway-tls-cert").filter({ hasText: ZONE });
    await expect(row.getByTestId("gateway-tls-cert-pill")).toHaveText(/Valid · \d+ days left/, { timeout: 120_000 });
    await expect(row).toHaveAttribute("data-stage", "idle");
    await expect(row.getByText("Not advertised", { exact: true })).toBeVisible();
    await expect(group.getByTestId("gateway-acme-gate-credentials")).toHaveCount(0);

    // The server agrees: a held cert, not advertised (custom directory, advertise unset).
    const cert = await api.cert(SOURCE);
    expect(cert?.held).toBe(true);
    expect(cert?.advertise).toBe(false);

    // Token rendered nowhere: not in text, markup/attributes, nor any field's live value.
    expect(await page.locator("body").textContent()).not.toContain(CF_TOKEN);
    expect(await page.content()).not.toContain(CF_TOKEN);
    const values = await page.evaluate(() => Array.from(document.querySelectorAll("input, textarea"), (e) => (e as HTMLInputElement).value));
    expect(values.join("\n")).not.toContain(CF_TOKEN);
  });
});
