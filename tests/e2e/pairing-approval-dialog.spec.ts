/**
 * E2E: add-pairing-approval-dialog (test-plan F1, F2, F6, F7, F13);
 * fix-pairing-approval-credential (test-plan F8).
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * L1 pins the manager, the routes, the dialog and the host in jsdom. Only a
 * real browser against the real server shows that a device's redeem pushes a
 * content-free hint over the live socket, that the operator page (on ANY route)
 * refetches the guarded list and raises the dialog, and that approve / deny
 * converge on the device's own poll.
 *
 * ACTORS
 * ------
 * - OPERATOR: the `page` fixture. Specs reach the container through a published
 *   port, so the server sees the docker bridge address — not loopback. The
 *   operator context therefore carries the harness's REAL `X-Pi-Local-Token`
 *   (the designed same-host operator credential, see helpers/bridge-credential)
 *   on every request, so the page's own `GET /api/pair/pending` passes
 *   `operatorGuard` exactly as a local operator browser would.
 * - DEVICE: a separate, credential-free browser context opening the real
 *   `/pair#<payload>` deep link (real challenge → redeem → poll).
 *
 * Harness state: pending requests are in-memory; every test denies whatever is
 * still pending before and after, so a leftover request never raises a stale
 * dialog in the next test (oldest-first queue).
 *
 * Exemplars: pairing-qr.spec.ts test 1 (real payload + redeem), access-grant-dialog.spec.ts.
 */
import type { APIRequestContext, Browser, BrowserContext, Page } from "@playwright/test";
import { expect, narrowTrust, test } from "./fixtures.js";
import { operatorHeaders } from "./helpers/bridge-credential.js";
import {
  companionFragment,
  deviceStatus,
  listPairedDevices,
  newDeviceKey,
  purgeDevices,
  restartServerAsOperator,
} from "./helpers/device-key.js";
import { gotoDashboard } from "./helpers/index.js";
import { BASE_URL, DASHBOARD_PORT } from "./lifecycle.js";

function encodePayloadString(payload: unknown): string {
  return `pi:pair:v1.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

async function pendingIds(request: APIRequestContext): Promise<string[]> {
  const res = await request.get("/api/pair/pending", { headers: operatorHeaders() });
  const json = await res.json();
  expect(json.success, JSON.stringify(json)).toBe(true);
  return (json.data as { pendingId: string }[]).map((p) => p.pendingId);
}

async function denyAllPending(request: APIRequestContext): Promise<void> {
  for (const pendingId of await pendingIds(request)) {
    await request.post("/api/pair/deny", { data: { pendingId }, headers: operatorHeaders() });
  }
}

async function pairedLabels(request: APIRequestContext): Promise<string[]> {
  const res = await request.get("/api/paired-devices");
  return ((await res.json()).data as { label: string }[]).map((d) => d.label);
}

/** Open the operator page on `/` with the operator credential on every request. */
async function operatorPage(page: Page): Promise<Page> {
  await page.context().setExtraHTTPHeaders(operatorHeaders());
  await gotoDashboard(page);
  return page;
}

/** A fresh device opens a freshly minted deep link; resolves once its confirm code shows. */
async function deviceRedeems(
  browser: Browser,
  request: APIRequestContext,
): Promise<{ ctx: BrowserContext; device: Page; confirmCode: string }> {
  const payloadJson = await (await request.get("/api/pair/payload")).json();
  expect(payloadJson.success, JSON.stringify(payloadJson)).toBe(true);
  const ctx = await browser.newContext({ baseURL: BASE_URL });
  const device = await ctx.newPage();
  await device.goto(`/pair#${encodePayloadString(payloadJson.data)}`);
  const codeEl = device.getByTestId("pair-landing-confirm-code");
  await expect(codeEl).toBeVisible({ timeout: 20_000 });
  const confirmCode = (await codeEl.textContent())?.trim() ?? "";
  expect(confirmCode).toMatch(/^\d{8}$/);
  return { ctx, device, confirmCode };
}

test.describe("pairing approval dialog", () => {
  test.beforeEach(async ({ request }) => {
    await denyAllPending(request);
  });
  test.afterEach(async ({ request }) => {
    await denyAllPending(request);
  });

  test("F1+F2: a redeem raises the dialog on any page; typing the device code approves it", async ({
    page,
    browser,
    request,
  }) => {
    const op = await operatorPage(page);
    const { ctx, device, confirmCode } = await deviceRedeems(browser, request);
    try {
      // F1 — raised without reload, carries device context, never the code.
      const dialog = op.getByTestId("pairing-dialog");
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await expect(op.getByTestId("pairing-dialog-browser")).not.toHaveText("");
      await expect(op.getByTestId("pairing-dialog-via")).toContainText("localhost");
      expect(await dialog.textContent()).not.toContain(confirmCode);

      // F2 — type the code shown on the device, name it, approve.
      await op.getByTestId("pairing-code-input").fill(confirmCode);
      await op.getByTestId("pairing-name-input").fill("QA phone");
      await op.getByTestId("pairing-approve").click();
      await expect(op.getByTestId("pairing-dialog-success")).toBeVisible({ timeout: 10_000 });
      await expect(dialog).toBeHidden({ timeout: 6_000 });
      await device.waitForURL((url) => new URL(url).pathname === "/", { timeout: 20_000 });
      expect(await pairedLabels(request)).toContain("QA phone");
    } finally {
      await ctx.close();
    }
  });

  test("F6: closing keeps the request pending; Gateway lists it and Review reopens the same request", async ({
    page,
    browser,
    request,
  }) => {
    const op = await operatorPage(page);
    const { ctx } = await deviceRedeems(browser, request);
    try {
      const dialog = op.getByTestId("pairing-dialog");
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await op.keyboard.press("Escape");
      await expect(dialog).toBeHidden();

      const ids = await pendingIds(request);
      expect(ids).toHaveLength(1);

      await op.goto("/settings/gateway");
      const row = op.getByTestId("pairing-waiting-row");
      await expect(row).toHaveCount(1, { timeout: 15_000 });
      expect(await row.getAttribute("data-pending-id")).toBe(ids[0]);
      // Navigating re-mounted the app → the per-tab dismissal is gone, so the
      // dialog may already be back; close it, then prove Review reopens it.
      if (await dialog.isVisible()) {
        await op.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
      }
      await row.getByTestId("pairing-waiting-review").click();
      await expect(dialog).toBeVisible();
      expect(await pendingIds(request)).toEqual(ids);
    } finally {
      await ctx.close();
    }
  });

  test("F7: approving in one operator window closes the other with a handled-elsewhere notice", async ({
    page,
    browser,
    request,
  }) => {
    const a = await operatorPage(page);
    const b = await a.context().newPage();
    await gotoDashboard(b);
    const { ctx, confirmCode } = await deviceRedeems(browser, request);
    try {
      await expect(a.getByTestId("pairing-dialog")).toBeVisible({ timeout: 10_000 });
      await expect(b.getByTestId("pairing-dialog")).toBeVisible({ timeout: 10_000 });

      await b.getByTestId("pairing-code-input").fill(confirmCode);
      await b.getByTestId("pairing-approve").click();
      await expect(b.getByTestId("pairing-dialog-success")).toBeVisible({ timeout: 10_000 });

      await expect(a.getByTestId("pairing-dialog")).toBeHidden({ timeout: 10_000 });
      await expect(a.getByText("Pairing request handled in another window.")).toBeVisible();
    } finally {
      await ctx.close();
      await b.close();
    }
  });

  test("F13: deny closes the dialog and the device shows the decline", async ({ page, browser, request }) => {
    const op = await operatorPage(page);
    const before = await pairedLabels(request);
    const { ctx, device } = await deviceRedeems(browser, request);
    try {
      const dialog = op.getByTestId("pairing-dialog");
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await op.getByTestId("pairing-deny").click();
      await expect(dialog).toBeHidden({ timeout: 5_000 });
      await expect(device.getByTestId("pair-landing-rejected")).toBeVisible({ timeout: 5_000 });
      await expect(device.getByTestId("pair-landing-rejected")).toContainText("The dashboard declined this device");
      expect(await pairedLabels(request)).toEqual(before);
    } finally {
      await ctx.close();
    }
  });

  /**
   * fix-pairing-approval-credential F8 — the rendered remedies against the real
   * server. The tab sits on `http://localhost:<dashboardPort>` (BASE_URL, read
   * from `.pi-test-harness.json`; NOT the container's configured port) and the
   * server sees a docker-bridge peer, i.e. a NON-loopback caller. The operator
   * credential is kept for the list fetch (so the dialog raises) but stripped from
   * the approve request, so the REAL server answers its real 401 + remedies: a
   * remote caller is never offered `authorize-browser`.
   */
  test("F8: a refused approve lists the approve-on-host command (no authorize-browser) and keeps the typed code", async ({
    page,
    browser,
    request,
  }) => {
    await page.route("**/api/pair/approve-pending", async (route) => {
      const headers = { ...route.request().headers() };
      delete headers["x-pi-local-token"];
      delete headers["x-pi-local-proof"];
      await route.continue({ headers });
    });
    const op = await operatorPage(page);
    const { ctx, confirmCode } = await deviceRedeems(browser, request);
    try {
      const dialog = op.getByTestId("pairing-dialog");
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await op.getByTestId("pairing-code-input").fill(confirmCode);
      await op.getByTestId("pairing-approve").click();

      const alert = op.getByTestId("pairing-dialog-remedies");
      await expect(alert).toBeVisible({ timeout: 10_000 });
      await expect(alert).toHaveAttribute("role", "alert");

      const [pendingId] = await pendingIds(request);
      expect(pendingId).toBeTruthy();
      const approveRow = alert.locator('[data-testid="pairing-remedy-row"][data-remedy="approve-on-host"]');
      await expect(approveRow.locator("code")).toHaveText(`pi-dashboard pair approve ${pendingId}`);
      await expect(approveRow.getByRole("button")).toHaveAccessibleName(/\S/);
      await expect(alert.locator('[data-remedy="authorize-browser"]')).toHaveCount(0);

      // Retry in place: the typed code survives, Approve stays usable, and the
      // confirmation code is nowhere in the alert.
      await expect(op.getByTestId("pairing-code-input")).toHaveValue(/^\d{4} \d{4}$/);
      await expect(op.getByTestId("pairing-approve")).toBeEnabled();
      expect(await alert.textContent()).not.toContain(confirmCode);
      expect(await pendingIds(request)).toEqual([pendingId]);
    } finally {
      await ctx.close();
    }
  });
});

/**
 * device-key-mutual-check F7 — the approval dialog with a device key and a companion, end to end.
 *
 * The device context opens the knock landing with a valid companion fragment (signed here with
 * `node:crypto` over the server fingerprint, for the claimed origin below). The landing signs its OWN
 * device key in the browser (Playwright's Chromium has Ed25519 WebCrypto on the secure origin
 * `127.0.0.1`); the companion key is a separate key that only this spec holds, so its status proof is
 * signed with `node:crypto` too (helpers/device-key.ts).
 *
 * Harness facts (see lan-knock.spec.ts): every device context shares ONE gateway source address, so the
 * knock limiter (5 admitted per 10 min; a deny elsewhere starts a 10-minute cooldown) is shared across
 * spec files. The server is restarted once at the start of this group so its in-memory limiter is clean
 * regardless of which specs ran before; the group uses 2 knocks and denies nothing.
 */
const LAN_BASE = `http://127.0.0.1:${DASHBOARD_PORT}`;
const COMPANION_ORIGIN = "http://192.168.16.31:8000";
const F7_PREFIX = "dk-f7-";

test.describe("device key + companion approval", () => {
  test.describe.configure({ mode: "serial" });
  const companionKey = newDeviceKey();

  test.beforeAll(async ({ request }) => {
    await narrowTrust(request, { trustedNetworks: ["198.51.100.0/24"] });
    await restartServerAsOperator(LAN_BASE);
    const res = await request.put("/api/config", {
      data: { pairing: { acceptLanRequests: true } },
      headers: operatorHeaders(),
    });
    expect(res.ok(), await res.text()).toBe(true);
  });

  test.afterAll(async ({ request }) => {
    await request.put("/api/config", { data: { pairing: { acceptLanRequests: false } }, headers: operatorHeaders() });
    await purgeDevices(LAN_BASE, F7_PREFIX);
  });

  /** Knock from a credential-free context carrying the companion fragment; resolves with the operator dialog open. */
  async function knockWithCompanion(browser: Browser, op: Page, name: string) {
    const ctx = await browser.newContext();
    const device = await ctx.newPage();
    await device.goto(`${LAN_BASE}/pair?request${await companionFragment(LAN_BASE, companionKey, COMPANION_ORIGIN)}`);
    await device.getByTestId("pair-landing-request-name").fill(name);
    await device.getByTestId("pair-landing-request-send").click();
    const codeEl = device.getByTestId("pair-landing-request-code");
    await expect(codeEl).toBeVisible({ timeout: 20_000 });
    const confirmCode = ((await codeEl.textContent()) ?? "").replace(/\D/g, "");
    expect(confirmCode).toMatch(/^\d{8}$/);
    const dialog = op.getByTestId("pairing-dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(op.getByTestId("pairing-dialog-says")).toContainText(name);
    return { ctx, device, dialog, confirmCode };
  }

  test("DK-F7: the dialog shows the device key and an UNticked companion box; the companion is stored only when ticked", async ({
    page,
    browser,
    request,
  }) => {
    test.setTimeout(120_000);
    const op = await operatorPage(page);
    const token = Date.now().toString(36);

    // ── Run A: approve with the box left unticked ──
    const nameA = `${F7_PREFIX}a-${token}`;
    const a = await knockWithCompanion(browser, op, nameA);
    try {
      await expect(a.dialog.getByTestId("pairing-dialog-device-key")).toContainText(/dk:[A-Za-z0-9_-]{12}/);
      const companion = a.dialog.getByTestId("pairing-dialog-companion");
      await expect(companion).toBeVisible();
      // The origin is the requester's CLAIM, rendered as plain text.
      await expect(companion.locator("span.font-mono", { hasText: COMPANION_ORIGIN })).toHaveText(COMPANION_ORIGIN);
      await expect(companion.locator("a")).toHaveCount(0);
      const box = companion.getByRole("checkbox", { name: "Allow this status check" });
      await expect(box).not.toBeChecked();

      await op.getByTestId("pairing-code-input").fill(a.confirmCode);
      await op.getByTestId("pairing-approve").click();
      await expect(op.getByTestId("pairing-dialog-success")).toBeVisible({ timeout: 10_000 });
      await a.device.waitForURL((url) => new URL(url).pathname === "/", { timeout: 20_000 });

      const row = (await listPairedDevices(LAN_BASE)).find((d) => d.label === nameA);
      expect(row, "device A is paired").toBeTruthy();
      expect(row?.keyId).toMatch(/^dk:[A-Za-z0-9_-]{12}$/);
      expect(row?.companions ?? []).toEqual([]);
      // Nothing was stored for the companion key → it is not a known key.
      expect((await deviceStatus(LAN_BASE, companionKey)).status).toBe("unknown");
    } finally {
      await a.ctx.close();
    }

    // ── Run B: a new knock, box ticked ──
    const nameB = `${F7_PREFIX}b-${token}`;
    const b = await knockWithCompanion(browser, op, nameB);
    try {
      const box = b.dialog.getByTestId("pairing-dialog-companion").getByRole("checkbox", { name: "Allow this status check" });
      await expect(box).not.toBeChecked();
      await box.check();
      await op.getByTestId("pairing-code-input").fill(b.confirmCode);
      await op.getByTestId("pairing-approve").click();
      await expect(op.getByTestId("pairing-dialog-success")).toBeVisible({ timeout: 10_000 });
      await b.device.waitForURL((url) => new URL(url).pathname === "/", { timeout: 20_000 });

      const row = (await listPairedDevices(LAN_BASE)).find((d) => d.label === nameB);
      expect(row?.keyId).toMatch(/^dk:[A-Za-z0-9_-]{12}$/);
      expect(row?.companions?.map((c) => c.origin)).toEqual([COMPANION_ORIGIN]);
      // The companion proof sees the pairing but gets no tier — status-only, never an authority.
      const answer = await deviceStatus(LAN_BASE, companionKey);
      expect(answer).toEqual({ status: "paired", scope: "status-only" });
      expect(answer).not.toHaveProperty("tier");
    } finally {
      await b.ctx.close();
    }
    expect(await pendingIds(request)).toEqual([]);
  });
});
