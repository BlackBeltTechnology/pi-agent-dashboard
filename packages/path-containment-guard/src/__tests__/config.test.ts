import nodePath from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseGuardConfig } from "../config.js";
import { decideGuard } from "../decide.js";
import { envOf, fakeEnv, type TmpTree, tmpTree } from "./helpers.js";

describe("parseGuardConfig + decideGuard — configuration (E1–E5)", () => {
  let t: TmpTree | undefined;
  afterEach(() => t?.cleanup());

  it("E1 relative and malformed root entries are ignored", () => {
    const env = fakeEnv();
    const cfg = parseGuardConfig(envOf(["/w/repo", "rel/dir", "", 7]), { resolveEnv: env });
    expect(cfg).toMatchObject({ ok: true, roots: ["/w/repo"] });
    expect(decideGuard("read", { path: "/w/repo/a.ts" }, "/w", cfg, { env })).toEqual({ allow: true });
    expect(decideGuard("read", { path: "rel/dir/x" }, "/w", cfg, { env })).toMatchObject({
      allow: false,
      code: "path_outside_roots",
    });
  });

  it("E2 a driveless Windows root is ignored → config_invalid", () => {
    const { path: _p, ...rest } = fakeEnv();
    const win = { ...rest, path: nodePath.win32, platform: "win32" as const };
    const cfg = parseGuardConfig(envOf(["\\w\\repo"]), { platform: "win32", resolveEnv: win });
    expect(cfg).toMatchObject({ ok: false, scope: "path" });
    expect(decideGuard("read", { path: "C:\\w\\repo\\a.ts" }, "C:\\w", cfg, { env: win })).toMatchObject({
      allow: false,
      code: "config_invalid",
    });
  });

  it("E3 a root that cannot be canonicalised (symlink loop) is ignored", () => {
    t = tmpTree();
    t.link("loop-a", t.p("loop-b"));
    t.link("loop-b", t.p("loop-a"));
    t.dir("repo");
    t.file("repo/a.ts");
    const cfg = parseGuardConfig(envOf([t.p("loop-a"), t.p("repo")]));
    expect(cfg).toMatchObject({ ok: true, roots: [t.p("repo")] });
    expect(decideGuard("read", { path: t.p("repo", "a.ts") }, t.real, cfg)).toEqual({ allow: true });
  });

  it.each([
    ["absent", undefined],
    ["not json", "not json"],
    ["{}", "{}"],
    ["[]", "[]"],
    ['["rel"]', '["rel"]'],
  ])("E4 unusable ALLOWED_ROOTS (%s) rejects path tools, leaves bash alone", (_n, raw) => {
    const env = fakeEnv();
    const cfg = parseGuardConfig(envOf(raw), { resolveEnv: env });
    expect(cfg.ok).toBe(false);
    expect(decideGuard("read", { path: "/w/repo/a.ts" }, "/w/repo", cfg, { env })).toMatchObject({
      allow: false,
      code: "config_invalid",
    });
    expect(decideGuard("bash", { command: "ls" }, "/w/repo", cfg, { env })).toEqual({ allow: true });
  });

  it.each([
    ["absent", undefined, true],
    ["[]", "[]", true],
    ["bash,write (not json)", "bash,write", false],
    ['{"a":1} (not an array)', '{"a":1}', false],
    ['["bash",7] (non-string)', '["bash",7]', false],
    ['["bash",""] (empty name)', '["bash",""]', false],
  ])("E5 DENIED_TOOLS %s", (_n, raw, allowsBoth) => {
    const env = fakeEnv();
    const cfg = parseGuardConfig(envOf(["/w/repo"], raw), { resolveEnv: env });
    const read = decideGuard("read", { path: "/w/repo/a.ts" }, "/w/repo", cfg, { env });
    const bash = decideGuard("bash", { command: "ls" }, "/w/repo", cfg, { env });
    if (allowsBoth) {
      expect(read).toEqual({ allow: true });
      expect(bash).toEqual({ allow: true });
    } else {
      expect(read).toMatchObject({ allow: false, code: "config_invalid" });
      expect(bash).toMatchObject({ allow: false, code: "config_invalid" });
    }
  });

  it("valid DENIED_TOOLS survives unusable ALLOWED_ROOTS (a denial is never lost)", () => {
    const env = fakeEnv();
    const cfg = parseGuardConfig(envOf("not json", ["bash"]), { resolveEnv: env });
    expect(decideGuard("bash", {}, "/w", cfg, { env })).toMatchObject({ allow: false, code: "tool_denied" });
    expect(decideGuard("read", { path: "/w/a" }, "/w", cfg, { env })).toMatchObject({ code: "config_invalid" });
  });
});
