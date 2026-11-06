/**
 * L1 — mock-site Vite plugin over real HTTP + the mock-decide CLI + launcher resolution.
 * A real Vite dev server runs the plugin against a temp fixture project.
 * See change: add-live-component-mock-site (test-plan E5-E13, E16, E17) and
 * add-mock-site-exact-env (test-plan E3, E4; tasks 4.1, 4.4: decide endpoint removed).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer, type ViteDevServer } from "vite";
import { isLanSafeVite, mockSite } from "../mock-site/plugin.mjs";
import { resolveLauncher } from "../mock-site/env.mjs";
import { makeFixture } from "./mock-site-fixture";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const CLI = path.resolve(here, "../mock-site/cli.mjs");

function lanIp(): string | null {
  for (const list of Object.values(os.networkInterfaces())) for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) return a.address;
  return null;
}

type Res = { status: number; body: string };
function req(port: number, method: string, p: string, opts: { body?: string | Buffer; headers?: Record<string, string>; host?: string; localAddress?: string } = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const r = http.request({ agent: false, host: opts.host ?? "127.0.0.1", port, method, path: p, headers: opts.headers, localAddress: opts.localAddress }, (res) => {
      let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b }));
    });
    r.on("error", reject);
    if (opts.body !== undefined) r.write(opts.body);
    r.end();
  });
}
const JSONH = { "content-type": "application/json" };
const decide = (port: number, body: unknown, opts: { host?: string; localAddress?: string } = {}) => req(port, "POST", "/__mock/decide", { body: JSON.stringify(body), headers: JSONH, ...opts });

async function start(root: string, lan = false): Promise<{ server: ViteDevServer; port: number }> {
  const server = await createServer({ configFile: false, logLevel: "silent", plugins: [mockSite({ projectRoot: root, app: "./mock-site.app.tsx", lan })], server: { port: 0 } });
  await server.listen();
  const a = server.httpServer!.address() as { port: number };
  return { server, port: a.port };
}

/** Bounded close: Vite's close() can wait on idle environments after many fs events; the
 *  shipped site runs as its own process (killed by serve_mock_site), so tests only need the port freed. */
async function stop(server?: ViteDevServer) {
  if (!server) return;
  await Promise.race([server.close(), new Promise((r) => setTimeout(r, 5000))]);
  (server.httpServer as { closeAllConnections?: () => void } | null)?.closeAllConnections?.();
}

describe("mock-site plugin HTTP (E5-E13; read-only since add-mock-site-exact-env)", () => {
  let root: string; let server: ViteDevServer; let port: number;
  const file = () => path.join(root, "mockups/2026-11-03-a/decision.json");
  beforeAll(async () => { root = makeFixture(); ({ server, port } = await start(root)); }, 15_000);
  afterAll(async () => { await stop(server); fs.rmSync(root, { recursive: true, force: true }); }, 15_000);

  it("binds 127.0.0.1 by default (E13)", () => {
    expect((server.httpServer!.address() as { address: string }).address).toBe("127.0.0.1");
  });
  it("serves the HTML entry and the read-only decisions marker", async () => {
    const html = await req(port, "GET", "/");
    expect(html.status).toBe(200);
    expect(html.body).toMatch(/<script type="module" src="\/@fs\/.*site\/main\.tsx"/);
    const d = JSON.parse((await req(port, "GET", "/__mock/decisions")).body);
    expect(d).toEqual({ mockSite: true, decisions: {}, warnings: [], errors: [] });
  });
  it("the decide endpoint is gone: any method 404, nothing written (4.1)", async () => {
    for (const m of ["POST", "GET", "PUT"]) {
      const r = m === "POST" ? await decide(port, { id: "2026-11-03-a", status: "accepted" }) : await req(port, m, "/__mock/decide");
      expect(r.status, m).toBe(404);
    }
    expect(fs.existsSync(file())).toBe(false);
  });
  it("CLI writes reach the marker; concurrent CLI writes leave one valid decision, no temp files (X4)", async () => {
    const clis = Array.from({ length: 6 }, (_, i) => new Promise<void>((r) => { const c = spawn(process.execPath, [CLI, i % 2 ? "accept" : "reject", "2026-11-03-a", "n"], { cwd: path.join(root, "mockups") }); c.on("exit", () => r()); }));
    await Promise.all(clis);
    expect(["accepted", "rejected"]).toContain(JSON.parse(fs.readFileSync(file(), "utf8")).status);
    expect(fs.readdirSync(path.dirname(file())).filter((f) => f.includes(".tmp-"))).toEqual([]);
    const d = JSON.parse((await req(port, "GET", "/__mock/decisions")).body);
    expect(d.decisions["2026-11-03-a"].by).toBe("agent");
  });
});

describe("LAN mode (E11)", () => {
  const ip = lanIp();
  it.skipIf(!ip)("LAN clients view only: marker readable, no decide endpoint", async () => {
    const root = makeFixture();
    const { server, port } = await start(root, true);
    try {
      expect((await decide(port, { id: "2026-11-03-a", status: "rejected" }, { host: ip!, localAddress: ip! })).status).toBe(404);
      expect(fs.existsSync(path.join(root, "mockups/2026-11-03-a/decision.json"))).toBe(false);
      const lanGet = JSON.parse((await req(port, "GET", "/__mock/decisions", { host: ip!, localAddress: ip! })).body);
      expect(lanGet.mockSite).toBe(true);
      expect("canDecide" in lanGet).toBe(false);
    } finally {
      await stop(server);
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);

  it("LAN mode denies secret files, including query-parameter variants", async () => {
    const root = makeFixture();
    fs.writeFileSync(path.join(root, ".env"), "TOKEN=x");
    fs.mkdirSync(path.join(root, ".secrets"));
    fs.writeFileSync(path.join(root, ".secrets/k.json"), "{}");
    fs.writeFileSync(path.join(root, "client-secrets.json"), "{}");
    const { server, port } = await start(root, true);
    try {
      for (const f of [".env", ".secrets/k.json", "client-secrets.json"])
        for (const q of ["", "?raw", "?import&raw", "?url", "?raw??"]) {
          const r = await req(port, "GET", `/@fs${root}/${f}${q}`);
          expect(r.status, `${f}${q}`).not.toBe(200);
          expect(r.body).not.toContain("TOKEN=x");
        }
    } finally {
      await stop(server);
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);

  it("refuses LAN mode on Vite versions with known fs.deny bypasses", () => {
    for (const v of ["5.0.12", "5.2.5", "5.4.20", "6.3.4", "6.4.0", "6.4.4", "7.0.7", "7.1.10"]) expect(isLanSafeVite(v), v).toBe(false);
    for (const v of ["5.4.21", "6.4.1", "6.4.3", "6.4.5", "7.0.8", "7.1.11", "7.3.7", "8.0.0"]) expect(isLanSafeVite(v), v).toBe(true);
  });
});

describe("mock-decide CLI (E16, E17)", () => {
  let root: string;
  beforeAll(() => { root = makeFixture(); });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
  const cli = (args: string[], cwd = path.join(root, "mockups")) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  const dfile = () => path.join(root, "mockups/2026-11-03-a/decision.json");

  it("list / accept / reject / reopen / unknown (E16)", () => {
    expect(cli(["list"]).status).toBe(0);
    const a = cli(["accept", "http://localhost:5299/#2026-11-03-a/1/proposed/2", "ok"]);
    expect(a.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(dfile(), "utf8"))).toMatchObject({ status: "accepted", by: "agent", note: "ok" });
    const before = fs.readFileSync(dfile(), "utf8");
    const r = cli(["reject", "2026-11-03-a"]);
    expect(r.status).not.toBe(0);
    expect(fs.readFileSync(dfile(), "utf8")).toBe(before);
    expect(cli(["reject", "2026-11-03-a", "dup"]).status).toBe(0);
    expect(JSON.parse(fs.readFileSync(dfile(), "utf8")).status).toBe("rejected");
    expect(cli(["reopen", "#2026-11-03-a/1"]).status).toBe(0);
    expect(fs.existsSync(dfile())).toBe(false);
    const u = cli(["accept", "2099-01-01-zz"]);
    expect(u.status).not.toBe(0);
    expect(u.stderr).toContain("2099-01-01-zz");
  });
  it("adoptable + move subcommands (E21, E22 via CLI)", () => {
    fs.mkdirSync(path.join(root, "mockups/2026-11-06-m"), { recursive: true });
    fs.writeFileSync(path.join(root, "mockups/2026-11-06-m/mock.tsx"), "export default {}");
    fs.writeFileSync(path.join(root, "mockups/AGENTS.md"), "| File | Purpose |\n|---|---|\n| `2026-11-06-m/` | x. Pending change: y |\n");
    const a = cli(["adoptable"]);
    expect(a.status).toBe(0);
    expect(JSON.parse(a.stdout).options[0].label).toBe("2026-11-06-m/ — y (open)");
    const m = cli(["move", "2026-11-06-m", path.join(root, "openspec/changes/n")]);
    expect(m.status).toBe(0);
    expect(fs.existsSync(path.join(root, "openspec/changes/n/mockups/2026-11-06-m/mock.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(root, "mockups/2026-11-06-m"))).toBe(false);
    expect(cli(["move", "2026-11-06-m", path.join(root, "openspec/changes/n")]).status).not.toBe(0);
  });
  it("finds the project root from a subdir and falls back to git toplevel (E17)", () => {
    fs.mkdirSync(path.join(root, "openspec/changes/x"), { recursive: true });
    const sub = cli(["list"], path.join(root, "openspec/changes/x"));
    expect(sub.status).toBe(0);
    expect(sub.stdout).toContain("2026-11-03-a");
    const g = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ms-git-")));
    execFileSync("git", ["init", "-q"], { cwd: g });
    fs.mkdirSync(path.join(g, "mockups/2026-11-05-z"), { recursive: true });
    fs.writeFileSync(path.join(g, "mockups/2026-11-05-z/mock.tsx"), "export default {}");
    fs.mkdirSync(path.join(g, "deep/er"), { recursive: true });
    const gl = cli(["list"], path.join(g, "deep/er"));
    expect(gl.status).toBe(0);
    expect(gl.stdout).toContain("2026-11-05-z");
    fs.rmSync(g, { recursive: true, force: true });
  });
});

describe("launcher resolution (E3, E4)", () => {
  const roots: string[] = [];
  afterAll(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });
  const proj = (files: Record<string, string>, linkModules = true) => {
    const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ms-launch-")));
    roots.push(r);
    if (linkModules) fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(r, "node_modules"), "dir");
    for (const [rel, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(r, rel)), { recursive: true }); fs.writeFileSync(path.join(r, rel), body); }
    return r;
  };
  it("declared wins; detected uses vite; unsupported / missing explain the next step (E3)", () => {
    const declared = proj({ "package.json": JSON.stringify({ mockSite: { launcher: "scripts/run.mjs", config: "app/vite.config.ts" } }), "scripts/run.mjs": "", "app/vite.config.ts": "", "vite.config.ts": "" });
    expect(resolveLauncher(declared)).toEqual({ ok: true, adapter: "vite", source: "declared", launcher: path.join(declared, "scripts/run.mjs"), config: path.join(declared, "app/vite.config.ts") });
    const detected = proj({ "package.json": "{}", "vite.config.mjs": "" });
    const d = resolveLauncher(detected);
    expect(d).toMatchObject({ ok: true, source: "detected", config: path.join(detected, "vite.config.mjs") });
    expect(d.ok && d.launcher).toMatch(/vite[/\\]bin[/\\]vite\.js$/);
    const launcherOnly = proj({ "package.json": JSON.stringify({ mockSite: { launcher: "run.mjs" } }), "run.mjs": "", "vite.config.ts": "" });
    expect(resolveLauncher(launcherOnly)).toMatchObject({ ok: true, source: "declared", launcher: path.join(launcherOnly, "run.mjs"), config: path.join(launcherOnly, "vite.config.ts") });
    const webpack = proj({ "package.json": "{}", "webpack.config.js": "" });
    const w = resolveLauncher(webpack);
    expect(w.ok).toBe(false);
    expect(!w.ok && w.error).toMatch(/build tool webpack has no mock-site adapter \(supported adapters: vite\)/);
    expect(!w.ok && w.error).toMatch(/"mockSite": \{ "launcher"/);
    const none = proj({ "package.json": "{}" });
    const n = resolveLauncher(none);
    expect(!n.ok && n.error).toContain(`no app build config found in ${none}`);
    expect(!n.ok && n.error).toContain("vite.config.ts");
    expect(!n.ok && n.error).toContain("supported adapters: vite");
  });
  it("refuses launchers whose real path leaves the project; names the real path (E4)", () => {
    const outside = path.join(fs.realpathSync(os.tmpdir()), `ms-outside-${process.pid}.mjs`);
    fs.writeFileSync(outside, "");
    try {
      const up = proj({ "package.json": JSON.stringify({ mockSite: { launcher: "../outside.mjs", config: "vite.config.ts" } }), "vite.config.ts": "" });
      fs.writeFileSync(path.join(path.dirname(up), "outside.mjs"), "");
      const a = resolveLauncher(up);
      expect(!a.ok && a.error).toContain(`refusing launcher outside the project: ${path.join(path.dirname(up), "outside.mjs")}`);
      fs.rmSync(path.join(path.dirname(up), "outside.mjs"));
      const link = proj({ "package.json": JSON.stringify({ mockSite: { launcher: "link.mjs", config: "vite.config.ts" } }), "vite.config.ts": "" });
      fs.symlinkSync(outside, path.join(link, "link.mjs"));
      const b = resolveLauncher(link);
      expect(!b.ok && b.error).toContain(`refusing launcher outside the project: ${outside}`);
      const ok = proj({ "package.json": JSON.stringify({ mockSite: { launcher: "./scripts/ok.mjs", config: "vite.config.ts" } }), "scripts/ok.mjs": "", "vite.config.ts": "" });
      expect(resolveLauncher(ok)).toMatchObject({ ok: true, launcher: path.join(ok, "scripts/ok.mjs") });
      const cfg = proj({ "package.json": JSON.stringify({ mockSite: { config: "c.ts" } }) });
      fs.symlinkSync(outside, path.join(cfg, "c.ts"));
      expect(resolveLauncher(cfg).ok).toBe(false);
    } finally { fs.rmSync(outside, { force: true }); }
  });
});
