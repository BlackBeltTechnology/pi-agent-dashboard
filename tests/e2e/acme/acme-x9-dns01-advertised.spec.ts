/**
 * E2E (test-plan X9, task 6.39): end-to-end DNS-01, advertised.
 *
 * Custom directory (Pebble) with `advertise: true`, domain `dash.test`, solver
 * Cloudflare via the overlay shim, `tls.host` = the container's overlay address
 * (the 127.0.0.1 default is loopback and emits no endpoint, D10). Issue now →
 * wait for `idle` → the listener on `dash.test:8443` presents a chain that a
 * client trusting ONLY Pebble's issuing root accepts; `/api/tunnel/endpoints`
 * lists `{kind:"domain", url:"https://dash.test:8443", tls:true}`; the
 * challenge TXT is gone from challtestsrv afterwards (cleanup ran).
 *
 * Needs the Pebble overlay (skipped without it):
 *   PI_E2E_SEED=1 TEST_EXTRA_COMPOSE=compose.test.acme.yml docker/test-up.sh -d --build
 *
 * See change: add-acme-dns01-certs (design D1, D10).
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
  txtRecords,
} from "../helpers/acme.js";
import { OperatorSession } from "../helpers/operator-session.js";

const SOURCE = "e2e-x9";
const op = new OperatorSession();

test.describe("ACME — end-to-end DNS-01, advertised (X9)", () => {
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

  test("X9: issue now → idle; handshake chains to the Pebble root; domain endpoint listed; TXT cleared", async () => {
    test.setTimeout(180_000);
    await api.putSource(cloudflareEntry(SOURCE, { advertise: true }));
    await api.putCredentials(SOURCE, { token: CF_TOKEN });
    await api.issue(SOURCE);

    await expect
      .poll(async () => {
        const c = await api.cert(SOURCE);
        return c ? `${c.held}/${c.stage}/${c.lastError ?? ""}` : "absent";
      }, { timeout: 120_000, intervals: [1_000] })
      .toBe("true/idle/");
    const cert = await api.cert(SOURCE);
    expect(cert?.advertise).toBe(true);

    const hs = handshake();
    expect(hs.authorizationError).toBeNull();
    expect(hs.authorized).toBe(true);
    expect(hs.serial).toBeTruthy();

    await expect.poll(() => api.endpoints(), { timeout: 10_000 }).toContainEqual({ kind: "domain", url: DOMAIN_URL, tls: true });

    // The solver removed its challenge record once the order finished.
    await expect.poll(() => txtRecords(CHALLENGE_HOST), { timeout: 15_000 }).toEqual([]);
  });
});
