import { afterEach, describe, expect, it, vi } from "vitest";
import { parseGuardConfig } from "../config.js";
import { createGuardExtension, type GuardExtensionDeps } from "../extension.js";
import { envOf, fakeEnv, type TmpTree, tmpTree } from "./helpers.js";

type Handler = (event: unknown, ctx: unknown) => Promise<{ block: true; reason: string } | undefined> | undefined;

function load(deps: GuardExtensionDeps) {
  const handlers: Array<[string, Handler]> = [];
  const pi = { on: (evt: string, h: Handler) => void handlers.push([evt, h]) };
  createGuardExtension(deps)(pi as never);
  return handlers;
}

const lines: string[] = [];
const baseDeps = (env: Record<string, string>, over: Partial<GuardExtensionDeps> = {}): GuardExtensionDeps => ({
  env,
  resolveEnv: fakeEnv(),
  log: (l) => lines.push(l),
  ...over,
});
const call = async (h: Handler, toolName: string, input: unknown, ctx: unknown = { cwd: "/w/repo" }) =>
  h({ type: "tool_call", toolName, toolCallId: "tc", input }, ctx);

afterEach(() => {
  lines.length = 0;
});

describe("guard extension handler (X1–X6)", () => {
  let t: TmpTree | undefined;
  afterEach(() => t?.cleanup());

  it("registers exactly one tool_call handler", () => {
    const handlers = load(baseDeps(envOf(["/w/repo"])));
    expect(handlers.map(([e]) => e)).toEqual(["tool_call"]);
  });

  it("X1 a resolver fault blocks as `error` with one stderr line", async () => {
    let failing = false;
    const resolveEnv = fakeEnv({
      realpathSync: (p) => {
        if (failing) throw Object.assign(new Error("EACCES"), { code: "EACCES" });
        return p;
      },
    });
    const [[, h]] = load(baseDeps(envOf(["/w/repo"]), { resolveEnv }));
    failing = true;
    const r = await call(h, "read", { path: "/w/repo/a.ts" });
    expect(r).toMatchObject({ block: true });
    expect(r?.reason.startsWith("error")).toBe(true);
    expect(lines).toHaveLength(1);
  });

  it("X2 a symlink loop blocks as `error` without hanging", async () => {
    t = tmpTree();
    t.dir("repo");
    t.link("repo/a", "b");
    t.link("repo/b", "a");
    const [[, h]] = load({ env: envOf([t.p("repo")]), log: (l) => lines.push(l) });
    const r = await call(h, "write", { path: t.p("repo", "a") }, { cwd: t.p("repo") });
    expect(r?.reason.startsWith("error")).toBe(true);
  }, 5000);

  it("X3 a config parse that throws still registers one handler that blocks everything", async () => {
    const handlers = load(
      baseDeps(envOf(["/w/repo"]), {
        parseConfig: () => {
          throw new Error("boom");
        },
      }),
    );
    expect(handlers).toHaveLength(1);
    const h = handlers[0][1];
    expect((await call(h, "read", { path: "/w/repo/a.ts" }))?.reason.startsWith("config_invalid")).toBe(true);
    expect((await call(h, "bash", { command: "ls" }))?.reason.startsWith("config_invalid")).toBe(true);
  });

  it("X4 never touches the UI", async () => {
    const [[, h]] = load(baseDeps(envOf(["/w/repo"])));
    const boom = vi.fn(() => {
      throw new Error("ui used");
    });
    const ctx = { cwd: "/w/repo", hasUI: true, ui: { confirm: boom, select: boom, input: boom, notify: boom } };
    const r = await call(h, "write", { path: "/w/other/a.txt" }, ctx);
    expect(r?.reason.startsWith("path_outside_roots")).toBe(true);
    expect(boom).not.toHaveBeenCalled();
  });

  it("X5 control characters in a logged path are escaped (one line)", async () => {
    const [[, h]] = load(baseDeps(envOf(["/w/repo"])));
    await call(h, "read", { path: "/w/other/a\nFORGED [path-containment-guard] ok\u2028b" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/[\n\r\u2028\u2029]/);
    expect(lines[0]).toContain("\\n");
    expect(lines[0]).toContain("\\u2028");
    expect(lines[0]).toContain("path_outside_roots");
    expect(lines[0]).toContain("tool=read");
  });

  it("X6 every reason starts with its code; the roots suffix only on path_outside_roots", async () => {
    const cfgEnv = envOf(["/w/repo"], ["bash"]);
    const [[, h]] = load(baseDeps(cfgEnv));
    const denied = await call(h, "bash", { command: "ls" });
    const outside = await call(h, "read", { path: "/w/other/x" });
    const invalid = await call(h, "read", { path: 7 });
    expect(denied?.reason.startsWith("tool_denied")).toBe(true);
    expect(outside?.reason.startsWith("path_outside_roots")).toBe(true);
    expect(outside?.reason).toContain("— allowed roots: /w/repo");
    expect(invalid?.reason.startsWith("invalid_path")).toBe(true);
    const [[, h2]] = load(baseDeps(envOf("not json")));
    const cfgBad = await call(h2, "read", { path: "/w/repo/a" });
    expect(cfgBad?.reason.startsWith("config_invalid")).toBe(true);
    let failing = false;
    const faulty = fakeEnv({
      realpathSync: (p) => {
        if (failing) throw Object.assign(new Error("x"), { code: "EIO" });
        return p;
      },
    });
    const [[, h3]] = load(baseDeps(cfgEnv, { resolveEnv: faulty }));
    failing = true;
    const err = await call(h3, "read", { path: "/w/repo/a" });
    expect(err?.reason.startsWith("error")).toBe(true);
    for (const r of [denied, invalid, cfgBad, err]) expect(r?.reason).not.toContain("allowed roots");
  });

  it("allows an in-root read and a non-gated tool (handler returns undefined)", async () => {
    const [[, h]] = load(baseDeps(envOf(["/w/repo"])));
    expect(await call(h, "read", { path: "/w/repo/a.ts" })).toBeUndefined();
    expect(await call(h, "bash", { command: "ls" })).toBeUndefined();
    expect(lines).toHaveLength(0);
  });

  it("uses process.cwd() when ctx has no cwd", async () => {
    const [[, h]] = load(baseDeps(envOf([process.cwd()]), { resolveEnv: undefined }));
    expect(await call(h, "ls", {}, {})).toBeUndefined();
  });

  it("parseGuardConfig stays pure over the injected env", () => {
    expect(parseGuardConfig(envOf(["/w/repo"]), { resolveEnv: fakeEnv() })).toMatchObject({ ok: true });
  });
});
