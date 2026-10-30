import { COOKIE_NAME, signToken } from "../../packages/server/src/auth/auth.js";
import { expect, narrowTrust, test } from "./fixtures.js";
import { gotoDashboard, launchFromNewTabMenu, robustClick, spawnFreshGitSession } from "./helpers/index.js";
import { writeConfig } from "./helpers/trust-access.js";
import { BASE_URL } from "./lifecycle.js";

/**
 * L3 for change `close-security-map-high-findings` D3 (OAuth fail-closed for public IdPs).
 * Test-plan rows #E110 (cookie rejection), #F5 (banner + login picker), #F6 (sockets converge).
 *
 * The harness boots with a github provider and a NON-EMPTY `auth.allowedUsers`
 * (`docker/test-entrypoint.sh`), because github is a public IdP: with both lists empty its login is
 * refused and its sessions are rejected. Each test flips the allowlist through the operator write
 * path (`writeConfig`: operator cookie + local token — the token still admits when the cookie is
 * rejected) and ALWAYS restores the seeded list in `afterEach`.
 *
 * Cookie-evaluating tests narrow `auth.bypassUrls` via `narrowTrust` (the boot seed's `["/"]` makes
 * the auth hook return before it ever reads a cookie); the reap fixture restores it after the test.
 */

const E2E_AUTH_SECRET = "e2e-auth-secret-32-chars-longxxxx";
const SESSION_USER = { sub: "e2e@example.com", name: "e2e operator", username: "e2e", provider: "github" };
const SEEDED_ALLOWED_USERS = ["e2e-operator@example.com"];
const PROVIDER = "github";

const setAllowedUsers = async (users: string[]) => {
  const status = await writeConfig({ auth: { allowedUsers: users } });
  expect(status, `PUT /api/config auth.allowedUsers=${JSON.stringify(users)}`).toBe(200);
};

test.describe.serial("oauth open enrolment — public IdP fail-closed", () => {
  test.beforeAll(async ({ request }) => {
    const probe = await request.get(`/auth/start/${PROVIDER}`, { maxRedirects: 0 });
    test.skip(
      probe.status() !== 302,
      "no /auth/* routes — start the harness with PI_E2E_OAUTH=1 (see docker/test-entrypoint.sh)",
    );
  });

  test.afterEach(async () => {
    await writeConfig({ auth: { allowedUsers: SEEDED_ALLOWED_USERS } }).catch(() => {});
  });

  // #E110 — a cookie minted for a now-refused public provider is rejected by the live harness, and the
  // same cookie works again once an allowlist is added (no re-login needed).
  test("E110: a github session cookie is rejected while github is refused, accepted once an allowlist exists", async ({
    request,
  }) => {
    const cookie = `${COOKIE_NAME}=${signToken(SESSION_USER, E2E_AUTH_SECRET)}`;
    await narrowTrust(request, { trustedNetworks: [], auth: { bypassUrls: ["/v1/"] } });

    await setAllowedUsers([]);
    await expect
      .poll(async () => (await request.get("/api/sessions", { headers: { cookie } })).status(), {
        timeout: 15_000,
        intervals: [250],
      })
      .toBe(401);
    const rejected = await request.get("/api/sessions", { headers: { cookie } });
    const cleared = rejected
      .headersArray()
      .filter((h) => h.name.toLowerCase() === "set-cookie")
      .some((h) => new RegExp(`^${COOKIE_NAME}=;`).test(h.value));
    expect(cleared, "the rejected session cookie must be cleared").toBe(true);

    await setAllowedUsers(SEEDED_ALLOWED_USERS);
    await expect
      .poll(async () => (await request.get("/api/sessions", { headers: { cookie } })).status(), {
        timeout: 15_000,
        intervals: [250],
      })
      .toBe(200);
  });

  // #F5 — the operator sees the banner in Settings → Security; a fresh visitor sees the refused
  // provider as text (no sign-in link); after an allowlist the banner is gone and the login works.
  test("F5: banner in Settings ▸ Security and the refused login page, then both clear after an allowlist", async ({
    page,
    browser,
  }) => {
    await setAllowedUsers([]);

    await gotoDashboard(page);
    await page.goto("/settings/security");
    const banner = page.getByTestId("open-enrolment-banner");
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner).toContainText(PROVIDER);
    await expect(banner).toHaveAttribute("role", "status");

    const fresh = await browser.newContext({ baseURL: BASE_URL });
    try {
      const login = await fresh.newPage();
      const res = await login.goto("/auth/login");
      expect(res?.status()).toBe(403);
      await expect(login.locator("body")).toContainText(/not configured|Sign-in Not Configured/i);
      await expect(login.locator("body")).toContainText("auth.allowedUsers");
      await expect(login.locator('a[href*="/auth/start/"]')).toHaveCount(0);

      await setAllowedUsers(SEEDED_ALLOWED_USERS);
      // a single (now allowed) provider auto-redirects to the IdP: the sign-in path exists again
      await expect
        .poll(async () => (await fresh.request.get("/auth/login", { maxRedirects: 0 })).status(), {
          timeout: 15_000,
          intervals: [250],
        })
        .toBe(302);
    } finally {
      await fresh.close();
    }

    await page.goto("/settings/security");
    await expect(page.getByTestId("bypass-urls-textarea")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("open-enrolment-banner")).toHaveCount(0);
  });

  // #F6 — a logged-in browser with a terminal tab open converges to logged-out after the reload.
  // Asserted on server truth (`/auth/status`) and on the sockets actually closing. The 4401 close code
  // itself is asserted at L1 (#E101/#E114): Playwright does not expose a page WebSocket's close code.
  test("F6: open browser + terminal sockets converge to logged-out after the reload refuses github", async ({
    page,
    context,
    request,
  }) => {
    const cookieValue = signToken(SESSION_USER, E2E_AUTH_SECRET);
    await narrowTrust(request, { trustedNetworks: [], auth: { bypassUrls: ["/v1/"] } });
    await context.addCookies([{ name: COOKIE_NAME, value: cookieValue, url: BASE_URL }]);

    const sockets: Array<{ url: string; closed: boolean }> = [];
    page.on("websocket", (ws) => {
      const entry = { url: ws.url(), closed: false };
      sockets.push(entry);
      ws.on("close", () => {
        entry.closed = true;
      });
    });

    const card = await spawnFreshGitSession(page);
    await card.click();
    await page.getByTestId("layout-mode-switch").waitFor({ state: "visible", timeout: 30_000 });
    await robustClick(page, "layout-mode-split");
    await launchFromNewTabMenu(page, "new-terminal-launch");
    await expect(page.getByRole("textbox", { name: /terminal input/i }).first()).toBeVisible({ timeout: 30_000 });
    expect(sockets.some((s) => s.url.includes("/ws/terminal/")), "a terminal socket must be open").toBe(true);

    // The page reconnects after a close, so judge only the sockets that were open BEFORE the reload.
    const openBefore = sockets.filter((s) => !s.closed);
    await setAllowedUsers([]); // the reload refuses github

    // server truth: the cookie no longer authenticates
    await expect
      .poll(
        async () =>
          (await (await request.get("/auth/status", { headers: { cookie: `${COOKIE_NAME}=${cookieValue}` } })).json())
            .authenticated,
        { timeout: 15_000, intervals: [250] },
      )
      .toBe(false);
    // every socket the page held was closed by the sweep (browser + terminal)
    expect(openBefore.length).toBeGreaterThan(0);
    await expect.poll(() => openBefore.filter((s) => !s.closed).length, { timeout: 15_000 }).toBe(0);
    // and no authenticated REST call succeeds with that cookie
    expect((await request.get("/api/sessions", { headers: { cookie: `${COOKIE_NAME}=${cookieValue}` } })).status()).toBe(401);
  });
});
