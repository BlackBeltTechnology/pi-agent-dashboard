import { expect, test } from "./fixture.js";

/**
 * L3 — the dashboard's baseline CSP admits the preview frame under BOTH `PI_DASHBOARD_CSP=report` and `enforce`
 * (the empty-pane regression: a `frame-src` that silently blocks the `<label>.localhost:<port>` iframe).
 * Row: test-plan #F23. See change: serve-live-previews-on-capability-origin (baseline-csp).
 */
const LABEL = "[a-z2-7]{26}";

for (const mode of ["report", "enforce"] as const) {
  test(`T.F23 / #F23 PI_DASHBOARD_CSP=${mode}: the tier-1 preview frame loads, zero frame-src violations`, async ({ page, isolatedServer, livePreview, upstream }) => {
    await isolatedServer.restart({ env: { PI_DASHBOARD_CSP: mode } });
    try {
      const mark = isolatedServer.logMark();
      // Header observable first: the dashboard document carries the per-request frame-src for the page's own port.
      const root = await isolatedServer.rawRequest({ host: `localhost:${isolatedServer.port}`, path: "/" });
      const enforcing = String(root.headers["content-security-policy"] ?? "");
      const reporting = String(root.headers["content-security-policy-report-only"] ?? "");
      expect(mode === "enforce" ? enforcing : reporting, `${mode}: the ${mode === "enforce" ? "enforcing" : "report-only"} header names the label source`).toContain(`http://*.localhost:${isolatedServer.port}`);
      if (mode === "enforce") expect(enforcing, "enforce: frame-src is in an ENFORCED policy").toMatch(/frame-src [^;]*http:\/\/\*\.localhost:\d+/);

      // Collect every CSP violation the dashboard document raises (any directive), before any page script runs.
      await page.addInitScript(() => {
        const w = window as unknown as { __csp: { directive: string; blocked: string }[] };
        w.__csp = [];
        document.addEventListener("securitypolicyviolation", (e) => w.__csp.push({ directive: e.effectiveDirective, blocked: e.blockedURI }));
      });
      const viewer = await livePreview.open(page);
      const src = new URL(await viewer.src());
      expect(src.origin, "iframe src origin is <label>.localhost:<port>").toMatch(new RegExp(`^http://${LABEL}\\.localhost:${isolatedServer.port}$`));
      const frame = await viewer.ready("#static");
      expect(await frame.evaluate(() => document.getElementById("static")?.textContent), "the frame RENDERS the upstream (not an empty pane)").toBe("static upstream");
      expect(upstream.requests.some((r) => r.url === "/"), "the upstream was actually fetched through the preview origin").toBe(true);

      // Give violation reports time to flush (the client batches them; the browser's report-uri is async).
      await page.waitForTimeout(2_000);
      const events = await page.evaluate(() => (window as unknown as { __csp: { directive: string; blocked: string }[] }).__csp);
      expect(events.filter((e) => /^frame-src/.test(e.directive)), "zero securitypolicyviolation events for frame-src").toEqual([]);
      expect(isolatedServer.logSince(mark, /\[csp\] violation .*directive=frame-src/), "zero server-side frame-src violation reports").toEqual([]);
      const counters = await isolatedServer.api("GET", "/api/csp-violations");
      expect(counters.status).toBe(200);
      expect(JSON.stringify(counters.json), "no /api/csp-violations entry for frame-src").not.toMatch(/frame-src/);
    } finally {
      await isolatedServer.restart({ reset: true });
    }
  });
}
