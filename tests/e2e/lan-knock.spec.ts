/**
 * E2E: add-lan-knock-pairing (test-plan F10–F14).
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * L1 pins admission, the manager, the landing and the dialog in isolation. Only
 * a real browser against the real server shows the whole chain over plain http: a credential-less device opens `<server>/pair?request`, knocks, the operator's page
 * raises the dialog showing the device's address, the operator types the code
 * the device shows, and the device ends up authenticated by its httpOnly cookie
 * alone.
 *
 * ACTORS
 * ------
 * - OPERATOR: the `page` fixture + the harness's real `X-Pi-Local-Token` on every
 *   request (specs reach the container through a published port, so the server
 *   sees the docker bridge address, not loopback — see helpers/bridge-credential).
 * - DEVICE: a separate credential-free browser context on `http://127.0.0.1:<dashboardPort>`
 *   (see LAN_HOST: the harness publishes on host loopback only).
 *
 * HARNESS FACTS THIS SPEC RESPECTS
 * --------------------------------
 * - The seed trusts every peer (`0.0.0.0/0`), which would make a paired device's
 *   tier and cookie unobservable; the suite narrows `trustedNetworks` to a range
 *   that matches nobody for its duration through `narrowTrust` (describe scope,
 *   restored by the reap fixture; the local token is the credential that can
 *   still write config).
 * - Every device context reaches the server from the SAME docker-gateway source
 *   address, so the knock limiter treats them as one source: a deny starts a
 *   10-minute cooldown. Tests therefore run serially with the denying test LAST,
 *   and a re-run inside 10 minutes of a previous run will see `knock_rate_limited`.
 *
 * Exemplars: pairing-approval-dialog.spec.ts (two-page glue), pairing-qr.spec.ts.
 */
import type { APIRequestContext, Browser, BrowserContext, Page } from "@playwright/test";
import { expect, narrowTrust, test } from "./fixtures.js";
import { operatorHeaders } from "./helpers/bridge-credential.js";
import { gotoDashboard } from "./helpers/index.js";
import { readConfig } from "./helpers/trust-access.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

/**
 * The "LAN" address the device types. The harness publishes the dashboard on the
 * host's loopback only, so a browser on the host reaches it as `127.0.0.1`; the
 * SERVER, running in a bridge-networked container, sees the docker gateway
 * address (private + on-link with its own eth0) — exactly the peer a LAN device
 * would present. (`127.0.0.1` is a secure context in Chromium; the plain-http /
 * no-WebCrypto behaviour of request mode is pinned at L1 in jsdom and by manual #X4.)
 */
const LAN_HOST = "127.0.0.1";
const LAN_BASE = `http://${LAN_HOST}:${DASHBOARD_PORT}`;
const NOBODY = ["198.51.100.0/24"]; // TEST-NET-2: matches no peer

async function setAccept(request: APIRequestContext, on: boolean): Promise<void> {
  // Only the non-trust `pairing` key: trust-bearing keys go through `narrowTrust`.
  const res = await request.put("/api/config", {
    data: { pairing: { acceptLanRequests: on } },
    headers: operatorHeaders(),
  });
  expect(res.ok(), await res.text()).toBe(true);
}

async function pendingIds(request: APIRequestContext): Promise<string[]> {
  const res = await request.get("/api/pair/pending", { headers: operatorHeaders() });
  const json = await res.json();
  expect(json.success, JSON.stringify(json)).toBe(true);
  return (json.data as { pendingId: string }[]).map((p) => p.pendingId);
}

async function pairedDevices(request: APIRequestContext): Promise<{ label: string; tier: string }[]> {
  const res = await request.get("/api/paired-devices", { headers: operatorHeaders() });
  return (await res.json()).data as { label: string; tier: string }[];
}

async function operatorPage(page: Page): Promise<Page> {
  await page.context().setExtraHTTPHeaders(operatorHeaders());
  await gotoDashboard(page);
  return page;
}

/** A credential-free device on the LAN URL asks for access; resolves once its code shows. */
async function deviceKnocks(
  browser: Browser,
  name: string,
): Promise<{ ctx: BrowserContext; device: Page; confirmCode: string }> {
  const ctx = await browser.newContext();
  const device = await ctx.newPage();
  await device.goto(`${LAN_BASE}/pair?request`);
  await expect(device.getByTestId("pair-landing-request-host")).toContainText(LAN_HOST);
  await device.getByTestId("pair-landing-request-name").fill(name);
  await device.getByTestId("pair-landing-request-send").click();
  const codeEl = device.getByTestId("pair-landing-request-code");
  await expect(codeEl).toBeVisible({ timeout: 20_000 });
  const confirmCode = ((await codeEl.textContent()) ?? "").replace(/\D/g, "");
  expect(confirmCode).toMatch(/^\d{8}$/);
  return { ctx, device, confirmCode };
}

test.describe.configure({ mode: "serial" });

test.describe("LAN knock pairing", () => {
  // Describe scope: `narrowTrust` from `beforeAll` lives for this file's tests and
  // is restored (and the group's sessions reaped) when the next spec's first test
  // starts — or by the worker-start baseline re-assert if the worker dies first.
  test.beforeAll(async ({ request }) => {
    await narrowTrust(request, { trustedNetworks: NOBODY });
    await setAccept(request, false);
  });

  test.afterAll(async ({ request }) => {
    await setAccept(request, false);
  });

  // E19/F1 — the describe-scope narrowing declared in `beforeAll` is still in force
  // for every test of the group (the reap fixture neither restores it between tests
  // nor treats it as a breach), while the credential-free client is refused by design.
  test("E19: the describe-scope narrowing outlives each test of the group", async () => {
    const operator = await readConfig(true);
    expect(operator.status).toBe(200);
    expect(operator.data?.trustedNetworks).toEqual(NOBODY);
  });

  test("F11: the switch is off by default; the device is told why and no dialog appears", async ({
    page,
    browser,
    request,
  }) => {
    const op = await operatorPage(page);
    const ctx = await browser.newContext();
    try {
      const device = await ctx.newPage();
      await device.goto(`${LAN_BASE}/pair?request`);
      await device.getByTestId("pair-landing-request-send").click();
      await expect(device.getByTestId("pair-landing-request-refused")).toContainText("isn't accepting requests", {
        timeout: 15_000,
      });
      expect(await pendingIds(request)).toHaveLength(0);
      await expect(op.getByTestId("pairing-dialog")).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  test("F10: switch on → device requests → operator types the code → device is paired and authenticated", async ({
    page,
    browser,
    request,
  }) => {
    const op = await operatorPage(page);
    await op.goto("/settings/gateway");
    const toggle = op.getByTestId("gateway-lan-switch");
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(op.getByTestId("gateway-lan-request-url").first()).toContainText("/pair?request");

    const { ctx, device, confirmCode } = await deviceKnocks(browser, "QA laptop");
    try {
      const dialog = op.getByTestId("pairing-dialog");
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      // The identity is what the server observed (the docker-gateway peer), the name is attributed.
      await expect(op.getByTestId("pairing-dialog-address")).toContainText(/\d/);
      await expect(op.getByTestId("pairing-dialog-says")).toContainText("QA laptop");
      await expect(op.getByTestId("pairing-dialog-unencrypted")).toBeVisible();
      expect(await dialog.textContent()).not.toContain(confirmCode);

      await op.getByTestId("pairing-code-input").fill(confirmCode);
      await op.getByTestId("pairing-approve").click();
      await expect(op.getByTestId("pairing-dialog-success")).toBeVisible({ timeout: 10_000 });

      await device.waitForURL((url) => new URL(url).pathname === "/", { timeout: 20_000 });
      expect((await pairedDevices(request)).map((d) => d.label)).toContain("QA laptop");
      // Authenticated by the httpOnly cookie alone (the narrowed trust admits nobody else).
      const status = await device.evaluate(() => fetch("/api/paired-devices").then((r) => r.status));
      expect(status).toBe(200);
    } finally {
      await ctx.close();
    }
  });

  test("F13: the operator picks Observe → the device is paired read-only and an operate action is refused", async ({
    page,
    browser,
    request,
  }) => {
    await setAccept(request, true);
    const op = await operatorPage(page);
    const { ctx, device, confirmCode } = await deviceKnocks(browser, "QA tablet");
    try {
      const dialog = op.getByTestId("pairing-dialog");
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await expect(op.getByTestId("pairing-dialog-tier").getByRole("radio", { name: /operate/i })).toBeChecked();
      await op.getByTestId("pairing-dialog-tier").getByRole("radio", { name: /observe/i }).check();
      await op.getByTestId("pairing-code-input").fill(confirmCode);
      await op.getByTestId("pairing-approve").click();
      await expect(op.getByTestId("pairing-dialog-success")).toBeVisible({ timeout: 10_000 });

      await device.waitForURL((url) => new URL(url).pathname === "/", { timeout: 20_000 });
      const paired = (await pairedDevices(request)).find((d) => d.label === "QA tablet");
      expect(paired?.tier).toBe("observe");
      // An operate-tier route is refused for the observe device; a read is not.
      const read = await device.evaluate(() => fetch("/api/favorite-models").then((r) => r.status));
      expect(read).toBe(200);
      const operate = await device.evaluate(() =>
        fetch("/api/packages/check-updates", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then(
          (r) => r.status,
        ),
      );
      expect(operate).toBe(403);
    } finally {
      await ctx.close();
    }
  });

  test("F14: a network-denied browser gets Request access on the banner and lands on the request page", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    // The harness seed enables OAuth + `bypassUrls:["/"]` and the page's CSP only admits its own origin,
    // so here the REAL guard can neither answer `network_not_allowed` nor can the page reach a second
    // origin. Everything else is real (the app's offline detection, the denial hook, the banner, the
    // navigation to the server-rendered request page); only the guard's answer on the page's own
    // health endpoint is simulated and the socket + status probe are failed so the app reads "offline".
    // The remote-active-server variant (window.open to that server's own /pair?request) is pinned at
    // L1 by ConnectionStatusBanner F9.
    const origin = `http://localhost:${DASHBOARD_PORT}`;
    const ctx = await browser.newContext();
    try {
      await ctx.route(`${origin}/api/health`, (route) =>
        route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ success: false, error: "network_not_allowed", hint: "Ask the owner to trust your network." }),
        }),
      );
      await ctx.route(/\/auth\/status/, (route) => route.abort());
      const page = await ctx.newPage();
      await page.routeWebSocket(/\/ws(\?|$)/, (ws) => ws.close());
      await page.goto(`${origin}/`);
      const requestAccess = page.getByTestId("network-denied-request-access");
      await expect(requestAccess).toBeVisible({ timeout: 150_000 });
      await expect(page.getByText("Ask the owner to trust your network.")).toBeVisible();
      await ctx.unroute(`${origin}/api/health`);
      await requestAccess.click();
      await page.waitForURL((url) => url.pathname === "/pair" && url.search === "?request", { timeout: 15_000 });
      await expect(page.getByTestId("pair-landing-request-send")).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test("F12 (last: a deny starts the shared source's cooldown): denied → declined, and the next request is rate-limited", async ({
    page,
    browser,
    request,
  }) => {
    await setAccept(request, true);
    const op = await operatorPage(page);
    const { ctx, device } = await deviceKnocks(browser, "QA phone");
    try {
      const dialog = op.getByTestId("pairing-dialog");
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await op.getByTestId("pairing-deny").click();
      await expect(device.getByTestId("pair-landing-request-rejected")).toBeVisible({ timeout: 20_000 });
      expect((await pairedDevices(request)).map((d) => d.label)).not.toContain("QA phone");

      // Requesting again: the cooldown refuses it, with a countdown rather than a retry.
      await device.goto(`${LAN_BASE}/pair?request`);
      await device.getByTestId("pair-landing-request-send").click();
      await expect(device.getByTestId("pair-landing-request-refused")).toContainText(/too many requests/i, {
        timeout: 15_000,
      });
    } finally {
      await ctx.close();
    }
  });
});
