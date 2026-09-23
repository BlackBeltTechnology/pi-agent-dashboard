/**
 * D21 setup matrix — RENDERED browser outcome per setup (the browser smoke,
 * automated). Three surfaces:
 *   1. the dashboard root: usable (live socket, no "Server offline") unless
 *      identity is enforced, in which case the tab goes to the core login page
 *      `/login` (a full page; nothing of the dashboard renders);
 *   1b. the dashboard's own UI as the frontend (D22): login page → IdP → back
 *      with an in-memory bearer (no cookies) → user line → reload signs in
 *      again with NO click (silent prompt=none) → sign out → signed-out page
 *      (no auto sign-in), and the IdP session really ended;
 *   2. the login plugin's own frontend (mode 1: plugin frontend, dashboard as
 *      backend): sign in at the IdP → back on the plugin page with the token in
 *      memory → bearer API + ticketed socket → sign out ends the IdP session.
 */
import { expect, type Page, test } from "@playwright/test";
import { lanIPv4, readState } from "./matrix-lifecycle.js";
import { SCENARIOS, type Scenario } from "./scenarios.js";

// Read lazily: spec files are collected BEFORE global-setup boots the matrix.
let cached: ReturnType<typeof readState> | undefined;
const st = () => {
  cached ??= readState();
  return cached;
};
const base = (s: Scenario, host = "localhost") => `http://${host}:${st().instances[s.id].port}`;

/** Value cell of the plugin app page's result row whose label contains `label`. */
async function appRow(page: Page, label: string): Promise<string> {
  const row = page.locator("#out tr", { has: page.locator("td.label", { hasText: label }) }).first();
  return (await row.locator("td.value").textContent())?.trim() ?? "";
}

async function signIn(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/identity-login/`);
  await page.getByRole("link", { name: /Sign in with Keycloak/i }).click();
  await page.locator("#username").fill("anna");
  await page.locator("#password").fill("anna-pw");
  await Promise.all([page.waitForURL(/\/identity-login\/app/), page.locator("#kc-login").click()]);
}

for (const s of SCENARIOS) {
  test.describe(`${s.id} — ${s.title}`, () => {
    test("dashboard root at localhost", async ({ page }) => {
      let opened = 0;
      let closed = 0;
      page.on("websocket", (ws) => {
        if (new URL(ws.url()).pathname !== "/ws") return;
        opened++;
        ws.on("close", () => closed++);
      });
      await page.goto(`${base(s)}/`);
      await page.waitForTimeout(5_000);
      const body = await page.locator("body").innerText();
      expect(body).not.toContain("Server offline");
      const login = page.getByTestId("login-page");
      if (s.expect.armed && s.resolver !== "dead") {
        // The silent attempt finds no IdP session ⇒ the login page, nothing else.
        await expect(login).toBeVisible();
        await expect(login).toHaveAttribute("data-variant", "signin");
        expect(new URL(page.url()).pathname).toBe("/login");
        await expect(page.getByRole("button", { name: "Sign in with Keycloak" })).toBeVisible();
        await expect(page.getByTestId("header-app-bar")).toHaveCount(0); // no dashboard behind it
        await expect(page.getByTestId("first-launch-display-backdrop")).toHaveCount(0);
      } else if (!s.expect.armed) {
        await expect(login).toHaveCount(0);
        await expect(page.getByTestId("user-bar")).toHaveCount(0); // no identity ⇒ no user line
        expect(opened).toBeGreaterThan(0);
        expect(closed).toBe(0);
      }
    });

    if (s.expect.armed && s.resolver !== "dead") {
      test("signed out: Settings (any route) goes to /login?returnTo — no Settings rendered (D24)", async ({ page }) => {
        await page.goto(`${base(s)}/settings/providers`);
        await expect(page.getByTestId("login-page")).toBeVisible();
        const u = new URL(page.url());
        expect(`${u.pathname}${u.search}`).toBe("/login?returnTo=%2Fsettings%2Fproviders");
        await expect(page.getByText("Pi runtime")).toHaveCount(0);
      });

      test("dashboard UI: login page → IdP → back; reload signs in with NO click; sign out → signed-out page (D22)", async ({ page, context }) => {
        const origin = base(s);
        await page.goto(`${origin}/session/deep-link?tab=x`);
        await expect(page.getByTestId("login-page")).toBeVisible();
        await page.getByRole("button", { name: "Sign in with Keycloak" }).click();
        await page.locator("#username").fill("anna");
        await page.locator("#password").fill("anna-pw");
        await page.locator("#kc-login").click();
        const bar = page.getByTestId("user-bar");
        await expect(bar).toBeVisible({ timeout: 20_000 });
        await expect(bar).toContainText("anna@example.test");
        await expect(bar).toContainText("Keycloak");
        const back = new URL(page.url());
        expect(`${back.pathname}${back.search}`).toBe("/session/deep-link?tab=x"); // returnTo preserved
        expect(back.hash).toBe(""); // one-time code stripped at once
        expect(await page.evaluate(() => sessionStorage.getItem("pi-dashboard:login-verifier"))).toBeNull();
        expect(await context.cookies(origin)).toEqual([]); // D22: no cookies on the dashboard origin

        // Returning user: a reload drops the in-memory token; the live IdP
        // session signs the page in again with NO click and NO IdP form.
        let sawIdpForm = false;
        page.on("framenavigated", (f) => {
          if (f === page.mainFrame() && new URL(f.url()).pathname.endsWith("/auth") && !f.url().includes("prompt=none")) sawIdpForm = true;
        });
        await page.reload();
        await expect(bar).toBeVisible({ timeout: 20_000 });
        expect(new URL(page.url()).pathname).toBe("/session/deep-link");
        expect(sawIdpForm).toBe(false);

        // The first-launch display modal is deferred until AFTER sign-in;
        // dismiss it like a user would.
        const firstLaunch = page.getByTestId("first-launch-display-backdrop");
        if (await firstLaunch.isVisible()) await page.getByRole("button", { name: /^skip$/i }).click();
        await page.getByTestId("user-bar-signout").click();
        const login = page.getByTestId("login-page");
        await expect(login).toHaveAttribute("data-variant", "signed-out", { timeout: 20_000 });
        await expect(login).toContainText("You're signed out");
        await page.waitForTimeout(1_500);
        await expect(login).toBeVisible(); // explicit sign-out ⇒ no silent sign-in
        await page.getByRole("button", { name: "Sign in with Keycloak" }).click();
        await expect(page.locator("#username")).toBeVisible(); // IdP session really ended
      });
    }

    if (s.extra === "login-unconfigured") {
      test("Keycloak not configured: plugin offers nothing — no login routes, no login page", async ({ page, request }) => {
        // No plugin route: the path falls through to the SPA shell (200 HTML), never a 302 to an IdP.
        const start = await request.get(`${base(s)}/identity-login/start?returnTo=%2F&challenge=x`, { maxRedirects: 0 });
        expect(start.status()).toBe(200);
        expect(start.headers().location).toBeUndefined();
        expect(start.headers()["content-type"]).toContain("text/html");
        expect(await (await request.get(`${base(s)}/api/identity/login-config`)).json()).toEqual({ active: false });
        await page.goto(`${base(s)}/`);
        await expect(page.getByText(/No active sessions|No sessions/)).toBeVisible();
        await expect(page.getByTestId("login-page")).toHaveCount(0);
      });
      return;
    }

    if (s.loginPlugin !== "good") return;

    if (s.resolver === "dead") {
      test("dashboard UI with the IdP down: the login page shows the error variant, no loop (D22/D23)", async ({ page }) => {
        await page.goto(`${base(s)}/`);
        const login = page.getByTestId("login-page");
        await expect(login).toHaveAttribute("data-variant", "error", { timeout: 20_000 });
        await expect(login).toContainText("Couldn't reach the sign-in service");
        await expect(login).toContainText("pi-dashboard login --local");
        expect(new URL(page.url()).hash).toBe("");
        await page.waitForTimeout(1_500);
        await expect(login).toHaveAttribute("data-variant", "error"); // no silent retry loop
      });
      test("plugin sign-in with the IdP down shows the plugin's error page", async ({ page }) => {
        await page.goto(`${base(s)}/identity-login/`);
        await page.getByRole("link", { name: /Sign in with Keycloak/i }).click();
        await expect(page.locator("body")).toContainText("Could not reach the identity provider");
      });
      return;
    }

    const hosts = s.expect.armed ? ["localhost", lanIPv4()] : ["localhost"];
    for (const host of hosts) {
      test(`plugin frontend: sign in → API + socket → sign out (${host ?? "lan"})`, async ({ page }) => {
        test.skip(!host, "no non-loopback IPv4 on this host");
        const origin = base(s, host ?? "");
        await signIn(page, origin);
        expect(page.url()).not.toContain("access_token"); // fragment stripped, token kept in memory
        await expect(page.locator("#out")).toContainText("heartbeat", { timeout: 20_000 });
        expect(await appRow(page, "GET /api/sessions (Bearer)")).toMatch(/^200/);
        expect(await appRow(page, "WS upgrade /ws?ticket")).toMatch(/^open/);
        // A ticketless browser socket is refused only while identity is enforced.
        expect(await appRow(page, "WS upgrade, NO ticket")).toMatch(s.expect.armed ? /^refused/ : /^opened/);

        await page.goto(`${origin}/identity-login/logout`);
        await Promise.all([
          page.waitForURL((u) => u.pathname === "/identity-login/"),
          page.getByRole("link", { name: /End Keycloak session/i }).click(),
        ]);
        expect(new URL(page.url()).origin).toBe(origin); // post-logout lands back on the plugin frontend
        await page.goto(`${origin}/identity-login/start`);
        await expect(page.locator("#username")).toBeVisible(); // IdP session really ended
      });
    }
  });
}
