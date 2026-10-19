import * as fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  canonicalizeTarget,
  defaultResolveEnv,
  isPathWithinRoots,
  isWithinRoot,
  type ResolveEnv,
} from "../tool-path-resolve.js";

const posixEnv = (over: Partial<ResolveEnv> = {}): ResolveEnv => ({
  path: nodePath.posix,
  platform: "linux",
  homeDir: "/h",
  realpathSync: (p) => p,
  exists: () => false,
  isDirectory: () => false,
  ...over,
});

describe("isPathWithinRoots — component-wise containment (E24)", () => {
  const env = posixEnv();
  it("a string-prefix sibling is outside", () => {
    expect(isPathWithinRoots("/w/repo-old/a", ["/w/repo"], { env, caseInsensitive: false })).toBe(false);
    expect(isPathWithinRoots("/w/repo2", ["/w/repo"], { env, caseInsensitive: false })).toBe(false);
  });
  it("root equality and descendants are inside; the parent is outside", () => {
    expect(isPathWithinRoots("/w/repo", ["/w/repo"], { env, caseInsensitive: false })).toBe(true);
    expect(isPathWithinRoots("/w/repo/a/b", ["/w/repo"], { env, caseInsensitive: false })).toBe(true);
    expect(isPathWithinRoots("/w", ["/w/repo"], { env, caseInsensitive: false })).toBe(false);
  });
  it("an exact hit never calls the volume probe", () => {
    const probe = vi.fn(() => true);
    expect(isPathWithinRoots("/w/repo/a", ["/w/repo"], { env, volumeCaseProbe: probe })).toBe(true);
    expect(probe).not.toHaveBeenCalled();
  });
  it("folds case only when the probe says the volume folds", () => {
    expect(isPathWithinRoots("/w/repo/a.ts", ["/w/Repo"], { env, volumeCaseProbe: () => false })).toBe(false);
    expect(isPathWithinRoots("/w/repo/a.ts", ["/w/Repo"], { env, volumeCaseProbe: () => true })).toBe(true);
  });
  it("isWithinRoot honours the explicit fold flag", () => {
    expect(isWithinRoot("/w/repo/a", "/W/REPO", env, true)).toBe(true);
    expect(isWithinRoot("/w/repo/a", "/W/REPO", env, false)).toBe(false);
  });
  it("win32 forms: drive roots, separators, case", () => {
    const win: ResolveEnv = posixEnv({ path: nodePath.win32, platform: "win32" });
    expect(isPathWithinRoots("C:\\w\\repo\\a.ts", ["C:\\w\\repo"], { env: win, caseInsensitive: true })).toBe(true);
    expect(isPathWithinRoots("c:\\W\\REPO\\a.ts", ["C:\\w\\repo"], { env: win, caseInsensitive: true })).toBe(true);
    expect(isPathWithinRoots("C:\\w\\repo-old\\a.ts", ["C:\\w\\repo"], { env: win, caseInsensitive: true })).toBe(false);
    expect(isPathWithinRoots("D:\\w\\repo\\a.ts", ["C:\\w\\repo"], { env: win, caseInsensitive: true })).toBe(false);
  });
});

describe("canonicalizeTarget — dangling symlinks (D6)", () => {
  let tmp: string;
  let real: string;
  beforeAll(() => {
    tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "tpr-"));
    real = fs.realpathSync(tmp);
    fs.mkdirSync(nodePath.join(real, "repo"));
    fs.mkdirSync(nodePath.join(real, "other", "deep"), { recursive: true });
    // dangling absolute / relative links
    fs.symlinkSync(nodePath.join(real, "other", "new.txt"), nodePath.join(real, "repo", "abs"));
    fs.symlinkSync("../other/new.txt", nodePath.join(real, "repo", "rel"));
    // relative link whose text goes ".." from the REAL parent of a symlinked dir
    fs.symlinkSync(nodePath.join(real, "other", "deep"), nodePath.join(real, "repo", "s"));
    fs.symlinkSync("../new.txt", nodePath.join(real, "other", "deep", "link"));
    // link text "sub/../x" where sub is itself a symlink
    fs.mkdirSync(nodePath.join(real, "d"));
    fs.mkdirSync(nodePath.join(real, "elsewhere", "deep"), { recursive: true });
    fs.symlinkSync(nodePath.join(real, "elsewhere", "deep"), nodePath.join(real, "d", "sub"));
    fs.symlinkSync("sub/../x", nodePath.join(real, "d", "lnk"));
    // loop
    fs.symlinkSync("b", nodePath.join(real, "repo", "a"));
    fs.symlinkSync("a", nodePath.join(real, "repo", "b"));
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("follows a dangling absolute link to its target", () => {
    expect(canonicalizeTarget(nodePath.join(real, "repo", "abs"))).toBe(nodePath.join(real, "other", "new.txt"));
  });
  it("follows a dangling relative link", () => {
    expect(canonicalizeTarget(nodePath.join(real, "repo", "rel"))).toBe(nodePath.join(real, "other", "new.txt"));
  });
  it("resolves relative link text from the real target of a symlinked directory", () => {
    expect(canonicalizeTarget(nodePath.join(real, "repo", "s", "link"))).toBe(nodePath.join(real, "other", "new.txt"));
  });
  it("resolves `sub/../x` from the real target of `sub`, not lexically", () => {
    expect(canonicalizeTarget(nodePath.join(real, "d", "lnk"))).toBe(nodePath.join(real, "elsewhere", "x"));
  });
  it("re-appends a missing tail below a dangling link", () => {
    expect(canonicalizeTarget(nodePath.join(real, "repo", "rel", "x", "y"))).toBe(
      nodePath.join(real, "other", "new.txt", "x", "y"),
    );
  });
  it("a symlink loop throws (bounded hops)", () => {
    expect(() => canonicalizeTarget(nodePath.join(real, "repo", "a"))).toThrow();
  });
  it("a plain missing nested target keeps the old behaviour", () => {
    expect(canonicalizeTarget(nodePath.join(real, "repo", "new", "deep", "a.txt"))).toBe(
      nodePath.join(real, "repo", "new", "deep", "a.txt"),
    );
  });
  it("defaultResolveEnv supplies isSymlink / readlink", () => {
    const env = defaultResolveEnv();
    expect(env.isSymlink?.(nodePath.join(real, "repo", "abs"))).toBe(true);
    expect(env.isSymlink?.(nodePath.join(real, "repo"))).toBe(false);
    expect(env.isSymlink?.(nodePath.join(real, "missing"))).toBe(false);
    expect(env.readlink?.(nodePath.join(real, "repo", "rel"))).toBe("../other/new.txt");
  });
  it("a legacy env literal without isSymlink/readlink keeps the old result", () => {
    const legacy = posixEnv({
      realpathSync: (p) => {
        if (["/", "/w", "/w/repo"].includes(p)) return p;
        throw new Error("ENOENT");
      },
    });
    expect(canonicalizeTarget("/w/repo/new/x.txt", legacy)).toBe("/w/repo/new/x.txt");
  });
});
