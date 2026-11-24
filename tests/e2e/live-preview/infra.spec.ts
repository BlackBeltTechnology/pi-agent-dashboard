import { expect, test } from "./fixture.js";

/**
 * Infra smoke (not a test-plan row): the config-rewrite + restart helper and log capture work, and the
 * rollback switch (`previewOrigins.enabled:false`, task 14.8) mints the legacy path. Always restores the base config.
 */
test("infra: isolatedServer.restart({patch}) applies a config change and restart({reset}) restores it", async ({ page, livePreview, isolatedServer }) => {
  try {
    await isolatedServer.restart({ patch: { liveServer: { previewOrigins: { enabled: false } } } });
    expect((isolatedServer.config().liveServer as { previewOrigins: { enabled: boolean } }).previewOrigins.enabled).toBe(false);
    const mark = isolatedServer.logMark();
    const viewer = await livePreview.open(page);
    expect(await viewer.src(), "rollback: legacy capability path").toMatch(/^\/live\/[^/]+\/~c\/[^/]+\/$/);
    expect(isolatedServer.livePreviewLog(mark).join("\n")).not.toMatch(/mint tier=[1-5] /);
  } finally {
    await isolatedServer.restart({ reset: true });
  }
  const mark = isolatedServer.logMark();
  const viewer = await livePreview.open(page);
  expect(new URL(await viewer.src()).hostname).toMatch(/^[a-z2-7]{26}\.localhost$/);
  expect(isolatedServer.livePreviewLog(mark).join("\n")).toMatch(/mint tier=1 /);
});
