/**
 * E2E: camera-scannable pairing QR — full `/pair` handshake (change:
 * make-pairing-qr-camera-scannable). The physical camera scan is manual (task
 * 7.2); this drives EVERYTHING the scan triggers — the `/pair` landing decoding
 * the URL fragment and running the REAL challenge→redeem→confirm→poll→approve→
 * bearer handshake against the Docker container. Real Ed25519 verify, real
 * one-time code, real approval, real minted bearer, real registry mutation.
 *
 * Precondition (PI_E2E_SEED=1, set by global-setup): the server exposes its
 * loopback http origin as a pairing url — localhost is a genuine browser secure
 * context, so crypto.subtle runs and the full handshake works without TLS. The
 * D14 https/wss gate stays intact for every non-localhost origin (see
 * pairing.ts `isTestLoopbackOrigin`; unit-tested in server pairing.test.ts).
 *
 * Two actors, one flow: the `page` fixture is the PHONE (challenge/redeem/poll);
 * the `request` fixture is the OPERATOR at the authenticated desktop (approve).
 */
import { expect, test } from "./fixtures.js";

const BEARER_KEY = "pi-dashboard:device-bearer";

/** Build the bare `pi:pair:v1.<base64url>` copy-string the QR fragment carries. */
function encodePayloadString(payload: unknown): string {
  return `pi:pair:v1.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

test.describe("pairing QR — /pair landing handshake", () => {
  test("phone opens the deep link → real handshake → paired device + stored bearer", async ({
    page,
    request,
  }) => {
    // 1. Operator/dashboard mints a REAL payload (the same GET behind the QR).
    const payloadRes = await request.get("/api/pair/payload");
    expect(payloadRes.ok()).toBeTruthy();
    const payloadJson = await payloadRes.json();
    // If this fails with no_reachable_endpoint, the PI_E2E_SEED loopback-origin
    // injection regressed (server.ts getReachableUrls / pairing.ts gate).
    expect(payloadJson.success, JSON.stringify(payloadJson)).toBe(true);
    const payload = payloadJson.data as { v: number; id: string; code: string; urls: string[] };
    expect(payload.urls.some((u) => /^http:\/\/localhost/i.test(u))).toBe(true);

    // 2. The PHONE opens the scannable deep link (payload rides the fragment).
    await page.goto(`/pair#${encodePayloadString(payload)}`);

    // 3. Real challenge (Ed25519 pin of fingerprint == payload.id) + redeem run
    //    → the confirm code is shown ON THE PHONE.
    const codeEl = page.getByTestId("pair-landing-confirm-code");
    await expect(codeEl).toBeVisible({ timeout: 20_000 });
    const confirmCode = (await codeEl.textContent())?.trim() ?? "";
    expect(confirmCode).toMatch(/^\d{8}$/);

    // 4. Operator APPROVES by typing the confirm code (D12) — authenticated route.
    const approveRes = await request.post("/api/pair/approve", {
      data: { code: payload.code, confirmCode },
    });
    const approveJson = await approveRes.json();
    expect(approveJson.success, JSON.stringify(approveJson)).toBe(true);

    // 5. The phone's next poll collects the minted bearer, stores it, and lands
    //    on the dashboard (window.location.href = "/").
    await page.waitForURL((url) => new URL(url).pathname === "/", { timeout: 20_000 });
    const bearer = await page.evaluate((k) => localStorage.getItem(k), BEARER_KEY);
    expect(bearer, "device bearer persisted after approval").toBeTruthy();

    // 6. The REAL paired-devices registry mutated — the phone is now a revocable
    //    dashboard client.
    const devicesRes = await request.get("/api/paired-devices");
    const devices = (await devicesRes.json()).data as unknown[];
    expect(Array.isArray(devices) && devices.length > 0).toBe(true);
  });

  test("a /pair link with no fragment shows an error + restart affordance", async ({ page }) => {
    await page.goto("/pair");
    await expect(page.getByTestId("pair-landing-error")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("pair-landing-restart")).toBeVisible();
  });

  // collapse-pairing-into-gateway — test-plan F5. The QR the OPERATOR scans is
  // now rendered only by the surviving GatewayPairQR surface. Read its
  // `data-qr-text`, prove the deep-link shape (https, /pair, fragment-only
  // code), then navigate the browser to the SAME fragment on the same-origin
  // http origin (the harness has no TLS listener; the fragment is byte-
  // identical, which is the thing F5 puts under test) and watch the landing
  // decode it into a real handshake.
  test("F5: the rendered Gateway QR carries an https deep link whose code rides only the fragment", async ({
    page,
  }) => {
    await gotoDashboard(page);

    // Seed a manual TLS endpoint (the `pairing.publicBaseUrls` affordance) so
    // the survivor selects a PAIRING endpoint and renders the deep-link QR.
    // Restored at the end — the harness is shared across specs.
    await page.evaluate(async () => {
      const cur = await (await fetch("/api/config")).json();
      const prev = cur?.data?.pairing?.publicBaseUrls ?? [];
      await fetch("/api/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pairing: { publicBaseUrls: [...prev, `https://localhost:${location.port}`] } }),
      });
    });

    try {
      await page.goto("/settings/gateway");
      const qr = page.getByTestId("gateway-qr-canvas");
      await expect(qr).toBeAttached({ timeout: 20_000 });
      const qrValue = await qr.getAttribute("data-qr-text");
      expect(qrValue, "QR encodes the scannable deep link").toMatch(
        /^https:\/\/localhost:\d+\/pair#pi:pair:v1\.[A-Za-z0-9_-]+$/,
      );

      // The one-time code appears ONLY in the fragment: decode the payload the
      // QR carries and check the pre-fragment URL never names it.
      const [beforeHash, fragment] = qrValue!.split("#");
      const payload = JSON.parse(Buffer.from(fragment.replace(/^pi:pair:v1\./, ""), "base64url").toString());
      expect(payload.code).toMatch(/^\d{8}$/);
      expect(beforeHash).not.toContain(payload.code);

      // Navigating to the carried fragment lands on /pair, which decodes it —
      // the REAL challenge→redeem runs and the confirm code is shown.
      await page.goto(`/pair#${fragment}`);
      await expect(page.getByTestId("pair-landing-confirm-code")).toBeVisible({ timeout: 20_000 });
    } finally {
      await page.evaluate(async () => {
        await fetch("/api/config", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pairing: { publicBaseUrls: [] } }),
        });
      });
    }
  });
});
