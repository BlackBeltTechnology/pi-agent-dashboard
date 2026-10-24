/**
 * `pi-blender mcp --register`: opt-in write of one `blender-wasm` entry into `<cwd>/.pi/mcp.json`.
 * Merge semantics, `--root` realpath, refusal of unsafe targets, notes. (Implicit-registration absence is
 * E62 in cli.test.ts.)
 *
 * See change: add-blender-wasm-mcp (test-plan E59–E61, E63, E64; tasks 5.8–5.10, 5.12, 5.13).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../bin/blender.js";
import { defaultLauncherPath, registerMcp, SERVER_NAME } from "../mcp-register.js";

const tmpDirs: string[] = [];
const tmp = (): string => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "blender-reg-")));
  tmpDirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function project(markers: string[] = [".git"]): string {
  const d = tmp();
  for (const m of markers) fs.mkdirSync(path.join(d, m));
  return d;
}
const mcpFile = (cwd: string): string => path.join(cwd, ".pi", "mcp.json");
const writeMcp = (cwd: string, content: string): void => {
  fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
  fs.writeFileSync(mcpFile(cwd), content);
};
const readMcp = (cwd: string) => JSON.parse(fs.readFileSync(mcpFile(cwd), "utf8")) as { mcpServers: Record<string, Record<string, unknown>> } & Record<string, unknown>;

const LAUNCHER = path.join(path.parse(process.cwd()).root, "fake", "bin", "pi-blender");
function run(cwd: string, root?: string) {
  const err: string[] = [];
  const code = registerMcp({ cwd, execPath: process.execPath, launcher: LAUNCHER, root, stderr: (t) => err.push(t) });
  return { code, err: err.join("") };
}

/** Symlink creation can need privilege on Windows; report false so the case can bail out. */
function trySymlink(target: string, link: string, type: "file" | "dir"): boolean {
  try {
    fs.symlinkSync(target, link, type === "dir" && process.platform === "win32" ? "junction" : type);
    return true;
  } catch (e) {
    if (process.platform === "win32" && ["EPERM", "EACCES"].includes((e as NodeJS.ErrnoException).code ?? "")) return false;
    throw e;
  }
}

describe("mcp --register", () => {
  it("creates the file with only mcpServers['blender-wasm'] = {command: execPath, args: [launcher, 'mcp']}", () => {
    const cwd = project();
    const { code, err } = run(cwd);
    expect(code).toBe(0);
    const cfg = readMcp(cwd);
    expect(Object.keys(cfg)).toEqual(["mcpServers"]);
    expect(Object.keys(cfg.mcpServers)).toEqual([SERVER_NAME]);
    expect(SERVER_NAME).toBe("blender-wasm");
    expect(cfg.mcpServers[SERVER_NAME]).toEqual({ command: process.execPath, args: [LAUNCHER, "mcp"] });
    expect(err).toContain(`registered "blender-wasm" in ${mcpFile(cwd)}`);
    expect(fs.readdirSync(path.join(cwd, ".pi"))).toEqual(["mcp.json"]);
  });

  it("defaultLauncherPath resolves to the package's bin/pi-blender from src/", () => {
    const p = defaultLauncherPath();
    expect(path.isAbsolute(p)).toBe(true);
    expect(p).toMatch(/packages[\\/]blender[\\/]bin[\\/]pi-blender$/);
    expect(fs.existsSync(p)).toBe(true);
  });

  it("E59: adds blender-wasm next to an existing `blender` entry; that entry and every other key stay byte-equal", () => {
    const cwd = project();
    const blender = { command: "blender", args: ["--background", "--python", "x.py"], env: { A: "1" }, note: [1, { k: null }] };
    writeMcp(cwd, JSON.stringify({ extra: { keep: true }, mcpServers: { blender, other: { url: "u" } } }, null, 2));
    const before = JSON.stringify(blender);
    const { code } = run(cwd);
    expect(code).toBe(0);
    const cfg = readMcp(cwd);
    expect(JSON.stringify(cfg.mcpServers.blender)).toBe(before);
    expect(cfg.mcpServers.other).toEqual({ url: "u" });
    expect(cfg.extra).toEqual({ keep: true });
    const entry = cfg.mcpServers["blender-wasm"] as { command: string; args: string[] };
    expect(entry.command).toBe(process.execPath);
    expect(entry.args.at(-1)).toBe("mcp");
    expect(entry.args).toEqual([LAUNCHER, "mcp"]);
  });

  it("E60: an existing blender-wasm entry is merged — command/args replaced, enabled:false and env kept", () => {
    const cwd = project();
    writeMcp(cwd, JSON.stringify({ mcpServers: { "blender-wasm": { enabled: false, env: { A: "1" }, command: "x", args: [] } } }));
    expect(run(cwd).code).toBe(0);
    expect(readMcp(cwd).mcpServers["blender-wasm"]).toEqual({ enabled: false, env: { A: "1" }, command: process.execPath, args: [LAUNCHER, "mcp"] });
  });

  it("E60: re-registering with a different --root replaces only args; cwd and exposure keys survive", () => {
    const cwd = project();
    fs.mkdirSync(path.join(cwd, "assets"));
    writeMcp(cwd, JSON.stringify({ mcpServers: { "blender-wasm": { command: "old", args: ["old"], cwd: "/somewhere", directTools: ["blender_scene"] } } }));
    expect(run(cwd, "assets").code).toBe(0);
    expect(readMcp(cwd).mcpServers["blender-wasm"]).toEqual({
      command: process.execPath,
      args: [LAUNCHER, "mcp", "--root", path.join(cwd, "assets")],
      cwd: "/somewhere",
      directTools: ["blender_scene"],
    });
  });

  it("E60: a non-object blender-wasm value is replaced by a fresh entry", () => {
    const cwd = project();
    writeMcp(cwd, JSON.stringify({ mcpServers: { "blender-wasm": "bogus" } }));
    expect(run(cwd).code).toBe(0);
    expect(readMcp(cwd).mcpServers["blender-wasm"]).toEqual({ command: process.execPath, args: [LAUNCHER, "mcp"] });
  });

  it("E61: --root assets (a symlink to /w/real) is stored as the absolute real path", (ctx) => {
    const cwd = project();
    const real = path.join(tmp(), "real");
    fs.mkdirSync(real);
    if (!trySymlink(real, path.join(cwd, "assets"), "dir")) return ctx.skip();
    expect(run(cwd, "assets").code).toBe(0);
    const { args } = readMcp(cwd).mcpServers["blender-wasm"] as { args: string[] };
    expect(args.slice(-3)).toEqual(["mcp", "--root", fs.realpathSync(real)]);
    expect(path.isAbsolute(args.at(-1) as string)).toBe(true);
  });

  it("E61: a plain relative --root becomes an absolute path; a missing or non-directory root exits 1 with the file untouched", () => {
    const cwd = project();
    fs.mkdirSync(path.join(cwd, "work"));
    fs.writeFileSync(path.join(cwd, "file.txt"), "x");
    expect(run(cwd, "work").code).toBe(0);
    expect((readMcp(cwd).mcpServers["blender-wasm"] as { args: string[] }).args.slice(-2)).toEqual(["--root", path.join(cwd, "work")]);
    const before = fs.readFileSync(mcpFile(cwd), "utf8");
    for (const bad of ["nope", "file.txt"]) {
      const r = run(cwd, bad);
      expect(r.code, bad).toBe(1);
      expect(r.err).toContain(`--root ${bad}`);
      expect(fs.readFileSync(mcpFile(cwd), "utf8")).toBe(before);
    }
  });

  it("E61: `main` forwards --root to the register dep", async () => {
    const cwd = project();
    fs.mkdirSync(path.join(cwd, "assets"));
    const err: string[] = [];
    const code = await main(["mcp", "--register", "--root", "assets"], {
      stderr: (t) => err.push(t),
      register: ({ root }) => registerMcp({ cwd, execPath: process.execPath, launcher: LAUNCHER, root, stderr: (t) => err.push(t) }),
    });
    expect(code).toBe(0);
    expect((readMcp(cwd).mcpServers["blender-wasm"] as { args: string[] }).args).toEqual([LAUNCHER, "mcp", "--root", path.join(cwd, "assets")]);
  });

  it("writes atomically: no temp file is left behind", () => {
    const cwd = project();
    expect(run(cwd).code).toBe(0);
    expect(fs.readdirSync(path.join(cwd, ".pi"))).toEqual(["mcp.json"]);
  });
});

describe("unsafe targets", () => {
  const CASES: { name: string; content: string }[] = [
    { name: "invalid JSON", content: "{ not json" },
    { name: "a JSON array root", content: "[1,2]" },
    { name: "JSON null", content: "null" },
    { name: "mcpServers an array", content: '{"mcpServers":[]}' },
    { name: "mcpServers null", content: '{"mcpServers":null}' },
    { name: "mcpServers a string", content: '{"mcpServers":"x"}' },
  ];
  for (const c of CASES) {
    it(`E63: ${c.name} → file byte-identical, exit 1, stderr names the file`, () => {
      const cwd = project();
      writeMcp(cwd, c.content);
      const { code, err } = run(cwd);
      expect(code).toBe(1);
      expect(err).toContain("mcp.json");
      expect(fs.readFileSync(mcpFile(cwd), "utf8")).toBe(c.content);
      expect(fs.readdirSync(path.join(cwd, ".pi"))).toEqual(["mcp.json"]);
    });
  }

  it("E63: a symlinked mcp.json → refused, exit 1, the link and its target are byte-identical", (ctx) => {
    const cwd = project();
    const outside = path.join(tmp(), "real-mcp.json");
    const original = '{"mcpServers":{"keep":{"command":"k"}}}';
    fs.writeFileSync(outside, original);
    fs.mkdirSync(path.join(cwd, ".pi"));
    if (!trySymlink(outside, mcpFile(cwd), "file")) return ctx.skip();
    const { code, err } = run(cwd);
    expect(code).toBe(1);
    expect(err).toMatch(/symbolic link/);
    expect(fs.lstatSync(mcpFile(cwd)).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(outside, "utf8")).toBe(original);
    expect(fs.readdirSync(path.dirname(outside))).toEqual(["real-mcp.json"]);
  });

  it("E63: a symlinked .pi → refused, exit 1, nothing written through it", (ctx) => {
    const cwd = project([]);
    const realPi = path.join(tmp(), "real-pi");
    fs.mkdirSync(realPi);
    const original = '{"mcpServers":{"keep":{"command":"k"}}}';
    fs.writeFileSync(path.join(realPi, "mcp.json"), original);
    if (!trySymlink(realPi, path.join(cwd, ".pi"), "dir")) return ctx.skip();
    const { code, err } = run(cwd);
    expect(code).toBe(1);
    expect(err).toMatch(/symbolic link/);
    expect(fs.readFileSync(path.join(realPi, "mcp.json"), "utf8")).toBe(original);
    expect(fs.readdirSync(realPi)).toEqual(["mcp.json"]);
  });

  it("E63: a dangling symlinked mcp.json is refused too (never written through)", (ctx) => {
    const cwd = project();
    const target = path.join(tmp(), "does-not-exist.json");
    fs.mkdirSync(path.join(cwd, ".pi"));
    if (!trySymlink(target, mcpFile(cwd), "file")) return ctx.skip();
    expect(run(cwd).code).toBe(1);
    expect(fs.existsSync(target)).toBe(false);
  });
});

describe("notes", () => {
  it("E64: a directory without .git and .pi/ registers, prints the 4 notes and the not-a-project-root warning", () => {
    const cwd = project([]);
    const { code, err } = run(cwd);
    expect(code).toBe(0);
    expect(fs.existsSync(mcpFile(cwd))).toBe(true);
    const notes = err.split("\n").filter((l) => l.trim().startsWith("note:"));
    expect(notes).toHaveLength(4);
    expect(err).toMatch(/machine-specific/);
    expect(err).toMatch(/project is trusted/);
    expect(err).toMatch(/start pi in the project root/);
    expect(err).toContain("pi-blender ensure");
    expect(err).toMatch(/warning: .* does not look like a project root \(no \.git or \.pi\/\)/);
    expect(err).toContain(cwd);
  });

  it("E64: with .git or an existing .pi/ the four notes print and the warning does not", () => {
    for (const marker of [".git", ".pi"]) {
      const { code, err } = run(project([marker]));
      expect(code, marker).toBe(0);
      expect(err.split("\n").filter((l) => l.trim().startsWith("note:")), marker).toHaveLength(4);
      expect(err, marker).not.toMatch(/does not look like a project root/);
    }
  });
});
