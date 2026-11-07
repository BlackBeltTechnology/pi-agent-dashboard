import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultLauncherPath, registerMcp } from "../mcp-register.js";
import { getApp } from "../registry.js";
import { cleanupTmp, tmpDir } from "./helpers/fixtures.js";

afterEach(cleanupTmp);

function project(markers: string[] = [".git"]): string {
  const d = tmpDir();
  for (const m of markers) fs.mkdirSync(path.join(d, m));
  return d;
}
const run = (cwd: string) => {
  const err: string[] = [];
  const code = registerMcp(getApp("photocraft"), {
    cwd,
    execPath: process.execPath,
    launcher: defaultLauncherPath("pi-photocraft"),
    entryArgs: ["mcp"],
    prog: "pi-photocraft",
    stderr: (t) => err.push(t),
  });
  return { code, err: err.join("") };
};
const mcpFile = (cwd: string) => path.join(cwd, ".pi", "mcp.json");

describe("mcp --register", () => {
  it("E20 creates the file with only mcpServers.photocraft (absolute command + launcher, args end with mcp)", () => {
    const cwd = project();
    const { code, err } = run(cwd);
    expect(code).toBe(0);
    const cfg = JSON.parse(fs.readFileSync(mcpFile(cwd), "utf8"));
    expect(Object.keys(cfg)).toEqual(["mcpServers"]);
    expect(Object.keys(cfg.mcpServers)).toEqual(["photocraft"]);
    const { command, args } = cfg.mcpServers.photocraft;
    expect(command).toBe(process.execPath);
    expect(path.isAbsolute(args[0])).toBe(true);
    expect(args[0]).toMatch(/bin[\\/]pi-photocraft$/);
    expect(fs.existsSync(args[0])).toBe(true);
    expect(args.slice(1)).toEqual(["mcp"]);
    expect(err).toMatch(/machine-specific/);
    expect(err).toMatch(/trusted/);
    expect(err).toMatch(/project root/);
  });

  it("E20 preserves other servers and replaces an old photocraft entry", () => {
    const cwd = project();
    fs.mkdirSync(path.join(cwd, ".pi"));
    fs.writeFileSync(
      mcpFile(cwd),
      JSON.stringify({ extra: 1, mcpServers: { filesystem: { command: "fs" }, docs: { url: "u" }, photocraft: { command: "old" } } }),
    );
    expect(run(cwd).code).toBe(0);
    const cfg = JSON.parse(fs.readFileSync(mcpFile(cwd), "utf8"));
    expect(cfg.extra).toBe(1);
    expect(cfg.mcpServers.filesystem).toEqual({ command: "fs" });
    expect(cfg.mcpServers.docs).toEqual({ url: "u" });
    expect(cfg.mcpServers.photocraft.command).toBe(process.execPath);
  });

  it("E20 a malformed file is left byte-identical and the exit code is 1", () => {
    const cwd = project();
    fs.mkdirSync(path.join(cwd, ".pi"));
    const bad = "{ not json";
    fs.writeFileSync(mcpFile(cwd), bad);
    const { code, err } = run(cwd);
    expect(code).toBe(1);
    expect(err).toContain("mcp.json");
    expect(fs.readFileSync(mcpFile(cwd), "utf8")).toBe(bad);
  });

  it("E20 a cwd with neither .git nor .pi/ still registers, with a project-root warning", () => {
    const cwd = project([]);
    const { code, err } = run(cwd);
    expect(code).toBe(0);
    expect(fs.existsSync(mcpFile(cwd))).toBe(true);
    expect(err).toMatch(/does not look like a project root/);
  });

  it("a .git cwd gets no project-root warning", () => {
    expect(run(project()).err).not.toMatch(/does not look like a project root/);
  });
});

// pi 1.4.0 strips one leading UTF-8 BOM from mcp.json (#11191); the registrar does too.
// See change: update-pi-core-1-5-adopt-apis (test-plan #X6).
describe("BOM-prefixed mcp.json", () => {
  it("one BOM: merged (exit 0), other servers kept, written without a BOM", () => {
    const cwd = project();
    fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    fs.writeFileSync(mcpFile(cwd), `\uFEFF${JSON.stringify({ mcpServers: { other: { command: "o" } } })}`);
    expect(run(cwd).code).toBe(0);
    const raw = fs.readFileSync(mcpFile(cwd), "utf8");
    expect(raw.charCodeAt(0)).toBe(0x7b);
    const cfg = JSON.parse(raw);
    expect(cfg.mcpServers.other).toEqual({ command: "o" });
    expect(cfg.mcpServers["photocraft"]).toBeTruthy();
  });

  it("two BOMs: reported invalid JSON, exit 1, file byte-identical", () => {
    const cwd = project();
    fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    const content = `\uFEFF\uFEFF${JSON.stringify({ mcpServers: { other: { command: "o" } } })}`;
    fs.writeFileSync(mcpFile(cwd), content);
    const { code, err } = run(cwd);
    expect(code).toBe(1);
    expect(err).toMatch(/not valid JSON/);
    expect(fs.readFileSync(mcpFile(cwd), "utf8")).toBe(content);
  });
});
