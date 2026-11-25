import type { Page, Request, Response } from "@playwright/test";
import { expect, test } from "./fixture.js";

/**
 * L3 — navigation guard + redirect containment of a tier-1 preview (host-run isolated server).
 * Rows: test-plan #F38 (D6(a)/(b) object/embed/iframe), #F39 (guard false positive), #F40 (D3(c) Refresh / Location /
 * meta refresh), #F41 (D7 guard recovery). Client guard: `packages/client/src/lib/live-preview/frame-guard.ts` + the
 * `LiveFrame` same-origin-readable probe; server D3(c) header rewriting: the live-server proxy.
 * See change: serve-live-previews-on-capability-origin (tasks 14.2).
 */

/** Tell the preview page (its script waits for `postMessage("go")`) to run its payload now, after listeners are armed. */
const go = (page: Page) => page.evaluate(() => (document.querySelector('[data-testid="live-iframe"]') as HTMLIFrameElement).contentWindow?.postMessage("go", "*"));
const onGo = (body: string) => `window.addEventListener("message", function (e) { if (e.data !== "go") return; ${body} });`;

/** Frames (other than the dashboard page itself) currently at the dashboard origin. */
const dashFrames = (page: Page, dash: string) => page.frames().filter((f) => f !== page.mainFrame() && f.url().startsWith(dash));
const spaRoot = (f: ReturnType<Page["frames"]>[number]) => f.evaluate(() => document.getElementById("root")?.childElementCount ?? 0).catch(() => -1);
const mintCount = (page: Page) => {
  const posts: string[] = [];
  page.on("request", (r: Request) => r.method() === "POST" && /\/api\/live-server\/[^/]+\/capability$/.test(new URL(r.url()).pathname) && posts.push(r.url()));
  return posts;
};

test("T.F38 / #F38 a preview embedding the dashboard via <object>, <embed> and <iframe> gets no dashboard UI in any of them", async ({ page, livePreview, upstream, isolatedServer }) => {
  const dash = isolatedServer.origin("localhost");
  const nested = `${dash}/`;
  // The preview CSP carries `object-src 'none'`: object/embed are refused by the browser (a violation, no document);
  // the nested <iframe> loads the dashboard document, which the client boot guard must leave empty (frameElement is null cross-origin).
  upstream.script = `
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", function (e) { window.__csp.push(e.violatedDirective.split(" ")[0] + "|" + e.blockedURI); });
    ${onGo(`
      var o = document.createElement("object"); o.id = "n-object"; o.data = ${JSON.stringify(nested)}; o.type = "text/html"; document.body.appendChild(o);
      var m = document.createElement("embed"); m.id = "n-embed"; m.src = ${JSON.stringify(nested)}; m.type = "text/html"; document.body.appendChild(m);
      var f = document.createElement("iframe"); f.id = "n-iframe"; f.src = ${JSON.stringify(nested)}; document.body.appendChild(f);
    `)}
  `;
  const nestedApi: string[] = [];
  const sockets: string[] = [];
  const nestedDocs: string[] = [];
  page.on("request", (r) => {
    if (r.frame() === page.mainFrame()) return;
    const u = new URL(r.url());
    if (r.url() === nested && r.resourceType() === "document") nestedDocs.push(r.url());
    else if (r.url().startsWith(dash) && /\/(api|ws)(\/|\?|$)/.test(u.pathname)) nestedApi.push(r.url());
  });
  page.on("websocket", (w) => w.url().startsWith(dash.replace("http", "ws")) && sockets.push(w.url()));

  const viewer = await livePreview.open(page);
  const previewFrame = await viewer.ready("#static");
  const wsBefore = sockets.length; // the dashboard's own socket
  await go(page);
  await expect(page.locator("body")).toBeVisible();
  await expect.poll(() => dashFrames(page, dash).length, { message: "the nested <iframe> dashboard loaded", timeout: 20_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(2_500); // let a (wrongly) booting SPA render / open its socket
  // Every nested dashboard document (whichever element created it) is blank: no SPA root, no app bar.
  for (const f of dashFrames(page, dash)) {
    expect(await spaRoot(f), `nested dashboard document ${f.url()} rendered its SPA`).toBeLessThanOrEqual(0);
    expect(await f.getByTestId("header-app-bar").count()).toBe(0);
  }
  // object/embed never produce a dashboard document: refused by `object-src 'none'` (the browser's own report).
  const violations = await previewFrame.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
  expect(violations.filter((v) => v.startsWith("object-src|")), `CSP reports: ${violations.join(", ")}`.slice(0, 300)).toHaveLength(2);
  expect(nestedDocs.length, "only the <iframe> fetched the dashboard document").toBe(1);
  expect(nestedApi, "nested dashboard made API/WS calls").toEqual([]);
  expect(sockets.length - wsBefore, "nested dashboard opened a /ws").toBe(0);
  await expect(page.getByTestId("header-app-bar")).toBeVisible(); // the real dashboard is untouched
  await expect(previewFrame.locator("#static")).toHaveText("static upstream");
});

test("T.F39 / #F39 a legitimate same-origin dashboard iframe (non-top, frameElement without the live attribute) still renders", async ({ page, operator, isolatedServer }) => {
  const dash = isolatedServer.origin("localhost");
  await operator.gotoDashboard(page, dash);
  const embedded = await page.evaluate(
    (src) =>
      new Promise<{ ok: boolean; hasFrameEl: boolean; attr: boolean }>((resolve) => {
        const f = document.createElement("iframe");
        f.id = "in-app-dash";
        f.src = src;
        f.style.cssText = "position:fixed;inset:0;width:900px;height:600px;z-index:99999";
        f.onload = () => {
          const w = f.contentWindow as Window;
          resolve({ ok: true, hasFrameEl: w.frameElement === f, attr: f.hasAttribute("data-pi-live-frame") });
        };
        document.body.appendChild(f);
      }),
    `${dash}/`,
  );
  expect(embedded).toEqual({ ok: true, hasFrameEl: true, attr: false });
  // The guard must not blank it: the SPA boots (root has children) and the app bar renders inside the frame.
  const inner = page.frameLocator("#in-app-dash");
  await expect(inner.getByTestId("header-app-bar")).toBeVisible({ timeout: 30_000 });
  const frame = page.frames().find((f) => f !== page.mainFrame() && f.url().startsWith(dash));
  if (!frame) throw new Error("embedded dashboard frame missing");
  expect(await spaRoot(frame), "embedded same-origin dashboard SPA root").toBeGreaterThan(0);
});

test.describe("T.F40 / #F40 D3(c) redirect containment (the upstream tries to send the frame to the dashboard)", () => {
  /** Documents the browser fetched from the label origin (the preview) — status + the headers that matter. */
  const trackPreviewDocs = (page: Page, dash: string) => {
    const docs: { url: string; status: number; location?: string; refresh?: string }[] = [];
    page.on("response", async (r: Response) => {
      const u = r.url();
      if (u.startsWith(dash) || !/\.localhost:\d+\//.test(u) || r.request().resourceType() !== "document") return;
      const h = await r.allHeaders();
      docs.push({ url: u, status: r.status(), location: h.location, refresh: h.refresh });
    });
    return docs;
  };

  test("(i) a `Refresh: 0; url=<dash>/x` response header is dropped and the frame stays on the preview", async ({ page, livePreview, upstream, isolatedServer }) => {
    const dash = isolatedServer.origin("localhost");
    upstream.route("/", (_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", refresh: `0; url=${dash}/x`, "cache-control": "no-store" });
      res.end(`<!doctype html><h1 id="static">refresh header upstream</h1>`);
    });
    const docs = trackPreviewDocs(page, dash);
    const viewer = await livePreview.open(page);
    const frame = await viewer.ready("#static");
    await page.waitForTimeout(3_000); // a forwarded `Refresh: 0` would have fired by now
    expect(docs.length, "the preview document was fetched").toBeGreaterThan(0);
    for (const d of docs) expect(d.refresh, `Refresh header leaked on ${d.url}`).toBeUndefined();
    expect(frame.url().startsWith(dash), "frame left the preview").toBe(false);
    expect(dashFrames(page, dash)).toEqual([]);
    await expect(viewer.frameLocator.locator("#static")).toHaveText("refresh header upstream");
    await expect(page.getByTestId("live-navigated")).toHaveCount(0);
  });

  test("(ii) a `302 Location: <dash>/x` is not delivered unchanged", async ({ page, livePreview, upstream, isolatedServer }) => {
    const dash = isolatedServer.origin("localhost");
    upstream.route("/", (_req, res) => {
      res.writeHead(302, { location: `${dash}/x`, "cache-control": "no-store" });
      res.end();
    });
    const docs = trackPreviewDocs(page, dash);
    const dashHits: string[] = [];
    page.on("request", (r) => r.frame() !== page.mainFrame() && r.url().startsWith(`${dash}/x`) && dashHits.push(r.url()));
    await livePreview.open(page);
    await expect.poll(() => docs.length, { message: "the preview document was answered", timeout: 20_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(2_500);
    for (const d of docs) {
      const unchanged = d.status >= 300 && d.status < 400 && d.location?.startsWith(dash);
      expect(unchanged, `a ${d.status} Location ${d.location} reached the browser unchanged`).toBeFalsy();
    }
    // Either a 502 (refused) or a preview-origin Location — and in both cases the frame never follows it into the dashboard.
    expect(docs.some((d) => d.status === 502 || (d.status >= 300 && d.status < 400 && !!d.location && !d.location.startsWith(dash))), `answers: ${JSON.stringify(docs)}`).toBe(true);
    expect(dashHits, "the browser requested the dashboard URL named by the upstream").toEqual([]);
    expect(dashFrames(page, dash)).toEqual([]);
  });

  test("(iii) a meta-refresh to the dashboard navigates, then the guard converges to about:blank and the blocked notice", async ({ page, livePreview, upstream, isolatedServer }) => {
    const dash = isolatedServer.origin("localhost");
    upstream.route("/", `<!doctype html><meta http-equiv="refresh" content="0;url=${dash}/"><h1 id="static">meta refresh upstream</h1>`);
    const sockets: string[] = [];
    page.on("websocket", (w) => w.url().startsWith(dash.replace("http", "ws")) && sockets.push(w.url()));
    const viewer = await livePreview.open(page);
    await expect(page.getByTestId("live-navigated")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("live-navigated")).toContainText(/navigated to the dashboard/i);
    await expect(viewer.iframe).toHaveAttribute("src", "about:blank");
    await page.waitForTimeout(1_000);
    expect(dashFrames(page, dash).map((f) => f.url()).filter((u) => u !== "about:blank")).toEqual([]);
  });
});

test("T.F41 / #F41 guard recovery: the blocked notice stays until Reload; Reload re-frames and clears it; the guard fires again; no automatic re-mint", async ({ page, livePreview, upstream, isolatedServer }) => {
  const dash = isolatedServer.origin("localhost");
  upstream.script = onGo(`location.href = ${JSON.stringify(`${dash}/`)};`);
  const mints = mintCount(page);
  const viewer = await livePreview.open(page);
  await viewer.ready("#static");
  const notice = page.getByTestId("live-navigated");
  const reload = page.getByTestId("live-navigated-reload");

  // 1st block.
  await go(page);
  await expect(notice).toBeVisible({ timeout: 20_000 });
  await expect(viewer.iframe).toHaveAttribute("src", "about:blank");
  const mintsAtBlock = mints.length;
  // Stays blocked on its own: no timer, no re-open, no automatic re-mint (Q43).
  await page.waitForTimeout(3_000);
  await expect(notice).toBeVisible();
  await expect(viewer.iframe).toHaveAttribute("src", "about:blank");
  expect(mints.length, "an automatic re-mint happened while blocked").toBe(mintsAtBlock);

  // Reload re-frames the preview and clears the notice.
  await reload.click();
  await expect(notice).toHaveCount(0);
  await expect(viewer.iframe).not.toHaveAttribute("src", "about:blank");
  await viewer.ready("#static");
  await expect(viewer.frameLocator.locator("#static")).toHaveText("static upstream");

  // The guard fires again on a repeat navigation.
  await go(page);
  await expect(notice).toBeVisible({ timeout: 20_000 });
  await expect(viewer.iframe).toHaveAttribute("src", "about:blank");
  expect(dashFrames(page, dash).map((f) => f.url()).filter((u) => u !== "about:blank")).toEqual([]);
});
