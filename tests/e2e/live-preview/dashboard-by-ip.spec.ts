import http from "node:http";
import { expect, test } from "./fixture.js";
import { startTcpForwarder } from "./forwarder.js";

/**
 * L3 — the dashboard reached by IP literal / through an `ssh -L`-style forwarded port / over IPv6 (chromium + firefox).
 * Row: test-plan #F24. See change: serve-live-previews-on-capability-origin (baseline-csp, Q7).
 *
 * - `http://127.0.0.1:<port>`  → tier 1; `frame-src` carries `http://*.localhost:<port>`.
 * - TCP forward on another local port F (`http://127.0.0.1:F`) → tier 1 on port F; `frame-src` uses the PAGE's port F.
 * - `http://[::1]:<F6>` (forwarded; the server binds IPv4 only) → CSP cannot express IPv6 literals, so the mint falls
 *   through to tier 5 (`/preview/<pid>/`) and the header carries no IPv6 entry.
 */
const LABEL = "[a-z2-7]{26}";

/** `GET /` through `port` with the Host the browser would send; returns the dashboard document's CSP headers. */
const documentCsp = (opts: { host: string; port: number; hostHeader: string }): Promise<string> =>
  new Promise((resolve, reject) => {
    http
      .get({ host: opts.host, port: opts.port, path: "/", headers: { host: opts.hostHeader, accept: "text/html" } }, (res) => {
        res.resume();
        const h = res.headers;
        resolve([h["content-security-policy"], h["content-security-policy-report-only"]].flat().filter(Boolean).join(" | "));
      })
      .on("error", reject);
  });
const frameSrc = (csp: string): string[] => csp.split(/[|,]/).flatMap((p) => p.split(";")).map((d) => d.trim()).filter((d) => d.startsWith("frame-src "));

test("T.F24 / #F24 dashboard at 127.0.0.1:<port>: tier 1 frame loads, frame-src names http://*.localhost:<port>", async ({ page, isolatedServer, livePreview }) => {
  const mark = isolatedServer.logMark();
  const viewer = await livePreview.open(page, { dashHost: "127.0.0.1" });
  expect((await viewer.srcOrigin()), "tier 1 label origin").toMatch(new RegExp(`^http://${LABEL}\\.localhost:${isolatedServer.port}$`));
  const frame = await viewer.ready("#static");
  expect(await frame.evaluate(() => location.origin)).toBe(await viewer.srcOrigin());
  expect(isolatedServer.livePreviewLog(mark).join("\n")).toMatch(/mint tier=1 /);
  const csp = await documentCsp({ host: "127.0.0.1", port: isolatedServer.port, hostHeader: `127.0.0.1:${isolatedServer.port}` });
  expect(frameSrc(csp).length, "frame-src present").toBeGreaterThan(0);
  for (const d of frameSrc(csp)) expect(d, "frame-src of the 127.0.0.1 page").toContain(`http://*.localhost:${isolatedServer.port}`);
});

test("T.F24 / #F24 dashboard through a TCP forward on another port: tier 1 on the forwarded port, frame-src uses that port", async ({ page, isolatedServer, operator, upstream }) => {
  const fwd = await startTcpForwarder({ targetPort: isolatedServer.port });
  try {
    expect(fwd.port).not.toBe(isolatedServer.port);
    const dash = `http://127.0.0.1:${fwd.port}`;
    const mark = isolatedServer.logMark();
    const viewer = await operator.openLivePreview(page, { dashOrigin: dash, target: upstream.url });
    expect(await viewer.srcOrigin(), "tier 1 on the PAGE's port, not the server's").toMatch(new RegExp(`^http://${LABEL}\\.localhost:${fwd.port}$`));
    const frame = await viewer.ready("#static");
    expect(await frame.evaluate(() => location.origin)).toBe(await viewer.srcOrigin());
    expect(isolatedServer.livePreviewLog(mark).join("\n")).toMatch(/mint tier=1 /);

    const csp = await documentCsp({ host: "127.0.0.1", port: fwd.port, hostHeader: `127.0.0.1:${fwd.port}` });
    expect(frameSrc(csp).length, "frame-src present").toBeGreaterThan(0);
    for (const d of frameSrc(csp)) {
      expect(d).toContain(`http://*.localhost:${fwd.port}`);
      expect(d, "never the server's own port for a forwarded page").not.toContain(`http://*.localhost:${isolatedServer.port}`);
    }
  } finally {
    await fwd.close();
  }
});

test("T.F24 / #F24 dashboard at http://[::1]:<port>: the mint falls through to tier 5, the frame renders via /preview/<pid>/, no IPv6 entry in frame-src", async ({ page, isolatedServer, operator, upstream }) => {
  // The server binds 127.0.0.1 only: reach it over IPv6 through a forwarder listening on ::1 (peer is still loopback).
  const fwd = await startTcpForwarder({ listenHost: "::1", targetPort: isolatedServer.port });
  try {
    const dash = `http://[::1]:${fwd.port}`;
    const mark = isolatedServer.logMark();
    // Tier 5 forwards the FULL `/preview/<pid>/` path to the upstream: it must behave like a dev server running under that base.
    upstream.baseAware = true;
    const viewer = await operator.openLivePreview(page, { dashOrigin: dash, target: upstream.url });
    const src = await viewer.src();
    expect(src, "tier 5: stable same-origin /preview/<pid>/ path, no origin").toMatch(/^\/preview\/[^/]+\/?/);
    const frame = await viewer.ready("#static");
    expect(await frame.evaluate(() => document.getElementById("static")?.textContent)).toBe("static upstream");
    const log = isolatedServer.livePreviewLog(mark).join("\n");
    expect(log, "no tier-1 mint for an IPv6 Host").not.toMatch(/mint tier=1 /);
    expect(log, "minted tier 5").toMatch(/mint tier=5 /);

    const csp = await documentCsp({ host: "::1", port: fwd.port, hostHeader: `[::1]:${fwd.port}` });
    expect(frameSrc(csp).length, "frame-src present").toBeGreaterThan(0);
    for (const d of frameSrc(csp)) expect(d, "no IPv6 literal in frame-src").not.toMatch(/\[|::1/);
  } finally {
    await fwd.close();
  }
});
