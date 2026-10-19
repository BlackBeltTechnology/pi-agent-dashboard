import { expect, type Page, test } from "../fixtures.js";
import { gotoDashboard } from "../helpers/index.js";

/**
 * L3 — obs-studio-plugin panel + settings card with the plugin REST routes
 * stubbed by `page.route` (change: add-obs-studio-plugin, test-plan F1–F3).
 *
 * The harness has no OBS, so every `/api/plugins/obs-studio/*` response is a
 * stub; the dashboard shell, the content-area claim (`/obs/*?`, depth 2,
 * `presentation: "content"`), the standalone host (`/apps/obs/`) and the
 * settings section are REAL. The route contract itself is covered at L1
 * (`packages/obs-studio-plugin/src/server/__tests__`).
 */

const API = "/api/plugins/obs-studio";
const DESKTOP = { width: 1440, height: 900 } as const;
const PIXEL = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

interface Stub {
  id: string;
  mode: string;
  state: string;
  exposure?: string;
  live?: Record<string, unknown>;
  liveError?: string;
}

async function stubObs(page: Page, instances: Stub[], calls: string[] = []) {
  await page.route(`**${API}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    calls.push(`${req.method()} ${url.pathname}`);
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === `${API}/instances`) return json({ instances });
    const m = new RegExp(`^${API}/([^/]+)/(status|screenshot|scene|virtualcam|record)$`).exec(url.pathname);
    const inst = instances.find((i) => i.id === m?.[1]);
    if (!m || !inst) return json({ error: "not-found" }, 404);
    if (m[2] === "status") return json(inst);
    if (m[2] === "screenshot") return json({ ok: true, result: { source: "Webcam", imageData: PIXEL } });
    return json({ ok: true, result: {} });
  });
}

const HEALTHY: Stub = {
  id: "obs",
  mode: "attached",
  state: "healthy",
  exposure: "all-interfaces",
  live: { obsVersion: "32.2.2", scenes: ["Webcam", "Desktop"], current: "Webcam", virtualCam: false, recording: false },
};

test.describe("obs-studio plugin", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
  });

  test("F1: settings card — empty shows the provision hint; healthy shows version, exposure warning and opens the panel beside the sidebar", async ({ page }) => {
    await stubObs(page, []);
    await gotoDashboard(page);
    await page.goto("/settings/plugins/obs-studio");
    const card = page.getByTestId("obs-settings");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("obs-settings-none")).toBeVisible();
    await expect(card.getByRole("button")).toHaveCount(0);

    await page.unroute(`**${API}/**`);
    await stubObs(page, [HEALTHY]);
    await page.reload();
    const instance = page.getByTestId("obs-instance-obs");
    await expect(instance).toBeVisible({ timeout: 20_000 });
    await expect(instance).toContainText("32.2.2");
    await expect(instance).toContainText(/all network interfaces/i);

    await page.getByRole("button", { name: "Open OBS panel" }).click();
    await expect(page).toHaveURL(/\/obs\/?$/);
    await expect(page.getByTestId("obs-panel")).toBeVisible({ timeout: 20_000 });
    // Content presentation: no dialog and the sidebar stays on screen.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("sidebar-collapse")).toBeVisible();
  });

  test("F2: panel lifecycle states — blocked has no actions, stopped offers Start, auth-failed hints re-provisioning, never Stop", async ({ page }) => {
    const calls: string[] = [];
    await page.route("**/api/services/obs/start", async (route) => {
      calls.push(`${route.request().method()} /api/services/obs/start`);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { state: "starting" } }) });
    });

    // blocked → host-input message, no Start/Retry/scene/toggle buttons.
    await stubObs(page, [{ id: "obs", mode: "attached", state: "blocked" }]);
    await page.goto("/obs/");
    await expect(page.getByTestId("obs-blocked")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("obs-panel").getByRole("button", { name: /start|retry/i })).toHaveCount(0);
    await expect(page.getByTestId("obs-scenes")).toHaveCount(0);

    // stopped → Start issues the managed-services start route.
    await page.unroute(`**${API}/**`);
    await stubObs(page, [{ id: "obs", mode: "attached", state: "stopped" }]);
    await page.goto("/obs/");
    const start = page.getByRole("button", { name: "Start" });
    await expect(start).toBeVisible({ timeout: 20_000 });
    await start.click();
    await expect.poll(() => calls).toContain("POST /api/services/obs/start");

    // auth-failed → re-provision hint.
    await page.unroute(`**${API}/**`);
    await stubObs(page, [{ ...HEALTHY, live: undefined, liveError: "auth-failed" }]);
    await page.goto("/obs/");
    await expect(page.getByTestId("obs-panel")).toContainText(/provision --update/, { timeout: 20_000 });

    // No Stop control in any state.
    await expect(page.getByRole("button", { name: /^stop/i })).toHaveCount(0);
  });

  test("F3: standalone host /apps/obs/ — scenes and the program preview image, no dashboard sidebar", async ({ page }) => {
    await stubObs(page, [HEALTHY]);
    await page.goto("/apps/obs/");
    await expect(page.getByTestId("obs-standalone")).toBeVisible({ timeout: 20_000 });
    const scenes = page.getByTestId("obs-scenes");
    await expect(scenes).toContainText("Webcam", { timeout: 20_000 });
    await expect(scenes).toContainText("Desktop");
    await expect(page.getByTestId("obs-preview")).toHaveAttribute("src", /^(data:|blob:)/, { timeout: 20_000 });
    await expect(page.getByTestId("sidebar-collapse")).toHaveCount(0);
  });
});
