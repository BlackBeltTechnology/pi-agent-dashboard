/**
 * `pi-blender` CLI dispatch, `ensure`, `status` and the rule that nothing registers implicitly.
 * Registration itself is in mcp-register.test.ts.
 *
 * See change: add-blender-wasm-mcp (test-plan E56–E58, E62; tasks 5.5–5.7, 5.11).
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type CliDeps, main, USAGE } from "../bin/blender.js";
import type { ProbeResult } from "../host/probe.js";
import { PIN } from "../pin.js";
import { type ProvisionDeps, provision } from "../provision.js";
import { cacheStatus, type JspiMode } from "../report.js";
import { makeRuntimeFixture } from "./helpers/tar-fixtures.js";

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LAUNCHER = path.join(PKG_DIR, "bin", "pi-blender");

const tmpDirs: string[] = [];
const tmp = (prefix = "blender-cli-"): string => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmpDirs.push(d);
  return d;
};
afterEach(() => {
  vi.unstubAllGlobals();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

interface Harness {
  out: string[];
  err: string[];
  deps: Partial<CliDeps>;
  stdout: () => string;
  stderr: () => string;
}

function harness(extra: Partial<CliDeps> = {}): Harness {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    deps: { stdout: (t) => out.push(t), stderr: (t) => err.push(t), ...extra },
    stdout: () => out.join(""),
    stderr: () => err.join(""),
  };
}

const probeOf = (mode: JspiMode): (() => Promise<ProbeResult>) => async () => ({ mode, node: "v24.0.0-test" });

/** Real `provision`/`cacheStatus` over a fixture pin and a tmp cache; every network access is `fetchSpy`. */
function realProvisioning(fetchImpl?: typeof fetch) {
  const fx = makeRuntimeFixture();
  const home = tmp();
  const fetchSpy = vi.fn<typeof fetch>(fetchImpl ?? (async () => new Response(new Uint8Array(fx.tgz))));
  const provisionDeps: Partial<ProvisionDeps> = { env: { BLENDER_WASM_HOME: path.join(home, "cache") }, homedir: () => home, fetch: fetchSpy, pin: fx.pin, log: () => {} };
  const provisionSpy = vi.fn(() => provision(provisionDeps));
  return { fx, home, fetchSpy, provisionSpy, provisionDeps };
}

// ── E56 dispatch ─────────────────────────────────────────────────────────────

describe("dispatch", () => {
  it("E56: `render` is an unknown command → usage on stderr, exit 1, nothing on stdout", async () => {
    const h = harness();
    expect(await main(["render"], h.deps)).toBe(1);
    expect(h.stderr()).toBe(USAGE);
    expect(h.stderr()).toMatch(/\bensure\b/);
    expect(h.stderr()).toMatch(/\bstatus\b/);
    expect(h.stderr()).toMatch(/\bmcp\b/);
    expect(h.stdout()).toBe("");
  });

  it("E56: no arguments → usage listing ensure/status/mcp on stderr, exit 1", async () => {
    const h = harness();
    expect(await main([], h.deps)).toBe(1);
    expect(h.stderr()).toBe(USAGE);
    for (const cmd of ["ensure", "status", "mcp"]) expect(h.stderr()).toContain(cmd);
    expect(h.stdout()).toBe("");
  });

  it("E56: --help (and -h) → usage, exit 0", async () => {
    for (const flag of ["--help", "-h"]) {
      const h = harness();
      expect(await main([flag], h.deps)).toBe(0);
      expect(h.stderr()).toBe(USAGE);
    }
  });

  it("E56: `mcp --help` prints usage and exits 0 without starting a server or registering", async () => {
    const runMcp = vi.fn(async () => 0);
    const register = vi.fn(() => 0);
    const h = harness({ runMcp, register });
    expect(await main(["mcp", "--help"], h.deps)).toBe(0);
    expect(h.stderr()).toBe(USAGE);
    expect(runMcp).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it("E56: bin/pi-blender --help from a plain shell (no tsx, no NODE_OPTIONS) exits 0 with usage on stderr", () => {
    const r = spawnSync(process.execPath, [LAUNCHER, "--help"], { cwd: tmp(), encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" }, timeout: 60_000 });
    expect(r.stderr).toContain("usage: pi-blender");
    expect(r.status).toBe(0);
  }, 90_000);

  it("E56: bin/pi-blender with no command exits 1 and with `render` exits 1, usage on stderr", () => {
    for (const args of [[], ["render"]]) {
      const r = spawnSync(process.execPath, [LAUNCHER, ...args], { cwd: tmp(), encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" }, timeout: 60_000 });
      expect(r.status, args.join(" ")).toBe(1);
      expect(r.stderr).toContain("usage: pi-blender");
      expect(r.stdout).toBe("");
    }
  }, 90_000);

  it("`mcp` option errors exit 1 without starting a server", async () => {
    for (const argv of [["mcp", "--root"], ["mcp", "--bogus"], ["mcp", "--root", "--register"]]) {
      const runMcp = vi.fn(async () => 0);
      const h = harness({ runMcp });
      expect(await main(argv, h.deps), argv.join(" ")).toBe(1);
      expect(runMcp).not.toHaveBeenCalled();
    }
  });

  it("`mcp [--root <dir>]` starts the server with the root; `--root=<dir>` is accepted", async () => {
    const runMcp = vi.fn(async () => 7);
    const h = harness({ runMcp });
    expect(await main(["mcp", "--root", "assets"], h.deps)).toBe(7);
    expect(await main(["mcp", "--root=other"], h.deps)).toBe(7);
    expect(await main(["mcp"], h.deps)).toBe(7);
    expect(runMcp.mock.calls.map((c) => (c as unknown as [{ root?: string }])[0].root)).toEqual(["assets", "other", undefined]);
  });

  it("`mcp --register --root <dir>` hands the root to the register dep", async () => {
    const register = vi.fn(() => 0);
    const runMcp = vi.fn(async () => 0);
    const h = harness({ register, runMcp });
    expect(await main(["mcp", "--register", "--root", "assets"], h.deps)).toBe(0);
    expect(register).toHaveBeenCalledWith({ root: "assets" });
    expect(runMcp).not.toHaveBeenCalled();
  });
});

// ── E57 ensure ───────────────────────────────────────────────────────────────

describe("ensure", () => {
  for (const mode of ["native", "flag"] as const) {
    it(`E57: JSPI ${mode} → provisions the runtime, \`ensure --json\` reports jspi:"${mode}", exit 0`, async () => {
      const p = realProvisioning();
      const h = harness({ probe: probeOf(mode), provision: p.provisionSpy });
      expect(await main(["ensure", "--json"], h.deps)).toBe(0);
      const report = JSON.parse(h.stdout()) as Record<string, unknown>;
      expect(report).toMatchObject({ version: p.fx.pin.version, source: "download", jspi: mode, licence: "GPL-3.0-or-later" });
      expect(typeof report.dir).toBe("string");
      expect(typeof report.bytes).toBe("number");
      expect(p.provisionSpy).toHaveBeenCalledTimes(1);
      expect(p.fetchSpy).toHaveBeenCalledTimes(1);

      // Second run: the cache is complete, so no further fetch; the report names the cache.
      const again = harness({ probe: probeOf(mode), provision: p.provisionSpy });
      expect(await main(["ensure", "--json"], again.deps)).toBe(0);
      expect(JSON.parse(again.stdout())).toMatchObject({ source: "cache", jspi: mode });
      expect(p.fetchSpy).toHaveBeenCalledTimes(1);
    });
  }

  it("E57: JSPI unavailable → exit 69, zero fetch and zero provision calls, stderr names Node/JSPI", async () => {
    const p = realProvisioning();
    const h = harness({ probe: probeOf("unavailable"), provision: p.provisionSpy });
    expect(await main(["ensure", "--json"], h.deps)).toBe(69);
    expect(p.fetchSpy).not.toHaveBeenCalled();
    expect(p.provisionSpy).not.toHaveBeenCalled();
    expect(h.stderr()).toMatch(/JSPI/);
    expect(h.stderr()).toMatch(/Node 24/);
    expect(JSON.parse(h.stdout())).toMatchObject({ code: "jspi-unavailable", jspi: "unavailable", node: "v24.0.0-test" });
    expect(fs.existsSync(path.join(p.home, "cache"))).toBe(false);
  });

  it("E57: unavailable without --json prints nothing on stdout", async () => {
    const p = realProvisioning();
    const h = harness({ probe: probeOf("unavailable"), provision: p.provisionSpy });
    expect(await main(["ensure"], h.deps)).toBe(69);
    expect(h.stdout()).toBe("");
    expect(p.fetchSpy).not.toHaveBeenCalled();
  });

  it("E57: a provisioning failure (integrity mismatch) → exit 69 with the machine code on stderr and in --json", async () => {
    const failing = vi.fn<typeof fetch>(async () => new Response(Buffer.from("not the pinned tarball")));
    const q = realProvisioning(failing);
    const h = harness({ probe: probeOf("native"), provision: q.provisionSpy });
    expect(await main(["ensure", "--json"], h.deps)).toBe(69);
    const body = JSON.parse(h.stdout()) as { code: string; message: string; jspi: string };
    expect(body.jspi).toBe("native");
    expect(body.code).toMatch(/^[a-z]+(-[a-z]+)*$/);
    expect(h.stderr()).toContain(`pi-blender: ${body.code}:`);
    expect(failing).toHaveBeenCalled();
  });

  it("E57: a rejected download → exit 69 (never an unhandled rejection)", async () => {
    const p = realProvisioning(async () => {
      throw new Error("network down");
    });
    const h = harness({ probe: probeOf("flag"), provision: () => provision({ ...p.provisionDeps, totalTimeoutMs: 2_000, stallTimeoutMs: 1_000 }) });
    expect(await main(["ensure"], h.deps)).toBe(69);
    expect(h.stderr()).toMatch(/^pi-blender: [a-z-]+: /m);
    expect(h.stdout()).toBe("");
  }, 30_000);

  it("`ensure` rejects unknown options with exit 1 before probing", async () => {
    const probe = vi.fn(probeOf("native"));
    const h = harness({ probe });
    expect(await main(["ensure", "--force"], h.deps)).toBe(1);
    expect(probe).not.toHaveBeenCalled();
  });
});

// ── E58 status ───────────────────────────────────────────────────────────────

describe("status", () => {
  function statusHarness(mode: JspiMode = "flag") {
    const p = realProvisioning();
    const throwingFetch = vi.fn(async () => {
      throw new Error("status must never touch the network");
    });
    vi.stubGlobal("fetch", throwingFetch);
    const reader = vi.fn(() => cacheStatus(p.provisionDeps));
    const h = harness({ probe: probeOf(mode), cacheStatus: reader, provision: p.provisionSpy });
    return { p, throwingFetch, reader, h };
  }

  it("E58: empty cache + throwing fetch → pinned version reported as not cached, exit 0, zero fetch", async () => {
    const { p, throwingFetch, h } = statusHarness();
    expect(await main(["status"], h.deps)).toBe(0);
    expect(h.stdout()).toContain(`pinned runtime: ${p.fx.pin.version} — not cached`);
    expect(h.stdout()).toContain("cached versions: none");
    expect(h.stdout()).toContain("source: managed");
    expect(h.stdout()).toContain("JSPI: flag");
    expect(throwingFetch).not.toHaveBeenCalled();
    expect(p.fetchSpy).not.toHaveBeenCalled();
    expect(p.provisionSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(p.home, "cache"))).toBe(false);
  });

  it("E58: `status --json` has the cache report plus jspi and node", async () => {
    const { p, throwingFetch, h } = statusHarness("native");
    expect(await main(["status", "--json"], h.deps)).toBe(0);
    const body = JSON.parse(h.stdout()) as Record<string, unknown>;
    expect(body).toMatchObject({
      pinned: { version: p.fx.pin.version, cached: false },
      source: "managed",
      versions: [],
      licence: "unknown",
      jspi: "native",
      node: "v24.0.0-test",
    });
    expect(Object.keys(body).sort()).toEqual(["jspi", "licence", "node", "pinned", "root", "source", "versions"]);
    expect(throwingFetch).not.toHaveBeenCalled();
  });

  it("E58: after `ensure` the same `status` reports the pinned version as cached (still zero further fetch)", async () => {
    const { p, h } = statusHarness();
    const ensured = harness({ probe: probeOf("flag"), provision: p.provisionSpy });
    expect(await main(["ensure"], ensured.deps)).toBe(0);
    expect(p.fetchSpy).toHaveBeenCalledTimes(1);
    expect(await main(["status"], h.deps)).toBe(0);
    expect(h.stdout()).toMatch(/pinned runtime: 0\.0\.5 — cached at /);
    expect(h.stdout()).toContain("licence: GPL-3.0-or-later");
    expect(p.fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("E58: status reports exit 0 even when JSPI is unavailable; unknown options exit 1", async () => {
    const { h } = statusHarness("unavailable");
    expect(await main(["status"], h.deps)).toBe(0);
    expect(h.stdout()).toContain("JSPI: unavailable");
    const bad = harness();
    expect(await main(["status", "--bogus"], bad.deps)).toBe(1);
  });

  it("E58: the real default `status` (plain shell, tmp BLENDER_WASM_HOME, empty cache) exits 0 and reports the pinned version not cached", () => {
    const home = tmp();
    const r = spawnSync(process.execPath, [LAUNCHER, "status", "--json"], {
      cwd: tmp(),
      encoding: "utf8",
      env: { ...process.env, NODE_OPTIONS: "", HOME: home, USERPROFILE: home, BLENDER_WASM_HOME: path.join(home, "cache") },
      timeout: 120_000,
    });
    expect(r.status, r.stderr).toBe(0);
    const body = JSON.parse(r.stdout) as { pinned: { version: string; cached: boolean }; jspi: string };
    expect(body.pinned).toMatchObject({ version: PIN.version, cached: false });
    expect(["native", "flag", "unavailable"]).toContain(body.jspi);
    expect(fs.existsSync(path.join(home, "cache"))).toBe(false);
  }, 150_000);
});

// ── E62 nothing registers implicitly ─────────────────────────────────────────

describe("no implicit registration", () => {
  it("E62: `ensure` and `mcp` without --register never create or modify <cwd>/.pi/mcp.json", async () => {
    const proj = tmp("blender-proj-");
    fs.mkdirSync(path.join(proj, ".git"));
    const p = realProvisioning();
    const before = process.cwd();
    process.chdir(proj);
    try {
      const h = harness({ probe: probeOf("native"), provision: p.provisionSpy, runMcp: async () => 0 });
      expect(await main(["ensure"], h.deps)).toBe(0);
      expect(await main(["mcp"], h.deps)).toBe(0);
      expect(await main(["mcp", "--root", "."], h.deps)).toBe(0);
      expect(await main(["status"], h.deps)).toBe(0);
    } finally {
      process.chdir(before);
    }
    expect(fs.existsSync(path.join(proj, ".pi"))).toBe(false);
    expect(fs.readdirSync(proj)).toEqual([".git"]);
  });

  it("E62: an existing mcp.json stays byte-identical across `ensure` and `mcp`", async () => {
    const proj = tmp("blender-proj-");
    const file = path.join(proj, ".pi", "mcp.json");
    fs.mkdirSync(path.dirname(file));
    const original = '{ "mcpServers": { "x": {"command":"y"} } }\n';
    fs.writeFileSync(file, original);
    const mtime = fs.statSync(file).mtimeMs;
    const p = realProvisioning();
    const before = process.cwd();
    process.chdir(proj);
    try {
      const h = harness({ probe: probeOf("flag"), provision: p.provisionSpy, runMcp: async () => 0 });
      expect(await main(["ensure"], h.deps)).toBe(0);
      expect(await main(["mcp"], h.deps)).toBe(0);
    } finally {
      process.chdir(before);
    }
    expect(fs.readFileSync(file, "utf8")).toBe(original);
    expect(fs.statSync(file).mtimeMs).toBe(mtime);
    expect(fs.readdirSync(path.dirname(file))).toEqual(["mcp.json"]);
  });

  it("E62: `ensure` through the real launcher in a project leaves .pi/mcp.json absent (fails fast, no download)", () => {
    const proj = tmp("blender-proj-");
    fs.mkdirSync(path.join(proj, ".git"));
    const home = tmp();
    // BLENDER_WASM_DIR points at a dir that is not a runtime, so `ensure` fails fast (override-invalid, or
    // jspi-unavailable on Node < 24), never reaching the network.
    const r = spawnSync(process.execPath, [LAUNCHER, "ensure"], {
      cwd: proj,
      encoding: "utf8",
      env: { ...process.env, NODE_OPTIONS: "", HOME: home, USERPROFILE: home, BLENDER_WASM_HOME: path.join(home, "cache"), BLENDER_WASM_DIR: path.join(home, "not-a-runtime") },
      timeout: 120_000,
    });
    expect(r.status, r.stderr).toBe(69);
    expect(r.stderr).toMatch(/^pi-blender: /m);
    expect(fs.existsSync(path.join(proj, ".pi"))).toBe(false);
  }, 150_000);
});
