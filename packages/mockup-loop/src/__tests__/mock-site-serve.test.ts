/**
 * L1 — serve_mock_site tool: real Vite child against a fixture project.
 * See change: add-live-component-mock-site (test-plan E18, E19, X1, X2, X3, X8, P2).
 */
import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as http from "node:http";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import frontendMockupLoop from "../extension.js";
import { children } from "../mock-site-serve.js";
import { makeFixture, makeServableFixture } from "./mock-site-fixture";

type Tool = { name: string; execute: (id: string, p: any) => Promise<{ content: { text: string }[]; details: any }> };
function fakePi() {
  const tools = new Map<string, Tool>();
  const handlers = new Map<string, () => Promise<void>>();
  const pi: any = { registerTool: (t: Tool) => tools.set(t.name, t), registerCommand() {}, on: (e: string, h: () => Promise<void>) => handlers.set(e, h) };
  frontendMockupLoop(pi);
  return { tools, handlers };
}
const freePort = () => new Promise<number>((r) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); }); });
const refused = (port: number) => new Promise<boolean>((r) => { const s = net.connect(port, "127.0.0.1"); s.on("connect", () => { s.destroy(); r(false); }); s.on("error", () => r(true)); });
const roots: string[] = [];
afterEach(async () => {
  for (const c of children.values()) c.kill("SIGKILL");
  children.clear();
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

describe("serve_mock_site", () => {
  it("registers alongside the existing tools without importing vite (X8)", () => {
    const { tools } = fakePi();
    for (const n of ["serve_mockup", "score_mockup", "init_ui_contract", "list_design_systems", "validate_mockup", "serve_mock_site"]) expect(tools.has(n), n).toBe(true);
    const src = fs.readFileSync(path.resolve(__dirname, "../mock-site-serve.ts"), "utf8") + fs.readFileSync(path.resolve(__dirname, "../mock-site/plugin.mjs"), "utf8");
    expect(src).not.toMatch(/from\s+["']vite["']/);
  });

  it("refuses reserved ports, missing config, missing vite (E18)", async () => {
    const { tools } = fakePi();
    const t = tools.get("serve_mock_site")!;
    const root = makeServableFixture(); roots.push(root);
    expect((await t.execute("t", { dir: root, port: 8000 })).content[0].text).toMatch(/reserved/);
    process.env.PI_DASHBOARD_PORT = "5310";
    try { expect((await t.execute("t", { dir: root, port: 5310 })).content[0].text).toMatch(/reserved/); } finally { delete process.env.PI_DASHBOARD_PORT; }
    const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ms-bare-"))); roots.push(bare);
    expect((await t.execute("t", { dir: bare })).content[0].text).toContain(path.join(bare, "mockups", "mock-site.config.ts"));
    fs.mkdirSync(path.join(bare, "mockups")); fs.writeFileSync(path.join(bare, "mockups/mock-site.config.ts"), "export default {}");
    expect((await t.execute("t", { dir: bare })).content[0].text).toMatch(/vite not found/);
    expect(children.size).toBe(0);
  });

  it("starts within 30s, LAN text only with lan, stops and frees the port (E19, P2, X3)", async () => {
    const { tools, handlers } = fakePi();
    const t = tools.get("serve_mock_site")!;
    const root = makeServableFixture(); roots.push(root);
    const port = await freePort();
    const t0 = Date.now();
    const a = await t.execute("t", { dir: root, port });
    expect(Date.now() - t0).toBeLessThan(30_000);
    expect(a.content[0].text).toContain(`http://localhost:${port}`);
    expect(a.content[0].text).not.toMatch(/LAN:/);
    await t.execute("t", { stop: true, port });
    expect(await refused(port)).toBe(true);
    const b = await t.execute("t", { dir: root, port, lan: true });
    expect(b.content[0].text).toMatch(/LAN:/);
    expect(b.content[0].text).toMatch(/view-only/);
    expect(b.content[0].text).toMatch(/readable on the LAN/);
    const child = children.get(port)!;
    await handlers.get("session_shutdown")!();
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    expect(await refused(port)).toBe(true);
  }, 90_000);

  it("busy port: error, foreign server untouched, no child (X1)", async () => {
    const { tools } = fakePi();
    const root = makeServableFixture(); roots.push(root);
    const foreign = http.createServer((_q, s) => s.end("hi"));
    const port = await new Promise<number>((r) => foreign.listen(0, "127.0.0.1", () => r((foreign.address() as net.AddressInfo).port)));
    try {
      const res = await tools.get("serve_mock_site")!.execute("t", { dir: root, port });
      expect(res.content[0].text).toMatch(new RegExp(`port ${port}`));
      expect(res.details.local).toBeUndefined();
      expect(children.size).toBe(0);
      const body = await new Promise<string>((r) => http.get({ host: "127.0.0.1", port, agent: false }, (s) => { let b = ""; s.on("data", (c) => (b += c)); s.on("end", () => r(b)); }));
      expect(body).toBe("hi");
    } finally { foreign.close(); }
  }, 60_000);

  it("child crash during start fails fast (X2)", async () => {
    const { tools } = fakePi();
    const root = makeFixture(); roots.push(root);
    fs.writeFileSync(path.join(root, "mockups/mock-site.config.ts"), "throw new Error('boom config');\n");
    const t0 = Date.now();
    const res = await tools.get("serve_mock_site")!.execute("t", { dir: root, port: await freePort() });
    expect(Date.now() - t0).toBeLessThan(30_000);
    expect(res.content[0].text).toMatch(/exited during start/);
    expect(children.size).toBe(0);
  }, 60_000);
});
