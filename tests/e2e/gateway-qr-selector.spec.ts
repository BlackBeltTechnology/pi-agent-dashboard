import { expect, type Page, test } from "@playwright/test";
import jsQR from "jsqr";
import { byTestId, gotoDashboard } from "./helpers/index.js";

// Browser E2E — Gateway "Connect a device" single-QR network selector
// (change: add-gateway-qr-network-selector).
//
// The vitest component tests cover the selection LOGIC against injected props.
// This spec adds the three things jsdom cannot:
//   1. The QR bitmap actually PAINTS — jsdom's `QRCode.toCanvas` is a swallowed
//      no-op. Here we read the real <canvas> pixels and decode them with jsQR,
//      proving the rendered code scans to the intended string. This automates
//      most of the change's manual task 5.3 ("a phone scans the selected QR
//      cleanly") — everything short of an actual phone camera.
//   2. Real Chromium keyboard + roving focus across the radio group.
//   3. The full Settings → Gateway route → fetch → render wiring.
//
// The test container has no live public tunnel, so `/api/tunnel/endpoints` and
// `/api/pair/payload` are stubbed via `page.route` (the established pattern in
// this suite) to inject a deterministic public-TLS + LAN mix. The server
// contracts are unchanged by this presentation refactor, so stubbing the two
// reads is faithful to what the component consumes.

const PUBLIC_URL = "https://e2e.zrok.io";
const LOCAL_URL = "http://localhost:8000";
const LAN_URL = "http://192.168.16.220:8000";

// Minimal payload → a short copy-string that decodes reliably at the 132px canvas.
const PAYLOAD = { v: 1, id: "sha256:e2eFp01234567", code: "424242", urls: [PUBLIC_URL] };

const ENDPOINTS = [
  { kind: "public", url: PUBLIC_URL, tls: true },
  { kind: "local", url: LOCAL_URL, tls: false },
  { kind: "lan", url: LAN_URL, tls: false },
];

async function stubGatewayApis(page: Page): Promise<void> {
  await page.route("**/api/tunnel/endpoints", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { endpoints: ENDPOINTS } }),
    }),
  );
  await page.route("**/api/pair/payload", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: PAYLOAD }),
    }),
  );
}

/** Read the single QR canvas pixels and decode with jsQR, retrying until the
 *  async QRCode.toCanvas draw settles. Returns the decoded string. */
async function decodeQr(page: Page): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const img = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('[data-testid="gateway-qr-canvas"]');
      if (!c?.width || !c.height) return null;
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      const d = ctx.getImageData(0, 0, c.width, c.height);
      return { data: Array.from(d.data), width: d.width, height: d.height };
    });
    if (img) {
      const decoded = jsQR(new Uint8ClampedArray(img.data), img.width, img.height);
      if (decoded?.data) return decoded.data;
    }
    await page.waitForTimeout(150);
  }
  throw new Error("QR canvas never decoded");
}

/** Navigate to Settings → Gateway and wait for the QR view to render. */
async function openGateway(page: Page): Promise<void> {
  await gotoDashboard(page);
  await byTestId(page, "settingsBtn").click();
  await byTestId(page, "settingsContent").waitFor({ state: "visible" });
  await page.getByTestId("settings-nav-rail").getByRole("button", { name: "Gateway", exact: true }).click();
  await page.getByTestId("gateway-page").waitFor({ state: "visible" });
}

test.describe("Gateway QR network selector", () => {
  test("one selectable QR: tunnel default, decodes, and swaps to a link", async ({ page }) => {
    await stubGatewayApis(page);
    await openGateway(page);

    // Exactly ONE QR renders (not one-per-endpoint).
    await expect(page.getByTestId("gateway-qr-canvas")).toHaveCount(1);

    // The selector lists every endpoint as a radio row; default = public tunnel.
    const radios = page.getByRole("radio");
    await expect(radios).toHaveCount(ENDPOINTS.length);
    const publicRow = radios.filter({ hasText: "e2e.zrok.io" });
    await expect(publicRow).toHaveAttribute("aria-checked", "true");

    // Pairing controls present. The copy-string stays the bare payload; the
    // pairing QR encodes the camera-scannable https://<tls>/pair#<payload> deep
    // link (change: make-pairing-qr-camera-scannable).
    await expect(page.getByTestId("gateway-pair-copystring")).toBeVisible();
    const canvas = page.getByTestId("gateway-qr-canvas");
    await expect(canvas).toHaveAttribute("data-qr-text", new RegExp(`^${PUBLIC_URL}/pair#pi:pair:v1\\.`));

    // Select the LAN link row → panel swaps to the bare URL, pairing controls gone.
    await radios.filter({ hasText: "192.168.16.220" }).click();
    await expect(page.getByTestId("gateway-pair-copystring")).toHaveCount(0);
    await expect(page.getByTestId("gateway-pair-confirm-input")).toHaveCount(0);
    await expect(page.getByTestId("gateway-link-note")).toBeVisible();
    await expect(canvas).toHaveAttribute("data-qr-text", LAN_URL);
    // Real bitmap → jsQR decode of the (short, reliable) link QR proves the
    // rendered code scans to the intended URL (5.3 automation).
    expect(await decodeQr(page)).toBe(LAN_URL);
  });

  test("radio group is keyboard navigable (arrow keys move selection)", async ({ page }) => {
    await stubGatewayApis(page);
    await openGateway(page);

    const radios = page.getByRole("radio");
    // The checked row carries tabIndex 0 (roving), so it is focusable; the
    // keydown bubbles to the radiogroup's handler. Default = public tunnel.
    await radios.filter({ hasText: "e2e.zrok.io" }).press("ArrowDown");
    await expect(radios.filter({ hasText: "localhost:8000" })).toHaveAttribute("aria-checked", "true");
    await expect(radios.filter({ hasText: "e2e.zrok.io" })).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("gateway-qr-canvas")).toHaveAttribute("data-qr-text", LOCAL_URL);
  });
});
