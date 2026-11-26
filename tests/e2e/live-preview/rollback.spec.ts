import fs from "node:fs";
import { expect, test } from "./fixture.js";
import { registerTarget } from "./tier5-helpers.js";

/**
 * Rollback of the capability-origin previews (`liveServer.previewOrigins.enabled:false`, task 14.8) in the host-run
 * isolated instance (HOME=<tmp>, never the live :8000 server):
 *   T.X10 (L2, REST)    — tier-1 mint before; after a LIVE config flip and again after a restart every mint is the legacy
 *                         `/live/<id>/~c/<token>/` path with no `origin`, and the old `<label>.localhost` Host answers 403.
 *   T.X60 (L3, browser) — the reopened pane frames the legacy path with the legacy sandbox; the old label origin is 403.
 * Always restores the base config. See change: serve-live-previews-on-capability-origin (tasks 14.8, 6.4).
 */
const LEGACY_PATH = /^\/live\/[^/]+\/~c\/[^/]+\/$/;

/** Rewrite `previewOrigins.enabled` in config.json WITHOUT a restart (the config is read live, E13). */
function setEnabled(server: { configPath: string; config(): Record<string, unknown> }, enabled: boolean): void {
  const cfg = server.config() as { liveServer: { previewOrigins: Record<string, unknown> } };
  cfg.liveServer.previewOrigins.enabled = enabled;
  fs.writeFileSync(server.configPath, JSON.stringify(cfg, null, 2));
}

test("T.X10 / #X10 enabled:false → legacy mint + old label host 403, both after a live flip and after a restart", async ({ isolatedServer, upstream }) => {
  const targetId = await registerTarget(isolatedServer, upstream.port, "x10");
  const mint = () => isolatedServer.api("POST", `/api/live-server/${targetId}/capability`, { accept: ["origin", "preview"] });
  const labelRequest = (originHost: string) => isolatedServer.rawRequest({ host: originHost, path: "/" });
  try {
    // Before: tier 1, and the label host reaches the upstream.
    const before = await mint();
    expect(before.json.tier, "before the rollback the loopback mint is tier 1").toBe(1);
    const labelHost = new URL(before.json.origin as string).host;
    expect(labelHost).toMatch(new RegExp(`^[a-z2-7]{26}\\.localhost:${isolatedServer.port}$`));
    const served = await labelRequest(labelHost);
    expect(served.status, "the capability origin serves the upstream").toBe(200);
    expect(served.body).toContain('id="static"');

    // Live flip (no restart): the next mint is legacy and the old label host is refused.
    setEnabled(isolatedServer, false);
    await expect
      .poll(async () => (await mint()).json.tier, { message: "the config flip applies without a restart", timeout: 20_000 })
      .toBe("legacy");
    const flipped = (await mint()).json;
    expect(flipped.path).toMatch(LEGACY_PATH);
    expect(flipped.origin, "a legacy mint carries no origin").toBeUndefined();
    const refusedLive = await labelRequest(labelHost);
    expect(refusedLive.status, "the old label host is refused after the flip").toBe(403);
    expect(refusedLive.body).not.toContain('id="static"');

    // Restart with the flag still off: same answers (no resurrected label, no tier-5 path either).
    await isolatedServer.restart();
    const restartedTarget = await registerTarget(isolatedServer, upstream.port, "x10-after");
    const after = (await isolatedServer.api("POST", `/api/live-server/${restartedTarget}/capability`, { accept: ["origin", "preview"] })).json;
    expect(after.tier).toBe("legacy");
    expect(after.path).toMatch(LEGACY_PATH);
    expect(after.origin).toBeUndefined();
    expect((await labelRequest(labelHost)).status, "the old label host stays refused across the restart").toBe(403);
    // The rollback must also stop the tier-5 base from being minted for a preview-only client.
    const previewOnly = (await isolatedServer.api("POST", `/api/live-server/${restartedTarget}/capability`, { accept: ["preview"] })).json;
    expect(previewOnly.tier).toBe("legacy");
    expect(previewOnly.path).toMatch(LEGACY_PATH);

    // Reversible: flipping the flag back on mints tier 1 again, live.
    setEnabled(isolatedServer, true);
    await expect
      .poll(async () => (await isolatedServer.api("POST", `/api/live-server/${restartedTarget}/capability`, { accept: ["origin", "preview"] })).json.tier, { timeout: 20_000 })
      .toBe(1);
  } finally {
    await isolatedServer.restart({ reset: true });
  }
});

test("T.X60 / #X60 rollback: the reopened pane frames the legacy path with the legacy sandbox; the old label origin answers 403", async ({ page, livePreview, isolatedServer }) => {
  try {
    // A running pane on a tier-1 origin first (its label origin is what must die).
    const first = await livePreview.open(page);
    const labelOrigin = await first.srcOrigin();
    expect(labelOrigin).toMatch(/^http:\/\/[a-z2-7]{26}\.localhost:\d+$/);
    expect(await first.sandbox(), "tier 1 frames its own origin").toContain("allow-same-origin");
    await first.ready("#static");

    await isolatedServer.restart({ patch: { liveServer: { previewOrigins: { enabled: false } } } });

    const mark = isolatedServer.logMark();
    const viewer = await livePreview.open(page); // a fresh pane on the same running upstream
    expect(await viewer.src(), "legacy capability path").toMatch(LEGACY_PATH);
    expect(await viewer.srcOrigin(), "legacy frames the dashboard origin").toBe(new URL(page.url()).origin);
    const sandbox = await viewer.sandbox();
    expect(sandbox, "legacy sandbox: scripts without same-origin").toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");
    await viewer.ready("#static");
    expect(isolatedServer.livePreviewLog(mark).join("\n")).not.toMatch(/mint tier=[1-5] /);

    const old = await isolatedServer.rawRequest({ host: new URL(labelOrigin).host, path: "/" });
    expect(old.status, "the old <label>.localhost origin answers 403").toBe(403);
    expect(old.body).not.toContain('id="static"');
  } finally {
    await isolatedServer.restart({ reset: true });
  }
});
