/**
 * E2E: add-pairing-approval-dialog (test-plan F1, F2, F6, F7, F13).
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
import { expect, test } from "./fixtures.js";
import { operatorHeaders } from "./helpers/bridge-credential.js";
import { gotoDashboard } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

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
});
