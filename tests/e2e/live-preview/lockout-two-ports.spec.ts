import fs from "node:fs";
import { expect, test } from "./fixture.js";
import { IsolatedServer, killPid, startIsolatedServer } from "./isolated-server.js";

/**
 * L3 — two dashboards on ONE host, two ports (`localhost:A` + `localhost:B`): cookies ignore ports, so both
 * set `pi_dash_token` host-only `Path=/` and the second sign-in OVERWRITES the first (same name/domain/path).
 * The duplicate-cookie gate must never see two copies: no 400 on either dashboard, the signed-out one is signed
 * out (existing behaviour) — not locked out — and signing in again recovers.
 * Row: test-plan #E127 (lockout false positive). See change: serve-live-previews-on-capability-origin (D10).
 */
test("T.E127 / #E127 two dashboards on one host, two ports: cookie overwrite, no 400, signed out but not locked out", async ({ page, context, isolatedServer }) => {
  const second = await startIsolatedServer(false); // not persisted: the run state file keeps pointing at the main server
  const A = isolatedServer;
  const B = new IsolatedServer(second);
  try {
    const originA = A.origin("localhost");
    const originB = B.origin("localhost");
    expect(originA, "two distinct ports on the same host").not.toBe(originB);

    const redeem = async (srv: IsolatedServer, origin: string) => {
      const res = await page.goto(`${origin}/auth/local-proof?code=${await srv.mintLocalProofCode()}`);
      expect(res?.ok(), `local-proof redeem at ${origin}`).toBeTruthy();
    };
    const dashCookies = async () => (await context.cookies()).filter((c) => c.name.startsWith("pi_dash_"));
    const expectNoDuplicate = async (label: string) => {
      const names = (await dashCookies()).map((c) => `${c.name}|${c.domain}|${c.path}`);
      expect(new Set(names).size, `${label}: no repeated pi_dash_* cookie in the jar (${names.join(", ")})`).toBe(names.length);
      const byName = (await dashCookies()).map((c) => c.name);
      expect(new Set(byName).size, `${label}: one cookie per pi_dash_* NAME (ports share the jar)`).toBe(byName.length);
    };
    const dashboardUp = async (origin: string) => {
      const res = await page.goto(`${origin}/`);
      expect(res?.status(), `${origin} must not refuse with 400`).not.toBe(400);
      await page.getByTestId("header-app-bar").waitFor({ state: "visible", timeout: 30_000 });
    };
    // The first-launch dialog would cover the app bar's neighbours; it never blocks `header-app-bar` visibility.

    // A signs in, then B signs in: B's `Set-Cookie` overwrites A's (same host, same name, same path).
    await redeem(A, originA);
    await dashboardUp(originA);
    await redeem(B, originB);
    await expectNoDuplicate("after both sign-ins");
    await dashboardUp(originB);

    // Reload A: B's token is not A's. A answers as signed out (NOT the 400 duplicate refusal).
    const reloadA = await page.goto(`${originA}/`);
    expect(reloadA?.status(), "A is signed out, never locked out by the duplicate gate").not.toBe(400);
    await expect(page.getByText(/two copies of a dashboard cookie/i), "no duplicate-cookie refusal page").toHaveCount(0);
    // The SPA shell is static; the credential decides the API. A's cookie was overwritten by B's token → A refuses the API (401/403).
    // An operate-tier POST (`{}` body): a signed-in operator reaches the handler (400 host is required), a signed-out caller is refused 401/403.
    const apiOf = (o: string) => page.evaluate(async (origin) => (await fetch(`${origin}/api/live-server/start`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{}" })).status, o);
    expect([401, 403], "A is signed out (existing behaviour), not 400-locked-out").toContain(await apiOf(originA));
    await expectNoDuplicate("after reloading A");

    // Not locked out: signing in to A again recovers with no manual cookie clearing (and now B is the signed-out one).
    await redeem(A, originA);
    await dashboardUp(originA);
    expect(await apiOf(originA), "A recovers with a fresh sign-in (handler reached: host is required), no manual cookie clear").toBe(400);
    const reloadB = await page.goto(`${originB}/`);
    expect(reloadB?.status(), "B is signed out in turn, not refused with 400").not.toBe(400);
    expect([401, 403], "B is the signed-out one now").toContain(await apiOf(originB));
    await expectNoDuplicate("after re-sign-in to A");
  } finally {
    killPid(second.pid);
    fs.rmSync(second.home, { recursive: true, force: true });
  }
});
