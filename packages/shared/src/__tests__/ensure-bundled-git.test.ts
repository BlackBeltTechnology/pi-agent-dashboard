/**
 * Unit tests for ensureBundledGitOnPath + resolveBundledGitDir.
 * See change: embed-git-bash-on-windows.
 */

import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureBundledGitOnPath,
  resolveBundledGitDir,
} from "../platform/ensure-bundled-git.js";

const win = path.win32.join;
const GIT_DIR = "C:\\app\\resources\\git";

/** exists-stub: true for any path under one of `present` prefixes. */
function existsFor(present: string[]): (p: string) => boolean {
  const set = new Set(present.map((p) => p.toLowerCase()));
  return (p) => set.has(p.toLowerCase());
}

/** Full x64 bundle layout (mingw64). */
const x64Layout = existsFor([
  win(GIT_DIR, "cmd", "git.exe"),
  win(GIT_DIR, "cmd"),
  win(GIT_DIR, "usr", "bin"),
  win(GIT_DIR, "mingw64"),
  win(GIT_DIR, "mingw64", "bin"),
  win(GIT_DIR, "mingw64", "libexec", "git-core"),
  win(GIT_DIR, "mingw64", "ssl", "certs", "ca-bundle.crt"),
]);

describe("resolveBundledGitDir", () => {
  it("returns root when cmd/git.exe exists under resourcesPath/git", () => {
    const exists = existsFor([win(GIT_DIR, "cmd", "git.exe")]);
    expect(resolveBundledGitDir({ resourcesPath: "C:\\app\\resources", exists })).toBe(GIT_DIR);
  });
  it("returns null when no git launcher present", () => {
    expect(resolveBundledGitDir({ resourcesPath: "C:\\app\\resources", exists: () => false })).toBeNull();
  });
  it("honors extra candidate roots", () => {
    const alt = "D:\\standalone\\git";
    const exists = existsFor([win(alt, "cmd", "git.exe")]);
    expect(resolveBundledGitDir({ candidates: [alt], exists })).toBe(alt);
  });
});

describe("ensureBundledGitOnPath", () => {
  it("no-op on non-Windows", () => {
    const env = { PATH: "/usr/bin" };
    expect(ensureBundledGitOnPath(env, { platform: "darwin", gitDir: GIT_DIR, exists: x64Layout })).toBe(env);
  });

  it("no-op when source is host", () => {
    const env = { PATH: "C:\\Windows\\System32" };
    expect(
      ensureBundledGitOnPath(env, { platform: "win32", source: "host", gitDir: GIT_DIR, exists: x64Layout }),
    ).toBe(env);
  });

  it("no-op when no bundled git resolvable", () => {
    const env = { PATH: "C:\\Windows\\System32" };
    expect(
      ensureBundledGitOnPath(env, { platform: "win32", source: "bundled", gitDir: null, exists: x64Layout }),
    ).toBe(env);
  });

  it("prepends cmd, usr/bin, mingw64/bin and sets git env vars (bundled)", () => {
    const env = { PATH: "C:\\Windows\\System32" };
    const out = ensureBundledGitOnPath(env, {
      platform: "win32",
      source: "bundled",
      gitDir: GIT_DIR,
      exists: x64Layout,
    });
    const parts = out.PATH!.split(";");
    expect(parts.slice(0, 3)).toEqual([
      win(GIT_DIR, "cmd"),
      win(GIT_DIR, "usr", "bin"),
      win(GIT_DIR, "mingw64", "bin"),
    ]);
    expect(parts.at(-1)).toBe("C:\\Windows\\System32");
    expect(out.GIT_EXEC_PATH).toBe(win(GIT_DIR, "mingw64", "libexec", "git-core"));
    expect(out.SSL_CERT_FILE).toBe(win(GIT_DIR, "mingw64", "ssl", "certs", "ca-bundle.crt"));
  });

  it("uses clangarm64 when mingw64 absent (arm64)", () => {
    const armLayout = existsFor([
      win(GIT_DIR, "cmd", "git.exe"),
      win(GIT_DIR, "cmd"),
      win(GIT_DIR, "usr", "bin"),
      win(GIT_DIR, "clangarm64"),
      win(GIT_DIR, "clangarm64", "bin"),
      win(GIT_DIR, "clangarm64", "libexec", "git-core"),
    ]);
    const out = ensureBundledGitOnPath({ PATH: "C:\\Windows\\System32" }, {
      platform: "win32",
      source: "bundled",
      gitDir: GIT_DIR,
      exists: armLayout,
    });
    expect(out.PATH).toContain(win(GIT_DIR, "clangarm64", "bin"));
    expect(out.GIT_EXEC_PATH).toBe(win(GIT_DIR, "clangarm64", "libexec", "git-core"));
  });

  it("is idempotent (apply twice == apply once)", () => {
    const env = { PATH: "C:\\Windows\\System32" };
    const once = ensureBundledGitOnPath(env, { platform: "win32", source: "bundled", gitDir: GIT_DIR, exists: x64Layout });
    const twice = ensureBundledGitOnPath(once, { platform: "win32", source: "bundled", gitDir: GIT_DIR, exists: x64Layout });
    expect(twice).toEqual(once);
  });
});

// ── windowsBashSource placement of usr/bin ────────────────────────────────
// See change: fix-windows-bundled-bash-exe (test-plan E3–E9).
describe("ensureBundledGitOnPath — bashSource placement", () => {
  const SYS = "C:\\Windows\\System32";
  const HOST = "C:\\host";
  const base = (bashSource: "bundled" | "host", env: NodeJS.ProcessEnv, source: "bundled" | "host" = "bundled") =>
    ensureBundledGitOnPath(env, { platform: "win32", source, gitDir: GIT_DIR, exists: x64Layout, bashSource });
  const CMD = win(GIT_DIR, "cmd");
  const USR = win(GIT_DIR, "usr", "bin");
  const LIB = win(GIT_DIR, "mingw64", "bin");
  const count = (p: string, dir: string) =>
    p.split(";").filter((e) => e.replace(/[\\/]+$/, "").toLowerCase() === dir.toLowerCase()).length;

  it("E3: bundled → cmd;usr\\bin;libdir prepended ahead of System32", () => {
    const out = base("bundled", { PATH: `${SYS};${HOST}` });
    expect(out.PATH).toBe([CMD, USR, LIB, SYS, HOST].join(";"));
  });

  it("E4: host → cmd;libdir prepended, usr\\bin appended once and last", () => {
    const out = base("host", { PATH: `${SYS};${HOST}` });
    expect(out.PATH).toBe([CMD, LIB, SYS, HOST, USR].join(";"));
  });

  it("E5: source host → env unchanged for both bashSource values", () => {
    const env = { PATH: `${SYS};${HOST}` };
    for (const bs of ["bundled", "host"] as const) {
      expect(base(bs, env, "host")).toEqual(env);
    }
  });

  it("E6: idempotent per mode (no duplicates)", () => {
    for (const bs of ["bundled", "host"] as const) {
      const once = base(bs, { PATH: `${SYS};${HOST}` });
      expect(base(bs, once)).toEqual(once);
      expect(count(once.PATH!, USR)).toBe(1);
    }
  });

  it("E7: switching host → bundled moves usr\\bin to the front, once", () => {
    const hosted = base("host", { PATH: `${SYS};${HOST}` });
    expect(count(hosted.PATH!, USR)).toBe(1);
    expect(hosted.PATH!.split(";").at(-1)).toBe(USR);
    const bundled = base("bundled", hosted);
    expect(count(bundled.PATH!, USR)).toBe(1);
    expect(bundled.PATH!.split(";")[1]).toBe(USR);
  });

  it("E8: a pre-existing differently-cased/trailing-slash usr\\bin entry is replaced by the canonical one", () => {
    const stale = "c:\\APP\\resources\\GIT\\usr\\bin\\";
    const out = base("host", { PATH: `${stale};${SYS};${HOST}` });
    expect(count(out.PATH!, USR)).toBe(1);
    expect(out.PATH!.split(";")).not.toContain(stale);
    expect(out.PATH!.split(";").at(-1)).toBe(USR);
  });

  it("a forward-slash spelling of the bundled usr/bin entry is replaced, not duplicated", () => {
    const stale = USR.replace(/\\/g, "/");
    const out = base("host", { PATH: `${stale};${SYS};${HOST}` });
    expect(out.PATH!.split(";")).not.toContain(stale);
    expect(count(out.PATH!, USR)).toBe(1);
    expect(out.PATH!.split(";").at(-1)).toBe(USR);
  });

  it("E9: clangarm64-only bundle, host → libdir prepended, usr\\bin last", () => {
    const arm = existsFor([
      win(GIT_DIR, "cmd", "git.exe"),
      CMD,
      USR,
      win(GIT_DIR, "clangarm64"),
      win(GIT_DIR, "clangarm64", "bin"),
    ]);
    const out = ensureBundledGitOnPath(
      { PATH: `${SYS};${HOST}` },
      { platform: "win32", source: "bundled", gitDir: GIT_DIR, exists: arm, bashSource: "host" },
    );
    expect(out.PATH).toBe([CMD, win(GIT_DIR, "clangarm64", "bin"), SYS, HOST, USR].join(";"));
  });

  it("omitting bashSource behaves as 'bundled' (back-compat)", () => {
    const out = ensureBundledGitOnPath(
      { PATH: `${SYS};${HOST}` },
      { platform: "win32", source: "bundled", gitDir: GIT_DIR, exists: x64Layout },
    );
    expect(out.PATH).toBe([CMD, USR, LIB, SYS, HOST].join(";"));
  });
});
