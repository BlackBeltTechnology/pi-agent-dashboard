import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixture.js";

/**
 * L3 — duplicate `pi_dash_*` cookie refusal vs engine cookie-path semantics (chromium + firefox projects;
 * WebKit is not a project of this suite — run it separately when a WebKit build is available).
 * Row: test-plan #F21. See change: serve-live-previews-on-capability-origin (D10, task 14.7).
 *
 * A second copy of the operator cookie at `Path=/api`, `Path=/api/` or `Path=/api/sessions/abc/events` is sent
 * beside the host-only `Path=/` one. The refusal must expire every candidate path so no engine sends a duplicate again.
 */
const COOKIE = "pi_dash_local";
const REQUEST_PATH = "/api/sessions/abc/events";

interface Ctx {
  context: BrowserContext;
  page: Page;
}
const copies = async ({ context }: Ctx, origin: string) => (await context.cookies(origin)).filter((c) => c.name === COOKIE);

/** Operator sign-in at `origin` with a fresh local-proof code (the operator fixture caches per origin; this always redeems). */
async function signIn(c: Ctx, redeem: () => Promise<string>, origin: string): Promise<void> {
  const res = await c.page.goto(`${origin}/auth/local-proof?code=${await redeem()}`);
  expect(res?.ok(), "local-proof redeem").toBeTruthy();
  await c.page.goto(`${origin}/`);
  await c.page.getByTestId("header-app-bar").waitFor({ state: "visible", timeout: 30_000 });
}
const request = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    const r = await fetch(p, { credentials: "include" });
    return { status: r.status, body: await r.text() };
  }, path);

for (const plantedPath of ["/api", "/api/", REQUEST_PATH]) {
  test(`T.F21 / #F21 a duplicate planted at Path=${plantedPath} is refused once, then no duplicate is sent`, async ({ page, context, isolatedServer, dashOrigin, browserName }) => {
    const c = { context, page };
    await signIn(c, () => isolatedServer.mintLocalProofCode(), dashOrigin);
    expect(await copies(c, dashOrigin), "baseline: one host-only Path=/ credential").toHaveLength(1);
    // Park on a script-free same-origin JSON document: the running SPA would otherwise race the explicit request (its own
    // background traffic can take the one refusal first and expire the cookies).
    await page.goto(`${dashOrigin}/api/health`);

    await context.addCookies([{ name: COOKIE, value: "planted", domain: "localhost", path: plantedPath }]);
    const sent = await copies(c, `${dashOrigin}${REQUEST_PATH}`);
    expect(sent.length, `${browserName}: both copies would be sent to ${REQUEST_PATH}`).toBe(2);

    const first = await request(page, REQUEST_PATH);
    expect(first.status, "the duplicate is refused").toBe(400);
    expect(first.body).toContain("duplicate_dashboard_cookie");
    expect(await copies(c, `${dashOrigin}${REQUEST_PATH}`), `${browserName}: every copy (incl. Path=${plantedPath}) was expired by the one refusal`).toEqual([]);
    expect((await context.cookies()).filter((k) => k.name === COOKIE), "nothing left in the whole jar").toEqual([]);

    const again = await request(page, REQUEST_PATH);
    expect(again.status, "no duplicate is sent after the one refusal").not.toBe(400);
    const health = await request(page, "/api/health");
    expect(health.status).toBe(200);
  });
}

test("T.F21 / #F21 Domain=localhost set by a <label>.localhost document: engine acceptance recorded, a surviving duplicate fails loudly", async ({ page, context, livePreview, upstream, dashOrigin, browserName }) => {
  const c = { context, page };
  upstream.script = `window.__result = {}; document.cookie = "${COOKIE}=tossed; Domain=localhost; Path=/"; window.__result.done = true;`;
  const viewer = await livePreview.open(page);
  const frame = await viewer.ready("#static");
  await expect.poll(() => frame.evaluate(() => (window as unknown as { __result?: { done?: boolean } }).__result?.done)).toBe(true);
  expect(new URL(await viewer.src()).hostname).toMatch(/^[a-z2-7]{26}\.localhost$/);

  const tossed = (await context.cookies()).filter((k) => k.value === "tossed");
  const accepted = tossed.length > 0;
  test.info().annotations.push({ type: `${browserName}: Domain=localhost from <label>.localhost`, description: accepted ? "accepted by the engine" : "refused by the engine (localhost is a public suffix)" });
  console.log(`[F21] ${browserName}: Domain=localhost from <label>.localhost → ${accepted ? "ACCEPTED" : "REFUSED"}`);

  const first = await request(page, REQUEST_PATH);
  if (accepted) {
    expect(first.status, "an accepted toss makes a duplicate → refused").toBe(400);
  } else {
    expect(first.status, "a refused toss leaves one credential → no refusal").not.toBe(400);
  }
  // Whatever the engine did: after (at most) one refusal there is never a duplicate again.
  const after = await request(page, REQUEST_PATH);
  expect(after.status, "a duplicate survived the expiry set").not.toBe(400);
  expect((await copies(c, `${dashOrigin}${REQUEST_PATH}`)).length, "at most one copy of the credential is sent").toBeLessThanOrEqual(1);
});
