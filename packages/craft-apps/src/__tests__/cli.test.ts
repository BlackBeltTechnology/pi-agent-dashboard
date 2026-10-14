import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../bin/photocraft.js";
import type { ProvisionReport } from "../provision.js";
import { cleanupTmp, tmpDir } from "./helpers/fixtures.js";
import { CLI, TSX } from "./helpers/paths.js";
import { ECHO_ARGV, nodeStub } from "./helpers/stubs.js";

afterEach(cleanupTmp);

const report = (binary: string): ProvisionReport => ({ app: "photocraft", version: "0.7.0", source: "latest", asset: "a", cacheHit: false, binary, durationMs: 1 });

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, deps: { stdout: (t: string) => out.push(t), stderr: (t: string) => err.push(t) } };
}

function runCli(args: string[], env: NodeJS.ProcessEnv = {}, cwd?: string) {
  const base = { ...process.env, NODE_OPTIONS: "" } as NodeJS.ProcessEnv;
  delete base.PHOTOCRAFT_BIN;
  return spawnSync(process.execPath, ["--import", TSX, CLI, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    cwd,
    env: { ...base, ...env },
    timeout: 30_000,
  });
}

describe("dispatch", () => {
  it("E13 no subcommand and unknown subcommand print usage listing every command, exit 1", async () => {
    for (const argv of [[], ["frobnicate"]]) {
      const c = capture();
      expect(await main(argv, c.deps)).toBe(1);
      const text = c.err.join("");
      for (const name of ["ensure", "path", "exec", "mcp", "replace-region"]) expect(text).toContain(name);
    }
  });

  it("E13b --help prints usage and exits 0", async () => {
    const c = capture();
    expect(await main(["--help"], c.deps)).toBe(0);
    expect(c.err.join("")).toContain("replace-region");
  });

  it("E14 path prints exactly the binary path and a newline", async () => {
    const c = capture();
    expect(await main(["path"], { ...c.deps, provision: async () => report("/abs/photocraft-cli") })).toBe(0);
    expect(c.out.join("")).toBe("/abs/photocraft-cli\n");
  });

  it("E11b ensure prints the report as one JSON object", async () => {
    const c = capture();
    expect(await main(["ensure"], { ...c.deps, provision: async () => report("/abs/x") })).toBe(0);
    const text = c.out.join("");
    expect(text.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(text)).toMatchObject({ version: "0.7.0", binary: "/abs/x" });
  });

  it("X2b provisioning failure on any subcommand exits 69 and names the error", async () => {
    for (const argv of [["ensure"], ["path"], ["exec", "--version"]]) {
      const c = capture();
      const code = await main(argv, {
        ...c.deps,
        provision: async () => {
          throw new Error("HTTP 500; set GITHUB_TOKEN, PHOTOCRAFT_VERSION or PHOTOCRAFT_BIN");
        },
      });
      expect(code).toBe(69);
      expect(c.err.join("")).toContain("GITHUB_TOKEN");
      expect(c.out.join("")).toBe("");
    }
  });
});

describe("exec", () => {
  it("E15 argv reaches the binary verbatim (no shell interpretation)", () => {
    const bin = nodeStub(ECHO_ARGV);
    const r = runCli(["exec", "run", "in.png", "--cmd", "x", "--params", '{"radius":3}', "--out", "out file.png"], { PHOTOCRAFT_BIN: bin });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(["run", "in.png", "--cmd", "x", "--params", '{"radius":3}', "--out", "out file.png"]);
  });

  it("E16 more than 10 MB on stdout is streamed completely", () => {
    const bin = nodeStub(`const chunk = "x".repeat(1024 * 1024); for (let i = 0; i < 12; i++) process.stdout.write(chunk);`);
    const r = runCli(["exec"], { PHOTOCRAFT_BIN: bin });
    expect(r.status).toBe(0);
    expect(r.stdout.length).toBe(12 * 1024 * 1024);
  });

  it("E17 the binary's exit code is propagated", () => {
    for (const code of [0, 1, 3]) {
      const bin = nodeStub(`console.error("boom"); process.exit(${code});`);
      const r = runCli(["exec"], { PHOTOCRAFT_BIN: bin });
      expect(r.status).toBe(code);
      expect(r.stderr).toContain("boom");
    }
  });
});

describe("no implicit registration", () => {
  it("E21 ensure, exec and mcp never create .pi/mcp.json", () => {
    const project = tmpDir();
    fs.mkdirSync(path.join(project, ".git"));
    const bin = nodeStub(`process.stdout.write("photocraft-cli 0.7.0\\n"); if (process.argv[2] === "mcp") process.stdin.resume().on("end", () => process.exit(0));`);
    const env = { PHOTOCRAFT_BIN: bin };
    expect(runCli(["ensure"], env, project).status).toBe(0);
    expect(runCli(["exec", "--version"], env, project).status).toBe(0);
    const mcp = spawnSync(process.execPath, ["--import", TSX, CLI, "mcp"], { cwd: project, input: "", encoding: "utf8", env: { ...process.env, ...env }, timeout: 30_000 });
    expect(mcp.status).toBe(0);
    expect(fs.existsSync(path.join(project, ".pi", "mcp.json"))).toBe(false);
  });
});
