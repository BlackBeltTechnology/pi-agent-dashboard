import { expect, test } from "./fixture.js";
import { launchSharedParentBrowser, PARENT_DOMAIN_WARNING, SHARED_PARENT, useSharedParentConfig } from "./shared-parent-env.js";

/**
 * L3 — tier-2 `Domain=` cookie toss from a preview page (csrf-gate D10), `chromium-resolver` project.
 * Row: test-plan #F20. See change: serve-live-previews-on-capability-origin.
 *
 * The dashboard's operator credential here is `pi_dash_local` (local-proof sign-in); a login session would be
 * `pi_dash_token`. The gate refuses ANY repeated `pi_dash_*` name, so the toss targets the name the browser holds.
 */
interface Toss {
  names: string[];
  set: Record<string, string>;
}
interface PreviewWindow {
  __result?: Toss;
}

const tossScript = (domains: string[]): string => `
  window.__result = { names: [], set: {} };
  ${JSON.stringify(domains)}.forEach(function (d) {
    document.cookie = "pi_dash_local=tossed-" + d + "; Domain=" + d + "; Path=/";
    window.__result.set[d] = document.cookie;
  });
`;

test("T.F20 / #F20 tier 2: a Domain=preview.test toss never reaches dash.test (no 400); no parent-domain warning at boot", async ({ page, context, livePreview, upstream, isolatedServer, operator, dashOrigin, dashHost }) => {
  expect(dashHost).toBe("dash.test");
  // Boot-log observable: a restart onto the base config logs the tier set but NOT the parent-domain warning
  // (`dash.test` and `preview.test` share no registrable parent).
  const mark = isolatedServer.logMark();
  await isolatedServer.restart({ reset: true });
  const boot = isolatedServer.livePreviewLog(mark);
  expect(boot.join("\n"), "boot line names tier 2").toMatch(/\[live-preview\] tiers: 1, 2, 3\(\d+-\d+\), 5/);
  expect(boot.filter((l) => PARENT_DOMAIN_WARNING.test(l)), "no parent-domain warning when suffix and dashboard host do not share a parent").toEqual([]);

  await operator.authenticate(context, dashOrigin);
  upstream.script = tossScript(["preview.test", "test"]);
  const dashResponses: { url: string; status: number }[] = [];
  page.on("response", (r) => {
    if (r.url().startsWith(`${dashOrigin}/api/`)) dashResponses.push({ url: r.url(), status: r.status() });
  });

  const viewer = await livePreview.open(page);
  const src = new URL(await viewer.src());
  expect(src.hostname, "tier 2: <label>.preview.test").toMatch(/^[a-z2-7]{26}\.preview\.test$/);
  const frame = await viewer.ready("#static");
  await expect.poll(() => frame.evaluate(() => (window as unknown as PreviewWindow).__result?.set["test"]), { message: "toss script ran" }).toBeDefined();

  // (a) From inside the cross-site viewer frame the engine refuses to store the toss at all (SameSite default Lax):
  // nothing tossed is in the jar, so nothing can reach dash.test.
  expect((await context.cookies()).filter((c) => c.value.startsWith("tossed-")), "a cross-site frame cannot toss").toEqual([]);

  // (b) The same preview origin opened as a TOP-LEVEL page (first-party): `Domain=preview.test` IS stored, `Domain=test`
  // (a public suffix) is refused — and the stored one never goes to the dashboard host.
  const top = await context.newPage();
  await top.goto(await viewer.src());
  await expect.poll(async () => (await top.evaluate(() => (window as unknown as PreviewWindow).__result?.set["test"])) !== undefined).toBe(true);
  const tossed = (await context.cookies()).filter((c) => c.value.startsWith("tossed-"));
  expect(tossed.map((c) => `${c.domain}=${c.value}`), "only Domain=preview.test could be set; Domain=test is refused").toEqual([".preview.test=tossed-preview.test"]);
  await top.close();
  const forDashboard = await context.cookies(dashOrigin);
  expect(forDashboard.filter((c) => c.value.startsWith("tossed-")), "the Domain=preview.test cookie never reaches dash.test").toEqual([]);
  expect(forDashboard.filter((c) => c.name === "pi_dash_local").length, "exactly one pi_dash_local goes to the dashboard").toBe(1);

  // Trigger dashboard requests: no 400, ever.
  const statuses = await page.evaluate(async () => [(await fetch("/api/health")).status, (await fetch("/api/health")).status]);
  expect(statuses).toEqual([200, 200]);
  const nav = await page.reload();
  expect(nav?.status(), "reloading the dashboard is not refused").toBe(200);
  expect(dashResponses.filter((r) => r.status === 400), "no dashboard API call was refused with 400").toEqual([]);
});

test("T.F20 / #F20 shared-parent tier 2 (preview.a.test + dash.a.test): a Domain=a.test toss → 400, healed by the Domain=a.test expiry, next request clean; warning at boot", async ({ isolatedServer, operator, upstream }) => {
  const mark = isolatedServer.logMark();
  await useSharedParentConfig(isolatedServer);
  const browser = await launchSharedParentBrowser();
  try {
    expect(isolatedServer.livePreviewLog(mark).filter((l) => PARENT_DOMAIN_WARNING.test(l)).join("\n"), "boot warns about the shared parent domain").toContain(`with ${SHARED_PARENT.dashHost}`);

    const dash = isolatedServer.origin(SHARED_PARENT.dashHost);
    const context = await browser.newContext();
    const page = await context.newPage();
    await operator.authenticate(context, dash);
    upstream.script = tossScript([SHARED_PARENT.parent]);
    const dashApi: { status: number; body: string }[] = [];
    page.on("response", async (r) => {
      if (r.url().startsWith(`${dash}/api/`)) dashApi.push({ status: r.status(), body: await r.text().catch(() => "") });
    });

    const viewer = await operator.openLivePreview(page, { dashOrigin: dash, target: upstream.url });
    expect((await viewer.srcOrigin()), "tier 2 on the shared-parent suffix").toMatch(new RegExp(`^http://[a-z2-7]{26}\\.${SHARED_PARENT.suffix.replaceAll(".", "\\.")}:${isolatedServer.port}$`));
    const frame = await viewer.ready("#static");
    const result = await frame.evaluate(() => (window as unknown as PreviewWindow).__result);
    expect(result?.set[SHARED_PARENT.parent], "engine accepted the Domain=a.test toss").toContain("pi_dash_local=tossed-a.test");

    // The toss is now in the jar for `.a.test`, beside the dashboard's host-only cookie.
    const dups = (await context.cookies(dash)).filter((c) => c.name === "pi_dash_local");
    expect(dups.map((c) => c.domain).sort(), "host-only + Domain=.a.test copies both go to the dashboard").toEqual([".a.test", SHARED_PARENT.dashHost].sort());

    // The next dashboard request is refused (400), and its `Set-Cookie` expiry healed the jar.
    const first = await page.evaluate(async () => {
      const r = await fetch("/api/health");
      return { status: r.status, body: await r.text() };
    });
    expect(first.status, "duplicate refused").toBe(400);
    expect(first.body).toContain("duplicate_dashboard_cookie");
    const healed = await context.cookies(dash);
    expect(healed.filter((c) => c.name === "pi_dash_local"), "every copy of the duplicated name was expired (host-only AND Domain=.a.test): the toss is gone").toEqual([]);
    expect(healed.filter((c) => c.value.startsWith("tossed-")), "no tossed cookie survives").toEqual([]);
    const second = await page.evaluate(async () => (await fetch("/api/health")).status);
    expect(second, "next request is clean").toBe(200);
  } finally {
    await browser.close();
    await isolatedServer.restart({ reset: true });
  }
});
