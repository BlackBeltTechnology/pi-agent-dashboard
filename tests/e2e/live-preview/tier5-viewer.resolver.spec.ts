import { expect, test, type Upstream } from "./fixture.js";
import { bearerApi, clockWarp, pairDevice, revokeDevice, sleep } from "./tier5-helpers.js";

/**
 * L3 — tier-5 viewer (`/preview/<pid>/` in the opaque-origin frame) reached as `http://dash5.test:<port>` (chromium-resolver).
 * Rows: test-plan #F13 (sandboxed frame, ACAO null), #F14 (pid drop while the viewer is open), #F15 (two tabs share a pid,
 * re-mint inside the 20-minute window). The site under test is started UNDER the base the dashboard reserved, like
 * `serve_mock_site` does. See change: serve-live-previews-on-capability-origin (tasks 8.3, 14.4).
 */
test.use({ dashHost: "dash5.test" });

interface FrameResult {
  module?: string;
  asset?: string;
  hmr?: string;
  api?: string;
  cookie?: string;
}

/**
 * Serve a site under `base` from the shared upstream: an HTML entry with an ES module (+ a relative import), a JSON asset, and
 * a script that checks what an opaque-origin frame can and cannot do. Results land in `window.__result`.
 */
function serveSiteUnder(upstream: Upstream, base: string, dashOrigin: string): void {
  upstream.route(base, `<!doctype html><meta charset="utf-8"><h1 id="site">site under ${base}</h1><script type="module" src="${base}main.js"></script>`);
  upstream.route(`${base}dep.js`, "export const dep = 'dep-ok';", "text/javascript");
  upstream.route(`${base}data.json`, JSON.stringify({ asset: "asset-ok" }), "application/json");
  upstream.route(
    `${base}main.js`,
    `import { dep } from "${base}dep.js";
const r = (window.__result = { module: dep });
fetch("${base}data.json").then((x) => x.json()).then((j) => { r.asset = j.asset; }).catch((e) => { r.asset = "error:" + e.name; });
const ws = new WebSocket("ws://" + location.host + "${base}");
ws.onopen = () => { r.hmr = "open"; };
ws.onerror = () => { r.hmr = r.hmr ?? "error"; };
fetch(${JSON.stringify(`${dashOrigin}/api/sessions`)}).then((x) => { r.api = "resolved:" + x.status; }).catch((e) => { r.api = "error:" + e.name; });
try { r.cookie = "readable:" + document.cookie; } catch (e) { r.cookie = "error:" + e.name; }
`,
    "text/javascript",
  );
}

/**
 * Wait until the dashboard tab's browser WebSocket has announced `live_preview_accept` (a tier-5 viewer exists), then reserve a
 * base for `port` as the operator. Returns `/preview/<pid>/`.
 */
async function reserveBase(isolatedServer: import("./isolated-server.js").IsolatedServer, port: number): Promise<string> {
  let base: string | null = null;
  await expect
    .poll(
      async () => {
        const r = await isolatedServer.api("POST", "/api/live-server/preview-path", { port });
        base = (r.json?.path as string | null) ?? null;
        return base;
      },
      { message: "a tier-5 browser is connected, so a base is reserved", timeout: 20_000 },
    )
    .not.toBeNull();
  return base as unknown as string;
}

test("T.F13 / #F13 tier-5 viewer in a sandboxed frame: ACAO null assets, HMR WebSocket, no dashboard cookie or API", async ({ page, livePreview, upstream, operator, isolatedServer, dashOrigin }) => {
  await operator.gotoDashboard(page, dashOrigin); // the tab whose socket makes the reservation visible
  const base = await reserveBase(isolatedServer, upstream.port);
  const pid = base.split("/")[2];
  serveSiteUnder(upstream, base, dashOrigin);

  const seen: { url: string; status: number; acao?: string; requestHeaders: Record<string, string> }[] = [];
  page.on("response", async (res) => {
    if (!res.url().includes(`/preview/${pid}/`)) return;
    seen.push({ url: new URL(res.url()).pathname, status: res.status(), acao: (await res.allHeaders())["access-control-allow-origin"], requestHeaders: await res.request().allHeaders() });
  });

  // The frame's probe of the dashboard API: the browser never delivers an answer (no ACAO ⇒ a CORS failure; no response event).
  const apiProbes: { response: boolean; failure?: string }[] = [];
  page.on("response", (res) => {
    if (res.url().endsWith("/api/sessions") && res.frame() !== page.mainFrame()) apiProbes.push({ response: true });
  });
  page.on("requestfailed", (req) => {
    if (req.url().endsWith("/api/sessions") && req.frame() !== page.mainFrame()) apiProbes.push({ response: false, failure: req.failure()?.errorText });
  });

  const viewer = await livePreview.open(page);
  expect(await viewer.src(), "the viewer adopts the reserved pid (no second pid)").toBe(base);
  expect(await viewer.sandbox(), "tier 5 stays opaque: scripts, never same-origin").not.toContain("allow-same-origin");
  const frame = await viewer.ready("#site");

  await expect.poll(() => frame.evaluate(() => (window as unknown as { __result?: FrameResult }).__result?.hmr), { timeout: 15_000, message: "the HMR WebSocket connects" }).toBe("open");
  await expect.poll(() => frame.evaluate(() => (window as unknown as { __result?: FrameResult }).__result?.asset), { timeout: 15_000 }).toBe("asset-ok");
  const r = await frame.evaluate(() => (window as unknown as { __result?: FrameResult }).__result as FrameResult);
  expect(r.module, "module import under the base").toBe("dep-ok");
  await expect.poll(() => frame.evaluate(() => (window as unknown as { __result?: FrameResult }).__result?.api), { timeout: 15_000 }).toBe("error:TypeError");
  expect(r.cookie, "an opaque-origin frame cannot even read document.cookie").toBe("error:SecurityError");
  // The dashboard API probe was refused by CORS: nothing of /api/* is readable from the frame.
  await expect.poll(() => apiProbes.length, { message: "the frame's /api/sessions probe happened" }).toBeGreaterThan(0);
  expect(apiProbes, "no readable dashboard API response reached the frame").toEqual(apiProbes.map(() => ({ response: false, failure: "net::ERR_FAILED" })));

  // Assets answered with `ACAO: null` and were requested WITHOUT credentials.
  for (const name of ["main.js", "dep.js", "data.json"]) {
    const hit = seen.find((s) => s.url === `${base}${name}`);
    expect(hit, `the frame requested ${name}`).toBeDefined();
    expect(hit?.status).toBe(200);
    expect(hit?.acao, `ACAO for ${name}`).toBe("null");
    expect(hit?.requestHeaders.cookie, `no cookie sent for ${name}`).toBeUndefined();
    expect(hit?.requestHeaders.authorization).toBeUndefined();
  }
});

test("T.F14 / #F14 pid dropped while the viewer is open: frame requests are refused and the viewer converges on the NEW pid", async ({ page, livePreview, upstream, operator, isolatedServer, dashOrigin }) => {
  await page.clock.install();
  await operator.gotoDashboard(page, dashOrigin);
  const base = await reserveBase(isolatedServer, upstream.port);
  serveSiteUnder(upstream, base, dashOrigin);
  const viewer = await livePreview.open(page);
  expect(await viewer.src()).toBe(base);
  const frame = await viewer.ready("#site");
  await expect.poll(() => frame.evaluate(() => (window as unknown as { __result?: FrameResult }).__result?.asset), { timeout: 15_000 }).toBe("asset-ok");

  // A second holder (a paired device) joins the same pid, then is revoked.
  const targetId = (await isolatedServer.api("GET", "/api/live-server/list")).json.data.servers.find((t: { port: number }) => t.port === upstream.port).id as string;
  const device = await pairDevice(isolatedServer, "f14-holder");
  const joined = await bearerApi(isolatedServer, device.token, "POST", `/api/live-server/${targetId}/capability`, { accept: ["preview"] });
  expect(joined.json.path, "the device holds the same pid").toBe(base);
  const mark = isolatedServer.logMark();
  await revokeDevice(isolatedServer, device.id);

  // The next frame request finds the pid gone: the browser reports an opaque network failure (no ACAO on a refusal) ...
  const failed = await frame.evaluate(async (url) => {
    try {
      await fetch(url);
      return false;
    } catch {
      return true;
    }
  }, `${base}data.json`);
  expect(failed, "the asset load fails once the pid is gone").toBe(true);
  // ... and the server's answer to exactly what the frame sends (opaque `Origin: null`, no credential) is a refusal.
  const replay = await isolatedServer.rawRequest({ host: new URL(dashOrigin).host, path: `${base}data.json`, headers: { origin: "null", "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" } });
  expect([403, 404], "refused, not served").toContain(replay.status);
  // Indistinguishable from a pid that never existed (D8): same status and body for a random well-formed pid.
  const unknown = await isolatedServer.rawRequest({ host: new URL(dashOrigin).host, path: "/preview/AAAAAAAAAAAAAAAAAAAAAA/data.json", headers: { origin: "null", "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" } });
  expect({ status: replay.status, body: replay.body }).toEqual({ status: unknown.status, body: unknown.body });
  expect(replay.headers["access-control-allow-origin"], "a refusal never carries ACAO").toBeUndefined();
  expect(isolatedServer.livePreviewLog(mark).join("\n")).toMatch(/pid dropped reason=holder-revoked/);

  // The viewer's keepalive (5 min) fails on the dead pid and re-mints: the notice now shows a NEW pid.
  await page.clock.fastForward("05:30");
  await expect(page.getByTestId("live-base-path")).not.toHaveText(base, { timeout: 20_000 });
  const newBase = (await page.getByTestId("live-base-path").textContent()) ?? "";
  expect(newBase).toMatch(/^\/preview\/[A-Za-z0-9_-]{22}\/$/);
  expect(newBase).not.toBe(base);
  await expect(page.getByTestId("live-hint-base-path")).toContainText(/restart your server with this base/i);
  expect(await viewer.src(), "the frame src follows the new pid").toBe(newBase);
  await expect(page.getByTestId("live-hint-base-path")).not.toContainText(base.split("/")[2]);
  // No stale pid anywhere in the page's viewer: not in src, not in the copy button's payload.
  expect(await page.locator("[data-testid=live-iframe]").getAttribute("src")).not.toContain(base.split("/")[2]);
  await page.evaluate(() => {
    // `http://dash5.test` is not a secure context (no `navigator.clipboard`): stand one in to read what the button copies.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (t: string) => void ((window as unknown as { __copied?: string }).__copied = t) },
    });
  });
  await page.getByTestId("live-base-copy").click();
  expect(await page.evaluate(() => (window as unknown as { __copied?: string }).__copied)).toBe(newBase);
});

test("T.F15 / #F15 two tabs share one pid; a re-mint inside the 20-minute window issues a NEW pid while the old one keeps serving", async ({ context, page, livePreview, upstream, operator, isolatedServer, dashOrigin }) => {
  test.setTimeout(240_000);
  const warp = clockWarp(isolatedServer);
  const MIN = 60_000;
  try {
    // The server's pid store runs on a shiftable clock (a 12 h lifetime cannot be waited out); the browser's on Playwright's.
    await isolatedServer.restart({ env: warp.env });
    await page.clock.install();
    await operator.gotoDashboard(page, dashOrigin);
    const base = await reserveBase(isolatedServer, upstream.port);
    serveSiteUnder(upstream, base, dashOrigin);
    const tab1 = await livePreview.open(page);
    const page2 = await context.newPage();
    await page2.clock.install();
    const tab2 = await livePreview.open(page2);
    expect(await tab1.src()).toBe(base);
    expect(await tab2.src(), "tab 2 holds the same pid").toBe(base);
    await tab1.ready("#site");

    // (1) A re-mint OUTSIDE the window (the 5-minute keepalive fails on a tier-5 token and re-mints) joins the same pid.
    const remint1 = page.waitForRequest((r) => r.method() === "POST" && /\/capability$/.test(r.url())).catch(() => undefined);
    await Promise.all([page.clock.fastForward("05:30"), page2.clock.fastForward("05:30")]);
    await Promise.race([remint1, sleep(5_000)]); // the keepalive's re-mint (if the client issues one) joins the same pid
    await sleep(1_000);
    await expect(page.getByTestId("live-base-path")).toHaveText(base);
    await expect(page2.getByTestId("live-base-path")).toHaveText(base);
    expect(await tab1.src(), "pid stable across the re-mint").toBe(base);
    expect(await tab2.src()).toBe(base);
    const joined = await isolatedServer.api("POST", `/api/live-server/${(await targetIdOf(isolatedServer, upstream.port))}/capability`, { accept: ["preview"] });
    expect(joined.json.path, "the server still has exactly this pid as current").toBe(base);

    // (2) Age the pid to 10 minutes before its absolute expiry, in steps that keep it "used" (idle expiry is 30 min).
    const mark = isolatedServer.logMark();
    const TOTAL = 11 * 60 * MIN + 50 * MIN;
    for (let at = 20 * MIN; ; at += 20 * MIN) {
      const step = Math.min(at, TOTAL);
      await warp.set(step);
      const touch = await isolatedServer.api("GET", `${base}data.json`);
      expect(touch.status, `the pid keeps serving while aging (${step / MIN} min)`).toBe(200);
      if (step === TOTAL) break;
    }
    // Tab 1's viewer reaches its 10-minute lead: the re-mint lands in the last 20 minutes → a NEW pid.
    await page.clock.fastForward("11:44:30");
    await expect(page.getByTestId("live-base-path")).not.toHaveText(base, { timeout: 30_000 });
    const newBase = (await page.getByTestId("live-base-path").textContent()) ?? "";
    expect(newBase).toMatch(/^\/preview\/[A-Za-z0-9_-]{22}\/$/);
    expect(newBase).not.toBe(base);
    await expect(page.getByTestId("live-hint-base-path"), "Q9: the viewer tells the operator to restart the site on the new base").toContainText(/restart your server with this base/i);
    expect(await tab1.src(), "no silent blank: the frame follows the new base").toBe(newBase);
    await expect(tab1.iframe).toBeVisible();

    // Tab 2 reaches its own lead and joins the CURRENT pid: both tabs end up on the same new pid.
    await page2.clock.fastForward("11:44:30");
    await expect(page2.getByTestId("live-base-path")).toHaveText(newBase, { timeout: 30_000 });
    expect(await tab2.src()).toBe(newBase);
    await expect(page2.getByTestId("live-hint-base-path")).toContainText(/restart your server with this base/i);

    // The superseded pid is NOT revoked: it keeps serving its site until its own absolute expiry.
    const old = await isolatedServer.api("GET", `${base}data.json`);
    expect(old.status).toBe(200);
    expect(old.json).toEqual({ asset: "asset-ok" });
    expect(isolatedServer.livePreviewLog(mark).join("\n"), "nothing was dropped by the supersede").not.toMatch(/pid dropped/);
  } finally {
    await isolatedServer.restart({ reset: true });
  }
});

/** The registered port target's id for `port`. */
async function targetIdOf(isolatedServer: import("./isolated-server.js").IsolatedServer, port: number): Promise<string> {
  const list = (await isolatedServer.api("GET", "/api/live-server/list")).json.data.servers as { id: string; port: number }[];
  const t = list.find((x) => x.port === port);
  if (!t) throw new Error(`no target for port ${port}`);
  return t.id;
}
