import { expect, test } from "./fixture.js";

/**
 * L3 — tier 1 (`<label>.localhost`) in a real browser against the HOST-RUN isolated server
 * (config: playwright.live-preview.config.ts; `npm run test:e2e:live-preview`).
 * Rows: test-plan #F1, #F5, #F3, #F4. See change: serve-live-previews-on-capability-origin (tasks 14.2).
 */
const LABEL = "[a-z2-7]{26}";

test("T.F1 / #F1 tier 1: frame origin is <label>.localhost:<port>, dashboard API unreachable from it", async ({ page, livePreview, isolatedServer }) => {
  const mark = isolatedServer.logMark();
  const viewer = await livePreview.open(page);

  const src = new URL(await viewer.src());
  expect(src.origin).toMatch(new RegExp(`^http://${LABEL}\\.localhost:${isolatedServer.port}$`));
  expect(await viewer.sandbox()).toContain("allow-same-origin");

  const frame = await viewer.ready("#static");
  expect(await frame.evaluate(() => location.origin)).toBe(src.origin);
  expect(await frame.evaluate(async () => (await fetch("/@vite/client")).status)).toBe(200);
  // /api/health on the label origin is the UPSTREAM's 404, never dashboard JSON.
  const health = await frame.evaluate(async () => {
    const r = await fetch("/api/health");
    return { status: r.status, body: await r.text() };
  });
  expect(health).toEqual({ status: 404, body: "upstream-404" });

  expect(isolatedServer.livePreviewLog(mark).join("\n")).toMatch(/mint tier=1 /);
});

test("T.F5 / #F5 trailing-dot dashboard URL still mints tier 1 with a dot-free frame origin", async ({ page, livePreview, isolatedServer, browserName }) => {
  // The row is defined for Chromium. Firefox drops the dotted `http://localhost.:<p>` source from the label's
  // CSP `frame-ancestors` (invalid source expression), so it refuses to frame the preview: a Firefox-only
  // limitation of trailing-dot dashboard URLs, recorded rather than asserted away.
  test.skip(browserName === "firefox", "Firefox rejects a trailing-dot host in CSP frame-ancestors (dashboard at localhost.:<p> cannot frame the preview)");
  const mark = isolatedServer.logMark();
  const viewer = await livePreview.open(page, { dashHost: "localhost." });

  const src = new URL(await viewer.src());
  expect(src.hostname, "frame origin carries no trailing dot").toMatch(new RegExp(`^${LABEL}\\.localhost$`));
  expect(src.origin).not.toBe(isolatedServer.origin("localhost"));
  const frame = await viewer.ready("#static");
  expect(await frame.evaluate(() => location.origin)).toBe(src.origin);
  expect(isolatedServer.livePreviewLog(mark).join("\n")).toMatch(/mint tier=1 /);
});

test("T.F3 / #F3 re-mint reuse: the frame keeps its origin and localStorage across viewer reopen", async ({ page, livePreview, isolatedServer }) => {
  const marker = `v-${Date.now()}`;
  const viewer = await livePreview.open(page);
  const origin1 = await viewer.srcOrigin();
  const frame1 = await viewer.ready("#static");
  await frame1.evaluate((v) => localStorage.setItem("persist", v), marker);

  const mark = isolatedServer.logMark();
  await viewer.reopen(); // new viewerId → second mint for the same dashboard ancestors
  const origin2 = await viewer.srcOrigin();
  expect(origin2, "second mint returns the same origin (reuse)").toBe(origin1);
  const frame2 = await viewer.ready("#static");
  expect(await frame2.evaluate(() => localStorage.getItem("persist"))).toBe(marker);
  expect(isolatedServer.livePreviewLog(mark).join("\n")).toMatch(/mint tier=1 /);
  // The "after absolute-expiry advance the origin changes and storage is empty" half needs a server
  // clock hook (none exists); it is covered at L1 (preview-origin / live-server-endpoint tests).
});

test("T.F4 / #F4 localhost and 127.0.0.1 tabs get different origins and cannot cross-use them", async ({ page, browser, operator, upstream, isolatedServer }) => {
  const session = await operator.fakeSession();
  const target = upstream.url;
  const viewerA = await operator.openLivePreview(page, { dashOrigin: isolatedServer.origin("localhost"), target, session });
  const ctxB = await browser.newContext();
  try {
    const pageB = await ctxB.newPage();
    const viewerB = await operator.openLivePreview(pageB, { dashOrigin: isolatedServer.origin("127.0.0.1"), target, session });
    const originA = await viewerA.srcOrigin();
    const originB = await viewerB.srcOrigin();
    expect(originA).toMatch(new RegExp(`^http://${LABEL}\\.localhost:${isolatedServer.port}$`));
    expect(originB).toMatch(new RegExp(`^http://${LABEL}\\.localhost:${isolatedServer.port}$`));
    expect(originA, "different dashboard ancestors → no reuse").not.toBe(originB);
    await viewerA.ready("#static");
    await viewerB.ready("#static");

    // No cross-use. Server side: label B's CSP `frame-ancestors` names ITS dashboard ancestor
    // (http://127.0.0.1:<p>) and itself — never tab A's http://localhost:<p>.
    const labelB = await isolatedServer.rawRequest({ host: new URL(originB).host, headers: { "sec-fetch-dest": "iframe" } });
    const ancestors = /frame-ancestors ([^;]*)/.exec(String(labelB.headers["content-security-policy"] ?? ""))?.[1].split(/\s+/) ?? [];
    expect(ancestors, `label B CSP: ${labelB.headers["content-security-policy"]}`).toContain(isolatedServer.origin("127.0.0.1"));
    expect(ancestors).not.toContain(isolatedServer.origin("localhost"));
    // Browser side, engine-agnostic: in tab A a control frame of A's OWN label renders, while the browser
    // refuses a frame of B's label (both engines log the frame-ancestors violation naming that label).
    const consoleLines: string[] = [];
    page.on("console", (m) => consoleLines.push(m.text()));
    await page.evaluate(
      ([own, other]) => {
        for (const [id, src] of [["control", own], ["cross-use", other]]) {
          const f = document.createElement("iframe");
          f.id = id;
          f.src = `${src}/`;
          document.body.appendChild(f);
        }
      },
      [originA, originB],
    );
    await expect(page.frameLocator("#control").locator("#static")).toHaveText("static upstream");
    await expect
      .poll(() => consoleLines.some((l) => /frame-ancestors/i.test(l) && l.includes(new URL(originB).host)), { message: `frame-ancestors violation for ${originB} in console: ${consoleLines.join(" | ")}` })
      .toBe(true);
    expect(consoleLines.some((l) => /frame-ancestors/i.test(l) && l.includes(new URL(originA).host) && !l.includes(new URL(originB).host)), "control frame was not refused").toBe(false);
  } finally {
    await ctxB.close();
  }
});
