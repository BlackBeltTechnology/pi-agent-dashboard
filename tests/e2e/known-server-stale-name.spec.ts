/**
 * E2E: stabilize-mdns-server-identity — task 6.8 (test-plan F5).
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * L1 pins the selector's mapping from a server-side probe status to a label in
 * jsdom with a stubbed API. Only a real browser against the real server shows
 * the whole chain: the browser's own health fetch to a dead `.local` name
 * fails, the selector asks the dashboard's operator-only probe, the REAL server
 * resolves the name (ENOTFOUND) and the row reads "Name not found" — not the
 * CORS-blocked hint the old LAN heuristic produced for every `.local` host.
 *
 * ACTORS
 * ------
 * The `page` fixture is the OPERATOR: specs reach the container through a
 * published port (docker-bridge peer, not loopback), so the context carries the
 * harness's REAL `X-Pi-Local-Token` — the same-host operator credential — on
 * every request. The known server is seeded through the operator API.
 *
 * Exemplars: access-grants-revoke.spec.ts (harness glue),
 * pairing-approval-dialog.spec.ts (operator context via helpers/bridge-credential).
 */
import { expect, test } from "./fixtures.js";
import { operatorHeaders } from "./helpers/bridge-credential.js";
import { gotoDashboard } from "./helpers/index.js";

const STALE_HOST = "stale-zz9-unresolvable.local";
const STALE_PORT = 8000;

test("a known server with a dead hostname reads 'Name not found', not CORS-blocked", async ({ page, request }) => {
  const headers = operatorHeaders();
  const seeded = await request.post("/api/known-servers", {
    data: { host: STALE_HOST, port: STALE_PORT, label: "Stale iMac" },
    headers,
  });
  expect((await seeded.json()).success).toBe(true);

  try {
    await page.context().setExtraHTTPHeaders(headers);
    await gotoDashboard(page);

    await page.getByTitle("Switch server").click();

    const row = page.getByRole("button", { name: new RegExp(`${STALE_HOST}:${STALE_PORT}`) });
    await expect(row).toContainText("Name not found", { timeout: 15_000 });
    await expect(row).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator("[data-cors-blocked]")).toHaveCount(0);
  } finally {
    await request.delete("/api/known-servers", { data: { host: STALE_HOST, port: STALE_PORT }, headers });
  }
});

/**
 * add-electron-server-windows — test-plan F4 / F5.
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * L1 pins the selector's Electron branch in jsdom. Only a real browser against
 * the real dashboard shows the header dropdown driving it end to end: the
 * `window.piDashboard.openServerWindow` capability (stubbed via an init script,
 * as Electron's preload would define it) is called INSTEAD OF the transactional
 * in-page switch, the entry shows its inline progress until the app answers, a
 * failure is reported as a toast in words, and the persisted last-used server is
 * never written. Without the capability (a plain browser) the same click still
 * runs the staging-socket switch.
 *
 * The "remote" is a stubbed health endpoint (Playwright route) so the entry reads
 * Available without a second dashboard.
 */
const REMOTE_HOST = "home-imac-e2e.test";
const REMOTE_PORT = 8000;

async function seedAvailableRemote(page: import("@playwright/test").Page, request: import("@playwright/test").APIRequestContext) {
  const headers = operatorHeaders();
  const seeded = await request.post("/api/known-servers", {
    data: { host: REMOTE_HOST, port: REMOTE_PORT, label: "home-imac" },
    headers,
  });
  expect((await seeded.json()).success).toBe(true);
  await page.route(`http://${REMOTE_HOST}:${REMOTE_PORT}/api/health`, (route) =>
    route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    }),
  );
  await page.context().setExtraHTTPHeaders(headers);
  return headers;
}

test("Electron: selecting an available remote shows progress, then a failure toast; no last-server write (F4)", async ({ page, request }) => {
  const headers = await seedAvailableRemote(page, request);
  try {
    await page.addInitScript(() => {
      (window as unknown as { piDashboard: unknown }).piDashboard = {
        openServerWindow: () =>
          new Promise((resolve) => setTimeout(() => resolve({ ok: false, reason: "identity_mismatch" }), 800)),
      };
    });
    await gotoDashboard(page);
    const lastServerBefore = await page.evaluate(() => localStorage.getItem("pi-dashboard-last-server"));
    const headerBefore = await page.getByTitle("Switch server").textContent();

    await page.getByTitle("Switch server").click();
    const row = page.getByRole("button", { name: new RegExp(`${REMOTE_HOST}:${REMOTE_PORT}`) });
    await expect(row).toContainText("Available", { timeout: 15_000 });
    await row.click();

    // inline progress while the app resolves the request
    await expect(row).toContainText("Switching");
    // failure is reported in text: the reason and the entry label
    const toast = page.getByText(/different identity/i);
    await expect(toast).toBeVisible({ timeout: 10_000 });
    await expect(toast).toContainText("home-imac");

    expect(await page.evaluate(() => localStorage.getItem("pi-dashboard-last-server"))).toBe(lastServerBefore);
    await expect(page.getByTitle("Switch server")).toHaveText(headerBefore ?? "");
  } finally {
    await request.delete("/api/known-servers", { data: { host: REMOTE_HOST, port: REMOTE_PORT }, headers });
  }
});

test("Browser: without the capability the in-page staging switch still runs (F5)", async ({ page, request }) => {
  const headers = await seedAvailableRemote(page, request);
  try {
    const sockets: string[] = [];
    page.on("websocket", (ws) => sockets.push(ws.url()));
    await gotoDashboard(page);
    expect(await page.evaluate(() => typeof (window as unknown as { piDashboard?: unknown }).piDashboard)).toBe("undefined");

    await page.getByTitle("Switch server").click();
    const row = page.getByRole("button", { name: new RegExp(`${REMOTE_HOST}:${REMOTE_PORT}`) });
    await expect(row).toContainText("Available", { timeout: 15_000 });
    await row.click();

    // the transactional switch opens a staging socket at the target (it fails — the host is a stub — and is rolled back)
    await expect.poll(() => sockets.some((u) => u.includes(`${REMOTE_HOST}:${REMOTE_PORT}/ws`)), { timeout: 10_000 }).toBe(true);
  } finally {
    await request.delete("/api/known-servers", { data: { host: REMOTE_HOST, port: REMOTE_PORT }, headers });
  }
});
