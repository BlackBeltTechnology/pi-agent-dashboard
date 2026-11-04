/**
 * L1 — mock-site Vite plugin over real HTTP + the mock-decide CLI.
 * A real Vite dev server runs the plugin against a temp fixture project.
 * See change: add-live-component-mock-site (test-plan E5-E13, E16, E17).
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
const decide = (port: number, body: unknown, headers: Record<string, string> = JSONH) => req(port, "POST", "/__mock/decide", { body: typeof body === "string" ? body : JSON.stringify(body), headers });

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

describe("mock-site plugin HTTP (E5-E13)", () => {
  let root: string; let server: ViteDevServer; let port: number;
  const file = () => path.join(root, "mockups/2026-11-03-a/decision.json");
  beforeAll(async () => { root = makeFixture(); ({ server, port } = await start(root)); }, 15_000);
  afterAll(async () => { await stop(server); fs.rmSync(root, { recursive: true, force: true }); }, 15_000);

  it("binds 127.0.0.1 by default (E13)", () => {
    expect((server.httpServer!.address() as { address: string }).address).toBe("127.0.0.1");
  });
  it("serves the HTML entry and the decisions marker", async () => {
    const html = await req(port, "GET", "/");
    expect(html.status).toBe(200);
    expect(html.body).toMatch(/<script type="module" src="\/@fs\/.*site\/main\.tsx"/);
    const d = JSON.parse((await req(port, "GET", "/__mock/decisions")).body);
    expect(d).toMatchObject({ mockSite: true, canDecide: true, decisions: {} });
  });
  it("note length boundary (E5)", async () => {
    expect((await decide(port, { id: "2026-11-03-a", status: "rejected", note: "n".repeat(499) })).status).toBe(200);
    expect((await decide(port, { id: "2026-11-03-a", status: "rejected", note: "n".repeat(500) })).status).toBe(200);
    expect(JSON.parse(fs.readFileSync(file(), "utf8")).note).toHaveLength(500);
    expect((await decide(port, { id: "2026-11-03-a", status: "rejected", note: "n".repeat(500) + "😀" })).status).toBe(400);
    expect(JSON.parse(fs.readFileSync(file(), "utf8")).note).toHaveLength(500);
  });
  it("body size boundary (E6)", async () => {
    fs.rmSync(file(), { force: true });
    const body = (n: number) => { const base = JSON.stringify({ id: "2026-11-03-a", status: "accepted", pad: "" }); return base.replace('"pad":""', `"pad":"${"p".repeat(n - base.length)}"`); };
    for (const n of [4095, 4096]) { const r = await decide(port, body(n)); expect(r.status, String(n)).toBe(200); }
    fs.rmSync(file(), { force: true });
    expect((await decide(port, body(4097))).status).toBe(413);
    expect(fs.existsSync(file())).toBe(false);
  });
  it("method and content type (E7)", async () => {
    expect((await req(port, "GET", "/__mock/decide")).status).toBe(405);
    expect((await req(port, "PUT", "/__mock/decide", { body: "{}", headers: JSONH })).status).toBe(405);
    expect((await decide(port, { id: "2026-11-03-a", status: "accepted" }, { "content-type": "text/plain" })).status).toBe(415);
    expect((await decide(port, { id: "2026-11-03-a", status: "accepted" }, { "content-type": "application/json; charset=utf-8" })).status).toBe(200);
  });
  it("id allow-list, no file outside (E8)", async () => {
    const list = () => execFileSync("find", [root, "-not", "-path", "*/node_modules*"]).toString().split("\n").sort().join("\n");
    const before = list();
    for (const id of ["../../etc", "2026-11-03-a/../../x", "2099-01-01-unknown", ""]) expect((await decide(port, { id, status: "accepted" })).status, id).toBe(400);
    expect(list()).toBe(before);
  });
  it("status enum; open deletes (E9)", async () => {
    const codes = [];
    for (const status of ["accepted", "rejected", "open", "ACCEPTED", "approved", undefined]) codes.push((await decide(port, { id: "2026-11-03-a", status })).status);
    expect(codes).toEqual([200, 200, 200, 400, 400, 400]);
    expect(fs.existsSync(file())).toBe(false);
  });
  it("Origin allow-list (E10)", async () => {
    const o = (origin?: string) => decide(port, { id: "2026-11-03-a", status: "accepted" }, { ...JSONH, ...(origin ? { origin } : {}) });
    expect([(await o()).status, (await o(`http://localhost:${port}`)).status, (await o(`http://127.0.0.1:${port}`)).status, (await o("http://evil.example")).status, (await o("http://localhost:9999")).status]).toEqual([200, 200, 200, 403, 403]);
  });
  it("concurrent UI + CLI writes leave one valid decision, no temp files (X4)", async () => {
    const posts = Array.from({ length: 20 }, (_, i) => decide(port, { id: "2026-11-03-a", status: i % 2 ? "accepted" : "rejected" }));
    const clis = Array.from({ length: 5 }, () => new Promise<void>((r) => { const c = spawn(process.execPath, [CLI, "accept", "2026-11-03-a"], { cwd: path.join(root, "mockups") }); c.on("exit", () => r()); }));
    const codes = (await Promise.all(posts)).map((r) => r.status);
    await Promise.all(clis);
    expect(codes.every((c) => c === 200)).toBe(true);
    expect(["accepted", "rejected"]).toContain(JSON.parse(fs.readFileSync(file(), "utf8")).status);
    expect(fs.readdirSync(path.dirname(file())).filter((f) => f.includes(".tmp-"))).toEqual([]);
  });
  it("symlinked decision.json refused (E12)", async () => {
    fs.rmSync(file(), { force: true });
    const outside = path.join(root, "outside.json");
    fs.writeFileSync(outside, "X");
    fs.symlinkSync(outside, file());
    expect((await decide(port, { id: "2026-11-03-a", status: "accepted" })).status).toBe(400);
    expect(fs.readFileSync(outside, "utf8")).toBe("X");
    fs.rmSync(file(), { force: true });
  });
});

describe("LAN mode (E11)", () => {
  const ip = lanIp();
  it.skipIf(!ip)("LAN clients view only; loopback may decide", async () => {
    const root = makeFixture();
    const { server, port } = await start(root, true);
    try {
      const lanPost = await decide(port, { id: "2026-11-03-a", status: "accepted" }, JSONH).then(() => req(port, "POST", "/__mock/decide", { host: ip!, localAddress: ip!, body: JSON.stringify({ id: "2026-11-03-a", status: "rejected" }), headers: JSONH }));
      expect(lanPost.status).toBe(403);
      expect(JSON.parse(fs.readFileSync(path.join(root, "mockups/2026-11-03-a/decision.json"), "utf8")).status).toBe("accepted");
      const lanGet = JSON.parse((await req(port, "GET", "/__mock/decisions", { host: ip!, localAddress: ip! })).body);
      expect(lanGet.canDecide).toBe(false);
      const loop = JSON.parse((await req(port, "GET", "/__mock/decisions")).body);
      expect(loop.canDecide).toBe(true);
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
    for (const v of ["5.0.12", "5.2.5", "5.4.18", "6.3.3", "6.4.4"]) expect(isLanSafeVite(v), v).toBe(false);
    for (const v of ["5.4.19", "6.3.4", "6.4.3", "6.4.5", "7.3.7"]) expect(isLanSafeVite(v), v).toBe(true);
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
