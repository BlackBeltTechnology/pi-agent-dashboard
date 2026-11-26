import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixture.js";
import { expectPanesReported, LP_MOCK, type LpMock, openPresetPreview, paneRing, startLpMock, watchForbiddenConsole } from "./mock-site.js";

/**
 * L3 — the live-component MOCK SITE framed on tier 1 (`http://<label>.localhost:<port>/`) by the host-run isolated
 * dashboard (loopback peer). Rows: test-plan #F31 (acceptance fixture T1), #F33 (root-absolute escape, T1 half),
 * #F42 (Open ↗, T1 half), #F49 (HMR through T1), #F56 (copied ring link, real origin), #F57 (dash host variants, 127.0.0.1).
 * The mock site runs on the host (free port) exactly as `serve_mock_site` starts it. See change:
 * serve-live-previews-on-capability-origin (tasks 14.2, 11.x).
 */

let mock: LpMock;
test.beforeEach(async () => {
  mock = await startLpMock();
});
test.afterEach(async () => {
  await mock.dispose();
});

const LABEL_ORIGIN = (port: number) => new RegExp(`^http://[a-z2-7]{26}\\.localhost:${port}$`);

test("T.F31 / #F31 the mock site renders on tier 1: label origin, same-origin sandbox, panes and rings, storage persists", async ({ page, livePreview, isolatedServer }) => {
  const console_ = watchForbiddenConsole(page);
  const viewer = await livePreview.open(page, { target: mock.url });
  expect(await viewer.src()).toMatch(new RegExp(`^http://[a-z2-7]{26}\\.localhost:${isolatedServer.port}/$`));
  expect(await viewer.sandbox()).toContain("allow-same-origin");

  // Ring list + Current/Proposed nested panes (isolated `?pane=` iframes) render; a ring is visible inside a nested pane.
  await expect(viewer.frameLocator.locator(".mk-frame")).toHaveCount(3, { timeout: 30_000 });
  await expectPanesReported(viewer);
  await expect(paneRing(viewer, 1, "current")).toBeVisible();
  await expect(paneRing(viewer, 1, "proposed")).toBeVisible();

  // The `localStorage` toggle (Highlights) persists across a viewer reload of the same origin.
  const toggle = viewer.frameLocator.getByLabel("Highlights");
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  const frame = await viewer.frame();
  expect(await frame.evaluate(() => localStorage.getItem("mk-rings"))).toBe("off");
  await page.getByTestId("live-reload").click();
  await expect(viewer.frameLocator.locator(".mk-frame")).toHaveCount(3, { timeout: 30_000 });
  await expect(viewer.frameLocator.getByLabel("Highlights")).not.toBeChecked();
  expect(await (await viewer.frame()).evaluate(() => localStorage.getItem("mk-rings"))).toBe("off");

  expect(console_.hits, "forbidden console output").toEqual([]);
});

test("T.F33 / #F33 a Vite mock site on tier 1 makes no root-absolute request to the dashboard origin; modules load from the preview origin", async ({ page, livePreview, isolatedServer }) => {
  const dash = isolatedServer.origin("localhost");
  const console_ = watchForbiddenConsole(page);
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  const viewer = await livePreview.open(page, { target: mock.url });
  await expectPanesReported(viewer);
  const previewOrigin = await viewer.srcOrigin();

  const ESCAPE = /^\/(@vite|@react-refresh|@fs|src|node_modules)(\/|$)/;
  const toDash = urls.filter((u) => u.startsWith(`${dash}/`) && ESCAPE.test(new URL(u).pathname));
  expect(toDash, "requests to dashboard-origin module paths").toEqual([]);
  const modules = urls.filter((u) => ESCAPE.test(new URL(u).pathname));
  expect(modules.length, "the site's module requests were observed").toBeGreaterThan(3);
  for (const u of modules) expect(new URL(u).origin, `module request ${u}`).toBe(previewOrigin);
  expect(modules.some((u) => new URL(u).pathname.startsWith("/@vite/client"))).toBe(true);
  expect(modules.some((u) => new URL(u).pathname.startsWith("/@react-refresh"))).toBe(true);
  expect(modules.some((u) => new URL(u).pathname.startsWith("/@fs/"))).toBe(true);
  expect(console_.hits, "forbidden console output (CORS / origin 'null')").toEqual([]);
});

test("T.F42 / #F42 Open ↗ on tier 1 opens the frame URL in a new tab that renders the mock (not the raw :port target)", async ({ page, context, operator, isolatedServer, dashOrigin }) => {
  // An AGENT-declared (`preset`) target, as `canvas()` / `serve_mock_site` registers it. (A user-added loopback target on a local
  // operator deliberately opens its own raw URL, `localTargetUrl`; the capability mint is the agent-preset path.)
  const viewer = await openPresetPreview(page, operator, isolatedServer, dashOrigin, mock.port);
  await expect(viewer.frameLocator.locator(".mk-frame").first()).toBeVisible({ timeout: 30_000 });
  const src = await viewer.src();
  const popupPromise = context.waitForEvent("page");
  await page.getByTestId("live-open").click();
  const popup = await popupPromise;
  await popup.waitForURL((u) => u.href !== "about:blank", { timeout: 20_000 }); // opened synchronously, navigated once the mint answers
  expect(popup.url()).toBe(src);
  expect(new URL(popup.url()).origin).toMatch(LABEL_ORIGIN(Number(new URL(src).port)));
  expect(popup.url().startsWith(`${mock.url}/`), "Open ↗ must not hand out the raw upstream URL").toBe(false);
  expect(popup.url()).not.toContain("localhost:5299");
  await expect(popup.locator(".mk-frame").first()).toBeVisible({ timeout: 30_000 });
  await expect(popup.getByText("LP preview mock v1").first()).toBeVisible();
  await popup.close();
});

/** The pane iframe `Frame` of `<LP_MOCK>/<n>/<side>`. */
const paneFrame = (page: Page, n: number, side: string): Frame => {
  const f = page.frames().find((fr) => fr.url().includes(`pane=${encodeURIComponent(`${LP_MOCK}/${n}/${side}`)}`));
  if (!f) throw new Error(`pane frame ${n}/${side} not found`);
  return f;
};

test("T.F56 / #F56 a copied ring link on tier 1 starts with the real origin (href minus hash plus #ring)", async ({ page, livePreview }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __copied: string[] };
    w.__copied = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (t: string) => (w.__copied.push(t), Promise.resolve()) } });
  });
  const viewer = await livePreview.open(page, { target: mock.url });
  await expectPanesReported(viewer);
  const frame = paneFrame(page, 1, "current");
  await frame.evaluate(() => document.addEventListener("click", (e) => e.preventDefault())); // keep the `target=_top` link from navigating
  await viewer.frameLocator.frameLocator(`iframe[data-pane="${LP_MOCK}/1/current"]`).locator(".mk-ring-n").first().click();
  const ring = `${LP_MOCK}/1/current/1`;
  const copied = await frame.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
  expect(copied).toEqual([`${frame.url().split("#")[0]}#${ring}`]);
  expect(copied[0].startsWith(await viewer.srcOrigin())).toBe(true);
  expect(copied[0].startsWith("null")).toBe(false);
});

test("T.F57 / #F57 dash reached as 127.0.0.1 mints tier 1 (label.localhost frame), mock renders, no frame-src CSP violation", async ({ page, livePreview, isolatedServer }) => {
  const violations: string[] = [];
  await page.exposeFunction("__lpViolation", (v: string) => violations.push(v));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __lpViolation: (v: string) => void }).__lpViolation(`${e.violatedDirective}|${e.blockedURI}`)));
  const reports: string[] = [];
  page.on("request", (r) => r.url().includes("/__pi/csp-report") && reports.push(r.postData() ?? ""));
  const viewer = await livePreview.open(page, { dashHost: "127.0.0.1", target: mock.url });
  expect(await viewer.src()).toMatch(new RegExp(`^http://[a-z2-7]{26}\\.localhost:${isolatedServer.port}/$`));
  await expect(viewer.frameLocator.locator(".mk-frame").first()).toBeVisible({ timeout: 30_000 });
  await expectPanesReported(viewer);
  await page.waitForTimeout(1_000);
  expect(violations.filter((v) => v.startsWith("frame-src")), `violations: ${violations.join(", ")}`).toEqual([]);
  expect(reports.filter((b) => /frame-src/.test(b)), "csp-report bodies naming frame-src").toEqual([]);
});

test.describe("T.F49 / #F49 HMR through tier 1", () => {
  test.describe.configure({ timeout: 150_000 });

  test("(a) a source edit updates the pane over a 101 WebSocket on the label origin; (b) a restarted mock site reconnects and reloads without a manual refresh", async ({ page, livePreview }) => {
    const sockets: { url: string; received: string[]; error?: string }[] = [];
    page.on("websocket", (w) => {
      const rec = { url: w.url(), received: [] as string[], error: undefined as string | undefined };
      sockets.push(rec);
      w.on("framereceived", (f) => rec.received.push(String(f.payload)));
      w.on("socketerror", (e) => { rec.error = e; });
    });
    const viewer = await livePreview.open(page, { target: mock.url });
    await expectPanesReported(viewer);
    const labelHost = new URL(await viewer.src()).host;
    const hmrUrl = `ws://${labelHost}/?token=`;
    const labelSockets = () => sockets.filter((s) => s.url.startsWith(`ws://${labelHost}/`));

    // (a) edit → HMR update reaches the page; the socket upgraded (Vite's first frame is `{"type":"connected"}`).
    await expect.poll(() => labelSockets().length, { message: `a WebSocket to ws://${labelHost}/ (${hmrUrl}…)` }).toBeGreaterThan(0);
    await expect.poll(() => labelSockets().some((s) => s.received.some((m) => m.includes('"connected"'))), { message: "Vite handshake over the proxied upgrade (101)" }).toBe(true);
    expect(labelSockets().every((s) => s.error === undefined), "socket errors").toBe(true);
    mock.edit("v2");
    await expect(viewer.frameLocator.getByText("LP preview mock v2").first()).toBeVisible({ timeout: 30_000 });
    await expect(viewer.frameLocator.frameLocator(`iframe[data-pane="${LP_MOCK}/1/proposed"]`).getByText("proposed ring v2")).toBeVisible({ timeout: 30_000 });

    // (b) kill and restart the site on the same port: the Vite client reconnects, reloads, and rings render again.
    const shell = await viewer.frame();
    await shell.evaluate(() => ((window as unknown as { __beforeRestart: boolean }).__beforeRestart = true));
    await mock.stop();
    await expect.poll(() => fetch(`${mock.url}/`).then(() => true, () => false), { timeout: 15_000 }).toBe(false);
    await mock.restart();
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
