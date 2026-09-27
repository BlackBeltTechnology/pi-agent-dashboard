/**
 * Runtime-update checker: target resolution per source/channel, notify-only
 * checks, failure caching. test-plan E9, E10, X3.
 * See change: electron-runtime-overlay-updates (D3, D5).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type RuntimeReleaseFeeds,
  RuntimeUpdateChecker,
  resolveTarget,
} from "../runtime-overlay/runtime-update-checker.js";

const feeds: RuntimeReleaseFeeds = {
  npmDistTags: async () => ({ latest: "0.9.0", beta: "0.10.0-beta.2" }),
  githubReleases: async () => [
    { tag: "v0.10.0-beta.2", prerelease: true, draft: false },
    { tag: "v0.9.0", prerelease: false, draft: false },
    { tag: "v0.8.5", prerelease: false, draft: false },
    { tag: "v1.0.0", prerelease: false, draft: true },
  ],
};

describe("resolveTarget (E9)", () => {
  it.each([
    ["npm", "stable", undefined, "0.9.0"],
    ["npm", "beta", undefined, "0.10.0-beta.2"],
    ["npm", "stable", "0.8.5", "0.8.5"],
    ["github", "stable", undefined, "0.9.0"],
    ["github", "beta", undefined, "0.10.0-beta.2"],
    ["github", "beta", "0.8.5", "0.8.5"],
  ] as const)("%s channel=%s pin=%s → %s", async (source, channel, pin, expected) => {
    expect(await resolveTarget({ source, channel, pin }, feeds)).toBe(expected);
  });

  it("beta never goes BELOW stable (a stale beta tag is ignored)", async () => {
    const stale: RuntimeReleaseFeeds = { ...feeds, npmDistTags: async () => ({ latest: "0.9.0", beta: "0.9.0-beta.1" }) };
    expect(await resolveTarget({ source: "npm", channel: "beta" }, stale)).toBe("0.9.0");
  });

  it("rejects an invalid pin", async () => {
    await expect(resolveTarget({ source: "npm", channel: "stable", pin: "latest; rm -rf" }, feeds)).rejects.toThrow(/invalid pin/);
  });
});

describe("RuntimeUpdateChecker (E10, X3)", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "rt-check-"));
  });
  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function checker(over: Partial<ConstructorParameters<typeof RuntimeUpdateChecker>[0]> = {}) {
    return new RuntimeUpdateChecker({
      readSelection: () => ({ source: "npm", channel: "stable" }),
      activeVersion: () => "0.9.0",
      feeds: { ...feeds, npmDistTags: async () => ({ latest: "0.9.1" }) },
      now: () => 1_000,
      ...over,
    });
  }

  it("E10: a newer release is reported available; nothing staged, request untouched", async () => {
    const before = fs.readdirSync(dir);
    const status = await checker().check();
    expect(status).toMatchObject({ state: "available", target: "0.9.1", active: "0.9.0" });
    expect(fs.readdirSync(dir)).toEqual(before);
  });

  it("up to date when the target equals the active version", async () => {
    expect(await checker({ activeVersion: () => "0.9.1" }).check()).toMatchObject({ state: "up_to_date", target: "0.9.1" });
  });

  it("source bundled/local: no check at all", async () => {
    const npmDistTags = vi.fn();
    const c = checker({ readSelection: () => ({ source: "bundled" }), feeds: { ...feeds, npmDistTags } });
    expect(await c.check()).toMatchObject({ state: "not_applicable" });
    expect(npmDistTags).not.toHaveBeenCalled();
  });

  it("caches for 24 h; force re-checks", async () => {
    const npmDistTags = vi.fn(async () => ({ latest: "0.9.1" }));
    let t = 0;
    const c = checker({ feeds: { ...feeds, npmDistTags }, now: () => t });
    await c.check();
    t = 23 * 3600_000;
    await c.check();
    expect(npmDistTags).toHaveBeenCalledTimes(1);
    await c.check({ force: true });
    expect(npmDistTags).toHaveBeenCalledTimes(2);
    t += 25 * 3600_000;
    await c.check();
    expect(npmDistTags).toHaveBeenCalledTimes(3);
  });

  it("X3: network error → check_failed with reason; last good result kept", async () => {
    let fail = false;
    const c = checker({
      feeds: {
        ...feeds,
        npmDistTags: async () => {
          if (fail) throw new Error("ENOTFOUND registry.npmjs.org");
          return { latest: "0.9.1" };
        },
      },
    });
    await c.check();
    fail = true;
    const st = await c.check({ force: true });
    expect(st).toMatchObject({ state: "check_failed", reason: expect.stringContaining("ENOTFOUND") });
    expect(st.state === "check_failed" && st.lastGood).toMatchObject({ state: "available", target: "0.9.1" });
  });

  it("X3: after a failure, peek() still carries the same-selection good result (within 24 h)", async () => {
    let fail = false;
    let t = 0;
    const c = checker({
      now: () => t,
      feeds: {
        ...feeds,
        npmDistTags: async () => {
          if (fail) throw new Error("ETIMEDOUT");
          return { latest: "0.9.1" };
        },
      },
    });
    await c.check();
    fail = true;
    t = 1_000;
    await c.check({ force: true });
    expect(c.peek()).toMatchObject({ state: "check_failed", lastGood: { target: "0.9.1" } });
    // a non-forced check within 24 h serves the good result without refetching
    expect(await c.check()).toMatchObject({ state: "available", target: "0.9.1" });
    // after 24 h the good result expires: failure carries no lastGood
    t = 25 * 3600_000;
    const st = await c.check();
    expect(st).toMatchObject({ state: "check_failed" });
    expect(st).not.toHaveProperty("lastGood");
  });

  it("X3: lastGood never leaks across selections (npm/stable result not shown for beta)", async () => {
    let channel: "stable" | "beta" = "stable";
    let fail = false;
    const c = checker({
      readSelection: () => ({ source: "npm", channel }),
      feeds: {
        ...feeds,
        npmDistTags: async () => {
          if (fail) throw new Error("ENOTFOUND");
          return { latest: "0.9.1" };
        },
      },
    });
    await c.check();
    fail = true;
    channel = "beta";
    const st = await c.check();
    expect(st).toMatchObject({ state: "check_failed" });
    expect(st).not.toHaveProperty("lastGood");
  });

  it("X3: a 30 s stall times out as check_failed", async () => {
    vi.useFakeTimers();
    const c = checker({ feeds: { ...feeds, npmDistTags: () => new Promise(() => {}) }, timeoutMs: 30_000 });
    const p = c.check();
    await vi.advanceTimersByTimeAsync(30_001);
    expect(await p).toMatchObject({ state: "check_failed", reason: expect.stringContaining("timeout") });
  });

  it("a switched selection invalidates the cache", async () => {
    const npmDistTags = vi.fn(async () => ({ latest: "0.9.1", beta: "0.10.0-beta.1" }));
    let channel: "stable" | "beta" = "stable";
    const c = checker({ feeds: { ...feeds, npmDistTags }, readSelection: () => ({ source: "npm", channel }) });
    expect(await c.check()).toMatchObject({ target: "0.9.1" });
    channel = "beta";
    expect(await c.check()).toMatchObject({ target: "0.10.0-beta.1" });
  });
});
