import { createRequire } from "node:module";
import { expect, type Page, test } from "./fixtures.js";
import { openAddPicker, openProvidersSettings, providerStatusRow, routeProviderData } from "./helpers/index.js";

/**
 * L3: Radius sign-in renders through the GENERIC select → device-code panes
 * (test-plan #F1). The server (`/start`, `/flow`) is mocked at the Playwright
 * network layer, the delegate-provider-oauth-to-pi-ai pattern.
 *
 * See change: add-radius-provider-login.
 */

const FLOW_ID = "flow-e2e-radius";

const radiusSelect = {
  flowId: FLOW_ID,
  provider: "radius",
  status: "pending",
  pending: {
    kind: "select",
    message: "How do you want to sign in to Radius?",
    options: [
      { id: "browser", label: "Sign in with browser" },
      { id: "device-code", label: "Sign in with device code (use this from another device)" },
    ],
  },
};

const radiusDevice = {
  flowId: FLOW_ID,
  provider: "radius",
  status: "pending",
  pending: {
    kind: "device_code",
    userCode: "RAD-4321",
    verificationUri: "https://radius.pi.dev/device",
    expiresInSeconds: 900,
  },
};

test.describe("add-radius-provider-login — Radius generic panes (L3)", () => {
  test("F1: Radius listed; select shows both pi labels; device-code pane for the same flow", async ({ page }) => {
    routeProviderData(page, {
      statuses: [providerStatusRow({ id: "radius", name: "Radius", flowType: "auth_code" })],
    });
    const startBodies: unknown[] = [];
    await page.route("**/api/provider-auth/start", async (route) => {
      startBodies.push(JSON.parse(route.request().postData() ?? "{}"));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(radiusSelect) });
    });
    const inputValues: string[] = [];
    await page.route("**/api/provider-auth/flow/*/input", async (route) => {
      inputValues.push((JSON.parse(route.request().postData() ?? "{}") as { value?: string }).value ?? "");
      await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    let chosen = false;
    const flowPaths: string[] = [];
    await page.route("**/api/provider-auth/flow/*", async (route) => {
      flowPaths.push(new URL(route.request().url()).pathname);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(chosen ? radiusDevice : radiusSelect),
      });
    });

    await openProvidersSettings(page);
    const picker = await openAddPicker(page);
    await picker.getByRole("option", { name: /^Radius/ }).click();
    await page.getByTestId("dialog-sign-in").click();

    await expect(page.getByText("Sign in with browser")).toBeVisible();
    await expect(page.getByText(/Sign in with device code/)).toBeVisible();

    await page.getByTestId("dialog-option-device-code").click();
    await expect.poll(() => inputValues).toEqual(["device-code"]);
    chosen = true;

    const waiting = page.getByTestId("dialog-flow-waiting");
    await expect(waiting.locator("code")).toHaveText("RAD-4321");
    await expect(waiting.getByRole("button", { name: "Open Registration Page" })).toBeVisible();
    expect(startBodies).toEqual([{ provider: "radius" }]);
    expect(flowPaths.every((p) => p === `/api/provider-auth/flow/${FLOW_ID}`)).toBe(true);
  });

  // ── F2 / F6 — the post-sign-in Radius MCP offer ───────────────────────────
  const MCP_PATH = "/home/u/.pi/agent/mcp.json";

  /** Radius sign-in that completes at once, with a scripted /radius/mcp. */
  async function radiusSignedIn(page: Page): Promise<{ posts: () => number }> {
    const data = routeProviderData(page, {
      statuses: [providerStatusRow({ id: "radius", name: "Radius", flowType: "auth_code" })],
    });
    await page.route("**/api/provider-auth/start", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(radiusDevice) });
    });
    await page.route("**/api/provider-auth/flow/*", async (route) => {
      data.serveStatuses([
        providerStatusRow({
          id: "radius",
          name: "Radius",
          flowType: "auth_code",
          authenticated: true,
          configured: true,
          expires: Date.now() + 30 * 86_400_000,
        }),
      ]);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ flowId: FLOW_ID, provider: "radius", status: "complete" }),
      });
    });
    let posts = 0;
    await page.route("**/api/provider-auth/radius/mcp", async (route) => {
      if (route.request().method() === "POST") {
        posts += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ configured: true, written: true, name: "radius", reloaded: 2 }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ configured: false, name: "radius", path: MCP_PATH }),
      });
    });
    await openProvidersSettings(page);
    const picker = await openAddPicker(page);
    await picker.getByRole("option", { name: /^Radius/ }).click();
    await page.getByTestId("dialog-sign-in").click();
    return { posts: () => posts };
  }

  test("F2: accept → dialog closed, inline offer names path + entry, one POST, success text", async ({ page }) => {
    const radius = await radiusSignedIn(page);
    const offer = page.getByTestId("radius-mcp-offer");
    await expect(offer).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("provider-add-dialog")).toHaveCount(0);
    await expect(offer).toContainText(MCP_PATH);
    await expect(offer).toContainText("radius");
    await offer.getByRole("button", { name: "Configure Radius MCP" }).click();
    await expect(offer).toHaveCount(0);
    await expect(page.getByText(/2 session\(s\) reloaded/)).toBeVisible();
    expect(radius.posts()).toBe(1);
  });

  test("F6: keyboard + accessible names; axe finds no serious violation on the offer", async ({ page }) => {
    const radius = await radiusSignedIn(page);
    const offer = page.getByTestId("radius-mcp-offer");
    await expect(offer).toBeVisible({ timeout: 10_000 });

    const accept = offer.getByRole("button", { name: "Configure Radius MCP" });
    const decline = offer.getByRole("button", { name: "Not now" });
    await expect(decline).toBeVisible();

    await page.addScriptTag({ path: createRequire(import.meta.url).resolve("axe-core/axe.min.js") });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (c: string, o: unknown) => Promise<unknown> } }).axe;
      const result = (await axe.run('[data-testid="radius-mcp-offer"]', {
        rules: { "color-contrast": { enabled: false } },
      })) as { violations: Array<{ id: string; impact: string | null }> };
      return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id);
    });
    expect(violations).toEqual([]);

    await accept.focus();
    await expect(accept).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(offer).toHaveCount(0);
    expect(radius.posts()).toBe(1);
  });
});
