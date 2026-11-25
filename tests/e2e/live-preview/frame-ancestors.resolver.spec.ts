import { expect, test } from "./fixture.js";

/**
 * L3 — another site cannot frame a preview (live-csp `frame-ancestors`), `chromium-resolver` project (tier 2).
 * Row: test-plan #F25. See change: serve-live-previews-on-capability-origin.
 *
 * `http://evil.test/` is served by Playwright route interception (no DNS needed) and embeds the preview capability URL.
 */
test("T.F25 / #F25 evil.test cannot frame a preview; the dashboard can; a direct top-level open renders but cannot read the dashboard's storage", async ({ page, context, livePreview, upstream, isolatedServer, dashOrigin }) => {
  const viewer = await livePreview.open(page);
  const previewUrl = await viewer.src();
  const previewOrigin = new URL(previewUrl).origin;
  expect(previewOrigin, "tier 2 capability origin").toMatch(/^http:\/\/[a-z2-7]{26}\.preview\.test:\d+$/);

  // The dashboard frames it fine (positive control) …
  const frame = await viewer.ready("#static");
  expect(await frame.evaluate(() => location.origin)).toBe(previewOrigin);

  // … the header names exactly the dashboard origin + the preview origin as allowed ancestors (never evil.test, never `*`).
  const head = await isolatedServer.rawRequest({ host: new URL(previewUrl).host, path: new URL(previewUrl).pathname });
  const csp = String(head.headers["content-security-policy"] ?? "");
  const fa = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("frame-ancestors"));
  expect(fa, "preview response carries frame-ancestors").toBeDefined();
  expect(fa).toContain(dashOrigin);
  expect(fa).not.toMatch(/evil\.test|\*(?!\.)/);

  // Seed the dashboard origin's storage with a sentinel the preview must never see.
  await page.evaluate(() => localStorage.setItem("__f25_secret", "dashboard-only"));

  // evil.test embeds the preview.
  const evil = await context.newPage();
  await evil.route("http://evil.test/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><iframe id="victim" src="${previewUrl}" width="400" height="300"></iframe>` }),
  );
  await evil.goto("http://evil.test/");
  // A frame refused by `frame-ancestors` becomes the browser's error document (it never navigates to the preview).
  await expect.poll(() => evil.frames().some((f) => f.url().startsWith("chrome-error://")), { message: "frame blocked by frame-ancestors", timeout: 15_000 }).toBe(true);
  const child = evil.frames().find((f) => f !== evil.mainFrame());
  expect(child, "the iframe exists").toBeDefined();
  expect(child?.url() ?? "", "the blocked frame never became the preview").toBe("chrome-error://chromewebdata/");
  expect(await evil.locator("#victim").count()).toBe(1);
  expect(await evil.frameLocator("#victim").locator("#static").count(), "the preview document never rendered inside evil.test").toBe(0);
  await evil.close();

  // Direct top-level open of the preview URL: renders, but it is its own origin (not the dashboard's storage/API).
  const top = await context.newPage();
  const res = await top.goto(previewUrl);
  expect(res?.status()).toBe(200);
  await expect(top.locator("#static")).toHaveText("static upstream");
  const view = await top.evaluate(async (dash) => {
    let api = "";
    try {
      api = String((await fetch(`${dash}/api/health`, { credentials: "include" })).status);
    } catch (e) {
      api = `error:${(e as Error).name}`;
    }
    return { origin: location.origin, secret: localStorage.getItem("__f25_secret"), api };
  }, dashOrigin);
  expect(view.origin).toBe(previewOrigin);
  expect(view.secret, "the preview cannot read the dashboard origin's localStorage").toBeNull();
  expect(view.api, "nor the dashboard API (CORS)").toBe("error:TypeError");
  expect(upstream.requests.some((r) => r.url === "/"), "the upstream served it").toBe(true);
  await top.close();
});
