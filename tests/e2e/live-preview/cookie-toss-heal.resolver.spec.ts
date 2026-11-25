import { expect, test } from "./fixture.js";
import { launchSharedParentBrowser, SHARED_PARENT, useSharedParentConfig } from "./shared-parent-env.js";

/**
 * L3 — duplicate-cookie gate self-heal after a preview-page toss (D10 / task 14.7), `chromium-resolver` project
 * (own Chromium on the shared-parent topology `dash.a.test` + `<label>.preview.a.test`, because that is where a
 * `Domain=` toss from a preview page really produces a duplicate: `Domain=localhost` is refused by Chromium
 * AND Firefox — see `cookie-paths.spec.ts`, T.F21).
 * Row: test-plan #X59. See change: serve-live-previews-on-capability-origin.
 */
const COOKIE = "pi_dash_local";

test("T.X59 / #X59 a preview toss makes dash answer 400 and expire the duplicate; the viewer recovers (self-heal) and re-mints a framed preview", async ({ isolatedServer, operator, upstream }) => {
  await useSharedParentConfig(isolatedServer);
  const browser = await launchSharedParentBrowser();
  try {
    const dash = isolatedServer.origin(SHARED_PARENT.dashHost);
    const context = await browser.newContext();
    const page = await context.newPage();
    await operator.authenticate(context, dash);
    upstream.script = `window.__result = {}; document.cookie = "${COOKIE}=tossed; Domain=${SHARED_PARENT.parent}; Path=/"; window.__result.done = true;`;

    const refusals: { status: number; body: string }[] = [];
    page.on("response", async (r) => {
      if (r.url().startsWith(`${dash}/api/`) && r.status() === 400) refusals.push({ status: 400, body: await r.text().catch(() => "") });
    });

    const viewer = await operator.openLivePreview(page, { dashOrigin: dash, target: upstream.url });
    const frame = await viewer.ready("#static");
    await expect.poll(() => frame.evaluate(() => (window as unknown as { __result?: { done?: boolean } }).__result?.done)).toBe(true);
    expect((await context.cookies(dash)).filter((c) => c.name === COOKIE), "host-only credential + Domain=.a.test toss").toHaveLength(2);

    // Follow-up dash fetch carries two copies → 400 + expiry (the SPA's own traffic may trip it first: either way ≥ 1 refusal).
    const followUp = await page.evaluate(async () => {
      const r = await fetch("/api/health");
      return r.status;
    });
    await expect.poll(() => refusals.length + (followUp === 400 ? 1 : 0), { message: "dash refused the duplicate" }).toBeGreaterThan(0);
    expect(refusals.every((r) => r.body.includes("duplicate_dashboard_cookie")), "every refusal is the duplicate-cookie JSON").toBe(true);

    // Self-heal, no manual cookie clear: nothing of the name survives, and the very next request is not refused again.
    expect((await context.cookies(dash)).filter((c) => c.name === COOKIE), "duplicate expired at every domain/path").toEqual([]);
    const next = await page.evaluate(async () => (await fetch("/api/health")).status);
    expect(next, "next request from the viewer's page is clean (no second 400)").toBe(200);

    // Recovery: the heal also dropped the legitimate credential (the gate cannot tell the copies apart), so the operator signs
    // in once (a normal sign-in, not a cookie clear). The viewer then re-mints and frames again.
    upstream.script = `window.__result = { done: true };`; // the toss does not repeat
    const code = await isolatedServer.mintLocalProofCode();
    expect((await page.goto(`${dash}/auth/local-proof?code=${code}`))?.ok()).toBeTruthy();
    const refusalsBefore = refusals.length;
    const again = await operator.openLivePreview(page, { dashOrigin: dash, target: upstream.url, session: viewer.session });
    const secondLabel = await again.srcOrigin();
    expect(secondLabel).toMatch(new RegExp(`\\.${SHARED_PARENT.suffix.replaceAll(".", "\\.")}:${isolatedServer.port}$`));
    const frame2 = await again.ready("#static");
    expect(await frame2.evaluate(() => location.origin)).toBe(secondLabel);
    expect(refusals.length, "no further refusal after recovery").toBe(refusalsBefore);
  } finally {
    await browser.close();
    await isolatedServer.restart({ reset: true });
  }
});
