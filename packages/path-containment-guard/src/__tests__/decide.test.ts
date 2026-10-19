import type { ResolveEnv } from "@blackbelt-technology/pi-dashboard-shared/tool-path-resolve.js";
import { afterEach, describe, expect, it } from "vitest";
import { parseGuardConfig } from "../config.js";
import { decideGuard } from "../decide.js";
import { envOf, fakeEnv, type TmpTree, tmpTree } from "./helpers.js";

const cfgOf = (roots: string[], denied?: string[], resolveEnv?: ResolveEnv) =>
  parseGuardConfig(envOf(roots, denied), resolveEnv ? { resolveEnv } : {});

describe("decideGuard — denied tools (E6, E7, E18)", () => {
  const env = fakeEnv();
  it("E6 a denied path tool is rejected even in-root", () => {
    const cfg = cfgOf(["/w/repo"], ["write"]);
    expect(decideGuard("write", { path: "/w/repo/a.txt" }, "/w/repo", cfg, { env })).toMatchObject({
      allow: false,
      code: "tool_denied",
      tool: "write",
    });
  });
  it("E7 the name match is case-sensitive", () => {
    const cfg = cfgOf(["/w/repo"], ["Bash"]);
    expect(decideGuard("bash", { command: "ls" }, "/w/repo", cfg, { env })).toEqual({ allow: true });
  });
  it("E18 shell tools are never path-analysed; only denial rejects them", () => {
    const open = cfgOf(["/w/repo"]);
    expect(decideGuard("bash", { command: "cat /w/other/s" }, "/w/repo", open, { env })).toEqual({ allow: true });
    expect(decideGuard("powershell", { command: "x" }, "/w/repo", open, { env })).toEqual({ allow: true });
    const denied = cfgOf(["/w/repo"], ["bash", "powershell"]);
    expect(decideGuard("bash", {}, "/w/repo", denied, { env })).toMatchObject({ code: "tool_denied" });
    expect(decideGuard("powershell", {}, "/w/repo", denied, { env })).toMatchObject({ code: "tool_denied" });
    expect(decideGuard("mcp__srv__read_file", { path: "/etc/passwd" }, "/w/repo", denied, { env })).toEqual({ allow: true });
  });
});

describe("decideGuard — containment on a real temp tree (E8–E15)", () => {
  let t: TmpTree | undefined;
  afterEach(() => t?.cleanup());
  const setup = () => {
    t = tmpTree();
    t.dir("repo");
    t.file("repo/a.ts");
    t.dir("repo-old");
    t.dir("repo2");
    t.dir("other");
    return t;
  };

  it("E8 root, child inside; sibling prefixes and the parent outside", () => {
    const x = setup();
    const cfg = cfgOf([x.p("repo")]);
    const run = (p: string) => decideGuard("read", { path: p }, x.real, cfg);
    expect(run(x.p("repo"))).toEqual({ allow: true });
    expect(run(x.p("repo", "a.ts"))).toEqual({ allow: true });
    for (const out of [x.p("repo-old", "a"), x.real, x.p("repo2")]) {
      expect(run(out)).toMatchObject({ allow: false, code: "path_outside_roots" });
    }
  });

  it("E9 ~, @/abs, file:// are resolved like pi does; @<repo>/a is allowed", () => {
    const x = setup();
    const cfg = cfgOf([x.p("repo")]);
    const run = (p: string) => decideGuard("read", { path: p }, x.p("repo"), cfg);
    for (const bad of ["~/.ssh/id_rsa", "@/etc/hosts", "file:///etc/hosts"]) {
      expect(run(bad)).toMatchObject({ allow: false, code: "path_outside_roots" });
    }
    expect(run(`@${x.p("repo", "a.ts")}`)).toEqual({ allow: true });
  });

  it("E10 traversal out of the root reports the canonical target", () => {
    const x = setup();
    const cfg = cfgOf([x.p("repo")]);
    expect(decideGuard("read", { path: "../other/x.txt" }, x.p("repo"), cfg)).toMatchObject({
      allow: false,
      code: "path_outside_roots",
      canonical: x.p("other", "x.txt"),
    });
  });

  it("E11 a symlink escaping the root is rejected; a symlinked root admits its target", () => {
    const x = setup();
    x.link("repo/link", x.p("other"));
    x.link("rootlink", x.p("repo"));
    expect(
      decideGuard("edit", { path: x.p("repo", "link", "f.txt") }, x.real, cfgOf([x.p("repo")])),
    ).toMatchObject({ allow: false, code: "path_outside_roots" });
    expect(decideGuard("read", { path: x.p("repo", "a.ts") }, x.real, cfgOf([x.p("rootlink")]))).toEqual({ allow: true });
  });

  it("E12 dangling links (absolute, relative, relative under a symlinked dir) are rejected", () => {
    const x = setup();
    x.dir("other", "deep");
    x.link("repo/link", "../other/new.txt");
    x.link("repo/s", x.p("other", "deep"));
    x.link("other/deep/link", "../new.txt");
    x.link("repo/abs", x.p("other", "new2.txt"));
    const cfg = cfgOf([x.p("repo")]);
    const cases: Array<[string, string]> = [
      [x.p("repo", "link"), x.p("other", "new.txt")],
      [x.p("repo", "s", "link"), x.p("other", "new.txt")],
      [x.p("repo", "abs"), x.p("other", "new2.txt")],
    ];
    for (const [input, canonical] of cases) {
      expect(decideGuard("write", { path: input }, x.real, cfg)).toMatchObject({
        allow: false,
        code: "path_outside_roots",
        canonical,
      });
    }
  });

  it("E13 a not-yet-existing nested target inside the root is allowed", () => {
    const x = setup();
    expect(decideGuard("write", { path: x.p("repo", "new", "deep", "a.txt") }, x.real, cfgOf([x.p("repo")]))).toEqual({
      allow: true,
    });
  });

  it("E14 grep/find/ls: absent/empty/null path = cwd; nested root", () => {
    const x = setup();
    x.dir("repo", "sub");
    const cfg = cfgOf([x.p("repo", "sub")]);
    for (const tool of ["grep", "find", "ls"]) {
      for (const input of [{}, { path: "" }, { path: null }]) {
        expect(decideGuard(tool, input, x.p("repo"), cfg)).toMatchObject({
          allow: false,
          code: "path_outside_roots",
        });
      }
      expect(decideGuard(tool, { path: "sub/x" }, x.p("repo"), cfg)).toEqual({ allow: true });
    }
  });

  it("E15 a curly-quote variant symlink to an outside file is decided on the variant", () => {
    const x = setup();
    x.file("other/secret.txt");
    x.link("repo/it\u2019s.txt", x.p("other", "secret.txt"));
    const cfg = cfgOf([x.p("repo")]);
    expect(decideGuard("read", { path: x.p("repo", "it's.txt") }, x.real, cfg)).toMatchObject({
      allow: false,
      code: "path_outside_roots",
    });
  });
});

describe("decideGuard — case, validation (E16, E17)", () => {
  it("E16 case folds only when the volume probe says so", () => {
    const env = fakeEnv();
    const cfg = cfgOf(["/w/Repo"]);
    expect(
      decideGuard("read", { path: "/w/repo/a.ts" }, "/w", cfg, { env, volumeCaseProbe: () => false }),
    ).toMatchObject({ allow: false, code: "path_outside_roots" });
    expect(decideGuard("read", { path: "/w/repo/a.ts" }, "/w", cfg, { env, volumeCaseProbe: () => true })).toEqual({
      allow: true,
    });
  });

  it("E17 invalid path arguments are rejected as invalid_path", () => {
    const env = fakeEnv();
    const cfg = cfgOf(["/w/repo"]);
    for (const tool of ["read", "write", "edit"]) {
      for (const input of [{}, { path: "" }, { path: null }, { path: 7 }]) {
        expect(decideGuard(tool, input, "/w/repo", cfg, { env })).toMatchObject({ allow: false, code: "invalid_path" });
      }
    }
    expect(decideGuard("grep", { path: 7 }, "/w/repo", cfg, { env })).toMatchObject({ code: "invalid_path" });
    expect(decideGuard("read", { path: "a\0b" }, "/w/repo", cfg, { env })).toMatchObject({ code: "invalid_path" });
    expect(decideGuard("ls", { path: "a\0b" }, "/w/repo", cfg, { env })).toMatchObject({ code: "invalid_path" });
  });

  it("a non-object input is invalid_path for a gated tool", () => {
    const env = fakeEnv();
    expect(decideGuard("read", null, "/w/repo", cfgOf(["/w/repo"]), { env })).toMatchObject({ code: "invalid_path" });
  });
});

describe("decideGuard — resolver faults and latency (P1, X1/X2 core)", () => {
  let t: TmpTree | undefined;
  afterEach(() => t?.cleanup());

  it("a symlink loop throws out of decideGuard (the handler maps it to `error`)", () => {
    const x = tmpTree();
    t = x;
    x.dir("repo");
    x.link("repo/a", "b");
    x.link("repo/b", "a");
    expect(() => decideGuard("write", { path: x.p("repo", "a") }, x.real, cfgOf([x.p("repo")]))).toThrow();
  });

  it("a non-ENOENT realpath fault (EACCES) is never swallowed as 'missing'", () => {
    const cfg = cfgOf(["/w/repo"]);
    let failing = false;
    const faulty = fakeEnv({
      realpathSync: (p) => {
        if (failing) throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
        return p;
      },
    });
    expect(decideGuard("read", { path: "/w/repo/a.ts" }, "/w", cfg, { env: faulty })).toEqual({ allow: true });
    failing = true;
    expect(() => decideGuard("read", { path: "/w/repo/a.ts" }, "/w", cfg, { env: faulty })).toThrow(/EACCES/);
  });

  it("P1 in-root decisions: p95 < 1 ms after warm-up", () => {
    t = tmpTree();
    t.dir("repo");
    for (let i = 0; i < 20; i++) t.file(`repo/f${i}.ts`);
    const cfg = cfgOf([t.p("repo")]);
    decideGuard("read", { path: t.p("repo", "f0.ts") }, t.real, cfg);
    const samples: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const s = performance.now();
      const r = decideGuard("read", { path: t.p("repo", `f${i % 20}.ts`) }, t.real, cfg);
      samples.push(performance.now() - s);
      expect(r).toEqual({ allow: true });
    }
    samples.sort((a, b) => a - b);
    expect(samples[Math.floor(samples.length * 0.95)]).toBeLessThan(1);
  });
});
