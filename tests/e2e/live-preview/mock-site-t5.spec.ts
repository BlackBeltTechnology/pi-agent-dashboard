import type { Frame, Page } from "@playwright/test";
import { test as base, expect } from "./fixture.js";
import { expectPanesReported, LP_MOCK, LP_PANES, type LpMock, openPresetPreview, paneRing, startLpMock, startT5Mock, watchForbiddenConsole } from "./mock-site.js";

/**
 * L3 — the live-component MOCK SITE framed on TIER 5 (`/preview/<pid>/`, opaque sandbox, no `allow-same-origin`) on the
 * host-run isolated dashboard reached as `dash5.test`, in Chromium AND Firefox. The resolver is wired per browser right
 * here (Chromium `--host-resolver-rules`, Firefox `network.dns.localDomains`), so this spec runs in the plain `chromium`
 * and `firefox` projects. Rows: #F34 (nested same-pid panes under `frame-ancestors 'self'`), #P22, #P26, #F33 (T5 half),
 * #F42 (T5 half), #F43 (mixed viewers), #F50 (a)(b) (HMR through T5), #F55, #F56 (opaque), #F57 (`[::1]`).
 * The site starts under the base the dashboard reserves (`POST /api/live-server/preview-path`, the `mock-site:base-reservation`
 * answer) because a tier-5 viewer socket is connected. See change: serve-live-previews-on-capability-origin (D8, D9, D11, D14).
 */
const CHROMIUM_RULES = "MAP *.preview.test 127.0.0.1, MAP dash.test 127.0.0.1, MAP dash5.test 127.0.0.1";

const test = base.extend<object, { launchOptions: Record<string, unknown> }>({
  launchOptions: [
    async ({ browserName, launchOptions }, use) => {
      const lo = launchOptions as Record<string, unknown>;
      await use(
        browserName === "firefox"
          ? { ...lo, firefoxUserPrefs: { ...((lo.firefoxUserPrefs as object) ?? {}), "network.dns.localDomains": "dash.test,dash5.test" } }
          : { ...lo, args: [...((lo.args as string[]) ?? []), `--host-resolver-rules=${CHROMIUM_RULES}`] },
      );
    },
    { scope: "worker", option: true },
  ],
});
test.use({ dashHost: "dash5.test" });

let mock: LpMock | undefined;
test.afterEach(async () => {
  await mock?.dispose();
  mock = undefined;
});

const PID_BASE = /^\/preview\/[A-Za-z0-9_-]{22}\/$/;

/** Open the dashboard at the tier-5 origin (registers a tier-5 viewer socket), then start the mock under the reserved base. */
async function t5Mock(page: Page, operator: import("./operator.js").Operator, dashOrigin: string, server: import("./isolated-server.js").IsolatedServer, opts: { scripted?: boolean } = {}): Promise<LpMock> {
  await operator.gotoDashboard(page, dashOrigin);
  mock = await startT5Mock(server, opts);
  expect(mock.base).toMatch(PID_BASE);
  return mock;
}

test("T.F34 / #F34 tier-5 mock: every nested same-pid pane iframe loads and renders under frame-ancestors 'self' (Chromium and Firefox)", async ({ page, operator, livePreview, isolatedServer, dashOrigin }) => {
  const console_ = watchForbiddenConsole(page);
  const paneDocs: { url: string; status: number; csp: string }[] = [];
  page.on("response", (r) => {
    if (r.request().resourceType() !== "document" || !r.url().includes("?pane=")) return;
    paneDocs.push({ url: r.url(), status: r.status(), csp: r.headers()["content-security-policy"] ?? "" });
  });
  const m = await t5Mock(page, operator, dashOrigin, isolatedServer);
  const viewer = await livePreview.open(page, { target: m.url });
  expect(await viewer.src()).toBe(m.base);
  expect(await viewer.sandbox()).not.toContain("allow-same-origin");

  await expectPanesReported(viewer);
  for (const n of [1, 2, 3]) for (const side of ["current", "proposed"] as const) await expect(paneRing(viewer, n, side), `ring in pane ${n}/${side}`).toBeVisible();
  // The nested panes are the SAME pid's path. T11: `frame-ancestors 'self'` never matches an opaque ancestor, so the shipped tier-5 CSP is
  // the pre-declared fallback (directive omitted, the CSP `sandbox` still forces the opaque origin): the panes must render under it.
  const pane = viewer.frameLocator.locator("iframe[data-pane]").first();
  expect(await pane.getAttribute("src")).toMatch(/^\?pane=/);
  expect(paneDocs.length, "pane documents fetched").toBeGreaterThanOrEqual(LP_PANES);
  for (const d of paneDocs) {
    expect(d.status, d.url).toBe(200);
    expect(new URL(d.url).pathname, d.url).toBe(m.base);
    expect(d.csp, `CSP of ${d.url}`).toMatch(/^sandbox allow-scripts\b/);
    expect(d.csp, `CSP of ${d.url}`).not.toContain("allow-same-origin");
  }
  expect(console_.hits, "forbidden console output").toEqual([]);
});

test("T.P22 / #P22 tier-5 acceptance budget: a mock started under a reserved base renders its pane iframes within 60 s total (Chromium and Firefox)", async ({ page, operator, livePreview, isolatedServer, dashOrigin }) => {
  test.setTimeout(60_000); // the raised Playwright timeout of the row: the whole test, start-up included
  const t0 = Date.now();
  const m = await t5Mock(page, operator, dashOrigin, isolatedServer); // `startMockSite` itself fails after READY_TIMEOUT_MS (30 s, unchanged)
  const viewer = await livePreview.open(page, { target: m.url });
  await expectPanesReported(viewer);
  await expect(viewer.frameLocator.locator("iframe[data-pane]")).toHaveCount(LP_PANES);
  const elapsed = Date.now() - t0;
  console.log(`[P22] tier-5 start + render: ${elapsed} ms`);
  expect(elapsed, "total wall time of start + render").toBeLessThan(60_000);
});

test("T.P26 / #P26 six panes through tier 5 all report ready within the 10 s expect timeout, one document request per pane", async ({ page, operator, livePreview, isolatedServer, dashOrigin }) => {
  const paneDocRequests = new Map<string, number>();
  page.on("request", (r) => {
    if (r.resourceType() !== "document") return;
    const m = /[?&]pane=([^&#]+)/.exec(r.url());
    if (m) paneDocRequests.set(decodeURIComponent(m[1]), (paneDocRequests.get(decodeURIComponent(m[1])) ?? 0) + 1);
  });
  const m = await t5Mock(page, operator, dashOrigin, isolatedServer);
  const viewer = await livePreview.open(page, { target: m.url });
  await expect(viewer.frameLocator.locator(".mk-frame")).toHaveCount(3, { timeout: 30_000 }); // the shell is up; the panes are the budget
  // A user scrolling the page: each pane (a cross-origin, lazily mounted iframe) mounts when near and reports its height once visible.
  // Ready = the frame left the default 240 px height; every pane must get there inside the default 10 s expect timeout.
  for (const side of ["current", "proposed"] as const) {
    for (const n of [1, 2, 3]) {
      const spec = `${LP_MOCK}/${n}/${side}`;
      const wrap = viewer.frameLocator.locator(`[id="r-${spec}"]`);
      await wrap.evaluate((e) => e.scrollIntoView({ block: "center" }));
      const iframe = viewer.frameLocator.locator(`iframe[data-pane="${spec}"]`);
      // One 10 s budget per pane: mounted AND reported (height left the default).
      await expect
        .poll(async () => (await iframe.count()) > 0 && (await iframe.evaluate((e) => Math.round(e.getBoundingClientRect().height))) !== 240, { message: `pane ${spec} mounted and left the default height`, timeout: 10_000 })
        .toBe(true);
    }
  }
  await expect(viewer.frameLocator.locator(".mk-phone-load")).toHaveCount(0, { timeout: 10_000 });
  expect([...paneDocRequests.keys()].sort()).toEqual(["current", "proposed"].flatMap((s) => [1, 2, 3].map((n) => `${LP_MOCK}/${n}/${s}`)).sort());
  for (const [spec, n] of paneDocRequests) expect(n, `document requests for pane ${spec}`).toBeLessThanOrEqual(1);
});

test("T.F33 / #F33 a Vite mock site on tier 5 makes no root-absolute request to the dashboard; every module carries the /preview/<pid>/ prefix", async ({ page, operator, livePreview, isolatedServer, dashOrigin }) => {
  const console_ = watchForbiddenConsole(page);
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  const m = await t5Mock(page, operator, dashOrigin, isolatedServer);
  const viewer = await livePreview.open(page, { target: m.url });
  await expectPanesReported(viewer);
  const base = m.base as string;

  const ESCAPE = /^\/(@vite|@react-refresh|@fs|src|node_modules)(\/|$)/;
  const escaped = urls.filter((u) => u.startsWith(`${dashOrigin}/`) && ESCAPE.test(new URL(u).pathname));
  expect(escaped, "requests to dashboard-origin root module paths").toEqual([]);
  const modules = urls.filter((u) => new URL(u).pathname.startsWith(base) && ESCAPE.test(`/${new URL(u).pathname.slice(base.length)}`));
  expect(modules.length, "prefixed module requests").toBeGreaterThan(3);
  for (const u of modules) expect(new URL(u).origin, u).toBe(dashOrigin);
  for (const probe of ["@vite/client", "@react-refresh", "@fs/"]) expect(modules.some((u) => new URL(u).pathname.startsWith(`${base}${probe}`)), probe).toBe(true);
  expect(console_.hits, "forbidden console output (CORS / origin 'null')").toEqual([]);
});

test("T.F42 / #F42 Open ↗ on tier 5 opens /preview/<pid>/ on the dashboard in a new tab that renders the mock", async ({ page, context, operator, isolatedServer, dashOrigin }) => {
  const m = await t5Mock(page, operator, dashOrigin, isolatedServer);
  const viewer = await openPresetPreview(page, operator, isolatedServer, dashOrigin, m.port);
  expect(await viewer.src()).toBe(m.base);
  await expect(viewer.frameLocator.locator(".mk-frame").first()).toBeVisible({ timeout: 30_000 });
  const popupPromise = context.waitForEvent("page");
  await page.getByTestId("live-open").click();
  const popup = await popupPromise;
  await popup.waitForURL((u) => u.href !== "about:blank", { timeout: 20_000 });
  expect(popup.url()).toBe(`${dashOrigin}${m.base}`);
  expect(popup.url()).not.toBe("http://localhost:5299/");
  await expect(popup.locator(".mk-frame").first()).toBeVisible({ timeout: 30_000 });
  await popup.close();
});

test("T.F43 / #F43 mixed viewers: a tier-1 tab frames origin + /preview/<pid>/, a tier-5 tab frames /preview/<pid>/; closing the T5 tab leaves the T1 frame alive", async ({ browser, operator, isolatedServer, dashOrigin }) => {
  const ctx = await browser.newContext();
  const t5Page = await ctx.newPage();
  const t1Page = await ctx.newPage();
  try {
    const m = await t5Mock(t5Page, operator, dashOrigin, isolatedServer); // the T5 viewer existed ⇒ the site runs under the reserved base
    const t1Origin = isolatedServer.origin("localhost");
    const t5Viewer = await operator.openLivePreview(t5Page, { dashOrigin, target: m.url });
    const t1Viewer = await operator.openLivePreview(t1Page, { dashOrigin: t1Origin, target: m.url });
    const base = m.base as string;

    expect(await t5Viewer.src()).toBe(base);
    const t1Src = await t1Viewer.src();
    expect(t1Src).toMatch(new RegExp(`^http://[a-z2-7]{26}\\.localhost:${isolatedServer.port}${base}$`)); // mint carries `base`
    // One tab is foreground at a time (a background tab does not run rendering), so look at each in turn.
    await t5Page.bringToFront();
    await expect(t5Viewer.frameLocator.locator(".mk-frame").first()).toBeVisible({ timeout: 30_000 });
    await expectPanesReported(t5Viewer);
    await t1Page.bringToFront();
    await expect(t1Viewer.frameLocator.locator(".mk-frame").first()).toBeVisible({ timeout: 30_000 });
    await expectPanesReported(t1Viewer);

    await t5Page.close(); // closing the tier-5 tab must not blank the tier-1 frame
    await t1Page.waitForTimeout(2_000);
    expect(await t1Viewer.src()).toBe(t1Src);
    await expect(t1Viewer.frameLocator.locator(".mk-frame").first()).toBeVisible();
    await expect(paneRing(t1Viewer, 1, "proposed")).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test.describe("T.F50 / #F50 HMR through tier 5", () => {
  test.describe.configure({ timeout: 150_000 });

  test("(a) an edit arrives over ws://<dash>/preview/<pid>/ and updates the pane; (b) a restarted upstream under the same base reconnects and reloads without a manual refresh", async ({ page, operator, livePreview, isolatedServer, dashOrigin }) => {
    const sockets: { url: string; received: string[]; error?: string }[] = [];
    page.on("websocket", (w) => {
      const rec = { url: w.url(), received: [] as string[], error: undefined as string | undefined };
      sockets.push(rec);
      w.on("framereceived", (f) => rec.received.push(String(f.payload)));
      w.on("socketerror", (e) => {
        rec.error = e;
      });
    });
    const m = await t5Mock(page, operator, dashOrigin, isolatedServer);
    const viewer = await livePreview.open(page, { target: m.url });
    await expectPanesReported(viewer);
    const hmr = () => sockets.filter((s) => s.url.startsWith(`${dashOrigin.replace("http", "ws")}${m.base}`));

    // (a)
    await expect.poll(() => hmr().some((s) => s.received.some((x) => x.includes('"connected"'))), { message: `Vite handshake over ws://dash5.test:${isolatedServer.port}${m.base} (opaque Origin: null)` }).toBe(true);
    expect(hmr().every((s) => s.error === undefined), "socket errors").toBe(true);
    m.edit("v2");
    await expect(viewer.frameLocator.getByText("LP preview mock v2").first()).toBeVisible({ timeout: 30_000 });
    await expect(viewer.frameLocator.frameLocator(`iframe[data-pane="${LP_MOCK}/1/proposed"]`).getByText("proposed ring v2")).toBeVisible({ timeout: 30_000 });

    // (b) restart on the same port with the same base.
    await (await viewer.frame()).evaluate(() => ((window as unknown as { __beforeRestart: boolean }).__beforeRestart = true));
    await m.stop();
    await expect.poll(() => fetch(`${m.url}/`).then(() => true, () => false), { timeout: 15_000 }).toBe(false);
    await m.restart();
    expect(m.base).toMatch(PID_BASE);
    await expect
      .poll(async () => (await (await viewer.frame()).evaluate(() => (window as unknown as { __beforeRestart?: boolean }).__beforeRestart).catch(() => true)) === undefined, {
        message: "the shell document reloaded by itself",
        timeout: 90_000,
        intervals: [1_000],
      })
      .toBe(true);
    await expect(viewer.frameLocator.locator(".mk-frame")).toHaveCount(3, { timeout: 60_000 });
    await expectPanesReported(viewer, 60_000);
    await expect(paneRing(viewer, 1, "proposed")).toBeVisible();
  });
});

/** Stub the clipboard (insecure contexts have none) and record `writeText` per frame. */
const stubClipboard = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as { __copied: string[] };
    w.__copied = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (t: string) => (w.__copied.push(t), Promise.resolve()) } });
  });

const paneFrame = (page: Page, n: number, side: string): Frame => {
  const f = page.frames().find((fr) => fr.url().includes(`pane=${encodeURIComponent(`${LP_MOCK}/${n}/${side}`)}`));
  if (!f) throw new Error(`pane frame ${n}/${side} not found`);
  return f;
};

test("T.F56 / #F56 a copied ring link in an opaque tier-5 frame is location.href minus hash plus #ring and never starts with null", async ({ page, operator, livePreview, isolatedServer, dashOrigin }) => {
  await stubClipboard(page);
  const m = await t5Mock(page, operator, dashOrigin, isolatedServer);
  const viewer = await livePreview.open(page, { target: m.url });
  await expectPanesReported(viewer);
  const frame = paneFrame(page, 1, "current");
  expect(await frame.evaluate(() => window.origin), "the pane really is opaque").toBe("null");
  await frame.evaluate(() => document.addEventListener("click", (e) => e.preventDefault())); // keep the `target=_top` link from navigating
  await viewer.frameLocator.frameLocator(`iframe[data-pane="${LP_MOCK}/1/current"]`).locator(".mk-ring-n").first().click();
  const copied = await frame.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
  expect(copied).toEqual([`${frame.url().split("#")[0]}#${LP_MOCK}/1/current/1`]);
  expect(copied[0].startsWith("null")).toBe(false);
  expect(copied[0].startsWith(`${dashOrigin}${m.base}`)).toBe(true);
});

test("T.F55 / #F55 pane→shell messages carry no pid, URL, decisions or fixtures; the unfixtured request is reported base-relative; target origin is \"*\" only while opaque", async ({ page, operator, livePreview, isolatedServer, dashOrigin }) => {
  // Spy on `parent.postMessage` of every frame: each message with its target origin and the frame's own origin.
  await page.addInitScript(() => {
    if (window === window.top) return;
    const real = window.parent;
    const log: { target: unknown; origin: string; data: string }[] = [];
    (window as unknown as { __pm: typeof log }).__pm = log;
    const spy = { postMessage: (m: unknown, t: unknown, x?: unknown) => (log.push({ target: t, origin: window.origin, data: JSON.stringify(m) }), (real.postMessage as (...a: unknown[]) => void)(m, t, x)) };
    try {
      Object.defineProperty(window, "parent", { configurable: true, get: () => spy });
    } catch {
      /* not replaceable here */
    }
  });
  const spied = async (f: Frame) => f.evaluate(() => (window as unknown as { __pm?: { target: unknown; origin: string; data: string }[] }).__pm ?? []);

  // Opaque (tier 5).
  const m = await t5Mock(page, operator, dashOrigin, isolatedServer);
  const viewer = await livePreview.open(page, { target: m.url });
  await expectPanesReported(viewer);
  await expect(viewer.frameLocator.locator(".mk-missing")).toContainText("GET /api/roles", { timeout: 20_000 });
  const msgs = [...(await spied(paneFrame(page, 2, "current"))), ...(await spied(paneFrame(page, 2, "proposed"))), ...(await spied(paneFrame(page, 1, "proposed")))];
  expect(msgs.length, "pane→shell messages observed").toBeGreaterThan(2);
  const missing = msgs.filter((x) => x.data.includes("mkMissing"));
  expect(missing.map((x) => JSON.parse(x.data))).toEqual(expect.arrayContaining([{ mkMissing: `${LP_MOCK}/2/current`, method: "GET", path: "/api/roles" }]));
  const pid = (m.base as string).split("/")[2];
  for (const x of msgs) {
    expect(x.origin, "the pane is opaque").toBe("null");
    expect(x.target, `target origin of ${x.data}`).toBe("*");
    expect(x.data, "payload leaks the pid").not.toContain(pid);
    expect(x.data, "payload carries a URL").not.toMatch(/https?:|\/preview\//);
    expect(x.data, "payload carries decisions / fixtures").not.toMatch(/decision|fixture/i);
  }

  // Real origin (tier 1, no base): never "*".
  await mock?.dispose();
  mock = await startLpMock();
  const t1 = await livePreview.open(page, { dashHost: "localhost", target: mock.url });
  await expectPanesReported(t1);
  const t1msgs = [...(await spied(paneFrame(page, 1, "proposed"))), ...(await spied(paneFrame(page, 2, "current")))];
  expect(t1msgs.length, "tier-1 pane→shell messages observed").toBeGreaterThan(1);
  for (const x of t1msgs) {
    expect(x.origin).toMatch(/^http:\/\/[a-z2-7]{26}\.localhost:\d+$/);
    expect(x.target, `target origin of ${x.data}`).toBe(x.origin);
    expect(x.target).not.toBe("*");
  }
});

test("T.F57 / #F57 dash reached as [::1] skips tiers 1-4: frame src is /preview/<pid>/, no frame-src violation, the mock renders", async ({ page, operator, livePreview, isolatedServer }) => {
  test.setTimeout(120_000);
  // The isolated server binds 127.0.0.1 only: rebind dual-stack (`::`) so `http://[::1]:<port>` is reachable, restore in `finally`.
  await isolatedServer.restart({ patch: { bindHost: "::" } });
  try {
  const dash6 = isolatedServer.origin("[::1]");
  const violations: string[] = [];
  await page.exposeFunction("__lpViolation", (v: string) => violations.push(v));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __lpViolation: (v: string) => void }).__lpViolation(`${e.violatedDirective}|${e.blockedURI}`)));
  const reports: string[] = [];
  page.on("request", (r) => r.url().includes("/__pi/csp-report") && reports.push(r.postData() ?? ""));
  const m = await t5Mock(page, operator, dash6, isolatedServer);
  const viewer = await livePreview.open(page, { dashHost: "[::1]", target: m.url });
  expect(await viewer.src()).toBe(m.base);
  await expect(viewer.frameLocator.locator(".mk-frame").first()).toBeVisible({ timeout: 30_000 });
  await expectPanesReported(viewer);
  await page.waitForTimeout(1_000);
  expect(violations.filter((v) => v.startsWith("frame-src")), `violations: ${violations.join(", ")}`).toEqual([]);
  expect(reports.filter((b) => /frame-src/.test(b)), "csp-report bodies naming frame-src").toEqual([]);
  } finally {
    await isolatedServer.restart({ reset: true });
  }
});


test("T.F50 / #F50 (c, SCALED) a tier-5 viewer on a site NOT under its base shows the base, a copy button and the restart instruction, not a silent blank", async ({ page, operator, livePreview, isolatedServer, dashOrigin }) => {
  // The row reaches this state by idle-expiring the pid (30 min idle / 12 h absolute, no server-side clock seam). The viewer state itself
  // — a new `/preview/<pid>/` base the site does not serve under yet (T3) — is produced here by starting the site at the ROOT.
  await stubClipboard(page);
  await operator.gotoDashboard(page, dashOrigin);
  mock = await startLpMock(); // no reservation probe: the site serves at `/`
  const viewer = await livePreview.open(page, { target: mock.url });
  const base = await viewer.src();
  expect(base).toMatch(PID_BASE);
  await expect(page.getByTestId("live-base-path")).toHaveText(base);
  await expect(page.getByTestId("live-base-path")).toBeVisible();
  await expect(page.getByText(/restart your server with this base/i)).toBeVisible();
  await page.getByTestId("live-base-copy").click();
  await expect(page.getByTestId("live-base-copy-status")).toHaveText(/copied/i);
  expect(await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)).toEqual([base]);
  await expect(viewer.iframe, "the frame is still the pid path, not blank").toHaveAttribute("src", base);
});
