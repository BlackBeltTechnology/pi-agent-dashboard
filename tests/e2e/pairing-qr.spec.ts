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
import { expect, test } from "@playwright/test";

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
});
