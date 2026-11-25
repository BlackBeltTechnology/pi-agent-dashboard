import { WebSocket } from "ws";
import { expect, test } from "./fixture.js";

/**
 * L3 — a tier-1 preview page is isolated from the dashboard (host-run isolated server).
 * Rows: test-plan #F28 (server-cors), #F27 + #F37 (nested dashboard renders nothing), #F36 (D7 navigation guard).
 * See change: serve-live-previews-on-capability-origin (tasks 14.2).
 */

/** `window.__result` convention of the scripts the specs inject into the preview page. */
interface PreviewWindow {
  __result?: Record<string, unknown>;
}

test("T.F28 / #F28 a tier-1 preview page cannot read the dashboard API nor open its WebSocket", async ({ page, livePreview, upstream, isolatedServer }) => {
  const dash = isolatedServer.origin("localhost");
  // `?probe=f28` tells the preview page's socket apart from the dashboard SPA's own `/ws`.
  const dashWs = `${dash.replace("http", "ws")}/ws?probe=f28`;
  upstream.script = `
    window.__result = {};
    fetch(${JSON.stringify(`${dash}/api/health`)}, { credentials: "include" })
      .then((r) => { window.__result.fetch = "resolved:" + r.status; })
      .catch((e) => { window.__result.fetch = "error:" + e.name; });
    // A cross-origin "simple" mutation (no preflight): the server must refuse it, never act on it.
    fetch(${JSON.stringify(`${dash}/api/live-server/start`)}, { method: "POST", credentials: "include", headers: { "content-type": "text/plain" }, body: "{}" })
      .then((r) => { window.__result.post = "resolved:" + r.status; })
      .catch((e) => { window.__result.post = "error:" + e.name; });
    var ws = new WebSocket(${JSON.stringify(dashWs)});
    ws.onopen = function () { window.__result.ws = "open"; };
    ws.onclose = function (e) { window.__result.wsClosed = e.code; };
  `;
  const label: { origin: string } = { origin: "" };
  // Requests the PREVIEW frame made to the dashboard (they carry `Origin: <label>.localhost`).
  const fromPreview: { method: string; url: string; headers: Record<string, string>; status?: number; acao?: string }[] = [];
  page.on("requestfinished", async (r) => {
    if (!r.url().startsWith(`${dash}/api/`) || (await r.allHeaders()).origin !== label.origin) return;
    const res = await r.response();
    fromPreview.push({ method: r.method(), url: r.url(), headers: await r.allHeaders(), status: res?.status(), acao: (await res?.allHeaders())?.["access-control-allow-origin"] });
  });
  const sockets: { url: string; error?: string }[] = [];
  page.on("websocket", (w) => {
    if (w.url() !== dashWs) return;
    const rec: { url: string; error?: string } = { url: w.url() };
    sockets.push(rec);
    w.on("socketerror", (e) => { rec.error = e; });
  });

  const viewer = await livePreview.open(page);
  label.origin = await viewer.srcOrigin();
  const frame = await viewer.ready("#static");

  // fetch: CORS-blocked — the page only ever sees an opaque failure; the WebSocket never opens.
  await expect.poll(() => frame.evaluate(() => (window as unknown as PreviewWindow).__result?.fetch), { timeout: 15_000 }).toBe("error:TypeError");
  await expect.poll(() => frame.evaluate(() => (window as unknown as PreviewWindow).__result?.wsClosed), { timeout: 15_000 }).toBeDefined();
  expect(await frame.evaluate(() => (window as unknown as PreviewWindow).__result?.ws), "WebSocket must never open").toBeUndefined();
  expect(await frame.evaluate(() => (window as unknown as PreviewWindow).__result?.post), "cross-origin POST is never readable").not.toMatch(/^resolved:2/);

  // Server side: whatever reached it from the label origin is unreadable (no ACAO), anonymous (the
  // SameSite=strict operator cookie is not sent cross-site) and — for the mutation — refused.
  for (const r of fromPreview) {
    expect(r.acao, `ACAO on ${r.method} ${r.url}`).toBeUndefined();
    expect(r.headers.cookie, "no operator credential rides a cross-site request").toBeUndefined();
    if (r.method !== "GET") expect(r.status, `${r.method} ${r.url} from a label Origin`).toBeGreaterThanOrEqual(400);
  }
  // WS: the browser's handshake fails (Chromium names the 403, Firefox only reports an abnormal close)…
  expect(sockets.length, "the preview opened a socket to the dashboard /ws").toBeGreaterThan(0);
  await expect.poll(() => sockets.every((s) => s.error !== undefined), { message: "socketerror reported", timeout: 5_000 }).toBe(true);
  for (const s of sockets) expect(s.error, "WS handshake must fail").toMatch(/403|CLOSE_ABNORMAL/);
  // …and the server's own answer to `Origin: <label>` on the upgrade is 403 (checked raw, browser-independent).
  const handshake = await new Promise<string>((resolve) => {
    const ws = new WebSocket(dashWs, { headers: { origin: label.origin } });
    ws.on("unexpected-response", (_req, res) => resolve(`status ${res.statusCode}`));
    ws.on("open", () => { ws.close(); resolve("open"); });
    ws.on("error", (e) => resolve(`error ${e.message}`));
  });
  expect(handshake).toBe("status 403");
});

/** Dashboard `/ws` sockets the page has opened so far (the SPA's own socket included — compare deltas). */
const trackDashSockets = (page: import("@playwright/test").Page, dashWsUrl: RegExp) => {
  const urls: string[] = [];
  page.on("websocket", (w) => dashWsUrl.test(w.url()) && urls.push(w.url()));
  return urls;
};

/** Tell the preview page (its script waits for `postMessage("go")`) to run its payload now, after listeners are armed. */
const go = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (document.querySelector('[data-testid="live-iframe"]') as HTMLIFrameElement).contentWindow?.postMessage("go", "*"));
const onGo = (body: string) => `window.addEventListener("message", function (e) { if (e.data !== "go") return; ${body} });`;

for (const [row, nestedHost] of [
  ["T.F27 / #F27", "localhost"],
  ["T.F37 / #F37", "127.0.0.1"],
] as const) {
  test(`${row} a dashboard framed inside a tier-1 preview (nested as ${nestedHost}) renders nothing and opens no /ws`, async ({ page, livePreview, upstream, isolatedServer }) => {
    const nested = `${isolatedServer.origin(nestedHost)}/`;
    upstream.script = onGo(`var f = document.createElement("iframe"); f.id = "nested-dash"; f.src = ${JSON.stringify(nested)}; document.body.appendChild(f);`);
    const sockets = trackDashSockets(page, /\/ws(\?|$)/);
    const apiFromNested: string[] = [];
    const viewer = await livePreview.open(page);
    const previewFrame = await viewer.ready("#static");
    const wsBefore = sockets.length; // the dashboard's own socket; nothing nested exists yet
    page.on("request", (r) => r.frame() !== page.mainFrame() && r.url().startsWith(nested.slice(0, -1)) && /\/(api|ws)(\/|\?|$)/.test(new URL(r.url()).pathname) && apiFromNested.push(r.url()));
    await go(page);
    await expect.poll(() => page.frames().some((f) => f !== page.mainFrame() && f.url().startsWith(nested)), { message: "nested dashboard frame loaded" }).toBe(true);
    const nestedFrame = page.frames().find((f) => f !== page.mainFrame() && f.url().startsWith(nested));
    if (!nestedFrame) throw new Error("nested dashboard frame missing");
    await page.waitForTimeout(2_500); // let a (wrongly) booting SPA open its socket / call the API

    expect(await nestedFrame.evaluate(() => document.getElementById("root")?.childElementCount ?? 0), "nested SPA root is empty").toBe(0);
    expect(apiFromNested, "nested dashboard made API/WS calls").toEqual([]);
    expect(sockets.length - wsBefore, "no new /ws socket after the nested frame loaded").toBe(0);
    // The preview itself still works.
    await expect(previewFrame.locator("#static")).toHaveText("static upstream");
  });
}

test("T.F36 / #F36 the preview navigating itself to the dashboard is blanked and blocked (plain http)", async ({ page, livePreview, upstream, isolatedServer }) => {
  const dashOrigin = isolatedServer.origin("localhost");
  upstream.script = onGo(`location.href = ${JSON.stringify(`${dashOrigin}/`)};`);
  const sockets = trackDashSockets(page, /\/ws(\?|$)/);
  // Sample the framed dashboard document's SPA root for as long as it lives (the viewer blanks it on `load`).
  const roots: number[] = [];
  const framedApi: string[] = [];
  page.on("request", (r) => r.frame() !== page.mainFrame() && r.url().startsWith(dashOrigin) && /\/(api|ws)(\/|\?|$)/.test(new URL(r.url()).pathname) && framedApi.push(r.url()));
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame() || !f.url().startsWith(dashOrigin)) return;
    void (async () => {
      for (let i = 0; i < 20; i++) {
        roots.push(await f.evaluate(() => document.getElementById("root")?.childElementCount ?? 0).catch(() => -1));
        await new Promise((r) => setTimeout(r, 50));
      }
    })();
  });

  const viewer = await livePreview.open(page);
  await viewer.ready("#static");
  const wsBefore = sockets.length; // the dashboard's own socket
  await go(page);
  await expect(page.getByTestId("live-navigated")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("live-navigated")).toContainText(/navigated to the dashboard/i);
  await expect(viewer.iframe).toHaveAttribute("src", "about:blank");
  await page.waitForTimeout(1_500);

  expect(roots.length, "the framed dashboard document was observed").toBeGreaterThan(0);
  expect(Math.max(...roots), "framed dashboard rendered an SPA root").toBeLessThanOrEqual(0);
  expect(sockets.length - wsBefore, "framed dashboard opened a /ws").toBe(0);
  expect(framedApi, "framed dashboard made API/WS calls").toEqual([]);
  // No `allow-same-origin` dashboard document is left in the pane.
  expect(page.frames().filter((f) => f !== page.mainFrame()).map((f) => f.url()).filter((u) => u.startsWith(dashOrigin))).toEqual([]);
});
