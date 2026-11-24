import { expect, test } from "./fixture.js";
import { expectPanesReported, type LpMock, startLpMock, startT5Mock, watchForbiddenConsole } from "./mock-site.js";

/**
 * L3 (chromium-resolver project) — the mock site on tier 5 via `dash5.test` and on tier 2 via `dash.test`.
 * Row: test-plan #F32 (proposal acceptance fixture T5; D14). Chromium runs with
 * `--host-resolver-rules="MAP *.preview.test 127.0.0.1, MAP dash.test 127.0.0.1, MAP dash5.test 127.0.0.1"` and the isolated server has
 * `allowedHosts:["dash.test","dash5.test"]`, `wildcard{suffix:"preview.test",scheme:"http",forHosts:["dash.test"]}` (the project config).
 * See change: serve-live-previews-on-capability-origin (D14).
 */
let mock: LpMock | undefined;
test.afterEach(async () => {
  await mock?.dispose();
  mock = undefined;
});

test("T.F32 / #F32 tier 5 (dash5.test): /preview/<pid>/ opaque frame with panes and the storage notice; tier 2 (dash.test): <label>.preview.test renders", async ({ page, operator, livePreview, isolatedServer }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${e.name}: ${e.message}`));
  const console_ = watchForbiddenConsole(page);

  // --- tier 5: the mock runs under the base the dashboard reserved for the connected tier-5 viewer ---
  const dash5 = isolatedServer.origin("dash5.test");
  await operator.gotoDashboard(page, dash5);
  mock = await startT5Mock(isolatedServer);
  const v5 = await livePreview.open(page, { dashHost: "dash5.test", target: mock.url });
  expect(await v5.src()).toMatch(/^\/preview\/[A-Za-z0-9_-]{22}\/$/);
  expect(await v5.src()).toBe(mock.base);
  expect(await v5.sandbox()).not.toContain("allow-same-origin");
  await expect(v5.frameLocator.locator(".mk-frame")).toHaveCount(3, { timeout: 30_000 }); // the mock list still renders
  await expectPanesReported(v5);
  const note = v5.frameLocator.getByTestId("mk-opaque-note");
  await expect(note).toBeVisible();
  await expect(note).toContainText(/storage unavailable in this preview/i);
  expect(errors, "uncaught exceptions on tier 5").toEqual([]);
  expect(console_.hits, "forbidden console output on tier 5").toEqual([]);
  await mock.dispose();
  mock = undefined;

  // --- tier 2 (dash.test, forHosts hit): `<label>.preview.test`, a real origin (no notice) ---
  mock = await startLpMock();
  const v2 = await livePreview.open(page, { dashHost: "dash.test", target: mock.url });
  expect(await v2.src()).toMatch(new RegExp(`^http://[a-z2-7]{26}\\.preview\\.test:${isolatedServer.port}/$`));
  await expect(v2.frameLocator.locator(".mk-frame")).toHaveCount(3, { timeout: 30_000 });
  await expectPanesReported(v2);
  await expect(v2.frameLocator.getByTestId("mk-opaque-note")).toHaveCount(0);
  expect(errors, "uncaught exceptions on tier 2").toEqual([]);
});
