import { expect, test } from "./fixture.js";
import { reserveBaseVia, startLpMock } from "./mock-site.js";
import { sleep } from "./tier5-helpers.js";

/**
 * L3 — a Vite dev server (the live-component mock site) previewed in the opaque-origin tier-5 frame (`Origin: null`):
 * its module scripts load because the preview proxy answers `ACAO: null`, no CORS console errors; the same request shape
 * at `/api/…` gets no ACAO. `chromium-resolver` project (dashboard `dash5.test`).
 * Row: test-plan #F29. See change: serve-live-previews-on-capability-origin (server-cors, D8).
 */
test("T.F29 / #F29 tier-5 Vite module scripts load with ACAO: null (Origin: null); /api gets no ACAO for the same Origin", async ({ page, operator, isolatedServer, livePreview }) => {
  test.setTimeout(240_000);
  const dash = isolatedServer.origin("dash5.test");
  await operator.gotoDashboard(page, dash);
  const events = reserveBaseVia(isolatedServer);
  let mock: Awaited<ReturnType<typeof startLpMock>> | undefined;
  for (let i = 0; i < 20 && !mock?.base; i++) {
    await mock?.stop();
    mock = await startLpMock({ events });
    if (!mock.base) await sleep(500);
  }
  if (!mock?.base) throw new Error("no tier-5 base was reserved (is a tier-5-capable viewer connected?)");
  try {
    const base = mock.base;
    const scripts: { path: string; status: number; acao?: string; origin?: string }[] = [];
    const consoleErrors: string[] = [];
    page.on("response", async (res) => {
      const u = new URL(res.url());
      if (u.origin !== dash || !u.pathname.startsWith(base) || res.request().resourceType() !== "script") return;
      scripts.push({ path: u.pathname, status: res.status(), acao: (await res.allHeaders())["access-control-allow-origin"], origin: (await res.request().allHeaders()).origin });
    });
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });

    const viewer = await livePreview.open(page, { dashHost: "dash5.test", target: mock.url });
    expect(await viewer.sandbox(), "opaque frame: Origin is `null`").not.toContain("allow-same-origin");
    const frame = await viewer.ready("#root");
    await expect(frame.locator("body"), "the Vite app rendered (module scripts executed)").toContainText("LP preview mock");

    expect(scripts.length, "module scripts were requested through the proxy").toBeGreaterThan(0);
    expect(scripts.some((s) => s.path.endsWith("/@vite/client")), "Vite's client module").toBe(true);
    expect(scripts.some((s) => s.origin === "null"), "scripts were requested with Origin: null").toBe(true);
    for (const s of scripts) {
      expect(s.status, `${s.path} loads`).toBe(200);
      if (s.origin === "null") expect(s.acao, `${s.path}: ACAO null honoured`).toBe("null");
    }
    expect(consoleErrors.filter((t) => /cors|access-control|blocked by|cross-origin/i.test(t)), "no CORS console errors").toEqual([]);

    // The same Origin at the dashboard's API: never an ACAO (opaque frames get assets only, not data).
    for (const apiPath of ["/api/health", "/api/sessions"]) {
      const res = await isolatedServer.rawRequest({ host: `dash5.test:${isolatedServer.port}`, path: apiPath, headers: { origin: "null" } });
      expect(res.headers["access-control-allow-origin"], `${apiPath} with Origin: null`).toBeUndefined();
    }
    const apiFromFrame = await frame.evaluate(async (d) => {
      try {
        return `resolved:${(await fetch(`${d}/api/health`)).status}`;
      } catch (e) {
        return `error:${(e as Error).name}`;
      }
    }, dash);
    expect(apiFromFrame, "the opaque frame cannot read the dashboard API").toBe("error:TypeError");
  } finally {
    await mock.stop();
  }
});
