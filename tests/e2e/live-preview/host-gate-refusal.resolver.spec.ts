import { expect, test } from "./fixture.js";

/**
 * L3 — duplicate dashboard cookie refusal page (csrf-gate), chromium-resolver project: the dashboard
 * is reached as `dash.test`, where a host-only and a `Domain=` cookie of the same name BOTH survive in
 * Chromium's jar (on `localhost` the engine collapses them — task 14.7), so the gate sees a real dup.
 * Row: test-plan #F22. See change: serve-live-previews-on-capability-origin (task 4.1, D10).
 */
const dupCookies = (name: string, host: string) => [
  { name, value: "a", domain: host, path: "/" },
  { name, value: "b", domain: `.${host}`, path: "/" },
];

test("T.F22 / #F22 duplicate-cookie refusal page: script-free HTML, one reload lands on the dashboard", async ({ page, context, operator, dashOrigin, dashHost }) => {
  await operator.authenticate(context, dashOrigin);
  await context.addCookies(dupCookies("pi_dash_token", dashHost));

  const res = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(res?.status(), "dup cookie is refused with 400 (not 401: that would loop sign-in)").toBe(400);
  expect(res?.headers()["content-type"]).toMatch(/^text\/html/);
  const body = await res?.text();
  expect(body, "HTML page, no script and no /assets/ reference (works under the enforced CSP)").not.toMatch(/<script|\/assets\//i);
  await expect(page.getByRole("heading")).toContainText(/two copies of a dashboard cookie/i);
  await expect(page.locator("main")).toContainText(/reload this page/i);
  await expect(page.locator("code")).toHaveText("pi_dash_token");

  // ONE reload (F5) lands on the dashboard: the refusal's Set-Cookie expired the duplicate.
  const again = await page.reload();
  expect(again?.status()).toBe(200);
  await page.getByTestId("header-app-bar").waitFor({ state: "visible", timeout: 30_000 });
  expect((await context.cookies()).filter((c) => c.name === "pi_dash_token").length, "at most one pi_dash_token survives").toBeLessThanOrEqual(1);
});

test("T.F22 / #F22 the refused cookie name is HTML-escaped in the page", async ({ page, context, operator, dashOrigin, dashHost }) => {
  await operator.authenticate(context, dashOrigin);
  // `&` is cookie-legal and HTML-significant: a name echoed verbatim would produce `&y`, escaped it is `&amp;y`.
  await context.addCookies(dupCookies("pi_dash_x&y", dashHost));
  const res = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(res?.status()).toBe(400);
  const body = (await res?.text()) ?? "";
  expect(body).toContain("<code>pi_dash_x&amp;y</code>");
  expect(body).not.toContain("pi_dash_x&y<");
});
