import * as fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { buildOptions, decidePathAccess, type GateRoots } from "../decide.js";
import { canonicalizeTarget, type ResolveEnv, resolveToolPath } from "../resolve.js";

const posixEnv = (over: Partial<ResolveEnv> = {}): ResolveEnv => ({
  path: nodePath.posix,
  platform: "linux",
  homeDir: "/h",
  realpathSync: (p) => {
    // fake FS: only these directories exist
    if (["/", "/w", "/w/repo", "/w/other", "/h", "/etc", "/h/.ssh"].includes(p)) return p;
    throw new Error("ENOENT");
  },
  ...over,
});

const roots = (over: Partial<GateRoots> = {}): GateRoots => ({
  workspace: ["/w/repo"],
  readOnly: [],
  readWrite: [],
  grants: [],
  ...over,
});

const base = (env: ResolveEnv, over = {}) => ({
  access: "read" as const,
  cwd: "/w/repo",
  roots: roots(),
  sensitiveDirs: ["/h/.ssh", "/h/.pi"],
  isUngrantable: (s: string) => s === "/h" || s === "/" || s.startsWith("/h/.ssh"),
  env,
  caseInsensitive: false,
  ...over,
});

describe("decidePathAccess — resolution and containment (E1–E7, E11, E13–E17)", () => {
  const env = posixEnv();
  it("E1 in-root relative read", () => {
    expect(decidePathAccess({ ...base(env), rawPath: "src/a.ts" }).verdict).toBe("in-root");
  });
  it("E2 ../ traversal asks with canonical path", () => {
    const d = decidePathAccess({ ...base(env), rawPath: "../other/x.txt" });
    expect(d).toMatchObject({ verdict: "ask", canonical: "/w/other/x.txt" });
  });
  it("E3 tilde expands to home and is sensitive", () => {
    const d = decidePathAccess({ ...base(env), rawPath: "~/.ssh/id_rsa" });
    expect(d).toMatchObject({ verdict: "ask", canonical: "/h/.ssh/id_rsa", sensitive: true });
  });
  it("E4 @ marker is stripped (write)", () => {
    const d = decidePathAccess({ ...base(env), access: "write", rawPath: "@/etc/hosts" });
    expect(d).toMatchObject({ verdict: "ask", canonical: "/etc/hosts" });
  });
  it("E5 string-prefix sibling is not in-root", () => {
    expect(decidePathAccess({ ...base(env), rawPath: "/w/repo-old/a.txt" }).verdict).toBe("ask");
  });
  it("E7 non-existent nested target resolves via nearest ancestor", () => {
    const d = decidePathAccess({ ...base(env), access: "write", rawPath: "/w/repo/new/dir/f.txt" });
    expect(d).toMatchObject({ verdict: "in-root", canonical: "/w/repo/new/dir/f.txt" });
  });
  it("E11 checkout root admits siblings of the package dir", () => {
    const d = decidePathAccess({
      ...base(env, { cwd: "/w/repo/packages/a" }),
      roots: roots({ workspace: ["/w/repo/packages/a", "/w/repo"] }),
      rawPath: "/w/repo/README.md",
    });
    expect(d.verdict).toBe("in-root");
  });
  it("E12 cwd-only fallback asks for the checkout root", () => {
    const d = decidePathAccess({
      ...base(env, { cwd: "/w/repo/packages/a" }),
      roots: roots({ workspace: ["/w/repo/packages/a"] }),
      rawPath: "/w/repo/README.md",
    });
    expect(d.verdict).toBe("ask");
  });
  it("E13 read-only built-ins admit read, not edit", () => {
    const r = roots({ readOnly: ["/h/.pi/agent/skills/x"] });
    const read = decidePathAccess({ ...base(env), roots: r, rawPath: "/h/.pi/agent/skills/x/SKILL.md" });
    const edit = decidePathAccess({ ...base(env), roots: r, access: "write", rawPath: "/h/.pi/agent/skills/x/SKILL.md" });
    expect([read.verdict, edit.verdict]).toEqual(["in-root", "ask"]);
  });
  it("E14 read+write built-ins admit write", () => {
    const r = roots({ readWrite: ["/tmp"] });
    expect(decidePathAccess({ ...base(env), roots: r, access: "write", rawPath: "/tmp/pi-test.log" }).verdict).toBe("in-root");
  });
  it("E15 grant subtree admits descendants only", () => {
    const r = roots({ grants: ["/w/other"] });
    expect(decidePathAccess({ ...base(env), roots: r, rawPath: "/w/other/docs/a.md" }).verdict).toBe("in-root");
    expect(decidePathAccess({ ...base(env), roots: r, rawPath: "/w/other2/a.md" }).verdict).toBe("ask");
  });
});

describe("symlink escape (E6) — real filesystem", () => {
  it("canonical path follows the link; asks", () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), "pg-")));
    const repo = nodePath.join(tmp, "repo");
    const other = nodePath.join(tmp, "other");
    fs.mkdirSync(repo);
    fs.mkdirSync(other);
    fs.symlinkSync(other, nodePath.join(repo, "link"));
    const d = decidePathAccess({
      access: "write",
      rawPath: "link/f.txt",
      cwd: repo,
      roots: roots({ workspace: [repo] }),
      sensitiveDirs: [],
      isUngrantable: () => false,
    });
    expect(d).toMatchObject({ verdict: "ask", canonical: nodePath.join(other, "f.txt") });
  });
});

describe("win32 flavour (E9)", () => {
  const win = posixEnv({
    path: nodePath.win32,
    platform: "win32",
    homeDir: "C:\\Users\\u",
    realpathSync: (p) => {
      if (/^[A-Za-z]:\\?$/.test(p) || /^C:\\w(\\repo)?$/i.test(p) || /^D:\\?$/i.test(p)) return p;
      throw new Error("ENOENT");
    },
  });
  const wb = (rawPath: string, caseInsensitive = true) => ({
    ...base(win),
    cwd: "C:\\w\\repo",
    roots: roots({ workspace: ["C:\\w\\repo"] }),
    rawPath,
    caseInsensitive,
    env: win,
  });
  it("other drive and UNC ask; case-variant cwd is in-root when case-insensitive", () => {
    expect(decidePathAccess(wb("..\\x")).verdict).toBe("ask");
    expect(decidePathAccess(wb("D:\\x")).verdict).toBe("ask");
    expect(decidePathAccess(wb("\\\\srv\\share\\x")).verdict).toBe("ask");
    expect(decidePathAccess(wb("c:\\W\\REPO\\a")).verdict).toBe("in-root");
  });
});

describe("pi resolution parity (E8)", () => {
  it("matches pi's resolveToCwd over a fixture table", async () => {
    let piUtils: { resolveToCwd: (p: string, cwd: string) => string };
    try {
      // package.json is not in `exports`; walk node_modules up from this file instead.
      let dir = nodePath.dirname(new URL(import.meta.url).pathname);
      let dist = "";
      for (let i = 0; i < 12 && !dist; i++) {
        const cand = nodePath.join(dir, "node_modules/@earendil-works/pi-coding-agent/dist");
        if (fs.existsSync(cand)) dist = cand;
        dir = nodePath.dirname(dir);
      }
      piUtils = await import(pathToFileURL(nodePath.join(dist, "core/tools/path-utils.js")).href);
    } catch {
      throw new Error("pi path-utils not found — re-verify resolution");
    }
    const cwd = "/w/repo";
    const home = os.homedir();
    const fixtures = ["~/x", "~", "@/etc/x", "@~/x", `a\u00A0b.txt`, `a\u202Fb`, "../other", "/abs/p", "rel/p", "@rel/p"];
    for (const f of fixtures) {
      const expected = piUtils.resolveToCwd(f, cwd);
      const got = resolveToolPath(f, cwd, { ...posixEnv(), platform: process.platform, path: nodePath, homeDir: home });
      expect(got, f).toBe(expected);
    }
  });
});

describe("canonicalizeTarget", () => {
  it("re-appends the missing tail onto the real ancestor", () => {
    const env = posixEnv({ realpathSync: (p) => (p === "/w" ? "/real/w" : (() => { throw new Error("x"); })()) });
    expect(canonicalizeTarget("/w/a/b.txt", env)).toBe("/real/w/a/b.txt");
  });
});

describe("buildOptions (E18, E19)", () => {
  const ok = { grantable: true, sensitive: false, storeMatch: true, subject: "/w/other/docs" };
  it("offers Always allow only for grantable + matching store; names the directory only", () => {
    expect(buildOptions(ok).options).toEqual(["Allow once", "Always allow /w/other/docs…", "Deny"]);
  });
  it.each([
    ["store mismatch / no identity", { ...ok, storeMatch: false }, "can't be remembered here"],
    ["ungrantable (home)", { ...ok, grantable: false, subject: "/h" }, "isn't available"],
    ["sensitive ungrantable", { ...ok, grantable: false, sensitive: true }, "isn't available"],
  ])("withholds Always allow: %s", (_n, input, note) => {
    const o = buildOptions(input);
    expect(o.options).toEqual(["Allow once", "Deny"]);
    expect(o.note).toContain(note);
  });
});
