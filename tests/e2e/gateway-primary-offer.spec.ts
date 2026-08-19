import { type APIRequestContext, expect, type Page, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";

/**
 * Browser E2E for change `add-zrok-custom-reserved-name` — test-plan rows F7
 * (confirm-gated primary switch, D10) and F8 (registration offer, D9).
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * `primary-switch.ts` and `gateway-action.ts` are unit-tested as pure algebra.
 * What they cannot show is the thing both requirements are actually about:
 * that NOTHING IS WRITTEN before the operator acts. "No config write until
 * confirmed" is a statement about the real `PUT /api/config` — observable only
 * by reading the real config across a real click.
 *
 * HARNESS SAFETY (read before editing)
 * ------------------------------------
 * This spec mutates `tunnel.provider` and `gateways` on the SHARED harness.
 * `afterAll` restores both from the values captured in `beforeAll`, whatever
 * happened in between. The tunnel is never connected here — readiness is
 * injected via `page.route`, following `gateway-readiness-board.spec.ts`.
 */

/** The live URL the offer is made for. Not a real zrok share — nothing dials it. */
const TS_URL = "https://pi-e2e-tailscale.example.com";

type Readiness = {
  provider: string;
  state: "not-installed" | "not-set" | "disconnected" | "connected";
  endpoints: { kind: string; url: string; tls: boolean }[];
};

const BOARD: Readiness[] = [
  { provider: "zrok", state: "connected", endpoints: [{ kind: "public", url: "https://x.shares.zrok.io", tls: true }] },
  { provider: "tailscale", state: "connected", endpoints: [{ kind: "public", url: TS_URL, tls: true }] },
  { provider: "ngrok", state: "not-installed", endpoints: [] },
  { provider: "zerotier", state: "disconnected", endpoints: [] },
];

interface ConfigSlice {
  gateways?: unknown[];
  publicBaseUrls?: string[];
  cors?: { allowedOrigins?: string[] };
  tunnel?: { provider?: string };
}

async function readConfig(request: APIRequestContext): Promise<ConfigSlice> {
  const res = await request.get("/api/config");
  expect(res.ok(), "/api/config must be readable").toBe(true);
  const body = (await res.json()) as ConfigSlice | { data?: ConfigSlice };
  return ("data" in body && body.data ? body.data : body) as ConfigSlice;
}

async function stubReadiness(page: Page): Promise<void> {
  // AWAITED: an unawaited registration races the first navigation, so the
  // immediate open-tick can escape the stub and hit the guarded endpoint.
  await page.route("**/api/tunnel-readiness", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { providers: BOARD, checkedAt: new Date().toISOString() } }),
    }),
  );
}

async function openSetupTab(page: Page): Promise<void> {
  const btn = page.getByTestId("tunnel-btn");
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.click();
  await page.getByTestId("gateway-tab-setup").click();
  await expect(page.getByTestId("gateway-readiness-tailscale")).toBeVisible({ timeout: 15_000 });
}

test.describe.serial("gateway primary switch + registration offer", () => {
  let original: ConfigSlice = {};

  test.beforeAll(async ({ request }) => {
    original = await readConfig(request);
    expect((await request.put("/api/config", { data: { tunnel: { provider: "zrok" } } })).ok()).toBe(true);
  });

  test.afterAll(async ({ request }) => {
    await request
      .put("/api/config", {
        data: {
          gateways: original.gateways ?? [],
          publicBaseUrls: original.publicBaseUrls ?? [],
          cors: { allowedOrigins: original.cors?.allowedOrigins ?? [] },
          tunnel: { provider: original.tunnel?.provider ?? "zrok" },
        },
      })
      .catch(() => {});
  });

  // F7 — the switch names its consequence and writes nothing until confirmed.
  test("F7: Make primary is confirm-gated and states the redirect-URI consequence", async ({ page, request }) => {
    await stubReadiness(page);
    await gotoDashboard(page);
    await openSetupTab(page);

    // Offered on the connected NON-primary; absent on the current primary.
    await expect(page.getByTestId("gateway-make-primary-tailscale")).toBeVisible();
    await expect(page.getByTestId("gateway-make-primary-zrok")).toHaveCount(0);
    // And absent on every provider that is not connected — promoting one would
    // mint a redirect URI nobody can reach.
    await expect(page.getByTestId("gateway-make-primary-ngrok")).toHaveCount(0);
    await expect(page.getByTestId("gateway-make-primary-zerotier")).toHaveCount(0);

    await page.getByTestId("gateway-make-primary-tailscale").click();
    const confirm = page.getByTestId("gateway-make-primary-confirm-tailscale");
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText(/redirect URI/i);
    await expect(confirm).toContainText(/reject sign-in/i);

    // THE ASSERTION THAT MATTERS: the consequence is on screen and the config
    // is still untouched.
    expect((await readConfig(request)).tunnel?.provider).toBe("zrok");

    await page.getByTestId("gateway-make-primary-apply-tailscale").click();
    await expect
      .poll(async () => (await readConfig(request)).tunnel?.provider, { timeout: 15_000 })
      .toBe("tailscale");
  });

  // F8 — the offer appears automatically; `gateways` stays untouched until the
  // operator completes the action.
  test("F8: an unregistered live URL is offered, and nothing is written until registered", async ({ page, request }) => {
    // tailscale is primary after F7; make zrok primary again so the OFFER is
    // being made for a NON-primary URL — the arm where `oauth` must be refused.
    expect((await request.put("/api/config", { data: { tunnel: { provider: "zrok" } } })).ok()).toBe(true);
    const before = (await readConfig(request)).gateways ?? [];

    await stubReadiness(page);
    await gotoDashboard(page);
    await openSetupTab(page);

    await page.getByTestId("gateway-register-offer-tailscale").click();
    const panel = page.getByTestId("gateway-offer-panel-tailscale");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(TS_URL);

    // `oauth` on a non-primary URL is refused WITH its reason, never hidden:
    // selecting it would move the sign-in origin off the primary through a path
    // that bypasses the F7 confirmation.
    await expect(page.getByTestId("gateway-offer-mode-oauth")).toBeDisabled();
    await expect(page.getByTestId("gateway-offer-mode-oauth-reason")).toContainText(/primary/i);

    // The offer is on screen; nothing has been written.
    expect((await readConfig(request)).gateways ?? []).toEqual(before);

    await page.getByTestId("gateway-offer-mode-pairing").click();
    await page.getByTestId("gateway-offer-save-tailscale").click();

    await expect
      .poll(
        async () =>
          ((await readConfig(request)).gateways ?? []).some(
            (g) => (g as { url?: string }).url === TS_URL,
          ),
        { timeout: 15_000 },
      )
      .toBe(true);

    // Registered once — the offer does not reappear for a URL already recorded.
    await page.reload();
    await openSetupTab(page);
    await expect(page.getByTestId("gateway-register-offer-tailscale")).toHaveCount(0);
  });
});
