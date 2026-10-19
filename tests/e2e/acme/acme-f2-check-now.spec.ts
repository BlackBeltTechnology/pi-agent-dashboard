/**
 * E2E (test-plan F2, task 6.30): the acme-dns CNAME gate's "Check now".
 *
 * Source: acme-dns solver against the overlay's acme-dns double
 * (`https://acme-dns.test:8443`), domain `dash.test`, the delegating CNAME
 * `_acme-challenge.dash.test → <fulldomain>` ABSENT in challtestsrv.
 *   1st click: the gate stays, its check time moves forward, the row keeps its
 *              stage (no attempt starts — gate-before-obtain).
 *   CNAME added through challtestsrv `/set-cname`.
 *   2nd click: the gate clears and the row converges to valid.
 *
 * Needs the Pebble overlay (skipped without it):
 *   PI_E2E_SEED=1 TEST_EXTRA_COMPOSE=compose.test.acme.yml docker/test-up.sh -d --build
 *
 * See change: add-acme-dns01-certs (design D2, D9, D11).
 */
import { expect, test } from "../fixtures.js";
import { ACME_DNS, AcmeApi, acmeOverlayPresent, CHALLENGE_HOST, challtestsrv, fqdn, PEBBLE_DIRECTORY, ZONE } from "../helpers/acme.js";
import { gotoDashboard } from "../helpers/index.js";
import { OperatorSession } from "../helpers/operator-session.js";
import { openGatewayPage } from "../helpers/remote-access.js";

const SOURCE = "e2e-acmedns";
const op = new OperatorSession();
const clearCname = () => challtestsrv("/clear-cname", { host: fqdn(CHALLENGE_HOST) });

test.describe("ACME — CNAME gate Check now (F2)", () => {
  test.skip(() => !acmeOverlayPresent(), "needs the Pebble overlay (TEST_EXTRA_COMPOSE=compose.test.acme.yml)");

  let api: AcmeApi;
  let prev: { enabled: boolean; host?: string } | undefined;

  test.beforeEach(async ({ request, context }) => {
    await op.arm(request, context);
    api = new AcmeApi(request, () => op.headers());
    await api.deleteSource(SOURCE);
    clearCname();
    prev = await api.enableListener();
    await api.putSource({
      type: "acme",
      id: SOURCE,
      domains: [ZONE],
      email: "e2e@dash.test",
      agreeTos: true,
      directory: PEBBLE_DIRECTORY,
      solver: { type: "acme-dns", server: ACME_DNS.server, subdomain: ACME_DNS.subdomain, fulldomain: ACME_DNS.fulldomain },
    });
    await api.putCredentials(SOURCE, { user: ACME_DNS.user, key: ACME_DNS.key });
  });

  test.afterEach(async () => {
    if (!api) return;
    await api.deleteSource(SOURCE);
    clearCname();
    if (prev) await api.restoreListener(prev);
  });

  const checkedAt = async (): Promise<number> => {
    const src = (await api.tls()).sources?.find((s) => s.id === SOURCE);
    const v = src?.details?.[`checkedAt:${ZONE}`];
    return typeof v === "string" ? Date.parse(v) : 0;
  };

  test("F2: Check now keeps an unmet gate (newer check time, no stage change), then clears it once the CNAME exists", async ({ page }) => {
    test.setTimeout(180_000);
    await gotoDashboard(page);
    await openGatewayPage(page);

    const group = page.getByTestId(`gateway-tls-source-${SOURCE}`);
    const row = group.getByTestId("gateway-tls-cert").filter({ hasText: ZONE });
    const gate = row.getByTestId("gateway-acme-gate-dns-cname");
    await expect(gate).toBeVisible({ timeout: 30_000 });
    await expect(gate.getByTestId("gateway-acme-record")).toContainText(ACME_DNS.fulldomain);
    await expect(row.getByTestId("gateway-tls-cert-pill")).toHaveText("CNAME missing");
    await expect(row).toHaveAttribute("data-stage", "idle");

    // ── 1st click: CNAME still absent ──
    const before = await checkedAt();
    expect(before).toBeGreaterThan(0);
    // The check time has a 1 s floor in practice; make "newer" unambiguous.
    await page.waitForTimeout(1_100);
    await gate.getByTestId("gateway-acme-check-now").click();
    await expect.poll(checkedAt, { timeout: 20_000 }).toBeGreaterThan(before);
    await expect(gate).toBeVisible();
    await expect(gate).toContainText(/Checked just now\./);
    await expect(row).toHaveAttribute("data-stage", "idle");
    await expect(row.getByTestId("gateway-tls-cert-pill")).toHaveText("CNAME missing");
    const cert = await api.cert(SOURCE);
    expect(cert?.held).toBe(false);
    expect(cert?.stage).toBe("idle");
    expect(cert?.lastError).toBeUndefined();

    // ── CNAME added out of band, 2nd click ──
    challtestsrv("/set-cname", { host: fqdn(CHALLENGE_HOST), target: fqdn(ACME_DNS.fulldomain) });
    await gate.getByTestId("gateway-acme-check-now").click();
    await expect(gate).toHaveCount(0, { timeout: 30_000 });
    await expect(row.getByTestId("gateway-tls-cert-pill")).toHaveText(/Valid · \d+ days left/, { timeout: 120_000 });
    expect((await api.cert(SOURCE))?.held).toBe(true);
  });
});
