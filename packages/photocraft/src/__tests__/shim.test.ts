import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The deprecated `@blackbelt-technology/pi-dashboard-photocraft` is a shim: a legacy `.pi/mcp.json` entry
 * (`node <pkg>/bin/pi-photocraft mcp`) and old scripts must keep working by forwarding to craft-apps.
 * See change: add-craft-apps-core (design D7, task 7.1).
 */
const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const launcher = path.join(pkgDir, "bin", "pi-photocraft");
const scratch: string[] = [];
afterAll(() => {
  for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pc-shim-")));
  scratch.push(d);
  return d;
};
const stub = (body: string) => {
  const f = path.join(tmp(), "photocraft-cli");
  fs.writeFileSync(f, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
  return f;
};
const env = (extra: NodeJS.ProcessEnv = {}) => {
  const e: NodeJS.ProcessEnv = { ...process.env, NODE_OPTIONS: "", ...extra };
  delete e.CRAFT_HOME;
  return e;
};

describe("photocraft deprecation shim", () => {
  it("depends on craft-apps, keeps the bin path and ships only the launcher + README", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")) as {
      bin: Record<string, string>;
      dependencies: Record<string, string>;
      files: string[];
      pi?: unknown;
    };
    expect(pkg.bin["pi-photocraft"]).toBe("bin/pi-photocraft");
    expect(Object.keys(pkg.dependencies)).toEqual(["@blackbelt-technology/pi-dashboard-craft-apps"]);
    expect(pkg.files).toEqual(["bin/", "README.md", "!**/AGENTS.md", "!**/*.AGENTS.md"]);
    expect(pkg.pi).toBeUndefined();
    expect(fs.readFileSync(path.join(pkgDir, "README.md"), "utf8")).toMatch(/deprecated/i);
  });

  it("forwards --help, ensure and exec (arguments, stdout and the binary's exit code)", () => {
    const help = spawnSync(process.execPath, [launcher, "--help"], { encoding: "utf8", env: env(), timeout: 30_000 });
    expect(help.status).toBe(0);
    expect(help.stderr).toContain("replace-region");
    const bin = stub(`if (process.argv[2] === "--version") process.stdout.write("photocraft-cli 0.7.0\\n"); else { process.stdout.write(JSON.stringify(process.argv.slice(2))); process.exit(7); }`);
    const ensure = spawnSync(process.execPath, [launcher, "ensure"], { encoding: "utf8", env: env({ PHOTOCRAFT_BIN: bin }), timeout: 30_000 });
    expect(ensure.status).toBe(0);
    expect(JSON.parse(ensure.stdout)).toMatchObject({ app: "photocraft", source: "override", version: "0.7.0" });
    const exec = spawnSync(process.execPath, [launcher, "exec", "run", "a b"], { encoding: "utf8", env: env({ PHOTOCRAFT_BIN: bin }), timeout: 30_000 });
    expect(exec.status).toBe(7);
    expect(JSON.parse(exec.stdout)).toEqual(["run", "a b"]);
  });

  it("a legacy .pi/mcp.json entry (`node <launcher> mcp`) still starts the confined MCP server", async () => {
    const argvLog = path.join(tmp(), "argv.json");
    const bin = stub(`
const fs = require("node:fs");
fs.writeFileSync(process.env.STUB_ARGV_LOG, JSON.stringify(process.argv.slice(2)));
require("node:readline").createInterface({ input: process.stdin }).on("line", (l) => {
  const m = JSON.parse(l);
  if (m.method === "initialize") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { serverInfo: { name: "photocraft" } } }) + "\\n");
});`);
    const cwd = tmp();
    const child = spawn(process.execPath, [launcher, "mcp"], { cwd, env: env({ PHOTOCRAFT_BIN: bin, STUB_ARGV_LOG: argvLog }), stdio: ["pipe", "pipe", "pipe"] });
    const reply = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no initialize reply")), 20_000);
      let buf = "";
      child.stdout.on("data", (d) => {
        buf += d;
        if (buf.includes("\n")) {
          clearTimeout(timer);
          resolve(buf);
        }
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
    });
    child.kill();
    expect(JSON.parse(reply)).toMatchObject({ id: 1, result: { serverInfo: { name: "photocraft" } } });
    expect(JSON.parse(fs.readFileSync(argvLog, "utf8"))).toEqual(["mcp", "--automation-read-root", cwd, "--automation-write-root", cwd]);
  }, 30_000);

  it("fails with an actionable message when craft-apps cannot be resolved", () => {
    const isolated = tmp();
    fs.mkdirSync(path.join(isolated, "bin"));
    fs.copyFileSync(launcher, path.join(isolated, "bin", "pi-photocraft"));
    fs.writeFileSync(path.join(isolated, "package.json"), '{"type":"module"}');
    const r = spawnSync(process.execPath, [path.join(isolated, "bin", "pi-photocraft"), "--help"], { encoding: "utf8", env: env(), timeout: 30_000 });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("pi-dashboard-craft-apps is not installed");
  });
});
