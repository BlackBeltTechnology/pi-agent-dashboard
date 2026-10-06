/**
 * The OPTIONAL standalone deployment: the same SPA build served from its OWN origin, signing in with
 * app-kit's OIDC PKCE client against the dashboard's published component descriptor (issuer + public
 * client id), talking to the dashboard over CORS with a bearer + single-use WS ticket.
 *
 * F17: opening it signed out redirects to the issuer, no team API request leaves the page before
 * sign-in, and after sign-in the grid loads from the foreign origin.
 *
 * Needs the `pi` CLI on PATH. See change: add-team-plugin (D11).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { type StaticApp, startStaticApp } from "./static-app.js";
import { API, bootTeamHarness, enc, hasPi, type TeamHarness } from "./team-harness.js";

test.skip(!hasPi, "needs the pi CLI on PATH to boot the dashboard");
test.describe.configure({ mode: "serial", timeout: 180_000 });

let h: TeamHarness;
let app: StaticApp;

test.beforeAll(async () => {
  app = await startStaticApp(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../packages/team-plugin/dist/app"));
  h = await bootTeamHarness({ corsOrigins: [app.origin], componentLogin: true });
  app.setDashboardUrl(h.base);
});
test.afterAll(async () => {
  await h?.stop();
  await app?.close();
});

test("F17: own-origin app — no team request before sign-in; OIDC sign-in; grid loads over CORS with a bearer", async ({ page }) => {
  const dashboardTeamCalls: Array<{ url: string; auth: boolean }> = [];
  // allHeaders(): the raw headers, including the Authorization a cross-origin fetch adds after preflight.
  page.on("requestfinished", (r) => {
    if (r.url().startsWith(h.base) && r.url().includes(`${API}/`)) {
      void r.allHeaders().then((hd) => dashboardTeamCalls.push({ url: r.url(), auth: !!hd.authorization }));
    }
  });
  await page.goto(`${app.origin}/apps/team/`);
  await page.getByTestId("signin").click();
  await page.fill("#username", "anna");
  await page.fill("#password", "anna-pw");
  await page.click("#kc-login");
  await expect(page.locator(".user-chip")).toBeVisible({ timeout: 30_000 });
  expect(new URL(page.url()).origin).toBe(app.origin); // never left the app's own origin after the callback
  await expect.poll(() => dashboardTeamCalls.some((c) => c.auth && c.url.endsWith(`${API}/me`))).toBe(true);
  expect(dashboardTeamCalls.filter((c) => !c.auth)).toEqual([]); // nothing before there was a bearer
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible(); // grid rendered from cross-origin data
  expect(enc("x")).toBe("x");
});
