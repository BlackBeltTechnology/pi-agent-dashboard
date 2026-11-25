/**
 * Mock site under a base path + the `mock-site:base-reservation` probe (D11).
 * Probe / validation tests use a tiny fake launcher (no Vite); the plugin tests start the REAL launcher.
 * See change: serve-live-previews-on-capability-origin (D11; test-plan #E105, #E178-#E191 server halves, #X51-#X57).
 */
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as net from "node:net";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import frontendMockupLoop from "../extension.js";
import { joinUrl, validateBase } from "../mock-site/base.mjs";
import { children, RESERVATION_WAIT_MS } from "../mock-site-serve.js";
import { makeServableFixture } from "./mock-site-fixture";

// Loading the fixture's options file through Vite costs ~25 s on a loaded dev machine: every test pays it once.
vi.setConfig({ testTimeout: 240_000 });

type Tool = { name: string; execute: (id: string, p: any) => Promise<{ content: { text: string }[]; details: any }> };
type Probe = { port: number; pending?: Promise<unknown>; signal: AbortSignal };
function fakePi(onProbe?: (p: Probe) => void) {
  const tools = new Map<string, Tool>();
  const emitted: (Probe & { at?: number })[] = [];
  const pi: any = {
    registerTool: (t: Tool) => tools.set(t.name, t),
    registerCommand() {},
    on() {},
    events: { emit: (_c: string, d: Probe) => { emitted.push(Object.assign(d, { at: Date.now() })); onProbe?.(d); } },
  };
  frontendMockupLoop(pi);
  return { tool: tools.get("serve_mock_site")!, emitted };
}
const freePort = () => new Promise<number>((r) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); }); });
const get = (port: number, p: string) =>
  new Promise<{ status: number; body: string }>((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: p, agent: false, timeout: 5000 }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b }));
    });
    req.on("error", () => resolve({ status: 0, body: "" }));
  });
const roots: string[] = [];
afterEach(async () => {
  for (const c of children.values()) c.kill("SIGKILL");
  children.clear();
  delete process.env.FAKE_MODE;
  delete process.env.FAKE_LOG;
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

/** A fixture whose declared launcher is a tiny script honouring `--port` / `--base` and logging its argv. */
function fakeLauncherFixture(): { root: string; log: string } {
  const root = makeServableFixture();
  roots.push(root);
  fs.writeFileSync(
    path.join(root, "fake-launcher.mjs"),
    `import http from "node:http"; import fs from "node:fs";
const a = process.argv; const val = (f) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };
if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ argv: a.slice(2), at: Date.now() }) + "\\n");
if (process.env.FAKE_MODE === "crash") process.exit(3);
const base = val("--base") ?? "/";
http.createServer((q, s) => { if (q.url === base + "__mock/decisions") { s.setHeader("content-type", "application/json"); s.end('{"mockSite":true}'); } else { s.statusCode = 404; s.end(); } })
  .listen(Number(val("--port")), "127.0.0.1");
`,
  );
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fx", private: true, type: "module", mockSite: { launcher: "fake-launcher.mjs", config: "vite.config.mjs" } }));
  const log = path.join(root, "argv.log");
  process.env.FAKE_LOG = log;
  return { root, log };
}
const lines = (log: string): { argv: string[]; at: number }[] => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const argvs = (log: string): string[][] => lines(log).map((l) => l.argv);
/** ms from the probe's emit to the launcher's start (the Vite config load before it is not part of the wait). */
const emitToLaunch = (log: string, emittedAt: number): number => lines(log)[0].at - emittedAt;
const PID = "AAAAAAAAAAAAAAAAAAAAAA";

describe("base validation (E178-E182)", () => {
  it("allowlist `^/([A-Za-z0-9._~-]+/)+$`, no dot segments, ≤ 256; `/` = no base", () => {
    const ok = (v: unknown) => validateBase(v).ok;
    const long = (n: number) => `/${"a".repeat(n - 2)}/`;
    expect(ok(long(255))).toBe(true);
    expect(ok(long(256))).toBe(true);
    expect(ok(long(257))).toBe(false);
    for (const v of ["/some/prefix/", "/..a/", "/a.b/", "/.../", `/preview/${PID}/`]) expect(ok(v), v).toBe(true);
    for (const v of ["", "a/b/", "/a/b", "//evil.example/", "///", "/\\evil/", 123, null, ["/a/"], "/a/../b/", "/./", "/a/./b/", "/../", "/a?x/", "/a#x/", "/a\\b/", "/a%2Fb/", "/a%2fb/", "/a%2Eb/", "/%2E%2E/", "/a//b/", "/a%5C/", "/a%252F/", "/a%00/", "/a b/", "/a\r\n/", "/é/"]) {
      expect(ok(v), String(v)).toBe(false);
    }
    expect(validateBase("/")).toEqual({ ok: true, base: null });
    const bad = validateBase("a/");
    expect(!bad.ok && bad.error).toContain('start and end with "/"');
    expect(!bad.ok && bad.error).toContain("/some/prefix/");
  });
  it("E189: joinUrl leaves exactly one `/` between a base URL and a path", () => {
    expect(joinUrl("http://localhost:5299/some/prefix/", "__mock/decisions")).toBe("http://localhost:5299/some/prefix/__mock/decisions");
    expect(joinUrl("http://localhost:5299/some/prefix", "/__mock/decisions")).toBe("http://localhost:5299/some/prefix/__mock/decisions");
  });
  it("an invalid explicit base is refused with the shape, nothing started, no probe", async () => {
    const { root } = fakeLauncherFixture();
    const { tool, emitted } = fakePi();
    for (const base of ["a/b/", "//evil.example/", "/a/../b/", "/a%2Fb/", 5]) {
      const r = (await tool.execute("t", { dir: root, port: await freePort(), base })).content[0].text;
      expect(r, String(base)).toContain('start and end with "/"');
    }
    expect(children.size).toBe(0);
    expect(emitted).toHaveLength(0);
  });
});

describe("explicit base (E184)", () => {
  it("is passed as `--base` to the launcher, served under it, and the probe is never emitted", async () => {
    const { root, log } = fakeLauncherFixture();
    const { tool, emitted } = fakePi();
    const port = await freePort();
    const r = await tool.execute("t", { dir: root, port, base: "/some/prefix/" });
    expect(r.details.local).toBe(`http://localhost:${port}/some/prefix/`);
    expect(argvs(log)[0]).toEqual(expect.arrayContaining(["--base", "/some/prefix/"]));
    expect(emitted).toHaveLength(0);
    await tool.execute("t", { stop: true, port });
  });
  it("explicit `/` means no base: no `--base`, no probe", async () => {
    const { root, log } = fakeLauncherFixture();
    const { tool, emitted } = fakePi();
    const port = await freePort();
    const r = await tool.execute("t", { dir: root, port, base: "/" });
    expect(r.details.local).toBe(`http://localhost:${port}`);
    expect(argvs(log)[0]).not.toContain("--base");
    expect(emitted).toHaveLength(0);
  });
});

describe("the reservation probe (E105, E183, E185, X51-X54, X57)", () => {
  it("no listener: root, without waiting; listener that never sets pending: root, without waiting", async () => {
    const { root, log } = fakeLauncherFixture();
    const port = await freePort();
    const r = await fakePi().tool.execute("t", { dir: root, port });
    expect(r.details.local).toBe(`http://localhost:${port}`);
    expect(argvs(log)[0]).not.toContain("--base");
    await fakePi().tool.execute("t", { stop: true, port });
    const { tool, emitted } = fakePi(() => {});
    const p2 = await freePort();
    await tool.execute("t", { dir: root, port: p2 });
    expect(emitToLaunch(log, emitted[0].at as number)).toBeLessThan(RESERVATION_WAIT_MS - 500); // no `pending` ⇒ no wait
    expect(emitted).toHaveLength(1);
    expect(emitted[0].port).toBe(p2);
    expect(emitted[0].signal.aborted).toBe(false);
  });
  it("a valid host-answered base is used; the pid appears once, inside the URL only (E185)", async () => {
    const { root, log } = fakeLauncherFixture();
    const { tool, emitted } = fakePi((p) => { p.pending = Promise.resolve({ base: `/preview/${PID}/`, extra: 1 }); });
    const port = await freePort();
    const r = await tool.execute("t", { dir: root, port });
    const text = r.content[0].text;
    expect(text.split(PID)).toHaveLength(2);
    expect(text).toContain(`  local: http://localhost:${port}/preview/${PID}/`);
    expect(text).not.toMatch(/^base:/m);
    expect(argvs(log)[0]).toEqual(expect.arrayContaining(["--base", `/preview/${PID}/`]));
    expect(emitted[0].signal.aborted).toBe(false);
    await tool.execute("t", { stop: true, port });
  });
  it("E183/X53: malformed, null, rejected answers and a throwing emit start at root; malformed/rejected abort the signal", async () => {
    for (const answer of [{ base: "//evil.example/" }, { base: "a/" }, { base: "/a/../" }, { base: 5 }, {}, "x", "reject"]) {
      const { root, log } = fakeLauncherFixture();
      const { tool, emitted } = fakePi((p) => { p.pending = answer === "reject" ? Promise.reject(new Error("base reservation unavailable: reservation_limit")) : Promise.resolve(answer); });
      const port = await freePort();
      const r = await tool.execute("t", { dir: root, port });
      expect(r.details.local, JSON.stringify(answer)).toBe(`http://localhost:${port}`);
      expect(r.content[0].text).toContain("base reservation unavailable");
      expect(argvs(log).at(-1)).not.toContain("--base");
      expect(emitted[0].signal.aborted).toBe(true);
      await tool.execute("t", { stop: true, port });
    }
    const { root } = fakeLauncherFixture();
    const { tool } = fakePi(() => { throw new Error("listener boom"); });
    const port = await freePort();
    expect((await tool.execute("t", { dir: root, port })).details.local).toBe(`http://localhost:${port}`);
    const none = fakePi((p) => { p.pending = Promise.resolve(null); });
    const p3 = await freePort();
    const r3 = await none.tool.execute("t", { dir: root, port: p3 });
    expect(r3.content[0].text).not.toContain("unavailable");
    expect(none.emitted[0].signal.aborted).toBe(false);
  });
  it("X51/X52: an answer that never comes aborts `signal` at 2 s and the site starts at root; a late answer is never used", async () => {
    const { root, log } = fakeLauncherFixture();
    let late: (v: unknown) => void = () => {};
    const { tool, emitted } = fakePi((p) => { p.pending = new Promise((res) => { late = res; }); });
    const port = await freePort();
    const r = await tool.execute("t", { dir: root, port });
    const waited = emitToLaunch(log, emitted[0].at as number);
    expect(waited).toBeGreaterThanOrEqual(RESERVATION_WAIT_MS - 100);
    expect(waited).toBeLessThan(RESERVATION_WAIT_MS + 1500);
    expect(emitted[0].signal.aborted).toBe(true);
    expect(r.details.local).toBe(`http://localhost:${port}`);
    expect(r.content[0].text).toContain("base reservation unavailable");
    late({ base: "/preview/BBBBBBBBBBBBBBBBBBBBBB/" });
    await new Promise((r2) => setTimeout(r2, 200));
    expect(argvs(log)).toHaveLength(1); // no second launch
    expect(argvs(log)[0]).not.toContain("--base");
    await tool.execute("t", { stop: true, port });
  });
  it("X57: a busy port never emits the probe; a crash after a reserved base aborts `signal`", async () => {
    const { root } = fakeLauncherFixture();
    const busy = net.createServer();
    const port = await new Promise<number>((res) => busy.listen(0, "127.0.0.1", () => res((busy.address() as net.AddressInfo).port)));
    const a = fakePi((p) => { p.pending = Promise.resolve({ base: `/preview/${PID}/` }); });
    expect((await a.tool.execute("t", { dir: root, port })).content[0].text).toContain("is busy");
    expect(a.emitted).toHaveLength(0);
    await new Promise<void>((res) => busy.close(() => res()));
    process.env.FAKE_MODE = "crash";
    const b = fakePi((p) => { p.pending = Promise.resolve({ base: `/preview/${PID}/` }); });
    const r = await b.tool.execute("t", { dir: root, port: await freePort() });
    expect(r.content[0].text).toContain("exited during start");
    expect(b.emitted[0].signal.aborted).toBe(true);
    expect(children.size).toBe(0);
  });
});

describe("the plugin under a real Vite base (E186, E187, E190)", () => {
  /** The foreground launcher in a plain node child (the Vite config load is not slowed by the vitest transform). */
  async function start(root: string, port: number, extra: string[]): Promise<() => void> {
    const cli = path.resolve(__dirname, "../mock-site/serve-cli.mjs");
    const child = spawn(process.execPath, [cli, "--port", String(port), ...extra], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout?.on("data", (c) => (out += c));
    child.stderr?.on("data", (c) => (out += c));
    const probePath = `${extra[0] === "--base" ? extra[1] : "/"}__mock/decisions`;
    for (let i = 0; i < 240; i++) {
      if ((await get(port, probePath)).body.includes("mockSite")) return () => void child.kill("SIGKILL");
      await new Promise((r) => setTimeout(r, 500));
    }
    child.kill("SIGKILL");
    throw new Error(`mock site did not start:\n${out.slice(-1500)}`);
  }
  it("serves its HTML entry and `__mock/*` only under the base; the app's own `base` never leaks in", async () => {
    const root = makeServableFixture();
    roots.push(root);
    fs.writeFileSync(path.join(root, "vite.config.mjs"), "export default { base: '/app/', define: { __FX__: '1' } };\n");
    const port = await freePort();
    const stop = await start(root, port, ["--base", "/some/prefix/"]);
    try {
      for (const p of ["/some/prefix/", "/some/prefix/index.html"]) {
        const h = await get(port, p);
        expect(h.status, p).toBe(200);
        expect(h.body, p).toContain('src="/some/prefix/@fs/');
      }
      expect((await get(port, "/some/prefix")).status).toBe(302);
      for (const p of ["/", "/__mock/decisions", "/app/", "/some/prefixX/", "//some/prefix/"]) {
        const h = await get(port, p);
        expect(h.body, p).not.toContain("mockSite");
        expect(h.body, p).not.toContain('id="root"');
      }
      for (const p of ["/some/prefix/__mock/../"]) await get(port, p);
      expect((await get(port, "/some/prefix/__mock/decisions")).status).toBe(200); // the process survived the odd paths
    } finally {
      stop();
    }
    // Without `--base` the same project serves at `/`, never at the app's `/app/`
    const p2 = await freePort();
    const stop2 = await start(root, p2, []);
    try {
      expect((await get(p2, "/__mock/decisions")).body).toContain("mockSite");
      expect((await get(p2, "/app/__mock/decisions")).body).not.toContain("mockSite");
      for (const f of fs.readdirSync(path.join(root, "node_modules/.vite-mock-site")).filter((x) => x.startsWith("mock-site.config."))) {
        expect(fs.readFileSync(path.join(root, "node_modules/.vite-mock-site", f), "utf8")).not.toMatch(/some\/prefix/);
      }
    } finally {
      stop2();
    }
  }, 600_000);
  it("serve-cli refuses a malformed --base before starting anything", async () => {
    const cli = path.resolve(__dirname, "../mock-site/serve-cli.mjs");
    const out = spawnSync(process.execPath, [cli, "--port", "5398", "--base", "//evil/"], { encoding: "utf8" });
    expect(out.status).toBe(2);
    expect(out.stderr).toContain('start and end with "/"');
    expect(fs.readFileSync(cli, "utf8")).toContain("--base /some/prefix/"); // usage lists the flag
  });
});
