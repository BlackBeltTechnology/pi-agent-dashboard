import { chromium, firefox } from "@playwright/test";
import { expect, test } from "./fixture.js";
import { expectNestedPanesRender } from "./mock-panes.js";
import { reserveBaseVia, startLpMock } from "./mock-site.js";
import { Operator } from "./operator.js";
import { sleep } from "./tier5-helpers.js";

/**
 * L3 — same-origin nested pane (live-component mock site Current/Proposed panes) inside the preview frame, on Chromium AND
 * Firefox: tier 1 (`<label>.localhost`) for both, tier 5 through an engine that resolves `dash5.test` itself
 * (Firefox `network.dns.localDomains`; Chromium host-resolver rule — the project's own resolver run is `nested-pane.resolver.spec.ts`).
 * Row: test-plan #F26. See change: serve-live-previews-on-capability-origin (live-csp, D6, T11).
 */
test("T.F26 / #F26 tier 1: every nested mock pane renders (frame-ancestors names the dashboard AND the label origin)", async ({ page, livePreview, isolatedServer }) => {
  test.setTimeout(180_000);
  const mock = await startLpMock();
  try {
    const viewer = await livePreview.open(page, { target: mock.url });
    expect(await viewer.srcOrigin()).toMatch(new RegExp(`^http://[a-z2-7]{26}\\.localhost:${isolatedServer.port}$`));
    const { panes } = await expectNestedPanesRender(viewer);
    for (const p of panes) expect(new URL(p.url()).origin, "panes are same-origin with the preview").toBe(await viewer.srcOrigin());
  } finally {
    await mock.stop();
  }
});

test("T.F26 / #F26 tier 5 (dash5.test resolved by the engine itself): every nested mock pane renders in the opaque frame", async ({ browserName, isolatedServer }) => {
  test.setTimeout(240_000);
  // The engine under test resolves `dash5.test` on its own: Firefox via `network.dns.localDomains`, Chromium via a host-resolver rule.
  const browser = await (browserName === "firefox"
    ? firefox.launch({ firefoxUserPrefs: { "network.dns.localDomains": "dash5.test" } })
    : chromium.launch({ args: ["--host-resolver-rules=MAP dash5.test 127.0.0.1"] }));
  const context = await browser.newContext();
  const page = await context.newPage();
  const operator = new Operator(isolatedServer);
  let mock: Awaited<ReturnType<typeof startLpMock>> | undefined;
  try {
    const dash = isolatedServer.origin("dash5.test");
    await operator.gotoDashboard(page, dash);
    const events = reserveBaseVia(isolatedServer);
    for (let i = 0; i < 20 && !mock?.base; i++) {
      await mock?.stop();
      mock = await startLpMock({ events });
      if (!mock.base) await sleep(500);
    }
    if (!mock?.base) throw new Error("no tier-5 base was reserved (is a tier-5-capable viewer connected?)");
    const viewer = await operator.openLivePreview(page, { dashOrigin: dash, target: mock.url });
    expect(await viewer.src(), "the viewer adopts the reserved base").toBe(mock.base);
    expect(await viewer.sandbox()).not.toContain("allow-same-origin");
    const { panes } = await expectNestedPanesRender(viewer);
    for (const p of panes) expect(new URL(p.url()).pathname).toContain(mock.base);
  } finally {
    await mock?.stop();
    await operator.dispose();
    await browser.close();
  }
});
