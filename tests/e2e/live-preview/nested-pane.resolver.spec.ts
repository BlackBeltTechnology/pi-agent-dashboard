import { expect, test } from "./fixture.js";
import { expectNestedPanesRender } from "./mock-panes.js";
import { reserveBaseVia, startLpMock } from "./mock-site.js";
import { sleep } from "./tier5-helpers.js";

/**
 * L3 — same-origin nested pane (the live-component mock site's Current/Proposed panes) loads inside the preview frame:
 * tier 2 (`<label>.preview.test`, via dash.test) and tier 5 (`/preview/<pid>/` in an opaque frame, via dash5.test).
 * `chromium-resolver` project; tiers 1 (Chromium + Firefox) and Firefox tier 5 live in `nested-pane.spec.ts`.
 * Row: test-plan #F26. See change: serve-live-previews-on-capability-origin (live-csp, D6, T11).
 * The site is the REAL mock site (`startMockSite`, Vite) started like `serve_mock_site`.
 */
test("T.F26 / #F26 tier 2: every nested mock pane renders (frame-ancestors names the dashboard AND the preview origin)", async ({ page, livePreview, isolatedServer }) => {
  test.setTimeout(180_000);
  const mock = await startLpMock();
  try {
    const viewer = await livePreview.open(page, { dashHost: "dash.test", target: mock.url });
    expect(await viewer.srcOrigin()).toMatch(/^http:\/\/[a-z2-7]{26}\.preview\.test:\d+$/);
    const { panes } = await expectNestedPanesRender(viewer);
    for (const p of panes) expect(new URL(p.url()).origin, "panes are same-origin with the preview").toBe(await viewer.srcOrigin());
    expect(isolatedServer.livePreviewLog().join("\n")).toMatch(/mint tier=2 /);
  } finally {
    await mock.stop();
  }
});

test("T.F26 / #F26 tier 5 (dash5.test): every nested pane renders in the opaque frame (or the T11 fallback is applied)", async ({ page, operator, isolatedServer, livePreview }) => {
  test.setTimeout(240_000);
  await operator.gotoDashboard(page, isolatedServer.origin("dash5.test"));
  // Reserve the tier-5 base exactly as the mock site's bridge does, then start the site UNDER it.
  const events = reserveBaseVia(isolatedServer);
  let mock: Awaited<ReturnType<typeof startLpMock>> | undefined;
  for (let i = 0; i < 20 && !mock?.base; i++) {
    await mock?.stop();
    mock = await startLpMock({ events });
    if (!mock.base) await sleep(500);
  }
  if (!mock?.base) throw new Error("no tier-5 base was reserved (is a tier-5-capable viewer connected?)");
  try {
    expect(mock.base).toMatch(/^\/preview\/[^/]+\/$/);
    const viewer = await livePreview.open(page, { dashHost: "dash5.test", target: mock.url });
    expect(await viewer.src(), "the viewer adopts the reserved base").toBe(mock.base);
    expect(await viewer.sandbox(), "tier 5 stays opaque").not.toContain("allow-same-origin");
    const { panes } = await expectNestedPanesRender(viewer);
    for (const p of panes) expect(new URL(p.url()).pathname, "nested panes live under the same /preview/<pid>/ base").toContain(mock.base);
  } finally {
    await mock.stop();
  }
});
