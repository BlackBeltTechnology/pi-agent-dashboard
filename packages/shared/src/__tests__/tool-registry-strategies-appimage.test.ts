/**
 * Tests for the AppImage self-hit guard inside `whereStrategy`. Per
 * design D2 (change: fix-electron-appimage-cli-self-detection), the
 * guard runs after `whichSync(name)` returns and demotes self-hits to
 * `{ ok: false, reason: "appimage-self-hit: <path>" }` so the
 * registry's diagnostic trail records the rejection.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";

import { whereStrategy } from "../tool-registry/strategies.js";
import {
  ToolRegistry,
  OverridesStore,
} from "../tool-registry/index.js";

function tmpStore(): OverridesStore {
  return new OverridesStore({
    filePath: path.join(
      os.tmpdir(),
      `where-strategy-appimage-test-${process.pid}-${Math.random().toString(36).slice(2)}.json`,
    ),
    warn: () => {},
  });
}

describe("whereStrategy AppImage self-hit guard", () => {
  it("rejects an APPDIR-mount candidate", () => {
    const savedAppDir = process.env.APPDIR;
    const fakeAppDir = "/tmp/.mount_PI-DAS-TEST";
    process.env.APPDIR = fakeAppDir;
    try {
      const strat = whereStrategy("pi-dashboard", {
        which: () => fakeAppDir + "/pi-dashboard",
      });
      const r = strat.run({
        overrides: {},
        platform: "linux",
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toContain("appimage-self-hit");
        expect(r.reason).toContain(fakeAppDir + "/pi-dashboard");
      }
    } finally {
      if (savedAppDir === undefined) delete process.env.APPDIR;
      else process.env.APPDIR = savedAppDir;
    }
  });

  it("rejects a process.execPath self-hit", () => {
    // Use the running process.execPath — realpath-equality matches.
    const exec = process.execPath;
    const strat = whereStrategy("pi-dashboard", {
      which: () => exec,
    });
    const r = strat.run({
      overrides: {},
      platform: process.platform,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("appimage-self-hit");
    }
  });

  it("returns ok for unrelated paths when no AppImage env vars are set", () => {
    const savedAppDir = process.env.APPDIR;
    const savedAppImage = process.env.APPIMAGE;
    delete process.env.APPDIR;
    delete process.env.APPIMAGE;
    try {
      const candidate = "/usr/local/bin/git";
      const strat = whereStrategy("git", { which: () => candidate });
      const r = strat.run({ overrides: {}, platform: "linux" });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.path).toBe(candidate);
    } finally {
      if (savedAppDir !== undefined) process.env.APPDIR = savedAppDir;
      if (savedAppImage !== undefined) process.env.APPIMAGE = savedAppImage;
    }
  });
});

describe("ToolRegistry diagnostic trail records appimage-self-hit", () => {
  it("Resolution.tried includes a 'where' entry whose reason contains 'appimage-self-hit'", () => {
    const savedAppDir = process.env.APPDIR;
    const fakeAppDir = "/tmp/.mount_PI-REG-TEST";
    process.env.APPDIR = fakeAppDir;
    try {
      const registry = new ToolRegistry({
        overrides: tmpStore(),
        platform: "linux",
      });
      registry.register({
        name: "synthetic-tool",
        kind: "binary",
        strategies: [
          // Final strategy in the chain is `where`, fed by an injected
          // `which` that returns an APPDIR-mount candidate.
          whereStrategy("synthetic-tool", {
            which: () => fakeAppDir + "/synthetic-tool",
          }),
        ],
      });

      const res = registry.resolve("synthetic-tool");
      expect(res.ok).toBe(false);
      const whereEntry = res.tried.find((t) => t.strategy === "where");
      expect(whereEntry).toBeDefined();
      expect(String(whereEntry!.result)).toContain("appimage-self-hit");
    } finally {
      if (savedAppDir === undefined) delete process.env.APPDIR;
      else process.env.APPDIR = savedAppDir;
    }
  });
});
