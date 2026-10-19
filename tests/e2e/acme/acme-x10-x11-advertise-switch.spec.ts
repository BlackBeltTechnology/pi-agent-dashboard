/**
 * E2E (test-plan X10 + X11, tasks 6.40, 6.41): a custom-directory certificate
 * is served but not advertised until the operator asserts `advertise`.
 *
 * X10  Pebble directory, `advertise` unset → issue now: the handshake to
 *      `dash.test:8443` succeeds (Pebble root), yet the URL is absent from
 *      `/api/tunnel/endpoints` AND from a freshly minted pairing payload.
 * X11  From the X10 state, tick "Advertise" in the Gateway editor and Save →
 *      the changed config re-issues (a NEW serial is served) and the URL
 *      appears in the endpoints.
 *
 * Serial: X11 starts from the state X10 leaves (one source, torn down after).
 *
 * Needs the Pebble overlay (skipped without it):
 *   PI_E2E_SEED=1 TEST_EXTRA_COMPOSE=compose.test.acme.yml docker/test-up.sh -d --build
 *
 * See change: add-acme-dns01-certs (design D4, D10, D11).
 */
import { expect, test } from "../fixtures.js";
import {
  AcmeApi,
  acmeOverlayPresent,
  CF_TOKEN,
  CHALLENGE_HOST,
  challtestsrv,
  cloudflareEntry,
  DOMAIN_URL,
  fqdn,
  handshake,
  ZONE,
} from "../helpers/acme.js";
import { gotoDashboard } from "../helpers/index.js";
import { OperatorSession } from "../helpers/operator-session.js";
import { openGatewayPage } from "../helpers/remote-access.js";
import { BASE_URL } from "../lifecycle.js";

const SOURCE = "e2e-x10";
const op = new OperatorSession();

test.describe.serial("ACME — custom directory advertise switch (X10, X11)", () => {
  test.skip(() => !acmeOverlayPresent(), "needs the Pebble overlay (TEST_EXTRA_COMPOSE=compose.test.acme.yml)");

  let api: AcmeApi;
  let prev: { enabled: boolean; host?: string } | undefined;
  let x10Serial: string | null = null;

  test.beforeEach(async ({ request, context }) => {
    await op.arm(request, context);
    api = new AcmeApi(request, () => op.headers());
  });

  // `request` is test-scoped; the serial state is torn down once, after X11.
  test.afterAll(async ({ playwright }) => {
    const request = await playwright.request.newContext({ baseURL: BASE_URL });
    try {
      const cleanup = new AcmeApi(request, () => op.headers());
      await cleanup.deleteSource(SOURCE);
      if (prev) await cleanup.restoreListener(prev);
    } finally {
      await request.dispose();
    }
  });

  test("X10: served but not advertised — absent from endpoints and the pairing payload", async () => {
    test.setTimeout(180_000);
    await api.deleteSource(SOURCE);
    challtestsrv("/clear-txt", { host: fqdn(CHALLENGE_HOST) });
    prev = await api.enableListener();

    await api.putSource(cloudflareEntry(SOURCE));
    await api.putCredentials(SOURCE, { token: CF_TOKEN });
    await api.issue(SOURCE);
    await expect
      .poll(async () => {
        const c = await api.cert(SOURCE);
        return c ? `${c.held}/${c.stage}/${c.lastError ?? ""}` : "absent";
      }, { timeout: 120_000, intervals: [1_000] })
      .toBe("true/idle/");
    expect((await api.cert(SOURCE))?.advertise).toBe(false);

    const hs = handshake();
    expect(hs.authorizationError).toBeNull();
    expect(hs.authorized).toBe(true);
    x10Serial = hs.serial;
    expect(x10Serial).toBeTruthy();

    expect((await api.endpoints()).map((e) => e.url)).not.toContain(DOMAIN_URL);
    const urls = await api.pairingUrls();
    expect(urls.length, "the payload minted (it carries the harness loopback origin)").toBeGreaterThan(0);
    expect(urls.some((u) => u.includes(ZONE))).toBe(false);
  });

  test("X11: ticking Advertise in the Gateway editor re-issues and lists the URL", async ({ page }) => {
    test.setTimeout(180_000);
    expect(x10Serial, "X10 left a served certificate").toBeTruthy();

    await gotoDashboard(page);
    await openGatewayPage(page);
    const group = page.getByTestId(`gateway-tls-source-${SOURCE}`);
    await expect(group).toBeVisible({ timeout: 20_000 });
    await group.getByTestId("gateway-acme-edit").click();
    const editor = page.getByTestId("gateway-acme-editor");
    await expect(editor).toBeVisible({ timeout: 10_000 });
    const advertise = editor.getByTestId("gateway-acme-advertise");
    await expect(advertise).not.toBeChecked();
    await advertise.check();
    await editor.getByTestId("gateway-acme-save").click();
    await expect(editor).toHaveCount(0, { timeout: 20_000 });

    await expect.poll(() => handshake().serial, { timeout: 120_000, intervals: [2_000] }).not.toBe(x10Serial);
    const hs = handshake();
    expect(hs.authorized).toBe(true);
    await expect.poll(() => api.endpoints(), { timeout: 30_000 }).toContainEqual({ kind: "domain", url: DOMAIN_URL, tls: true });
    expect((await api.cert(SOURCE))?.advertise).toBe(true);
    await expect(group.getByTestId("gateway-tls-cert").filter({ hasText: ZONE }).getByText("Not advertised", { exact: true })).toHaveCount(0);
  });
});
