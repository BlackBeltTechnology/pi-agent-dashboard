import { expect, test } from "./fixture.js";

/**
 * Infra smoke for the `chromium-resolver` project (not a test-plan row): proves the host-resolver
 * rules + `allowedHosts` + `wildcard.forHosts` wiring that tier-2/tier-5 specs (F8, F32, F34, F43, …)
 * build on. `dash.test` → tier 2 (`<label>.preview.test`); `dash5.test` (forHosts miss) → tier 5.
 * Override the host per test with `livePreview.open(page, { dashHost })` or `test.use({ dashHost })`.
 */
test("infra: dash.test mints tier 2 and the frame renders from <label>.preview.test", async ({ page, livePreview, isolatedServer }) => {
  const mark = isolatedServer.logMark();
  const viewer = await livePreview.open(page);
  expect(await viewer.srcOrigin()).toMatch(new RegExp(`^http://[a-z2-7]{26}\\.preview\\.test:${isolatedServer.port}$`));
  await viewer.ready("#static");
  expect(isolatedServer.livePreviewLog(mark).join("\n")).toMatch(/mint tier=2 /);
});

test("infra: dash5.test (forHosts miss) never gets tier 2 — frame src is the tier-5 /preview/<pid>/ path", async ({ page, livePreview, isolatedServer }) => {
  const mark = isolatedServer.logMark();
  const viewer = await livePreview.open(page, { dashHost: "dash5.test" });
  expect(await viewer.src()).toMatch(/^\/preview\/[A-Za-z0-9_-]{22}\/$/);
  expect(await viewer.sandbox()).not.toContain("allow-same-origin");
  expect(isolatedServer.livePreviewLog(mark).join("\n")).not.toMatch(/mint tier=2 /);
});
