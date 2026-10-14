import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../bin/craft.js";
import type { ProvisionReport } from "../provision.js";
import { APP_IDS } from "../registry.js";
import { cleanupTmp, tmpDir } from "./helpers/fixtures.js";
import { CRAFT_CLI, TSX } from "./helpers/paths.js";
import { ECHO_ARGV, nodeStub } from "./helpers/stubs.js";

afterEach(cleanupTmp);

const report = (app: string, binary: string): ProvisionReport => ({ app: app as ProvisionReport["app"], version: "0.7.0", source: "latest", asset: "a", cacheHit: false, binary, durationMs: 1 });

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, deps: { stdout: (t: string) => out.push(t), stderr: (t: string) => err.push(t) } };
}

function runCli(args: string[], env: NodeJS.ProcessEnv = {}, cwd?: string) {
  const base = { ...process.env, NODE_OPTIONS: "" } as NodeJS.ProcessEnv;
  for (const k of Object.keys(base)) if (/^[A-Z]+CRAFT_(BIN|VERSION|HOME)$/.test(k) || k === "CRAFT_HOME" || k === "CRAFT_SOURCE") delete base[k];
  return spawnSync(process.execPath, ["--import", TSX, CRAFT_CLI, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, cwd, env: { ...base, ...env }, timeout: 30_000 });
}

describe("dispatch", () => {
  it("no args, unknown subcommand and unknown app print usage listing subcommands and the 13 app ids, exit 1", async () => {
    for (const argv of [[], ["frobnicate"], ["paintcraft", "path"]]) {
      const c = capture();
      expect(await main(argv, c.deps)).toBe(1);
      const text = c.err.join("");
      for (const name of ["apps", "status", "install", "launcher", "verify", "ensure", "exec", "mcp"]) expect(text).toContain(name);
      for (const id of APP_IDS) expect(text).toContain(id);
    }
  });

  it("--help exits 0", async () => {
    const c = capture();
    expect(await main(["--help"], c.deps)).toBe(0);
    expect(c.err.join("")).toContain("pi-craft <command>");
  });

  it("<app> with an unknown subcommand is a usage error", async () => {
    const c = capture();
    expect(await main(["filmcraft", "dance"], c.deps)).toBe(1);
  });

  it("<app> path prints exactly one line with the binary path", async () => {
    const c = capture();
    expect(await main(["soundcraft", "path"], { ...c.deps, provision: async (id) => report(id, "/abs/soundcraft-cli") })).toBe(0);
    expect(c.out.join("")).toBe("/abs/soundcraft-cli\n");
  });

  it("<app> ensure prints the report as one JSON object", async () => {
    const c = capture();
    expect(await main(["effectcraft", "ensure"], { ...c.deps, provision: async (id) => report(id, "/abs/x") })).toBe(0);
    const text = c.out.join("");
    expect(text.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(text)).toMatchObject({ app: "effectcraft", binary: "/abs/x" });
  });

  it("provisioning failure prints the error and exits 69", async () => {
    const c = capture();
    const provision = async () => {
      throw new Error("checksum mismatch");
    };
    for (const sub of [["ensure"], ["path"], ["exec", "--version"]]) {
      expect(await main(["filmcraft", ...sub], { ...c.deps, provision })).toBe(69);
    }
    expect(c.err.join("")).toContain("pi-craft: checksum mismatch");
  });
});

describe("apps", () => {
  it("apps --json lists 13 entries offline and exits 0", async () => {
    const c = capture();
    expect(await main(["apps", "--json"], { ...c.deps, provision: async () => Promise.reject(new Error("network used")) })).toBe(0);
    const rows = JSON.parse(c.out.join(""));
    expect(rows).toHaveLength(13);
    expect(rows.find((r: { id: string }) => r.id === "lightcraft")).toMatchObject({ mcp: { confinement: false, toolClass: "large", tools: 330 }, repo: "storytold/lightcraft" });
  });

  it("apps (text) lists every id", async () => {
    const c = capture();
    expect(await main(["apps"], c.deps)).toBe(0);
    for (const id of APP_IDS) expect(c.out.join("")).toContain(id);
  });
});

describe("status", () => {
  it("status on an empty cache reports every app not installed and never provisions", async () => {
    const home = tmpDir();
    const c = capture();
    const code = await main(["status", "--json"], {
      ...c.deps,
      env: { CRAFT_HOME: home },
      provision: async () => Promise.reject(new Error("download attempted")),
    });
    expect(code).toBe(0);
    const rows = JSON.parse(c.out.join(""));
    expect(rows).toHaveLength(13);
    for (const r of rows) expect(r).toMatchObject({ installed: [], cacheBytes: 0, wouldUse: { version: null, source: "download" }, source: "managed" });
  });

  it("status shows installed versions, cache size, pin and source", async () => {
    const home = tmpDir();
    const dir = path.join(home, "filmcraft", "0.8.0", "top", "bin");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "filmcraft-cli"), "x".repeat(1000), { mode: 0o755 });
    const c = capture();
    await main(["status", "--json"], { ...c.deps, env: { CRAFT_HOME: home, FILMCRAFT_VERSION: "0.8.0", CRAFT_SOURCE: "auto" } });
    const film = JSON.parse(c.out.join("")).find((r: { app: string }) => r.app === "filmcraft");
    expect(film).toMatchObject({ installed: ["0.8.0"], wouldUse: { version: "0.8.0", source: "pin" }, source: "auto" });
    expect(film.cacheBytes).toBeGreaterThanOrEqual(1000);
  });
});

describe("install", () => {
  it("a partial failure installs the others, prints both outcomes and exits 69", async () => {
    const c = capture();
    const provision = async (id: string) => {
      if (id === "filmcraft") throw new Error("release has no asset");
      return report(id, `/abs/${id}-cli`);
    };
    const code = await main(["install", "soundcraft", "filmcraft"], { ...c.deps, provision });
    expect(code).toBe(69);
    expect(JSON.parse(c.out.join("").trim())).toMatchObject({ app: "soundcraft" });
    expect(c.err.join("")).toContain("filmcraft: release has no asset");
  });

  it("install --all provisions all 13; mixing --all and names is a usage error; unknown app is a usage error", async () => {
    const seen: string[] = [];
    const c = capture();
    expect(await main(["install", "--all"], { ...c.deps, provision: async (id) => (seen.push(id), report(id, "/b")) })).toBe(0);
    expect(seen).toEqual([...APP_IDS]);
    const c2 = capture();
    expect(await main(["install", "--all", "filmcraft"], c2.deps)).toBe(1);
    expect(await main(["install"], c2.deps)).toBe(1);
    expect(await main(["install", "paintcraft"], c2.deps)).toBe(1);
  });
});

describe("exec (subprocess)", () => {
  it("passes arguments verbatim (no shell interpretation), streams stdout and exits with the binary's code", () => {
    const bin = nodeStub(`${ECHO_ARGV}\nprocess.exit(7);`, "effectcraft-cli");
    const r = runCli(["effectcraft", "exec", "run", "comp.new", '{"name":"My Title"}', "$HOME", "a b"], { EFFECTCRAFT_BIN: bin });
    expect(r.status).toBe(7);
    expect(JSON.parse(r.stdout)).toEqual(["run", "comp.new", '{"name":"My Title"}', "$HOME", "a b"]);
  });

  it("path output is exactly one line", () => {
    const bin = nodeStub(`process.stdout.write("x")`, "soundcraft-cli");
    const r = runCli(["soundcraft", "path"], { SOUNDCRAFT_BIN: bin });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`${bin}\n`);
  });

  it("nothing is registered implicitly: install/ensure/exec/mcp (without --register) leave .pi/mcp.json alone", () => {
    const cwd = tmpDir();
    const bin = nodeStub(`process.stdout.write("soundcraft-cli 0.6.1\\n")`, "soundcraft-cli");
    for (const args of [["soundcraft", "ensure"], ["soundcraft", "exec", "--version"], ["soundcraft", "path"]]) {
      expect(runCli(args, { SOUNDCRAFT_BIN: bin }, cwd).status).toBe(0);
    }
    expect(fs.existsSync(path.join(cwd, ".pi"))).toBe(false);
  });

  it("mcp --register on an unconfined app without the flag exits 1 and writes nothing", () => {
    const cwd = tmpDir();
    fs.mkdirSync(path.join(cwd, ".git"));
    const r = runCli(["filmcraft", "mcp", "--register"], {}, cwd);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--allow-unconfined");
    expect(fs.existsSync(path.join(cwd, ".pi"))).toBe(false);
  });

  it("mcp --register --allow-unconfined writes craft-filmcraft; extra options are rejected", () => {
    const cwd = tmpDir();
    fs.mkdirSync(path.join(cwd, ".git"));
    expect(runCli(["filmcraft", "mcp", "--register", "--root", "/x"], {}, cwd).status).toBe(1);
    const ok = runCli(["filmcraft", "mcp", "--register", "--allow-unconfined"], {}, cwd);
    expect(ok.status).toBe(0);
    const cfg = JSON.parse(fs.readFileSync(path.join(cwd, ".pi", "mcp.json"), "utf8"));
    expect(cfg.mcpServers["craft-filmcraft"].args.slice(1)).toEqual(["filmcraft", "mcp", "--allow-unconfined"]);
  });
});

describe("launcher", () => {
  it("launcher status is offline JSON for all 13 apps; bad subcommand exits 1", async () => {
    const home = tmpDir();
    const c = capture();
    expect(await main(["launcher", "status"], { ...c.deps, env: { CRAFT_LAUNCHER_HOME: path.join(home, "none") }, platform: "linux", homedir: () => home })).toBe(0);
    const rows = JSON.parse(c.out.join(""));
    expect(rows).toHaveLength(13);
    expect(rows.every((r: { installed: boolean }) => r.installed === false)).toBe(true);
    expect(await main(["launcher", "bogus"], c.deps)).toBe(1);
  });

  it("launcher install failure exits 69 and prints the error", async () => {
    const c = capture();
    const code = await main(["launcher", "install"], {
      ...c.deps,
      installLauncher: async () => {
        throw new Error("checksum mismatch for x.dmg");
      },
    });
    expect(code).toBe(69);
    expect(c.err.join("")).toContain("checksum mismatch");
  });
});

describe("exec signal listeners", () => {
  it("do not accumulate across repeated exec calls in one process", async () => {
    const bin = nodeStub("process.exit(0)", "soundcraft-cli");
    const before = process.listenerCount("SIGTERM");
    const beforeInt = process.listenerCount("SIGINT");
    for (let i = 0; i < 12; i++) {
      const c = capture();
      expect(await main(["soundcraft", "exec", "--version"], { ...c.deps, provision: async (id) => report(id, bin) })).toBe(0);
    }
    expect(process.listenerCount("SIGTERM")).toBe(before);
    expect(process.listenerCount("SIGINT")).toBe(beforeInt);
  });
});
