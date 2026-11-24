import { expect, test } from "./fixture.js";

/**
 * L3 — tier 2 + `forHosts` miss via host-resolver rules (task 14.4), `chromium-resolver` project.
 * Config (isolated-server `baseConfig`): `allowedHosts:[dash.test, dash5.test]`,
 * `wildcard:{suffix:"preview.test", scheme:"http", forHosts:["dash.test"]}`.
 * Row: test-plan #F8. See change: serve-live-previews-on-capability-origin.
 */
test("T.F8 / #F8 dashboard at dash.test (forHosts hit) → tier 2 <label>.preview.test renders; dash5.test (forHosts miss) → tier 5, never tier 2", async ({ page, context, livePreview, upstream, isolatedServer, dashOrigin }) => {
  expect(isolatedServer.config().liveServer).toMatchObject({ previewOrigins: { wildcard: { suffix: "preview.test", forHosts: ["dash.test"] } } });

  // dash.test — forHosts hit → tier 2.
  const mark2 = isolatedServer.logMark();
  const hit = await livePreview.open(page, { dashHost: "dash.test" });
  const hitOrigin = await hit.srcOrigin();
  expect(hitOrigin, "tier 2 origin http://<L>.preview.test:<p>").toMatch(new RegExp(`^http://[a-z2-7]{26}\\.preview\\.test:${isolatedServer.port}$`));
  const hitFrame = await hit.ready("#static");
  expect(await hitFrame.evaluate(() => location.origin)).toBe(hitOrigin);
  expect(await hitFrame.evaluate(() => document.getElementById("static")?.textContent), "tier-2 frame renders the upstream").toBe("static upstream");
  const log2 = isolatedServer.livePreviewLog(mark2).join("\n");
  expect(log2).toMatch(/mint tier=2 /);
  expect(dashOrigin).toBe(isolatedServer.origin("dash.test"));

  // dash5.test — forHosts miss → tier 5 (or the legacy path), never tier 2. A fresh page: its own session + viewer.
  upstream.baseAware = true; // tier 5 forwards the full /preview/<pid>/ path: behave like a dev server under that base
  const page5 = await context.newPage();
  const mark5 = isolatedServer.logMark();
  const miss = await livePreview.open(page5, { dashHost: "dash5.test" });
  const src5 = await miss.src();
  expect(src5, "tier 5 (/preview/<pid>/) or legacy (/live/…), never a preview.test origin").toMatch(/^\/(preview|live)\//);
  expect(src5).not.toContain("preview.test");
  expect(await miss.srcOrigin(), "same origin as the dashboard host that minted it").toBe(isolatedServer.origin("dash5.test"));
  const frame5 = await miss.ready("#static");
  expect(await frame5.evaluate(() => document.getElementById("static")?.textContent), "tier-5 frame renders the upstream").toBe("static upstream");
  const log5 = isolatedServer.livePreviewLog(mark5).join("\n");
  expect(log5, "dash5.test mints tier 5 / legacy").toMatch(/mint tier=(5|legacy) /);
  expect(log5, "never tier 2 for dash5.test").not.toMatch(/mint tier=2 /);
  await page5.close();
});
