import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { type EngineConfig, type EngineRequest, type EngineRunner, runEngine } from "../engine.js";
import { DocConverterError } from "../errors.js";

// Every request path lives under a per-suite mkdtemp root passed as
// `workspaceRoot` — `/in.md`-style paths (mount dir `/`) can never be admitted.
let tmp: string;
let ws: string;
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "docconv-eng-"));
  ws = join(tmp, "ws");
  await mkdir(ws, { recursive: true });
});
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const okRunner =
  (payload: object): EngineRunner =>
  async () => ({ stdout: JSON.stringify({ ok: true, ...payload }), stderr: "", exitCode: 0 });

function spyRunner() {
  return vi.fn<EngineRunner>(async () => ({
    stdout: JSON.stringify({ ok: true }),
    stderr: "",
    exitCode: 0,
  }));
}

/** Parse `-v src:dst[:ro]` pairs out of a recorded argv. */
function mountsOf(argv: string[]): { source: string; target: string; ro: boolean }[] {
  const out: { source: string; target: string; ro: boolean }[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "-v") continue;
    const parts = argv[i + 1].split(":");
    out.push({ source: parts[0], target: parts[1], ro: parts[2] === "ro" });
  }
  return out;
}

const cfg = (extra: Partial<EngineConfig> = {}): EngineConfig => ({
  image: "pi-doc-engine:test",
  workspaceRoot: ws,
  ...extra,
});

describe("runEngine envelope handling", () => {
  it("returns the ok envelope minus the ok flag", async () => {
    const out = join(ws, "out.docx");
    const res = await runEngine(cfg({ runner: okRunner({ output: out }) }), {
      command: "renderDocx",
      input: join(ws, "in.md"),
      output: out,
    });
    expect(res).toEqual({ output: out });
  });

  it("maps an error envelope to a typed DocConverterError", async () => {
    const runner: EngineRunner = async () => ({
      stdout: JSON.stringify({
        ok: false,
        error: { code: "INGEST_FAILED", message: "boom", stderr: "trace" },
      }),
      stderr: "",
      exitCode: 1,
    });
    await expect(
      runEngine(cfg({ runner }), { command: "convertToMarkdown", input: join(ws, "a.pdf") }),
    ).rejects.toMatchObject({ code: "INGEST_FAILED", message: "boom", stderr: "trace" });
  });

  it("rejects non-JSON stdout with BAD_RESPONSE on clean exit", async () => {
    const runner: EngineRunner = async () => ({ stdout: "not json", stderr: "", exitCode: 0 });
    await expect(
      runEngine(cfg({ runner }), { command: "renderPdf", input: join(ws, "a.md"), output: join(ws, "a.pdf") }),
    ).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });

  it("rejects non-JSON stdout with ENGINE_NONZERO on bad exit", async () => {
    const runner: EngineRunner = async () => ({ stdout: "", stderr: "docker: not found", exitCode: 127 });
    await expect(
      runEngine(cfg({ runner }), { command: "renderPdf", input: join(ws, "a.md"), output: join(ws, "a.pdf") }),
    ).rejects.toMatchObject({ code: "ENGINE_NONZERO", exitCode: 127 });
  });

  it("builds one bind mount per referenced dir (source realpath'd, target lexical)", async () => {
    const runner = spyRunner();
    await runEngine(cfg({ runner }), {
      command: "renderDocx",
      input: join(ws, "in.md"),
      output: join(ws, "out.docx"),
    });
    const argv = runner.mock.calls[0][0];
    expect(argv).toContain("pi-doc-engine:test");
    const ms = mountsOf(argv);
    // mount appears once even though two paths share ws
    expect(ms).toEqual([{ source: await realpath(ws), target: ws, ro: false }]);
  });

  // X6 — confinement adds no regression to the runner error path.
  it("surfaces DOCKER_UNAVAILABLE when the runner cannot spawn (allowed request)", async () => {
    const runner: EngineRunner = async () => {
      throw new DocConverterError({ code: "DOCKER_UNAVAILABLE", message: "no docker" });
    };
    await expect(
      runEngine(cfg({ runner }), { command: "renderPdf", input: join(ws, "a.md"), output: join(ws, "a.pdf") }),
    ).rejects.toMatchObject({ code: "DOCKER_UNAVAILABLE" });
  });
});

describe("runEngine confinement (D1)", () => {
  async function expectNotAllowed(c: EngineConfig, req: EngineRequest, runner = spyRunner()) {
    await expect(runEngine({ ...c, runner }, req)).rejects.toMatchObject({ code: "PATH_NOT_ALLOWED" });
    expect(runner).toHaveBeenCalledTimes(0);
  }

  it("E1 rejects a sensitive output outside the roots without running the engine", async () => {
    await expectNotAllowed(cfg(), {
      command: "renderPdf",
      input: join(ws, "a.md"),
      output: "/root/.ssh/authorized_keys",
    });
  });

  it("E1 PATH_NOT_ALLOWED message names the path and the configured roots", async () => {
    const err = await runEngine(cfg({ runner: spyRunner() }), {
      command: "renderPdf",
      input: join(ws, "a.md"),
      output: "/root/.ssh/authorized_keys",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(DocConverterError);
    expect(err.message).toContain("/root/.ssh/authorized_keys");
    expect(err.message).toContain(ws);
  });

  it("E2 rejects an input outside every root", async () => {
    await mkdir(join(tmp, "other"), { recursive: true });
    await expectNotAllowed(cfg(), { command: "convertToMarkdown", input: join(tmp, "other", "x.pdf") });
  });

  it("E3 rejects a symlink that escapes the root", async () => {
    const link = join(ws, "etclink");
    await symlink("/etc", link);
    await expectNotAllowed(cfg(), { command: "convertToMarkdown", input: join(link, "hosts") });
  });

  it("E4 mounts an in-root symlinked input as <real>:<lexical>:ro with the request unchanged", async () => {
    const real = join(ws, "real");
    await mkdir(real, { recursive: true });
    const link = join(ws, "inlink");
    await symlink(real, link);
    const runner = spyRunner();
    const input = join(link, "a.md");
    await runEngine(cfg({ runner }), { command: "convertToMarkdown", input });
    const [argv, stdin] = runner.mock.calls[0];
    expect(argv.join(" ")).toContain(`-v ${await realpath(real)}:${link}:ro`);
    expect(JSON.parse(stdin).input).toBe(input);
  });

  it("E5 mounts the root dir itself, never its parent", async () => {
    const runner = spyRunner();
    await runEngine(cfg({ runner }), { command: "fillFrontmatter", paths: [ws], apply: false });
    const ms = mountsOf(runner.mock.calls[0][0]);
    expect(ms).toHaveLength(1);
    expect(ms[0].target).toBe(ws);
    expect(ms.some((m) => m.target === tmp)).toBe(false);
  });

  it("E6 refuses `/` as a root (workspaceRoot and mounts)", async () => {
    const req = { command: "convertToMarkdown", input: join(ws, "a.pdf") };
    await expectNotAllowed(cfg({ workspaceRoot: "/" }), req);
    await expectNotAllowed(cfg({ mounts: ["/"] }), req);
  });

  describe("denylist under a fake HOME", () => {
    let home: string;
    const savedHome = process.env.HOME;
    beforeAll(async () => {
      home = join(tmp, "home");
      await mkdir(join(home, ".pi", "agent"), { recursive: true });
      await mkdir(join(home, ".pi", "x"), { recursive: true });
      await mkdir(join(home, ".ssh"), { recursive: true });
    });
    afterEach(() => {
      process.env.HOME = savedHome;
    });

    it("E7 containing-root exception decision table", async () => {
      process.env.HOME = home;
      const roots = cfg({ workspaceRoot: home, mounts: [join(home, ".pi", "x")] });
      // (a) only containing root is HOME → reject
      await expectNotAllowed(roots, { command: "convertToMarkdown", input: join(home, ".pi", "agent", "auth.json") });
      // (b) a root inside ~/.pi contains the path → accept
      const rb = spyRunner();
      await runEngine({ ...roots, runner: rb }, { command: "convertToMarkdown", input: join(home, ".pi", "x", "a.docx") });
      expect(rb).toHaveBeenCalledTimes(1);
      // (c) workspaceRoot inside ~/.pi/agent → accept
      const rc = spyRunner();
      await runEngine(
        cfg({ workspaceRoot: join(home, ".pi", "agent"), runner: rc }),
        { command: "convertToMarkdown", input: join(home, ".pi", "agent", "b.docx") },
      );
      expect(rc).toHaveBeenCalledTimes(1);
      // (d) ~/.ssh under HOME root → reject
      await expectNotAllowed(roots, { command: "convertToMarkdown", input: join(home, ".ssh", "id") });
    });

    it("E8 compares denylist entries by realpath too", async () => {
      const home2 = join(tmp, "home2");
      await mkdir(join(home2, "realpi", "agent"), { recursive: true });
      await symlink(join(home2, "realpi"), join(home2, ".pi"));
      process.env.HOME = home2;
      await expectNotAllowed(cfg({ workspaceRoot: home2 }), {
        command: "convertToMarkdown",
        input: join(home2, "realpi", "agent", "x.md"),
      });
    });
  });

  it("E9 per-command mount mode table", async () => {
    const a = join(ws, "e9", "a");
    const b = join(ws, "e9", "b");
    await mkdir(a, { recursive: true });
    await mkdir(b, { recursive: true });
    const modes = async (req: EngineRequest) => {
      const runner = spyRunner();
      await runEngine(cfg({ runner }), req);
      return Object.fromEntries(mountsOf(runner.mock.calls[0][0]).map((m) => [m.target, m.ro ? "ro" : "rw"]));
    };
    const inA = join(a, "in.md");
    const outB = join(b, "out.x");
    expect(await modes({ command: "convertToMarkdown", input: inA })).toEqual({ [a]: "ro" });
    expect(await modes({ command: "renderPdf", input: inA, output: outB })).toEqual({ [a]: "ro", [b]: "rw" });
    expect(await modes({ command: "renderDocx", input: inA, output: outB })).toEqual({ [a]: "rw", [b]: "rw" });
    expect(await modes({ command: "extractForEdit", input: inA, output: outB })).toEqual({ [a]: "rw", [b]: "rw" });
    expect(await modes({ command: "mergeBack", original: inA, edited: inA, output: outB })).toEqual({
      [a]: "rw",
      [b]: "rw",
    });
    for (const command of ["fillFrontmatter", "profileTables"]) {
      expect(await modes({ command, paths: [inA], apply: false })).toEqual({ [a]: "ro" });
      expect(await modes({ command, paths: [inA], apply: true })).toEqual({ [a]: "rw" });
    }
    // shared in/out dir → one rw mount
    expect(await modes({ command: "renderPdf", input: inA, output: join(a, "out.pdf") })).toEqual({ [a]: "rw" });
  });

  it("E10 mounts the deepest glob-free ancestor of a glob path", async () => {
    await mkdir(join(ws, "spec"), { recursive: true });
    const runner = spyRunner();
    await runEngine(cfg({ runner }), { command: "fillFrontmatter", paths: [join(ws, "spec", "**", "*.md")] });
    expect(mountsOf(runner.mock.calls[0][0]).map((m) => m.target)).toEqual([join(ws, "spec")]);
  });

  it("E11 leaves relative paths unmounted and unrejected", async () => {
    const runner = spyRunner();
    await runEngine(cfg({ runner }), { command: "fillFrontmatter", paths: ["spec/a.md"] });
    expect(mountsOf(runner.mock.calls[0][0])).toEqual([]);
  });

  it("E12 admits a not-yet-existing output and mounts its parent rw", async () => {
    const runner = spyRunner();
    const out = join(ws, "new", "sub", "x.pdf");
    await runEngine(cfg({ runner }), { command: "renderPdf", input: join(ws, "a.md"), output: out });
    const ms = mountsOf(runner.mock.calls[0][0]);
    expect(ms.find((m) => m.target === join(ws, "new", "sub"))).toMatchObject({ ro: false });
  });

  it("rejects paths whose mount spec could be mis-parsed (`:`) or that carry `..`", async () => {
    await expectNotAllowed(cfg(), { command: "convertToMarkdown", input: join(ws, "a:b", "x.pdf") });
    await expectNotAllowed(cfg(), { command: "convertToMarkdown", input: `${ws}/sub/../../x.pdf` });
  });

  it("creates writable roots before checking and mounts them rw", async () => {
    const staging = join(ws, "fresh-staging");
    const runner = spyRunner();
    await runEngine(cfg({ runner, writable: [staging] }), { command: "convertToMarkdown", input: join(ws, "a.pdf") });
    expect(existsSync(staging)).toBe(true);
    expect(mountsOf(runner.mock.calls[0][0]).find((m) => m.target === staging)).toMatchObject({ ro: false });
  });

  it("E11b relative glob/nested values are ignored, writes to existing file", async () => {
    await writeFile(join(ws, "exists.md"), "x");
    const runner = spyRunner();
    await runEngine(cfg({ runner }), { command: "convertToMarkdown", input: join(ws, "exists.md") });
    expect(mountsOf(runner.mock.calls[0][0])).toEqual([{ source: await realpath(ws), target: ws, ro: true }]);
  });
});
