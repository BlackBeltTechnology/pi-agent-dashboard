/**
 * getGitSourceReadout reports the shell pi would resolve for a fresh spawn
 * (pi's getShellConfig order over the augmented spawn env), never `sh.exe`.
 * Also covers the windowsBashSource state plumbing.
 *
 * See change: fix-windows-bundled-bash-exe (test-plan #E15 #E16 #E19 #X2–#X4).
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  augmentEnvWithGitSource,
  getActiveGitSource,
  getGitSourceReadout,
  invalidateGitSourceCache,
  setWindowsBashSourceSetting,
  setWindowsGitSourceSetting,
} from "../platform/git-source.js";
import { resolvePiShell } from "../platform/resolve-pi-shell.js";

const win = path.win32.join;
const RES = "C:\\res";
const GIT = win(RES, "git");
const SYS = "C:\\Windows\\System32";
const WSL = win(SYS, "bash.exe");

/** Bundle layout pieces, built from segments (no literal bundled-path strings). */
const bundle = (withBash: boolean): string[] => [
  win(GIT, "cmd", "git.exe"),
  win(GIT, "cmd"),
  win(GIT, "usr", "bin"),
  win(GIT, "usr", "bin", "sh.exe"),
  ...(withBash ? [win(GIT, "usr", "bin", "bash.exe")] : []),
  win(GIT, "mingw64"),
  win(GIT, "mingw64", "bin"),
];
const existsIn = (present: string[]) => {
  const set = new Set(present.map((p) => p.toLowerCase()));
  return (p: string) => set.has(p.toLowerCase());
};
const noHost = () => null;
const opts = (present: string[]) => ({ platform: "win32" as const, resourcesPath: RES, exists: existsIn(present) });

/** The env a real spawn would see: System32 first, bundled git per bashSetting. */
const spawnEnv = (present: string[], inherited = `${SYS};C:\\Tools`, extra: NodeJS.ProcessEnv = {}) =>
  augmentEnvWithGitSource({ PATH: inherited, ...extra }, noHost, opts(present));

beforeEach(() => {
  setWindowsGitSourceSetting("bundled");
  setWindowsBashSourceSetting("bundled");
  invalidateGitSourceCache();
});
afterEach(() => {
  setWindowsGitSourceSetting("auto");
  setWindowsBashSourceSetting("bundled");
  invalidateGitSourceCache();
});

describe("getGitSourceReadout — pi-order shell", () => {
  it("E15: bundled source, bundle has bash.exe, no PF Git → shellPath is the bundled bash.exe", () => {
    const present = bundle(true);
    const r = getGitSourceReadout(noHost, { ...opts(present), spawnEnv: spawnEnv(present) });
    expect(r?.shellPath).toBe(win(GIT, "usr", "bin", "bash.exe"));
    expect(r?.bashSetting).toBe("bundled");
    expect(r?.shellIsWslLauncher).toBe(false);
    expect(r?.source).toBe("bundled");
  });

  it("E16: Git for Windows bash exists → pi step 2 wins", () => {
    const pf = "C:\\PF\\Git\\bin\\bash.exe";
    const present = [...bundle(true), pf];
    const env = spawnEnv(present, `${SYS}`, { ProgramFiles: "C:\\PF" });
    const r = getGitSourceReadout(noHost, { ...opts(present), spawnEnv: env });
    expect(r?.shellPath).toBe(pf);
  });

  it("E19: setWindowsBashSourceSetting('host') invalidates the readout and recomputes shellPath", () => {
    const present = [...bundle(true), win("C:\\Tools", "bash.exe")];
    const first = getGitSourceReadout(noHost, { ...opts(present), spawnEnv: spawnEnv(present) });
    expect(first?.bashSetting).toBe("bundled");
    expect(first?.shellPath).toBe(win(GIT, "usr", "bin", "bash.exe"));

    setWindowsBashSourceSetting("host");
    const second = getGitSourceReadout(noHost, { ...opts(present), spawnEnv: spawnEnv(present) });
    expect(second?.bashSetting).toBe("host");
    expect(second?.shellPath).toBe(win("C:\\Tools", "bash.exe"));
  });

  it("X2: bundle with only sh.exe and no other bash → shellPath null (never sh.exe)", () => {
    const present = bundle(false);
    const r = getGitSourceReadout(noHost, { ...opts(present), spawnEnv: spawnEnv(present) });
    expect(r?.shellPath).toBeNull();
  });

  it("X3: bundle with only sh.exe + System32 bash.exe → the WSL launcher, flagged", () => {
    const present = [...bundle(false), WSL];
    const r = getGitSourceReadout(noHost, { ...opts(present), spawnEnv: spawnEnv(present) });
    expect(r?.shellPath).toBe(WSL);
    expect(r?.shellIsWslLauncher).toBe(true);
  });

  it("X4: bashSource host with no host bash anywhere → pi falls back to the bundled bash.exe", () => {
    setWindowsBashSourceSetting("host");
    const present = bundle(true);
    const env = spawnEnv(present, `${SYS}`);
    expect(getActiveGitSource(noHost, opts(present)).bashSetting).toBe("host");
    expect(resolvePiShell({ env, exists: existsIn(present) })?.path).toBe(win(GIT, "usr", "bin", "bash.exe"));
  });

  it("returns null on non-win32 platforms", () => {
    expect(getGitSourceReadout(noHost, { platform: "darwin" })).toBeNull();
  });
});
