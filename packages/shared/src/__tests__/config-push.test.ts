/**
 * `push` config block: opt-in by default, coalescing window clamped.
 * See change: add-server-push-notifications (test-plan #E15, #E16).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, parsePushConfig } from "../config.js";

describe("parsePushConfig — coalesceWindowMs clamp (test-plan #E15)", () => {
  it.each([
    [4_999, 5_000],
    [5_000, 5_000],
    [30_000, 30_000],
    [300_000, 300_000],
    [300_001, 300_000],
    [undefined, 30_000],
    ["abc", 30_000],
  ])("coalesceWindowMs %s → %s", (raw, expected) => {
    const parsed = parsePushConfig(raw === undefined ? { enabled: true } : { enabled: true, coalesceWindowMs: raw });
    expect(parsed.coalesceWindowMs).toBe(expected);
  });
});

describe("parsePushConfig — enabled only when strictly true (test-plan #E16)", () => {
  it.each([
    [undefined, false],
    [{}, false],
    [{ enabled: "true" }, false],
    [{ enabled: true }, true],
  ])("push block %j → enabled %s", (raw, expected) => {
    expect(parsePushConfig(raw).enabled).toBe(expected);
  });

  it("keeps fcm.serviceAccountPath and webPush.contactEmail when they are strings", () => {
    const parsed = parsePushConfig({
      enabled: true,
      fcm: { serviceAccountPath: "/x/sa.json" },
      webPush: { contactEmail: "me@example.com" },
    });
    expect(parsed.fcm).toEqual({ serviceAccountPath: "/x/sa.json" });
    expect(parsed.webPush).toEqual({ contactEmail: "me@example.com" });
  });

  it("drops malformed fcm/webPush sub-blocks", () => {
    const parsed = parsePushConfig({ enabled: true, fcm: { serviceAccountPath: 3 }, webPush: "x" });
    expect(parsed.fcm).toBeUndefined();
    expect(parsed.webPush).toBeUndefined();
  });
});

describe("loadConfig — push block", () => {
  let testDir: string;
  let origHome: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `test-config-push-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  });

  it("a config with no push block parses as disabled", () => {
    fs.writeFileSync(path.join(testDir, ".pi", "dashboard", "config.json"), JSON.stringify({ port: 8000 }));
    const cfg = loadConfig();
    expect(cfg.push?.enabled ?? false).toBe(false);
  });

  it("a config with push.enabled true parses as enabled", () => {
    fs.writeFileSync(
      path.join(testDir, ".pi", "dashboard", "config.json"),
      JSON.stringify({ push: { enabled: true, coalesceWindowMs: 1 } }),
    );
    const cfg = loadConfig();
    expect(cfg.push).toMatchObject({ enabled: true, coalesceWindowMs: 5_000 });
  });
});
