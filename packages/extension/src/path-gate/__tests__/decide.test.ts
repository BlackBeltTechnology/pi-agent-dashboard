import * as fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { buildOptions, decidePathAccess, type GateRoots } from "../decide.js";
import { canonicalizeTarget, defaultResolveEnv, type ResolveEnv, resolveReadTarget, resolveToolPath } from "../resolve.js";

// fake FS: only these directories exist (no files, so pi's read variant fallback never kicks in)
const FAKE_DIRS = ["/", "/w", "/w/repo", "/w/other", "/h", "/etc", "/h/.ssh"];
const posixEnv = (over: Partial<ResolveEnv> = {}): ResolveEnv => ({
  path: nodePath.posix,
  platform: "linux",
  homeDir: "/h",
  realpathSync: (p) => {
    if (FAKE_DIRS.includes(p)) return p;
    throw new Error("ENOENT");
  },
  exists: (p) => FAKE_DIRS.includes(p),
  isDirectory: () => false,
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

describe("case sensitivity is probed from the volume (review B1)", () => {
  const darwin = (over: Partial<ResolveEnv> = {}) => posixEnv({ platform: "darwin", ...over });
  const run = (probe: (p: string) => boolean, raw: string) =>
    decidePathAccess({
      ...base(darwin()),
      caseInsensitive: undefined,
      volumeCaseProbe: probe,
      rawPath: raw,
    } as never);

  it("a case-SENSITIVE volume (darwin host, APFS-cs) never folds: a case-variant path asks", () => {
    expect(run(() => false, "/W/Repo/a.txt").verdict).toBe("ask");
    expect(run(() => false, "/w/repo/a.txt").verdict).toBe("in-root"); // exact match unaffected
  });

  it("a case-INSENSITIVE volume folds: the case-variant path is in-root", () => {
    expect(run(() => true, "/W/Repo/a.txt").verdict).toBe("in-root");
  });

  it("the probe is consulted only after the exact check fails (hot path stays probe-free)", () => {
    let calls = 0;
    const d = decidePathAccess({ ...base(posixEnv()), rawPath: "src/a.ts", volumeCaseProbe: () => { calls++; return true; } } as never);
    expect(d.verdict).toBe("in-root");
    expect(calls).toBe(0);
  });
});

describe("grant subject = the directory itself when the target is a directory (review r3/B1)", () => {
  const withDirs = (dirs: string[]) => posixEnv({ isDirectory: (p) => dirs.includes(p) });
  it("a gated existing DIRECTORY names itself, never its parent", () => {
    const d = decidePathAccess({ ...base(withDirs(["/w/other/docs"])), rawPath: "/w/other/docs" });
    expect(d).toMatchObject({ verdict: "ask", subject: "/w/other/docs", suppressionKey: "/w/other" });
  });
  it("a gated FILE names its containing directory", () => {
    const d = decidePathAccess({ ...base(withDirs(["/w/other/docs"])), rawPath: "/w/other/docs/a.md" });
    expect(d).toMatchObject({ verdict: "ask", subject: "/w/other/docs" });
  });
  it("a not-yet-existing target names its (lexical) parent", () => {
    const d = decidePathAccess({ ...base(withDirs([])), access: "write", rawPath: "/w/other/new.txt" });
    expect(d).toMatchObject({ verdict: "ask", subject: "/w/other" });
  });
});

describe("read follows pi's filename-variant fallback (review r3/B2)", () => {
  const NNBSP = "\u202F";
  it("parity with pi resolveReadPath over AM/PM, NFD, curly-quote and combined variants", async () => {
    let dist = "";
    let dir = nodePath.dirname(new URL(import.meta.url).pathname);
    for (let i = 0; i < 12 && !dist; i++) {
      const cand = nodePath.join(dir, "node_modules/@earendil-works/pi-coding-agent/dist");
      if (fs.existsSync(cand)) dist = cand;
      dir = nodePath.dirname(dir);
    }
    let pi: { resolveReadPath: (p: string, cwd: string) => string };
    try {
      pi = await import(pathToFileURL(nodePath.join(dist, "core/tools/path-utils.js")).href);
    } catch {
      throw new Error("pi path-utils not found — re-verify resolution");
    }
    const tmp = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), "pg-variant-")));
    const names = [
      `Screenshot 2024-01-01 at 10.00.00${NNBSP}AM.png`, // AM/PM narrow-space variant exists
      "caf\u00e9.txt".normalize("NFD"), // NFD variant exists
      "it\u2019s.txt", // curly-quote variant exists
      "l\u2019\u00e9cran.txt".normalize("NFD"), // combined NFD + curly
    ];
    for (const n of names) fs.writeFileSync(nodePath.join(tmp, n), "x");
    const asked = [
      "Screenshot 2024-01-01 at 10.00.00 AM.png",
      "caf\u00e9.txt".normalize("NFC"),
      "it's.txt",
      "l'\u00e9cran.txt".normalize("NFC"),
      "absent.txt",
    ];
    for (const a of asked) {
      const expected = pi.resolveReadPath(a, tmp);
      expect(resolveReadTarget(nodePath.join(tmp, a), defaultResolveEnv()), a).toBe(expected);
    }
  });

  it("a variant that is an ESCAPING symlink is what the gate decides on (not the literal missing name)", () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), "pg-variant2-")));
    const repo = nodePath.join(tmp, "repo");
    const outside = nodePath.join(tmp, "outside.txt");
    fs.mkdirSync(repo);
    fs.writeFileSync(outside, "secret");
    fs.symlinkSync(outside, nodePath.join(repo, "a\u2019b")); // in-root curly name → outside file
    const decide = (access: "read" | "write") =>
      decidePathAccess({
        access,
        rawPath: "a'b", // literal straight-quote name does not exist
        cwd: repo,
        roots: roots({ workspace: [repo] }),
        sensitiveDirs: [],
        isUngrantable: () => false,
      });
    const read = decide("read");
    expect(read).toMatchObject({ verdict: "ask", canonical: outside });
    // write/edit use resolveToCwd (no variant fallback): the literal in-root name stands.
    expect(decide("write").verdict).toBe("in-root");
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
