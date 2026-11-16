/**
 * Smoke tests for the mockup-loop extension tools, focused on the new
 * design-system surface: list_design_systems, init_ui_contract (+system),
 * score_mockup (+system), validate_mockup. Back-compat: no-system calls must
 * behave exactly as before.
 *
 * Pattern: a fake ExtensionAPI captures registered tool handlers, then we
 * drive them directly. Mirrors image-fit-extension's extension.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Controllable os.networkInterfaces (LAN URL tests); everything else is real.
const nic = vi.hoisted(() => ({ fn: undefined as undefined | (() => unknown) }));
vi.mock("node:os", async (orig) => {
  const actual = await orig<typeof import("node:os")>();
  const networkInterfaces = () => (nic.fn ? nic.fn() : actual.networkInterfaces());
  return { ...actual, networkInterfaces, default: { ...actual, networkInterfaces } };
});

import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import frontendMockupLoop from "../extension.js";

interface Tool {
  name: string;
  execute: (id: string, params: any, signal?: unknown, onUpdate?: unknown, ctx?: { cwd?: string }) => Promise<{ content: { text: string }[]; details: Record<string, unknown> }>;
}

function makeFakePi() {
  const tools = new Map<string, Tool>();
  const pi: any = {
    registerTool(t: Tool) {
      tools.set(t.name, t);
    },
    registerCommand() {},
    on() {},
  };
  return { pi, tools };
}

describe("extension tool surface", () => {
  let tools: Map<string, Tool>;
  let workDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const f = makeFakePi();
    tools = f.tools;
    frontendMockupLoop(f.pi);
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-ext-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it("registers all five tools", () => {
    for (const name of ["serve_mockup", "score_mockup", "init_ui_contract", "list_design_systems", "validate_mockup"]) {
      expect(tools.has(name)).toBe(true);
    }
  });

  it("list_design_systems returns the 5-preset registry", async () => {
    const res = await tools.get("list_design_systems")!.execute("t", {});
    const presets = (res.details as any).presets as any[];
    expect(presets).toHaveLength(5);
    expect(presets.map((p) => p.id)).toContain("apple-hig");
  });

  it("init_ui_contract with no system writes the blank template (back-compat)", async () => {
    const target = path.join(workDir, "ui-contract.md");
    const res = await tools.get("init_ui_contract")!.execute("t", { path: target });
    expect((res.details as any).created).toBe(true);
    const body = fs.readFileSync(target, "utf8");
    expect(body).toContain("# UI Contract");
    expect(body).toContain("Anti-slop guardrails");
  });

  it("init_ui_contract --system shadcn writes a DTCG contract", async () => {
    const target = path.join(workDir, "ui-contract.tokens.json");
    const res = await tools.get("init_ui_contract")!.execute("t", { path: target, system: "shadcn" });
    expect((res.details as any).system).toBe("shadcn");
    const parsed = JSON.parse(fs.readFileSync(target, "utf8"));
    expect(parsed.color.primary).toHaveProperty("$value");
  });

  it("init_ui_contract rejects an unknown system", async () => {
    const res = await tools.get("init_ui_contract")!.execute("t", { system: "bogus" });
    expect((res.details as any).error).toContain("bogus");
  });

  it("score_mockup --system apple-hig returns the HIG rubric, not the generic one", async () => {
    const res = await tools.get("score_mockup")!.execute("t", { url: "http://x", system: "apple-hig" });
    const text = res.content.map((c) => c.text).join("\n");
    expect(text).toContain("Apple Human Interface Guidelines");
    expect(text).toContain("tab bar");
    expect(text).not.toContain("purple gradient");
  });

  it("validate_mockup returns the { gates, advisory, pass } shape", async () => {
    fs.writeFileSync(path.join(workDir, "index.html"), `<div class="text-primary">ok</div>`);
    const res = await tools.get("validate_mockup")!.execute("t", { system: "shadcn", dir: workDir });
    const d = res.details as any;
    expect(d.gates.l1).toBeTruthy();
    expect(d.gates.l2).toBeTruthy();
    expect(d.advisory.l4).toBeTruthy();
    expect(typeof d.pass).toBe("boolean");
  });
});


// ─── serve_mockup listener / token / Host / dir confinement ───────────────
// close-local-listener-and-egress-gaps §3 (D4, D5); test-plan E41–E70.

interface Raw { status: number; head: string; body: string }

function raw(port: number, target: string, opts: { host?: string | null } = {}): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const host = opts.host === undefined ? `127.0.0.1:${port}` : opts.host;
    const lines = host === null ? [`GET ${target} HTTP/1.0`, ""] : [`GET ${target} HTTP/1.1`, `Host: ${host}`, "Connection: close", ""];
    const sock = net.connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    sock.on("data", (c: Buffer) => chunks.push(c));
    sock.on("error", reject);
    sock.on("close", () => {
      const all = Buffer.concat(chunks).toString("latin1");
      const [head, ...rest] = all.split("\r\n\r\n");
      resolve({ status: Number(head.split(" ")[1]), head, body: rest.join("\r\n\r\n") });
    });
    sock.write(`${lines.join("\r\n")}\r\n`);
  });
}

describe("serve_mockup listener hardening", () => {
  const MARKER = "TOP-SECRET-MARKER";
  let tools: Map<string, Tool>;
  let tmp: string;
  let cwd: string;
  let mock: string;
  let outside: string;
  let ports: number[];
  let created: net.Server[];
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let listenSpy: ReturnType<typeof vi.spyOn>;

  const ctx = () => ({ cwd });
  const start = async (params: Record<string, unknown> = {}, c: { cwd?: string } | null = ctx()) => {
    const res = await tools.get("serve_mockup")!.execute("t", { dir: mock, ...params }, undefined, undefined, c ?? undefined);
    const d = res.details as any;
    if (typeof d.port === "number") ports.push(d.port);
    const token = typeof d.local === "string" ? d.local.split("/")[3] : "";
    return { res, d, token, text: res.content[0].text, port: d.port as number };
  };
  const bound = () => (created.at(-1)!.address() as net.AddressInfo).address;

  beforeEach(() => {
    const f = makeFakePi();
    tools = f.tools;
    frontendMockupLoop(f.pi);
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ml-listen-")));
    cwd = path.join(tmp, "proj");
    mock = path.join(cwd, "mock");
    outside = path.join(tmp, "outside");
    fs.mkdirSync(mock, { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(mock, "index.html"), '<link href="/style.css"><link href="style.css"><h1>hi</h1>');
    fs.writeFileSync(path.join(mock, "style.css"), "body{}");
    fs.writeFileSync(path.join(outside, "secret.txt"), MARKER);
    ports = [];
    created = [];
    nic.fn = undefined;
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const orig = net.Server.prototype.listen as (...a: unknown[]) => net.Server;
    listenSpy = vi.spyOn(net.Server.prototype, "listen").mockImplementation(function (this: net.Server, ...a: any[]) {
      created.push(this);
      return orig.apply(this, a);
    });
  });

  afterEach(async () => {
    for (const port of ports) await tools.get("serve_mockup")!.execute("t", { stop: true, port });
    listenSpy.mockRestore();
    infoSpy.mockRestore();
    nic.fn = undefined;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe("bind + URLs (E41–E46)", () => {
    it("binds 127.0.0.1 by default and returns a token URL, no LAN URL", async () => {
      const { text, d, token, port } = await start();
      expect(bound()).toBe("127.0.0.1");
      expect(token).toMatch(/^[0-9a-f]{32}$/);
      expect(d.local).toBe(`http://localhost:${port}/${token}/`);
      expect(text).toMatch(/local: http:\/\/localhost:\d+\/[0-9a-f]{32}\//);
      expect(text).not.toContain("LAN:");
      expect(d.lan).toBeUndefined();
      expect((await raw(port, `/${token}/index.html`)).status).toBe(200);
    });

    it("binds 127.0.0.1 on a fixed port", async () => {
      const probe = net.createServer();
      await new Promise<void>((r) => probe.listen(0, "127.0.0.1", () => r()));
      const free = (probe.address() as net.AddressInfo).port;
      await new Promise<void>((r) => probe.close(() => r()));
      const { port, d } = await start({ port: free });
      expect(port).toBe(free);
      expect(bound()).toBe("127.0.0.1");
      expect(d.local).toContain(`:${free}/`);
    });

    it("lan:true binds 0.0.0.0 and returns local + LAN token URLs", async () => {
      nic.fn = () => ({ en0: [{ family: "IPv4", internal: false, address: "192.168.1.50" }] });
      const { d, token, port, text } = await start({ lan: true });
      expect(bound()).toBe("0.0.0.0");
      expect(d.local).toBe(`http://localhost:${port}/${token}/`);
      expect(d.lan).toBe(`http://192.168.1.50:${port}/${token}/`);
      expect(text).toContain("LAN:");
    });

    it.each([
      [true, "0.0.0.0"], [false, "127.0.0.1"], [undefined, "127.0.0.1"], ["true", "127.0.0.1"],
      ["false", "127.0.0.1"], [1, "127.0.0.1"], [0, "127.0.0.1"], [null, "127.0.0.1"],
    ])("lan=%j binds %s (only boolean true opens the LAN)", async (lan, addr) => {
      await start({ lan });
      expect(bound()).toBe(addr);
    });

    it("lan:true with no IPv4 reports (no LAN IPv4 detected) and still serves", async () => {
      nic.fn = () => ({ lo0: [{ family: "IPv4", internal: true, address: "127.0.0.1" }] });
      const { d, text, token, port } = await start({ lan: true });
      expect(text).toContain("(no LAN IPv4 detected)");
      expect(d.local).toContain(`/${token}/`);
      expect((await raw(port, `/${token}/index.html`)).status).toBe(200);
    });

    it("description and result steer to loopback-by-default, lan:true, relative links", async () => {
      const desc = (tools.get("serve_mockup") as any).description as string;
      expect(desc).not.toMatch(/on 0\.0\.0\.0/);
      expect(desc).toMatch(/lan:\s*true/);
      expect(desc).toMatch(/loopback|127\.0\.0\.1|this machine/i);
      expect(desc).toMatch(/relative/i);
      for (const lan of [false, true]) {
        const { text } = await start({ lan });
        expect(text).toContain("Show the local URL to the user.");
        expect(text).not.toMatch(/canvas\(|dashboard/i);
      }
    });
  });

  describe("input validation (E47–E49, E67, E68)", () => {
    it("no dir → error; missing / file dir → error naming path; no listener started", async () => {
      const before = created.length;
      const a = await tools.get("serve_mockup")!.execute("t", {}, undefined, undefined, ctx());
      expect(a.content[0].text).toMatch(/dir required/);
      const missing = path.join(cwd, "nope");
      const b = await tools.get("serve_mockup")!.execute("t", { dir: missing }, undefined, undefined, ctx());
      expect(b.content[0].text).toContain(missing);
      const file = path.join(mock, "index.html");
      const c = await tools.get("serve_mockup")!.execute("t", { dir: file }, undefined, undefined, ctx());
      expect(c.content[0].text).toContain(file);
      expect(created.length).toBe(before);
    });

    it.each(["", "mockups", "mockups/"])("dir under cwd starts (%j)", async (sub) => {
      fs.mkdirSync(path.join(cwd, "mockups"), { recursive: true });
      const { port } = await start({ dir: path.join(cwd, sub) });
      expect(typeof port).toBe("number");
    });

    it("dir outside cwd (parent, string-prefix sibling, .., /etc) is refused naming cwd", async () => {
      fs.mkdirSync(path.join(tmp, "proj-x"));
      fs.mkdirSync(path.join(tmp, "other"));
      const before = created.length;
      for (const dir of [tmp, path.join(tmp, "proj-x"), "../other", "/etc"]) {
        const res = await tools.get("serve_mockup")!.execute("t", { dir }, undefined, undefined, ctx());
        expect(res.content[0].text, dir).toContain(cwd);
        expect((res.details as any).port, dir).toBeUndefined();
      }
      expect(created.length).toBe(before);
    });

    it("symlinked dir: escaping link refused, in-cwd link allowed", async () => {
      fs.symlinkSync(outside, path.join(cwd, "m"));
      fs.mkdirSync(path.join(cwd, "real"));
      fs.symlinkSync(path.join(cwd, "real"), path.join(cwd, "m2"));
      const bad = await tools.get("serve_mockup")!.execute("t", { dir: "m" }, undefined, undefined, ctx());
      expect(bad.content[0].text).toContain(cwd);
      expect((bad.details as any).port).toBeUndefined();
      const ok = await start({ dir: "m2" });
      expect(typeof ok.port).toBe("number");
    });

    it("root follows ctx.cwd, not process.cwd(); falls back to process.cwd() without ctx", async () => {
      const b = path.join(tmp, "b");
      fs.mkdirSync(b);
      const spy = vi.spyOn(process, "cwd").mockReturnValue(b);
      try {
        expect(typeof (await start({ dir: mock })).port).toBe("number"); // under ctx.cwd (a != process cwd)
        const refused = await tools.get("serve_mockup")!.execute("t", { dir: path.join(b) }, undefined, undefined, ctx());
        expect((refused.details as any).port).toBeUndefined(); // under process.cwd() only
        expect(typeof (await start({ dir: b }, null)).port).toBe("number"); // no ctx
        const noCtxRefused = await tools.get("serve_mockup")!.execute("t", { dir: mock }, undefined, undefined, undefined);
        expect((noCtxRefused.details as any).port).toBeUndefined();
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("logging + lifecycle (E69, E70)", () => {
    it("logs one info line per start: bind, lan, real root; never the token", async () => {
      for (const lan of [false, true]) {
        infoSpy.mockClear();
        const { token } = await start({ lan });
        expect(infoSpy).toHaveBeenCalledTimes(1);
        const line = String(infoSpy.mock.calls[0].join(" "));
        expect(line).toContain(lan ? "0.0.0.0" : "127.0.0.1");
        expect(line).toContain(`lan=${lan}`);
        expect(line).toContain(mock);
        expect(line).not.toContain(token);
      }
    });

    it("restart on the same port yields a new token; stopping an unknown port is a no-op", async () => {
      const first = await start();
      await tools.get("serve_mockup")!.execute("t", { stop: true, port: first.port });
      const second = await start({ port: first.port });
      expect(second.token).not.toBe(first.token);
      const other = await start();
      const unknown = await tools.get("serve_mockup")!.execute("t", { stop: true, port: 1 });
      expect(unknown.content[0].text).toMatch(/No mockup server/);
      expect((await raw(other.port, `/${other.token}/index.html`)).status).toBe(200);
    });
  });

  describe("static handler (E50–E66, X10)", () => {
    it("token: only the exact prefix serves; everything else is a bare 404", async () => {
      const { port, token } = await start();
      const flip = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
      expect((await raw(port, `/${token}/index.html`)).status).toBe(200);
      for (const p of ["/index.html", `/wrong/index.html`, `/${token}`, `/${token}x/index.html`, `/${flip}/index.html`, `/${token.toUpperCase()}/index.html`]) {
        const r = await raw(port, p);
        expect(r.status, p).toBe(404);
        expect(r.body, p).not.toContain(token);
        expect(r.body, p).not.toContain("index.html");
      }
    });

    it("root-relative /style.css 404s, relative resolves", async () => {
      const { port, token } = await start();
      expect((await raw(port, "/style.css")).status).toBe(404);
      expect((await raw(port, `/${token}/style.css`)).status).toBe(200);
    });

    it("dotfile segments 404 (incl. encoded); root under a dotted parent still serves", async () => {
      fs.writeFileSync(path.join(mock, ".env"), "S=1");
      fs.mkdirSync(path.join(mock, "a/.git"), { recursive: true });
      fs.writeFileSync(path.join(mock, "a/.git/config"), "x");
      fs.mkdirSync(path.join(mock, ".well-known"));
      fs.writeFileSync(path.join(mock, ".well-known/x"), "x");
      fs.writeFileSync(path.join(mock, "..a"), "x");
      const { port, token } = await start();
      for (const p of [".env", "a/.git/config", ".well-known/x", "..a", "%2eenv"]) {
        const r = await raw(port, `/${token}/${p}`);
        expect(r.status, p).toBe(404);
        expect(r.body, p).not.toContain("S=1");
      }
      const dotted = path.join(cwd, ".hidden", "mock");
      fs.mkdirSync(dotted, { recursive: true });
      fs.writeFileSync(path.join(dotted, "index.html"), "ok-dotted");
      const d2 = await start({ dir: dotted });
      const r = await raw(d2.port, `/${d2.token}/`);
      expect(r.status).toBe(200);
      expect(r.body).toContain("ok-dotted");
    });

    it("symlinks: inside ok; outside file/dir 403 with no byte; sibling-prefix dir not served", async () => {
      fs.writeFileSync(path.join(mock, "real.txt"), "REAL");
      fs.symlinkSync(path.join(mock, "real.txt"), path.join(mock, "in-file"));
      fs.symlinkSync(path.join(outside, "secret.txt"), path.join(mock, "out-file"));
      fs.symlinkSync(outside, path.join(mock, "out-dir"));
      fs.mkdirSync(path.join(mock, "sub"));
      fs.symlinkSync(path.join(mock, "sub"), path.join(mock, "in-dir"));
      fs.writeFileSync(path.join(mock, "sub/index.html"), "SUB");
      const sib = `${mock}-x`;
      fs.mkdirSync(sib);
      fs.writeFileSync(path.join(sib, "secret.txt"), MARKER);
      fs.symlinkSync(path.join(sib, "secret.txt"), path.join(mock, "sib-link"));
      const { port, token } = await start();
      expect((await raw(port, `/${token}/in-file`)).body).toContain("REAL");
      expect((await raw(port, `/${token}/in-dir/`)).body).toContain("SUB");
      for (const p of ["out-file", "out-dir/secret.txt", "sib-link"]) {
        const r = await raw(port, `/${token}/${p}`);
        expect(r.status, p).toBe(403);
        expect(r.head + r.body, p).not.toContain(MARKER);
      }
    });

    it("traversal: escaping .. is 403 (raw and %2f); a staying .. is 404; double-encoding is literal 404", async () => {
      const { port, token } = await start();
      for (const p of ["../../etc/passwd", "..%2f..%2fetc/passwd"]) {
        const r = await raw(port, `/${token}/${p}`);
        expect(r.status, p).toBe(403);
      }
      expect((await raw(port, `/${token}/a/../index.html`)).status).toBe(404);
      const dbl = await raw(port, `/${token}/%252e%252e/%252e%252e/etc/passwd`);
      expect(dbl.status).toBe(404);
      expect(dbl.body).not.toContain("root:");
    });

    it("malformed paths → 400 with a generic body (no URIError, no 500)", async () => {
      const { port, token } = await start();
      for (const p of ["a%00.html", "%zz", "%"]) {
        const r = await raw(port, `/${token}/${p}`);
        expect(r.status, p).toBe(400);
        expect(r.body, p).not.toMatch(/URIError|malformed|at /i);
      }
    });

    it("resolution: dir → index.html; missing 404 text/plain, path not reflected as markup; headers by extension", async () => {
      fs.mkdirSync(path.join(mock, "noindex"));
      for (const f of ["a.css", "a.js", "a.png", "a.xyz"]) fs.writeFileSync(path.join(mock, f), "x");
      const { port, token } = await start();
      const idx = await raw(port, `/${token}/`);
      expect(idx.status).toBe(200);
      expect(idx.body).toContain("<h1>hi</h1>");
      expect((await raw(port, `/${token}/noindex/`)).status).toBe(404);
      const miss = await raw(port, `/${token}/<script>.html`);
      expect(miss.status).toBe(404);
      expect(miss.head).toMatch(/content-type: text\/plain/i);
      const type = async (f: string) => (await raw(port, `/${token}/${f}`)).head;
      expect(await type("index.html")).toMatch(/content-type: text\/html/i);
      expect(await type("a.css")).toMatch(/content-type: text\/css/i);
      expect(await type("a.js")).toMatch(/content-type: text\/javascript/i);
      expect(await type("a.png")).toMatch(/content-type: image\/png/i);
      const x = await type("a.xyz");
      expect(x).toMatch(/content-type: application\/octet-stream/i);
      expect(x).toMatch(/cache-control: no-store/i);
    });

    it("loopback Host check: literal forms ok; rebound/other-port/absent/no-port/trailing-dot/127.0.0.2 → 421", async () => {
      const { port, token } = await start();
      const get = (host: string | null) => raw(port, `/${token}/index.html`, { host });
      for (const h of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, `LOCALHOST:${port}`]) expect((await get(h)).status, h).toBe(200);
      for (const h of [`evil.example:${port}`, `localhost:${port + 1}`, "localhost", `localhost.:${port}`, `127.0.0.2:${port}`, null]) {
        const r = await get(h);
        expect(r.status, String(h)).toBe(421);
        expect(r.body).not.toContain("<h1>");
      }
    });

    it("check order: wrong token + evil Host is 404, not 421", async () => {
      const { port } = await start();
      expect((await raw(port, "/wrong/index.html", { host: `evil.example:${port}` })).status).toBe(404);
    });

    it("LAN mode skips the Host check; wrong token still 404", async () => {
      nic.fn = () => ({});
      const { port, token } = await start({ lan: true });
      expect((await raw(port, `/${token}/index.html`, { host: `192.168.1.5:${port}` })).status).toBe(200);
      expect((await raw(port, `/${token}/index.html`, { host: `evil.example:${port}` })).status).toBe(200);
      expect((await raw(port, "/wrong/index.html", { host: `192.168.1.5:${port}` })).status).toBe(404);
    });

    it("realpath failures: loop/dangling → 404; EACCES → 403; nothing served", async () => {
      fs.symlinkSync(path.join(mock, "b"), path.join(mock, "a"));
      fs.symlinkSync(path.join(mock, "a"), path.join(mock, "b"));
      fs.symlinkSync(path.join(mock, "gone"), path.join(mock, "dangling"));
      const locked = path.join(mock, "locked");
      fs.mkdirSync(locked);
      fs.writeFileSync(path.join(locked, "f.txt"), "LOCKED");
      const { port, token } = await start();
      expect((await raw(port, `/${token}/a`)).status).toBe(404);
      expect((await raw(port, `/${token}/dangling`)).status).toBe(404);
      fs.chmodSync(locked, 0o000);
      try {
        if (process.getuid?.() !== 0) {
          const r = await raw(port, `/${token}/locked/f.txt`);
          expect(r.status).toBe(403);
          expect(r.body).not.toContain("LOCKED");
        }
      } finally {
        fs.chmodSync(locked, 0o755);
      }
    });

    it("client abort mid-stream does not crash the server", async () => {
      fs.writeFileSync(path.join(mock, "big.bin"), Buffer.alloc(8 * 1024 * 1024));
      const { port, token } = await start();
      await new Promise<void>((resolve) => {
        const s = net.connect(port, "127.0.0.1", () => {
          s.write(`GET /${token}/big.bin HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`);
          s.once("data", () => { s.destroy(); resolve(); });
        });
      });
      await new Promise((r) => setTimeout(r, 100));
      expect((await raw(port, `/${token}/index.html`)).status).toBe(200);
    });

    it("T.162 X10: client abort mid-stream releases the file handle; no uncaught exception; server keeps serving", async () => {
      // The read stream is created inside the handler (namespace-imported fs, not spy-able), so its destruction is
      // observed through the process fd table. /dev/fd exists on Linux and macOS; elsewhere the fd assertion is skipped
      // and the no-crash + keeps-serving assertions carry the row.
      const fdCount = (): number | null => {
        try {
          return fs.readdirSync("/dev/fd").length;
        } catch {
          return null;
        }
      };
      const uncaught: unknown[] = [];
      const onUncaught = (e: unknown) => void uncaught.push(e);
      process.on("uncaughtException", onUncaught);
      process.on("unhandledRejection", onUncaught);
      try {
        fs.writeFileSync(path.join(mock, "huge.bin"), Buffer.alloc(64 * 1024 * 1024));
        const { port, token } = await start();
        await raw(port, `/${token}/index.html`); // warm up: lazily opened fds settle before the baseline
        const baseline = fdCount();
        const client = await new Promise<net.Socket>((resolve, reject) => {
          const s = net.connect(port, "127.0.0.1", () => {
            s.write(`GET /${token}/huge.bin HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`);
            s.once("data", () => resolve(s));
          });
          s.once("error", reject);
        });
        const during = fdCount();
        client.destroy();
        let after = fdCount();
        for (let i = 0; i < 40 && baseline !== null && after !== null && after > baseline; i++) {
          await new Promise((r) => setTimeout(r, 50));
          after = fdCount();
        }
        if (baseline !== null && after !== null) {
          expect(during, "stream held descriptors while the client was connected").toBeGreaterThan(baseline);
          expect(after, "fd count back to baseline after the abort").toBeLessThanOrEqual(baseline);
        }
        expect((await raw(port, `/${token}/index.html`)).status).toBe(200);
        expect(uncaught).toEqual([]);
      } finally {
        process.off("uncaughtException", onUncaught);
        process.off("unhandledRejection", onUncaught);
      }
    });
  });
});
