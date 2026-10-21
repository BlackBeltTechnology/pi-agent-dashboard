/**
 * `windowsBashSource` wiring: PATCH via writeConfigPartial applies to the next
 * augmented spawn env with no restart; the startup seed reads the stored value.
 *
 * See change: fix-windows-bundled-bash-exe (test-plan #F1, #F2).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  augmentEnvWithGitSource,
  getActiveGitSource,
  invalidateGitSourceCache,
  setWindowsBashSourceSetting,
  setWindowsGitSourceSetting,
} from "@blackbelt-technology/pi-dashboard-shared/platform/git-source.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedWindowsSourceSettings, writeConfigPartial } from "../config-api.js";

const win = path.win32.join;
const RES = "C:\\res";
const GIT = win(RES, "git");
const present = new Set(
  [
    win(GIT, "cmd", "git.exe"),
    win(GIT, "cmd"),
    win(GIT, "usr", "bin"),
    win(GIT, "mingw64"),
    win(GIT, "mingw64", "bin"),
  ].map((p) => p.toLowerCase()),
);
const opts = { platform: "win32" as const, resourcesPath: RES, exists: (p: string) => present.has(p.toLowerCase()) };
const SYS = "C:\\Windows\\System32";
const USR = win(GIT, "usr", "bin");
const pathOf = () =>
  augmentEnvWithGitSource({ PATH: SYS }, () => null, opts).PATH!.split(";");

describe("windowsBashSource wiring", () => {
  let testDir: string;
  let configFile: string;
  let origHome: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-api-bash-"));
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    configFile = path.join(testDir, ".pi", "dashboard", "config.json");
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
    setWindowsGitSourceSetting("bundled");
    setWindowsBashSourceSetting("bundled");
    invalidateGitSourceCache();
  });
  afterEach(() => {
    process.env.HOME = origHome;
    fs.rmSync(testDir, { recursive: true, force: true });
    setWindowsGitSourceSetting("auto");
    setWindowsBashSourceSetting("bundled");
    invalidateGitSourceCache();
  });

  it("F1: PATCH { windowsBashSource: 'host' } succeeds without restart and moves usr\\bin last", () => {
    fs.writeFileSync(configFile, JSON.stringify({ windowsBashSource: "bundled" }));
    expect(pathOf()[1]).toBe(USR); // bundled: usr\bin ahead of System32

    const r = writeConfigPartial({ windowsBashSource: "host" });
    expect(r.success).toBe(true);
    expect(r.restartRequired).toBe(false);

    const parts = pathOf();
    expect(parts.at(-1)).toBe(USR);
    expect(JSON.parse(fs.readFileSync(configFile, "utf-8")).windowsBashSource).toBe("host");
  });

  it("F1: an invalid value is not applied to the live setting", () => {
    writeConfigPartial({ windowsBashSource: "wsl" });
    expect(getActiveGitSource(() => null, opts).bashSetting).toBe("bundled");
  });

  it("F2: startup seed applies the stored value with no config write", () => {
    fs.writeFileSync(configFile, JSON.stringify({ windowsBashSource: "host" }));
    const before = fs.readFileSync(configFile, "utf-8");
    seedWindowsSourceSettings();
    expect(getActiveGitSource(() => null, opts).bashSetting).toBe("host");
    expect(fs.readFileSync(configFile, "utf-8")).toBe(before);
  });
});
